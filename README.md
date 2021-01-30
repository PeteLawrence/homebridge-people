# homebridge-people-guest-mode

## What This Plugin Is
This is a plugin for [homebridge](https://github.com/nfarina/homebridge). It's a forked version of [homebridge-people](https://github.com/PeteLawrence/homebridge-people) with a dummy switch called "Guest Mode" designed to override the "Anyone" presence sensor so that you can force presence without onboarding a new person.

## Installation

Before installing this plugin, you should install Homebridge using the [official instructions](https://github.com/homebridge/homebridge/wiki).

### Install via Homebridge Config UI X

1. Search for `Homebridge People Guest Mode` on the Plugins tab of [Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x).
2. Install the `Homebridge People Guest Mode` plugin and use the form to enter your configuration.

### Manual Installation

1. Install this plugin using: `sudo npm install -g homebridge-people-guest-mode --unsafe-perm`.
2. Edit `config.json` manually to add your cameras. See below for instructions on that.

## Manual Configuration

### Most Important Parameters

- `platform`: _(Required)_ Must always be set to `People`.
- `name`: _(Required)_ Set the sensor name for display in the Home app.
- `target`: _(Required)_ IP address or hostname ping should hit to determine presence.

#### Config Example

```json
{
  "platforms": [
    {
      "people": [
        {
          "name": "Zack",
          "target": "zack-wagners-iphone.local"
        },
        {
          "name": "Ellen",
          "target": "10.0.0.77"
        }
      ],
      "platform": "People"
    }
  ]
}
```

### Optional Parameters

- `threshold`: Time in minutes until considered away. (Default: `15`)
- `pingInterval`: Time in milliseconds for how often to ping a device. -1 disables ping. (Default: `10000` or 10 seconds)
- `ignoreReEnterExitSeconds`: Time in seconds to trigger state change if no re-enter/exit occurs. 0 will cause every enter/exit to trigger state change. (Default: `0`)
- `motionTimeout`: The number of seconds after triggering to reset the motion sensor. Set to 0 to disable resetting of motion trigger for MQTT or HTTP. (Default: `1`)
- `webhookPort`: Port to accept incoming webhooks. (Default: `51828`)
- `cacheDirectory`: *ONLY RECOMMENDED FOR EXPERTS* Directory to store cache data in. (Default: Homebridge's persistance directory)

## Thanks
Thanks to:
* [PeteLawrence](https://github.com/PeteLawrence) - for creating a great plugin, Homebrige People
* [nfarina](https://github.com/nfarina) - For creating the Homebridge dummy switch.
