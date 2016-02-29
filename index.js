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
  config['people'].forEach(function(person) {
    var service = new Service.OccupancySensor(person.name, person.name);
    service
      .getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', this.getState.bind(this, person.ip));

    this.services.push(service);
  }.bind(this));

  //Start pinging the hosts
  this.pingHosts();
}

PeopleAccessory.prototype.getServices = function() {
  return this.services;
}

PeopleAccessory.prototype.getState = function(ip, callback) {
  var lastSeenUnix = this.storage.getItem('person_' + ip);

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
  this.people.forEach(function(person) {
    ping.sys.probe(person.ip, function(isAlive){
      if (isAlive) {
        this.storage.setItem('person_' + person.ip, Date.now());
      }
    }.bind(this));
  }.bind(this));

  setTimeout(PeopleAccessory.prototype.pingHosts.bind(this), 1000);
}
