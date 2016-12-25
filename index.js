var ping = require('ping');
var moment = require('moment');
var request = require("request");
var http = require('http');
var url = require('url');
var DEFAULT_REQUEST_TIMEOUT = 10000;
var SENSOR_ANYONE = 'Anyone';
var SENSOR_NOONE = 'No One';

var Service, Characteristic, HomebridgeAPI;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;

    homebridge.registerPlatform("homebridge-people", "People", PeoplePlatform);
    homebridge.registerAccessory("homebridge-people", "PeopleAccessory", PeopleAccessory);
    homebridge.registerAccessory("homebridge-people", "PeopleAllAccessory", PeopleAllAccessory);
}

// #######################
// PeoplePlatform
// #######################

function PeoplePlatform(log, config){
    this.log = log;
    this.threshold = config['threshold'] || 15;
    this.anyoneSensor = config['anyoneSensor'] || true;
    this.nooneSensor = config['nooneSensor'] || false;
    this.webhookPort = config["webhookPort"] || 51828;
    this.cacheDirectory = config["cacheDirectory"] || HomebridgeAPI.user.persistPath();
    this.pingInterval = config["pingInterval"] || 10000;
    this.ignoreReEnterExitSeconds = config["ignoreReEnterExitSeconds"] || 0;
    this.people = config['people'];
    this.storage = require('node-persist');
    this.storage.initSync({dir:this.cacheDirectory});
    this.webhookQueue = [];
}

PeoplePlatform.prototype = {

    accessories: function(callback) {
        this.accessories = [];
        this.peopleAccessories = [];
        for(var i = 0; i < this.people.length; i++){
            var peopleAccessory = new PeopleAccessory(this.log, this.people[i], this);
            this.accessories.push(peopleAccessory);
            this.peopleAccessories.push(peopleAccessory);
        }
        if(this.anyoneSensor) {
            this.peopleAnyOneAccessory = new PeopleAllAccessory(this.log, SENSOR_ANYONE, this);
            this.accessories.push(this.peopleAnyOneAccessory);
        }
        if(this.nooneSensor) {
            this.peopleNoOneAccessory = new PeopleAllAccessory(this.log, SENSOR_NOONE, this);
            this.accessories.push(this.peopleNoOneAccessory);
        }
        callback(this.accessories);
        
        this.startServer();
    },
    
    startServer: function() {
        //
        // HTTP webserver code influenced by benzman81's great
        // homebridge-http-webhooks homebridge plugin.
        // https://github.com/benzman81/homebridge-http-webhooks
        //
        
        // Start the HTTP webserver
        http.createServer((function(request, response) {
            var theUrl = request.url;
            var theUrlParts = url.parse(theUrl, true);
            var theUrlParams = theUrlParts.query;
            var body = [];
            request.on('error', (function(err) {
              this.log("WebHook error: %s.", err);
            }).bind(this)).on('data', function(chunk) {
              body.push(chunk);
            }).on('end', (function() {
              body = Buffer.concat(body).toString();

              response.on('error', function(err) {
                this.log("WebHook error: %s.", err);
              });

              response.statusCode = 200;
              response.setHeader('Content-Type', 'application/json');

              if(!theUrlParams.sensor || !theUrlParams.state) {
                response.statusCode = 404;
                response.setHeader("Content-Type", "text/plain");
                var errorText = "WebHook error: No sensor or state specified in request.";
                this.log(errorText);
                response.write(errorText);
                response.end();
              }
              else {
                var sensor = theUrlParams.sensor.toLowerCase();
                var newState = (theUrlParams.state == "true");
                this.log('Received hook for ' + sensor + ' -> ' + newState);
                var responseBody = {
                  success: true
                };
                for(var i = 0; i < this.peopleAccessories.length; i++){
                  var peopleAccessory = this.peopleAccessories[i];
                  var target = peopleAccessory.target
                  if(peopleAccessory.name.toLowerCase() === sensor) {
                    this.clearWebhookQueueForTarget(target);
                    this.webhookQueue.push({"target": target, "newState": newState, "timeoutvar": setTimeout((function(){ 
                        this.runWebhookFromQueueForTarget(target);
                    }).bind(this),  this.ignoreReEnterExitSeconds * 1000)});
                    break;
                  }
                }
                response.write(JSON.stringify(responseBody));
                response.end();
              }
            }).bind(this));
        }).bind(this)).listen(this.webhookPort);
        this.log("WebHook: Started server on port '%s'.", this.webhookPort);
    },
    
    clearWebhookQueueForTarget: function(target) {
        for (var i = 0; i < this.webhookQueue.length; i++) {
            var webhookQueueEntry = this.webhookQueue[i];
            if(webhookQueueEntry.target == target) {
                clearTimeout(webhookQueueEntry.timeoutvar);
                this.webhookQueue.splice(i, 1);
                break;
            }
        }
    },

    runWebhookFromQueueForTarget: function(target) {
        for (var i = 0; i < this.webhookQueue.length; i++) {
            var webhookQueueEntry = this.webhookQueue[i];
            if(webhookQueueEntry.target == target) {
                this.log('Running hook for ' + target + ' -> ' + webhookQueueEntry.newState);
                this.webhookQueue.splice(i, 1);
                if (webhookQueueEntry.newState) {
                    this.storage.setItemSync('ping_' + target, Date.now());
                }
                this.storage.setItemSync('webhook_' + target, Date.now());
                this.getPeopleAccessoryForTarget(target).setNewState(webhookQueueEntry.newState);
                break;
            }
        }
    },
    
    getPeopleAccessoryForTarget: function(target) {
        for(var i = 0; i < this.peopleAccessories.length; i++){
            var peopleAccessory = this.peopleAccessories[i];
            if(peopleAccessory.target === target) {
                return peopleAccessory;
            }
        }
        return null;
    }
}

