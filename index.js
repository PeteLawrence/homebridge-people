import arp from 'arp-a-x';
import { createServer } from 'http';
import moment from 'moment';
import { sys } from 'ping';
import { parse } from 'url';

const DEFAULT_IGNORE_RE_ENTER_EXIT_SECONDS = 0;
const DEFAULT_PING_INTERVAL = 10000;
const DEFAULT_THRESHOLD = 15;
const DEFAULT_WEBHOOK_PORT = 51828;
const REGEX_MAC_ADDRESS = /^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/;
const SENSOR_ANYONE = 'Anyone';
const SWITCH_GUEST_MODE = 'Guest Mode';

let Service, Characteristic, HomebridgeAPI;

export default function(homebridge) {

    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;

    homebridge.registerPlatform('homebridge-people-guest-mode', 'People', PeoplePlatform);
    homebridge.registerAccessory('homebridge-people-guest-mode', 'PeopleAccessory', PeopleAccessory);
    homebridge.registerAccessory('homebridge-people-guest-mode', 'PeopleAllAccessory', PeopleAllAccessory);
    homebridge.registerAccessory('homebridge-people-guest-mode', 'GuestModeSwitch', GuestModeSwitch);
}

// #######################
// PeoplePlatform
// #######################

class PeoplePlatform {

    constructor(log, config) {

        this.log = log;
        this.threshold = config['threshold'] || DEFAULT_THRESHOLD;
        this.webhookPort = config['webhookPort'] || DEFAULT_WEBHOOK_PORT;
        this.cacheDirectory = config['cacheDirectory'] || HomebridgeAPI.user.persistPath();
        this.pingInterval = config['pingInterval'] || DEFAULT_PING_INTERVAL;
        this.ignoreReEnterExitSeconds = config['ignoreReEnterExitSeconds'] || DEFAULT_IGNORE_RE_ENTER_EXIT_SECONDS;
        this.people = config['people'];
        this.storage = require('node-persist');
        this.storage.initSync({ dir: this.cacheDirectory });
        this.webhookQueue = [];
    }

    accessories(callback) {

        this.accessories = [];
        this.peopleAccessories = [];

        for (var i = 0; i < this.people.length; i++) {
            var peopleAccessory = new PeopleAccessory(this.log, this.people[i], this);
            this.accessories.push(peopleAccessory);
            this.peopleAccessories.push(peopleAccessory);
        }

        this.guestModeSwitch = new GuestModeSwitch(this.log, SWITCH_GUEST_MODE, this);
        this.accessories.push(this.guestModeSwitch);

        this.peopleAnyOneAccessory = new PeopleAllAccessory(this.log, SENSOR_ANYONE, this);
        this.accessories.push(this.peopleAnyOneAccessory);

        callback(this.accessories);

        this.startServer();
    }

    // HTTP webserver code influenced by benzman81's great
    // homebridge-http-webhooks homebridge plugin.
    // https://github.com/benzman81/homebridge-http-webhooks
    startServer() {

        // Start the HTTP webserver
        createServer((function (request, response) {
            var theUrl = request.url;
            var theUrlParts = parse(theUrl, true);
            var theUrlParams = theUrlParts.query;
            var body = [];
            request.on('error', (function (err) {
                this.log('WebHook error: %s.', err);
            }).bind(this)).on('data', function (chunk) {
                body.push(chunk);
            }).on('end', (function () {
                body = Buffer.concat(body).toString();

                response.on('error', function (err) {
                    this.log('WebHook error: %s.', err);
                });

                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json');

                if (!theUrlParams.sensor || !theUrlParams.state) {
                    response.statusCode = 404;
                    response.setHeader('Content-Type', 'text/plain');
                    var errorText = 'WebHook error: No sensor or state specified in request.';
                    this.log(errorText);
                    response.write(errorText);
                    response.end();
                }
                else {
                    var sensor = theUrlParams.sensor.toLowerCase();
                    var newState = (theUrlParams.state == 'true');
                    this.log('Received hook for ' + sensor + ' -> ' + newState);
                    var responseBody = {
                        success: true
                    };
                    for (var i = 0; i < this.peopleAccessories.length; i++) {
                        var peopleAccessory = this.peopleAccessories[i];
                        var target = peopleAccessory.target;
                        if (peopleAccessory.name.toLowerCase() === sensor) {
                            this.clearWebhookQueueForTarget(target);
                            this.webhookQueue.push({
                                'target': target, 'newState': newState, 'timeoutvar': setTimeout((function () {
                                    this.runWebhookFromQueueForTarget(target);
                                }).bind(this), peopleAccessory.ignoreReEnterExitSeconds * 1000)
                            });
                            break;
                        }
                    }
                    response.write(JSON.stringify(responseBody));
                    response.end();
                }
            }).bind(this));
        }).bind(this)).listen(this.webhookPort);
        this.log("WebHook: Started server on port '%s'.", this.webhookPort);
    }

