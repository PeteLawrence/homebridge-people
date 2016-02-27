var ping = require('ping');
var JsonDB = require('node-json-db');
var moment = require('moment');

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-people", "people", PeopleAccessory);
}

function PeopleAccessory(log, config) {
  this.log = log;
  this.name = config['name'];
  this.people = config['people'];
  this.threshold = config['threshold'];
  this.db = new JsonDB("seen.db", true, false);
  this.services = [];

  config['people'].forEach(function(person) {
    var service = new Service.OccupancySensor(person.name, person.name);
    service
      .getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', this.getState.bind(this, person.ip));

    this.services.push(service);
  }.bind(this));

  this.pingHosts();
}

PeopleAccessory.prototype.getServices = function() {
  return this.services;
}

PeopleAccessory.prototype.getState = function(ip, callback) {
  var lastSeen = moment(this.db.getData('/' + ip));
  var activeTreshold = moment().subtract(this.threshold, 'm');

  var isActive = lastSeen.isAfter(activeTreshold);

  callback(null, isActive);
}

PeopleAccessory.prototype.pingHosts = function() {
  this.people.forEach(function(person) {
    ping.sys.probe(person.ip, function(isAlive){
      if (isAlive) {
        this.db.push('/' + person.ip, Date.now());
      }
    }.bind(this));
  }.bind(this));

  setTimeout(PeopleAccessory.prototype.pingHosts.bind(this), 1000);
}
