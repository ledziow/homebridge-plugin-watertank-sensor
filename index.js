"use strict";

var waterlevelSensorService;
var temperatureSensorService;
var batterystatusSensorService;

var Service, Characteristic;
var request = require('request');

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-plugin-watertank-sensor", "WaterTankSensor", WaterTankSensor);
};

//DataSet
const DATAVAR = {
    WATERLEVEL: 'watertankType',
    TEMPERATURE: 'temperatureType',
    BATTERY: 'batteryType'
};

function WaterTankSensor(log, config) {
    this.log = log;

    this.name = config.name || 'WaterTankSensor';
    this.user_id = config.user_id;
    this.device_id = config.device_id;

    if (!this.user_id) {
        throw new Error("No 'user_id' config value");
    }

    if (!this.device_id) {
        throw new Error("No 'device_id' config value");
    }

    this.active = false;
    this.cache = undefined;
    this.isFetching = false
    this.api_url = "https://mojdomek.eu/api/api.php?id=" + this.user_id;

    this.cacheExpiryTime = Number(config['cacheExpiryTime'])
        if (isNaN(this.cacheExpiryTime)) {
            this.cacheExpiryTime = 10
            this.log.error("Wrong config 'cacheExpiryTime' parameter. Set to default.")
        } else if (this.cacheExpiryTime < 1) {
            this.cacheExpiryTime = 10
            this.log.error("'cacheExpiryTime' lower then 1. Set to default.")
        }

        this.log.info("cacheExpiryTime set: " + this.cacheExpiryTime.toString())
}


WaterTankSensor.prototype = {

    /**
     * Get all data from WaterTankSensor
     */
    getWaterTankData: function (callback) {
        var self = this;

        if (self.isFetching) {
            self.callbackQueue.push(callback)
            return
        }

        if (self._shouldUpdate()) {
            self.isFetching = true

            // Make request only every ten minutes
            if (this.lastupdate === 0 || this.lastupdate + 600 < (new Date().getTime() / 1000) || this.cache === undefined) {

                console.log('APIURL: %s',this.api_url)
                request({
                    url: this.api_url,
                    json: true,
                    headers: {
                        'User-Agent': 'Homebridge Plugin',
                    }
                },function (err, response, data) {

                    self.isFetching = false

                    // If no errors
                    if (!err && response.statusCode === 200) {

                        data.locations.forEach(function(location) {
                            var device_id = location.id;
                            console.log(location);
                            console.log(device_id);
                
                            if (device_id === self.device_id) {
                                this.log.info("Found device: %s.", device_id.toString());

                                temp_data = {
                                    'temperature': location.measurement.temperature,
                                    'waterlevel': location.measurement.percent,
                                    'statusbattery': location.measurement.volts
                                };
                                
                                self.active = location.active

                                data = temp_data
                
                            }
                        })


                        self.cache = data;
                        this.log.info("Cached data: %s.", data.toString());
                        self.lastupdate = new Date().getTime() / 1000;
                        callback(null, data, 'Fetch');

                        // If error
                    } else {
                        self.log.error("Can't connect to Mojdomek.eu API.");
                        callback(err, null, null);
                    }

                });

                // Return cached data
            } else {
                self.log.info("Pulling data from cache.");
                console.log("Pulling data from cache.");
                callback(null, self.cache, 'Cache');
            }
        }
    },

    /**
     * Check if Update data is needed
     */

    _shouldUpdate: function () {
        this.log.info("Checking cacheExpiryTime.");
        console.log("Checking cacheExpiryTime.");
        let intervalBetweenUpdates = this.cacheExpiryTime * 60
        return this.lastupdate === 0 ||
                this.lastupdate + intervalBetweenUpdates < (new Date().getTime() / 1000) ||
                this.cache === undefined
    },


    _getData: function(service, type, next) {
        var self = this

        self.getWaterTankData(function (error, data, source) {
            if (error) {
                service.setCharacteristic(Characteristic.StatusFault, 1);
                self.log(error.message);
                return next(error, null);
            }

            service.setCharacteristic(Characteristic.StatusFault, 0);

            let typeName = null
            let value = null

            switch (type) {
                case DATAVAR.BATTERY:
                    typeName = "StatusLowBattery"
                    value = self._transformPBatteryLevel(data.statusbattery)
                    break;
                case DATAVAR.TEMPERATURE:
                    typeName = "Temperature"
                    value = data.temperature
                    break;
                case DATAVAR.WATERLEVEL:
                    typeName = "WaterLevel"
                    value = data.waterlevel
                    break;
                default:
                    let error = new Error("Unknown data type: " + type)
                    self.log(error.message);
                    return next(error, null);
            }

            self.log.info("Update %s: %s from [%s].", typeName, value.toString(), source);

            return next(null, value);
          })
    },

    /**
     * Get TEMP
     */
    getTemperature: function(next) {
        var self = this

        self._getData(
            temperatureSensorService,
            DATAVAR.TEMPERATURE,
            next
        )
    },

    getLowBattery: function(next) {
        var self = this

        self._getData(
            batterystatusSensorService,
            DATAVAR.BATTERY,
            next
        )
    },

    getWaterLevel: function(next) {
        var self = this

        self._getData(
            waterlevelSensorService,
            DATAVAR.WATERLEVEL,
            next
        )
    },

    identify: function (callback) {
        this.log("Identify requested!");
        callback(); // success
    },


    // Services 
    getServices: function () {

        var services = [];

        /**
         * Informations
         */
        var informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Mojdomek.eu")
            .setCharacteristic(Characteristic.Model, "WaterTankSensor")
            .setCharacteristic(Characteristic.SerialNumber, "123-456");
        services.push(informationService);


        //Temeprature
        let temperatureSensorService = new Service.TemperatureSensor("Temperature")
        temperatureSensorService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: -100,
                maxValue: 100
            })
            .on('get', this.getTemperature.bind(this));
        
        services.push(temperatureSensorService);


        //Battery status
        let batterystatusSensorService = new Service.Battery("StatusLowBattery")
        batterystatusSensorService
            .getCharacteristic(Characteristic.StatusLowBattery)
            .on('get', this.getLowBattery.bind(this));
        
        services.push(batterystatusSensorService);


        /**
         * humiditySensorService
         */
        waterlevelSensorService = new Service.HumiditySensor("WaterLevel")

        waterlevelSensorService
            .getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .on('get', this.getWaterLevel.bind(this));

        services.push(waterlevelSensorService);

        return services;
    },

    _transformPBatteryLevel: function (statusbattery) {
        if (isNaN(statusbattery) || statusbattery === null || statusbattery === "" || statusbattery === undefined ) {
            return (0); // Error or unknown response
        } else {
            battery_voltage = parseFloat(statusbattery)
            if (battery_voltage <= 6.5 && battery_voltage >= 6) {
                return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            }
            else {
                return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
            }
        }
    }

};