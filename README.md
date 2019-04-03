# homebridge-people-guest-mode
This is a plugin for [homebridge](https://github.com/nfarina/homebridge). It's a forked version of [homebridge-people](https://github.com/PeteLawrence/homebridge-people) with a dummy switch called "Guest Mode" designed to override the "Anyone" presence sensor so that you can force presence without onboarding a new person.

# Installation

1. Install homebridge (if not already installed) using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-people-guest-mode`
3. Update your configuration file. See below for a sample.

# Configuration

```
"platforms": [
    {
        "platform": "People",
        "threshold" : 15,
        "webhookPort": 51828,
        "cacheDirectory": "./.node-persist/storage",
        "pingInterval": 10000,
        "ignoreReEnterExitSeconds": 0,
        "people" : [
            {
                "name" : "Pete",
                "target" : "PetesiPhone",
                "threshold" : 15,
                "pingInterval": 10000,
                "ignoreReEnterExitSeconds": 0
            },
            {
                "name" : "Someone Else",
                "target" : "192.168.1.68",
                "threshold" : 15,
                "pingInterval": 10000,
                "ignoreReEnterExitSeconds": 0
            }
        ]
    }
]
```

# Thanks
Thanks to:
* [PeteLawrence](https://github.com/PeteLawrence) - for creating a great plugin, Homebrige People
* [nfarina](https://github.com/nfarina) - For creating the Homebridge dummy switch.
