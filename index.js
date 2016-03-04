var ping = require('ping');
var moment = require('moment');

var Service, Characteristic, HomebridgeAPI;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;

  homebridge.registerAccessory("homebridge-people", "people", PeopleAccessory);
}

function PeopleAccessory(log, config) {
  this.log = log;
  this.name = config['name'];
  this.people = config['people'];
  this.threshold = config['threshold'];
  this.services = [];
  this.storage = require('node-persist');

  //Init storage
  this.storage.initSync({
    dir: HomebridgeAPI.user.persistPath()
  });

  //Setup an OccupancySensor for each person defined in the config file
  config['people'].forEach(function(personConfig) {
    var target = this.getTarget(personConfig);
    var service = new Service.OccupancySensor(personConfig.name, personConfig.name);
    service
      .getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', this.getState.bind(this, target));

    this.services.push(service);
  }.bind(this));

  //Start pinging the hosts
  this.pingHosts();
}

PeopleAccessory.prototype.getServices = function() {
  return this.services;
}

PeopleAccessory.prototype.getState = function(target, callback) {
  var lastSeenUnix = this.storage.getItem('person_' + target);

  //Check whether we have a last seen record or not
  if (!lastSeenUnix) {
    //No record, so the device must be offline
    callback(null, false);
    return;
  } else {
    //Found record, work out whether it is recent enough or not
    var lastSeenMoment = moment(lastSeenUnix);
    var activeTreshold = moment().subtract(this.threshold, 'm');
    var isActive = lastSeenMoment.isAfter(activeTreshold);

    callback(null, isActive);
  }
}

PeopleAccessory.prototype.pingHosts = function() {
  this.people.forEach(function(personConfig) {

    var target = this.getTarget(personConfig);

    ping.sys.probe(target, function(isAlive){
      if (isAlive) {
        this.storage.setItem('person_' + target, Date.now());
      }
    }.bind(this));
  }.bind(this));

  setTimeout(PeopleAccessory.prototype.pingHosts.bind(this), 1000);
}

/**
 * Handle old config entries that use a key of 'ip' instead of 'target'
 */
PeopleAccessory.prototype.getTarget = function(personConfig) {
  if (personConfig.ip) {
    return personConfig;
  }

  return personConfig.target;
}
