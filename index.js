var ping = require('ping');
var moment = require('moment');
var request = require("request");
var http = require('http');
var url = require('url');
var DEFAULT_REQUEST_TIMEOUT = 10000;

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
  this.anyoneSensor = config['anyoneSensor'] || true;
  this.nooneSensor = config['nooneSensor'] || false;
  this.threshold = config['threshold'];
  this.webhookPort = config["webhookPort"] || 51828;
  this.services = [];
  this.storage = require('node-persist');
  this.stateCache = [];

  //Init storage
  this.storage.initSync({
    dir: HomebridgeAPI.user.persistPath()
  });

  //Setup an OccupancySensor for each person defined in the config file
  this.people.forEach(function(personConfig) {
    //Fix old config entries that use a key of 'ip' instead of 'target'
    if (personConfig.ip && !personConfig.target) {
      personConfig.target = personConfig.ip;
    }
    var target = personConfig.target;
    this.createService(personConfig.name, target, this.getState.bind(this, target)).bind(this);
  }.bind(this));

  if(this.anyoneSensor) {
    //Setup an Anyone OccupancySensor
    this.createService('Anyone', 'Anyone', this.getAnyoneState.bind(this)).bind(this);
  }

  if(this.nooneSensor) {
    //Setup an No One OccupancySensor
    this.createService('No One', 'No One', this.getNoOneState.bind(this)).bind(this);
  }
  
  this.populateStateCache();

  //Start pinging the hosts
  this.pingHosts();

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
        var state = (theUrlParams.state == "true");
        this.log('Received hook for ' + sensor + ' -> ' + state);
        var responseBody = {
          success: true
        };

        for(var i = 0; i < this.people.length; i++){
          var person = this.people[i];
          var target = person.target
          if(person.name.toLowerCase() === sensor) {
            if (state) {
              this.storage.setItem('person_' + target, Date.now());
            } else {
            }

            var oldState = this.getStateFromCache(target);
            var newState = state;
            if (oldState != newState) {
              //Update our internal cache of states
              this.updateStateCache(target, newState);

              //Trigger an update to the Homekit service associated with the target
              var service = this.getServiceForTarget(target);
              service.getCharacteristic(Characteristic.OccupancyDetected).setValue(newState);

              //Trigger an update to the Homekit service associated with 'Anyone'
              var anyoneService = this.getServiceForTarget('Anyone');
              if (anyoneService) {
                var anyoneState = this.getAnyoneStateFromCache();
                anyoneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(anyoneState);
              }
              var anyoneState = this.getAnyoneStateFromCache();
              anyoneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(anyoneState);

              //Trigger an update to the Homekit service associated with 'No One'
              var noOneService = this.getServiceForTarget('No One');
              if (noOneService) {
                var noOneState = this.getNoOneStateFromCache();
                noOneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(noOneState);
              }
            }
          }
        }
        response.write(JSON.stringify(responseBody));
        response.end();
      }
    }).bind(this));
  }).bind(this)).listen(this.webhookPort);
  this.log("WebHook: Started server on port '%s'.", this.webhookPort);
}

PeopleAccessory.prototype.createService = function(name, target, stateFunction) {
    var service = new Service.OccupancySensor(name, name);
    service.target = target;
    service
      .getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', stateFunction);
    this.services.push(service);
}

PeopleAccessory.prototype.populateStateCache = function() {
  this.people.forEach(function(personConfig) {
    var target = personConfig.target;
    var isActive = this.targetIsActive(target);

    this.updateStateCache(target, isActive);
  }.bind(this));
}

PeopleAccessory.prototype.updateStateCache = function(target, state) {
  this.stateCache[target] = state;
}

PeopleAccessory.prototype.getState = function(target, callback) {
  callback(null, this.getStateFromCache(target));
}

PeopleAccessory.prototype.getStateFromCache = function(target) {
  return this.stateCache[target];
}

PeopleAccessory.prototype.getAnyoneState = function(callback) {
  var isAnyoneActive = this.getAnyoneStateFromCache();

  callback(null, isAnyoneActive);
}

PeopleAccessory.prototype.getAnyoneStateFromCache = function() {
  for (var i = 0; i < this.people.length; i++) {
    var personConfig = this.people[i];
    var target = personConfig.target;

    var isActive = this.getStateFromCache(target);

    if (isActive) {
      return true;
    }
  }

  return false;
}

PeopleAccessory.prototype.getNoOneState = function(callback) {
  var isAnyoneActive = this.getAnyoneStateFromCache();
  callback(null, !isAnyoneActive);
}

PeopleAccessory.prototype.getNoOneStateFromCache = function() {
  return false;
}

PeopleAccessory.prototype.pingHosts = function() {
  this.people.forEach(function(personConfig) {

    var target = personConfig.target;
    ping.sys.probe(target, function(state){
      //If target is alive update the last seen time
      if (state) {
        this.storage.setItem('person_' + target, Date.now());
      }

      var oldState = this.getStateFromCache(target);
      var newState = this.targetIsActive(target);
      if (oldState != newState) {
        //Update our internal cache of states
        this.updateStateCache(target, newState);

        //Trigger an update to the Homekit service associated with the target
        var service = this.getServiceForTarget(target);
        service.getCharacteristic(Characteristic.OccupancyDetected).setValue(newState);

        //Trigger an update to the Homekit service associated with 'Anyone'
        var anyoneService = this.getServiceForTarget('Anyone');
        if (anyoneService) {
          var anyoneState = this.getAnyoneStateFromCache();
          anyoneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(anyoneState);
        }

        //Trigger an update to the Homekit service associated with 'No One'
        var noOneService = this.getServiceForTarget('No One');
        if (noOneService) {
          var noOneState = this.getNoOneStateFromCache();
          noOneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(noOneState);
        }
      }
    }.bind(this));
  }.bind(this));

  setTimeout(PeopleAccessory.prototype.pingHosts.bind(this), 1000);
}

PeopleAccessory.prototype.targetIsActive = function(target) {
  var lastSeenUnix = this.storage.getItem('person_' + target);

  if (lastSeenUnix) {
    var lastSeenMoment = moment(lastSeenUnix);
    var activeThreshold = moment().subtract(this.threshold, 'm');

    var isActive = lastSeenMoment.isAfter(activeThreshold);

    if (isActive) {
      return true;
    }
  }

  return false;
}

PeopleAccessory.prototype.getServices = function() {
  return this.services;
}

PeopleAccessory.prototype.getServiceForTarget = function(target) {
  var service = this.services.find(function(target, service) {
    return (service.target == target);
  }.bind(this, target));

  return service;
}
