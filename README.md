# homebridge-plugin-watertank-sensor

**Homebridge plugin for showing water level in watertank based on information from SZ-02 sensor (https://mojdomek.eu/products.php) **

Project is based on [homebridge-smogomierz](https://github.com/bfaliszek/homebridge-smogomierz).

## Instalation
1. Install Homebridge using: `(sudo) npm install -g --unsafe-perm homebridge`.
1. Install this plugin using: `(sudo) npm install -g homebridge-plugin-watertank-sensor`.
1. Login to https://mojdomek.eu/profil/login.php and find your user_id and device_id.
1. Update your configuration file like the example below.

This plugin is returning data such as: Water Level, Temperature, BatteryLevel.

## Configuration
Example config.json

```json
"accessories": [
    {
          "accessory": "WaterTankSensor",
          "name": "WaterTank Home",
          "user_id": "<REDACTED>",
          "device_id": "<REDACTED>",
          "cacheExpiryTime": 10
    }
]
```

## Config file
Fields:
- `accessory` must be "WaterTankSensor" (required).
- `name` Is the name of accessory, you can change it! (required).
- `user_id` id of your user account at https://mojdomek.eu, available in https://mojdomek.eu/profil/support_api.php after logon (required).
- `device_id` id of your device/sensor, available in https://mojdomek.eu/profil/support_api.php after logon (required).
- `cacheExpiryTime` time (in minutes) after which cache will be updated.
