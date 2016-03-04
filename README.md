# homebridge-people
This is a plugin for homebridge. It monitors who is at home, based on their smartphone being seen on the network recently.

# Installation

1. Install homebridge (if not already installed) using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-people
3. Update your configuration file. See below for a sample.

# Configuration

```
"accessories": [
	{
    "accessory" : "people",
    "name" : "People",
    "people" : [
      { "name" : "Pete", "target" : "PetesiPhone" },
      { "name" : "Someone Else", "target" : "192.168.1.68" }
    ],
    "threshold" : 15
  }
],
```

```target``` may be either a hostname or an IP address

# How it works
* When started homebridge-people will continually ping the IP address associated with each person defined in config.json.
* When a ping is successful the current timestamp is logged to a file (seen.db.json)
* When a Homekit enabled app looks up the state of a person, the last seen time for that persons device is compared to the current time minus ```threshold``` minutes, and if it is greater assumes that the person is active.

# Accuracy
This plugin requires that the devices being monitored are connected to the network.  iPhones (and I expect others) deliberately disconnect from the network once the screen is turned off to save power, meaning just because the device isn't connected, it doesn't mean that the devices owner isn't at home.  Fortunately, iPhones (and I expect others) periodically reconnect to the network to check for updates, emails, etc.  This plugin works by keeping track of the last time a device was seen, and comparing that to a threshold value (in minutes).

From a _very_ limited amount of testing, I've found that a threshold of 15 minutes seems to work well for the phones that I have around, but for different phones this may or may not work.  The threshold can be configured in the ```.homebridge/config.json``` file.