    clearWebhookQueueForTarget(target) {

        for (var i = 0; i < this.webhookQueue.length; i++) {
            var webhookQueueEntry = this.webhookQueue[i];
            if (webhookQueueEntry.target == target) {
                clearTimeout(webhookQueueEntry.timeoutvar);
                this.webhookQueue.splice(i, 1);
                break;
            }
        }
    }

    runWebhookFromQueueForTarget(target) {

        for (var i = 0; i < this.webhookQueue.length; i++) {
            var webhookQueueEntry = this.webhookQueue[i];
            if (webhookQueueEntry.target == target) {
                this.log('Running hook for ' + target + ' -> ' + webhookQueueEntry.newState);
                this.webhookQueue.splice(i, 1);
                this.storage.setItemSync('lastWebhook_' + target, Date.now());
                this.getPeopleAccessoryForTarget(target).setNewState(webhookQueueEntry.newState);
                break;
            }
        }
    }

    getPeopleAccessoryForTarget(target) {

        for (var i = 0; i < this.peopleAccessories.length; i++) {
            var peopleAccessory = this.peopleAccessories[i];
            if (peopleAccessory.target === target) {
                return peopleAccessory;
            }
        }
        return null;
    }
}

// #######################
// PeopleAccessory
// #######################

class PeopleAccessory {

    constructor(log, config, platform) {

        this.log = log;
        this.name = config['name'];
        this.target = config['target'];
        this.platform = platform;
        this.threshold = config['threshold'] || this.platform.threshold;
        this.pingInterval = config['pingInterval'] || this.platform.pingInterval;
        this.ignoreReEnterExitSeconds = config['ignoreReEnterExitSeconds'] || this.platform.ignoreReEnterExitSeconds;
        this.stateCache = false;
        this.service = new Service.OccupancySensor(this.name);
        this.service.getCharacteristic(Characteristic.OccupancyDetected).on('get', this.getState.bind(this));

        this.initStateCache();

        if (this.pingInterval > -1) {
            this.ping();
        }
    }

    getState(callback) {
        callback(null, PeopleAccessory.encodeState(this.stateCache));
    }

    initStateCache() {
        var isActive = this.isActive();
        this.stateCache = isActive;
    }

    isActive() {

        var lastSeenUnix = this.platform.storage.getItemSync('lastSuccessfulPing_' + this.target);
        if (lastSeenUnix) {
            var lastSeenMoment = moment(lastSeenUnix);
            var activeThreshold = moment().subtract(this.threshold, 'm');
            return lastSeenMoment.isAfter(activeThreshold);
        }
        return false;
    }

    ping() {

        if (this.webhookIsOutdated()) {

            if (isMacAddress(this.target)) {
                arp.table(function (error, entry) {
                    if (error) {
                        this.log('ARP Error: %s', error.message);
                    } else {
                        if (this.webhookIsOutdated()) {
                            if (entry) {
                                this.platform.storage.setItemSync('lastSuccessfulPing_' + this.target, Date.now());
                                if (entry.mac == this.target.toLowerCase()) {
                                    if (entry.flag != "0x0") {
                                        if (this.successfulPingOccurredAfterWebhook()) {
                                            var newState = this.isActive();
                                            this.setNewState(newState);
                                        }
                                    }
                                }
                            }
                        }
                        setTimeout(PeopleAccessory.prototype.ping.bind(this), this.pingInterval);
                    }
                }.bind(this));
            } else {
                sys.probe(this.target, function (state) {
                    if (this.webhookIsOutdated()) {
                        if (state) {
                            this.platform.storage.setItemSync('lastSuccessfulPing_' + this.target, Date.now());
                        }
                        if (this.successfulPingOccurredAfterWebhook()) {
                            var newState = this.isActive();
                            this.setNewState(newState);
                        }
                    }
                    setTimeout(PeopleAccessory.prototype.ping.bind(this), this.pingInterval);
                }.bind(this));
            }
        }
        else {
            setTimeout(PeopleAccessory.prototype.ping.bind(this), this.pingInterval);
        }
    }