// #######################
// PeopleAccessory
// #######################

function PeopleAccessory(log, config, platform) {
    this.log = log;
    this.name = config['name'];
    this.target = config['target'];
    this.platform = platform;
    this.stateCache = false;
    
    this.service = new Service.OccupancySensor(this.name);
    this.service
        .getCharacteristic(Characteristic.OccupancyDetected)
        .on('get', this.getState.bind(this));
  
    this.initStateCache();

    if(this.platform.pingInterval > -1) {
        this.ping();
    }
}

PeopleAccessory.prototype.getState = function(callback) {
  callback(null, this.stateCache);
}

PeopleAccessory.prototype.initStateCache = function() {
    var isActive = this.isActive();
    this.stateCache = isActive;
}

PeopleAccessory.prototype.isActive = function() {
    var lastSeenUnix = this.platform.storage.getItemSync('ping_' + this.target);
    if (lastSeenUnix) {
        var lastSeenMoment = moment(lastSeenUnix);
        var activeThreshold = moment().subtract(this.platform.threshold, 'm');
        return lastSeenMoment.isAfter(activeThreshold);
    }
    return false;
}

PeopleAccessory.prototype.ping = function() {
    if(this.webhookIsOutdated()) {
        //this.log("Pinging %s %s.", this.target, moment().format());
        ping.sys.probe(this.target, function(state){
            if(this.webhookIsOutdated()) {
                if (state) {
                    this.platform.storage.setItemSync('ping_' + this.target, Date.now());
                }
                var newState = this.isActive();
                this.setNewState(newState);
            }
            setTimeout(PeopleAccessory.prototype.ping.bind(this), this.platform.pingInterval);
        }.bind(this));
    }
    else {
        setTimeout(PeopleAccessory.prototype.ping.bind(this), this.platform.pingInterval);
    }
}

PeopleAccessory.prototype.webhookIsOutdated = function() {
    var lastWebhookUnix = this.platform.storage.getItemSync('webhook_' + this.target);
    if (lastWebhookUnix) {
        var lastWebhookMoment = moment(lastWebhookUnix);
        var activeThreshold = moment().subtract(this.platform.threshold, 'm');
        return lastWebhookMoment.isBefore(activeThreshold);
    }
    return true;
}

PeopleAccessory.prototype.setNewState = function(newState) {
    var oldState = this.stateCache;
    if (oldState != newState) {
        this.stateCache = newState;
        this.service.getCharacteristic(Characteristic.OccupancyDetected).setValue(newState);

        if(this.platform.peopleAnyOneAccessory) {
            this.platform.peopleAnyOneAccessory.refreshState();
        }
        
        if(this.platform.peopleNoOneAccessory) {
            this.platform.peopleNoOneAccessory.refreshState();
        }
    }
}

PeopleAccessory.prototype.getServices = function() {
    return [this.service];
}

// #######################
// PeopleAllAccessory
// #######################

function PeopleAllAccessory(log, name, platform) {
    this.log = log;
    this.name = name;
    this.platform = platform;
    
    this.service = new Service.OccupancySensor(this.name);
    this.service
        .getCharacteristic(Characteristic.OccupancyDetected)
        .on('get', this.getState.bind(this));
}

PeopleAllAccessory.prototype.getState = function(callback) {
    callback(null, this.getStateFromCache());
}

PeopleAllAccessory.prototype.getStateFromCache = function() {
    var isAnyoneActive = this.getAnyoneStateFromCache();
    if(this.name === SENSOR_NOONE) {
        return !isAnyoneActive;
    }
    else {
        return isAnyoneActive;
    }
}

PeopleAllAccessory.prototype.getAnyoneStateFromCache = function() {
    for(var i = 0; i < this.platform.peopleAccessories.length; i++){
        var peopleAccessory = this.platform.peopleAccessories[i];
        var isActive = peopleAccessory.stateCache;
        if(isActive) {
            return true;
        }
    }
    return false;
}

PeopleAllAccessory.prototype.refreshState = function() {
    this.service.getCharacteristic(Characteristic.OccupancyDetected).setValue(this.getStateFromCache());
}

PeopleAllAccessory.prototype.getServices = function() {
    return [this.service];
}