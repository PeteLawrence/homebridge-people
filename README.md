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
      { "name" : "Pete", "ip" : "192.168.1.67" },
      { "name" : "Someone Else", "ip" : "192.168.1.68" }
    ],
    "threshold" : 5
  }
],
```

# How it works
* When started homebridge-people will continually ping the IP address associated with each person defined in config.json.
* When a ping is successful the current timestamp is logged to a file (seen.db.json)
* When a Homekit enabled app looks up the state of a person, the last seen time for that persons device is compared to the current time minus ```threshold``` minutes, and if it is greater assumes that the person is active.