    webhookIsOutdated() {

        var lastWebhookUnix = this.platform.storage.getItemSync('lastWebhook_' + this.target);
        if (lastWebhookUnix) {
            var lastWebhookMoment = moment(lastWebhookUnix);
            var activeThreshold = moment().subtract(this.threshold, 'm');
            return lastWebhookMoment.isBefore(activeThreshold);
        }
        return true;
    }

    successfulPingOccurredAfterWebhook() {

        var lastSuccessfulPing = this.platform.storage.getItemSync('lastSuccessfulPing_' + this.target);
        if (!lastSuccessfulPing) {
            return false;
        }
        var lastWebhook = this.platform.storage.getItemSync('lastWebhook_' + this.target);
        if (!lastWebhook) {
            return true;
        }
        var lastSuccessfulPingMoment = moment(lastSuccessfulPing);
        var lastWebhookMoment = moment(lastWebhook);
        return lastSuccessfulPingMoment.isAfter(lastWebhookMoment);
    }

    setNewState(newState) {

        if (!isInternetConnected) {
            return;
        }

        var oldState = this.stateCache;

        if (oldState != newState) {
            this.stateCache = newState;
            this.service.getCharacteristic(Characteristic.OccupancyDetected).updateValue(PeopleAccessory.encodeState(newState));

            if (this.platform.peopleAnyOneAccessory) {
                this.platform.peopleAnyOneAccessory.refreshState();
            }

            var lastSuccessfulPingMoment = 'none';
            var lastWebhookMoment = 'none';
            var lastSuccessfulPing = this.platform.storage.getItemSync('lastSuccessfulPing_' + this.target);

            if (lastSuccessfulPing) {
                lastSuccessfulPingMoment = moment(lastSuccessfulPing).format();
            }

            var lastWebhook = this.platform.storage.getItemSync('lastWebhook_' + this.target);

            if (lastWebhook) {
                lastWebhookMoment = moment(lastWebhook).format();
            }

            this.log('Changed occupancy state for %s to %s. Last successful ping %s , last webhook %s .', this.target, newState, lastSuccessfulPingMoment, lastWebhookMoment);
        }
    }

    getServices() {
        return [this.service];
    }

    static encodeState(state) {
        return state ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
    }

    isMacAddress(target) {
        return REGEX_MAC_ADDRESS.test(target);
    }
}

function isInternetConnected() {

    return co(function* () {
        try {
            var response = yield urllib.request('http://google.com/generate_204', { wd: 'nodejs' }); // This is co-request.
            var statusCode = response.statusCode;
            return statusCode == 204;
        } catch (e) {
            return false;
        }
    });
}

// #######################
// PeopleAllAccessory
// #######################
class PeopleAllAccessory {

    constructor(log, name, platform) {
        this.log = log;
        this.name = name;
        this.platform = platform;

        this.service = new Service.OccupancySensor(this.name);
        this.service
            .getCharacteristic(Characteristic.OccupancyDetected)
            .on('get', this.getState.bind(this));
    }

    getState(callback) {
        callback(null, PeopleAccessory.encodeState(this.getStateFromCache()));
    }

    getStateFromCache() {
        return this.getAnyoneStateFromCache();
    }

    getAnyoneStateFromCache() {

        if (this.platform.guestModeSwitch && this.platform.guestModeSwitch.getStateFromCache()) {
            return true;
        }

        for (var i = 0; i < this.platform.peopleAccessories.length; i++) {
            var peopleAccessory = this.platform.peopleAccessories[i];
            var isActive = peopleAccessory.stateCache;
            if (isActive) {
                return true;
            }
        }
        return false;
    }

    refreshState() {
        this.service.getCharacteristic(Characteristic.OccupancyDetected).updateValue(PeopleAccessory.encodeState(this.getStateFromCache()));
    }

    getServices() {
        return [this.service];
    }
}

// #######################
// GuestModeSwitch
// #######################

class GuestModeSwitch {

    constructor(log, name, platform) {

        this.log = log;
        this.name = name;
        this.platform = platform;

        this.service = new Service.Switch(this.name);
        this.service.getCharacteristic(Characteristic.On)
            .on('set', this.setOn.bind(this));

        this.service.setCharacteristic(Characteristic.On, this.getStateFromCache());
    }

    getStateFromCache() {
        var cachedState = this.platform.storage.getItemSync(this.name);
        return cachedState === true;
    }

    setOn(on, callback) {
        this.platform.storage.setItemSync(this.name, on);

        if (this.platform.peopleAnyOneAccessory) {
            this.platform.peopleAnyOneAccessory.refreshState();
        }

        callback();
    }

    getServices() {
        return [this.service];
    }
}




