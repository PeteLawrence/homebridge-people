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

  homebridge.registerAccessory("homebridge-people", "people", PeopleAccessory);
}

function PeopleAccessory(log, config) {
  this.log = log;
  this.name = config['name'];
  this.people = config['people'];
  this.anyoneSensor = config['anyoneSensor'] || true;
  this.nooneSensor = config['nooneSensor'] || false;
  this.threshold = config['threshold'] || 15;
  this.webhookPort = config["webhookPort"] || 51828;
  this.cacheDirectory = config["cacheDirectory"] || HomebridgeAPI.user.persistPath();
  this.pingInterval = config["pingInterval"] || 1000;
  this.ignoreReEnterExitSeconds = config["ignoreReEnterExitSeconds"] || 0;
  this.services = [];
  this.storage = require('node-persist');
  this.stateCache = [];
  this.webhookQueue = [];

  //Init storage
  this.storage.initSync({
    dir: this.cacheDirectory
  });

  //Setup an OccupancySensor for each person defined in the config file
  this.people.forEach(function(personConfig) {
    //Fix old config entries that use a key of 'ip' instead of 'target'
    if (personConfig.ip && !personConfig.target) {
      personConfig.target = personConfig.ip;
    }
    var target = personConfig.target;
    this.createService(personConfig.name, target, this.getState.bind(this, target));
  }.bind(this));

  if(this.anyoneSensor) {
    //Setup an Anyone OccupancySensor
    this.createService(SENSOR_ANYONE, SENSOR_ANYONE, this.getAnyoneState.bind(this));
  }

  if(this.nooneSensor) {
    //Setup an No One OccupancySensor
    this.createService(SENSOR_NOONE, SENSOR_NOONE, this.getNoOneState.bind(this));
  }
  
  this.populateStateCache();

  //Start pinging the hosts
  if(this.pingInterval > -1) {
    this.pingHosts();
  }

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
        for(var i = 0; i < this.people.length; i++){
          var person = this.people[i];
          var target = person.target
          if(person.name.toLowerCase() === sensor) {
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
}

PeopleAccessory.prototype.clearWebhookQueueForTarget = function(target) {
    for (var i = 0; i < this.webhookQueue.length; i++) {
        var webhookQueueEntry = this.webhookQueue[i];
        if(webhookQueueEntry.target == target) {
            clearTimeout(webhookQueueEntry.timeoutvar);
            this.webhookQueue.splice(i, 1);
            break;
        }
    }
}

PeopleAccessory.prototype.runWebhookFromQueueForTarget = function(target) {
    for (var i = 0; i < this.webhookQueue.length; i++) {
        var webhookQueueEntry = this.webhookQueue[i];
        if(webhookQueueEntry.target == target) {
            this.log('Running hook for ' + target + ' -> ' + webhookQueueEntry.newState);
            this.webhookQueue.splice(i, 1);
            this.storage.setItem('webhook_' + target, Date.now());
            this.setNewState(target, webhookQueueEntry.newState);
            break;
        }
    }
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

PeopleAccessory.prototype.pingHosts = function() {
  this.people.forEach(function(personConfig) {
    var target = personConfig.target;
    this.log('webhookIsOutdated -> ' + this.webhookIsOutdated(target));
    if(this.webhookIsOutdated(target)) {
        this.log('Running ping for ' + target);
        ping.sys.probe(target, function(state){
          this.log('Ping for ' + target + ' -> ' + state);
          this.log('webhookIsOutdated -> ' + this.webhookIsOutdated(target));
          if(this.webhookIsOutdated(target)) {
              //If target is alive update the last seen time
              if (state) {
                this.storage.setItem('ping_' + target, Date.now());
              }
              var newState = this.targetIsActive(target);
              this.setNewState(target, newState);
          }
        }.bind(this));
    }
  }.bind(this));
  setTimeout(PeopleAccessory.prototype.pingHosts.bind(this), this.pingInterval);
}

PeopleAccessory.prototype.setNewState = function(target, newState) {
  var oldState = this.getStateFromCache(target);
  if (oldState != newState) {
    //Update our internal cache of states
    this.updateStateCache(target, newState);

    //Trigger an update to the Homekit service associated with the target
    var service = this.getServiceForTarget(target);
    service.getCharacteristic(Characteristic.OccupancyDetected).setValue(newState);

    var anyoneState = this.getAnyoneStateFromCache();
    
    //Trigger an update to the Homekit service associated with SENSOR_ANYONE
    var anyoneService = this.getServiceForTarget(SENSOR_ANYONE);
    if (anyoneService) {
      anyoneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(anyoneState);
    }

    //Trigger an update to the Homekit service associated with SENSOR_NOONE
    var noOneService = this.getServiceForTarget(SENSOR_NOONE);
    if (noOneService) {
      noOneService.getCharacteristic(Characteristic.OccupancyDetected).setValue(!anyoneState);
    }
  }
}

PeopleAccessory.prototype.targetIsActive = function(target) {
  var lastSeenUnix = this.storage.getItem('ping_' + target);
  if (lastSeenUnix) {
    var lastSeenMoment = moment(lastSeenUnix);
    var activeThreshold = moment().subtract(this.threshold, 'm');
    return lastSeenMoment.isAfter(activeThreshold);
  }
  return false;
}

PeopleAccessory.prototype.webhookIsOutdated = function(target) {
  var lastWebhookUnix = this.storage.getItem('webhook_' + target);
  if (lastWebhookUnix) {
    var lastWebhookMoment = moment(lastWebhookUnix);
    var activeThreshold = moment().subtract(this.threshold, 'm');
    return lastWebhookMoment.isBefore(activeThreshold);
  }
  return true;
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
