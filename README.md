**NOTE: Since version X.X.X the configuration changed to platform. You must fix your configuration to match the new configuration format.**
***
# homebridge-people
This is a plugin for [homebridge](https://github.com/nfarina/homebridge). It monitors who is at home, based on their smartphone being seen on the network recently.

It can also receive webhooks sent by location-aware mobile apps (such as [Locative](https://my.locative.io), which can use iBeacons and geofencing to provide faster and more accurate location information.

# Installation

1. Install homebridge (if not already installed) using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-people`
3. Update your configuration file. See below for a sample.

# Configuration

```
"platforms": [
    {
        "platform": "People",
        "threshold" : 15, // (optional, in minutes, default: 15)
        "anyoneSensor" : true, // (optional, default: true)
        "nooneSensor" : false, // (optional, default: false)
        "webhookPort": 51828, // (optional, default: 51828)
        "cacheDirectory": "./.node-persist/storage", // (optional, default: "./.node-persist/storage")
        "pingInterval": 10000,  // (optional, in milliseconds, default: 10000, if set to -1 than the ping mechanism will not be used)
        "ignoreReEnterExitSeconds": 0,  // (optional, in minutes, default: 0, if set to 0 than every enter/exit will trigger state change otherwise the state will only change if no re-enter/exit occurs in specified number of seconds)
        "people" : [
           { "name" : "Pete", "target" : "PetesiPhone" },
           { "name" : "Someone Else", "target" : "192.168.1.68" }
        ]
    }
]
```

```target``` may be either a hostname or an IP address

# How it works
* When started homebridge-people will continually ping the IP address associated with each person defined in config.json if `pingInterval` is not set to `-1`.
* With an iBeacon or geofencing smartphone app, you can configure a HTTP push to trigger when you enter and exit your 'home' region. This data will be combined with the ping functionality if used to give this plugin more precise presence data.
* When a ping is successful the current timestamp is logged to a file (seen.db.json)
* When a Homekit enabled app looks up the state of a person, the last seen time for that persons device is compared to the current time minus ```threshold``` minutes, and if it is greater assumes that the person is active.

# 'Anyone' and 'No One' sensors
Some HomeKit automations need to happen when "anyone" is home or when "no one" is around, but the default Home app makes this difficult. homebridge-people can automatically create additional sensors called "Anyone" and "No One" to make these automations very easy.

For example, you might want to run your "Arrive Home" scene when _Anyone_ gets home. Or run "Leave Home" when _No One_ is home.

These sensors can be enabled by adding `"anyoneSensor" : true` and `"nooneSensor" : true` to your homebridge `config.json` file.

# Accuracy
This plugin requires that the devices being monitored are connected to the network. iPhones (and I expect others) deliberately disconnect from the network once the screen is turned off to save power, meaning just because the device isn't connected, it doesn't mean that the devices owner isn't at home. Fortunately, iPhones (and I expect others) periodically reconnect to the network to check for updates, emails, etc. This plugin works by keeping track of the last time a device was seen, and comparing that to a threshold value (in minutes).

From a _very_ limited amount of testing, I've found that a threshold of 15 minutes seems to work well for the phones that I have around, but for different phones this may or may not work. The threshold can be configured in the ```.homebridge/config.json``` file.

Additionally, if you're using a location-aware mobile app to range for iBeacons and geofences, this plugin can receive a HTTP push from the app to immediately see you as present or not present when you physically enter or exit your desired region. This is particularly useful for "Arrive Home" and "Depart Home" HomeKit automations which ideally happen faster than every 15 minutes.

# Pairing with a location-aware mobile app
Apps like [Locative](https://my.locative.io) range for iBeacons and geofences by using core location APIs available on your smartphone. With bluetooth and location services turned on, these apps can provide an instantaneous update when you enter and exit a desired region.

To use this plugin with one of these apps, configure your region and set the HTTP push to `http://youripaddress:51828/?sensor=[name]&state=true` for arrival, and `http://youripaddress:51828/?sensor=[name]&state=false` for departure, where `[name]` is the name of the person the device belongs to as specified in your config under `people`. *Note:* you may need to enable port forwarding on your router to accomplish this.

By default homebridge-people listens on port 51828 for updates.  This can be changed by setting `webhookPort` in your homebridge `config.json`.

# Notes
## Running on a raspberry pi as non 'pi' user
On some versions of raspbian, users are not able to use the ping program by default. If none of your devices show online try running ```sudo chmod u+s /bin/ping```. Thanks to oberstmueller for the tip.
