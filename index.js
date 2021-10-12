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
    this.callbackQueue = []
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
            self.log.info('Featching data ...')
            self.callbackQueue.push(callback)
            return
        }

        if (self._shouldUpdate()) {
            self.isFetching = true

            self.log.info('Requesting APIURL: %s',this.api_url)
            request({
                url: this.api_url,
                json: true,
                headers: {
                    'User-Agent': 'Homebridge Plugin',
                }
            },function (err, response, data) {

                self.isFetching = false

                let callbackQueue = self.callbackQueue
                self.callbackQueue = []

                // If no errors
                if (!err && response.statusCode === 200) {

                    data.locations.forEach(function(location) {
                        var device_id = location.id;
            
                        if (device_id === self.device_id) {
                            self.log.info("Found device: %s.", device_id.toString());

                            var temp_data = {
                                'temperature': location.measurement.temperature,
                                'waterlevel': location.measurement.percent,
                                'statusbattery': location.measurement.volts
                            };
                            
                            self.active = location.active
                            data = temp_data
                        }
                    })


                    self.cache = data;
                    self.log.info("Fetched data:");
                    for (var item in self.cache) {
                        self.log.info('key:' + item + ' value:' + self.cache[item]);
                    }

                    self.lastupdate = new Date().getTime() / 1000;
                    callback(null, data, 'Fetch');

                    for (let c of callbackQueue) {
                        c(null, data, 'Cache');
                    }

                    // If error
                } else {
                    self.log.error("Can't connect to Mojdomek.eu API.");
                    callback(err, null, null);

                    for (let c of callbackQueue) {
                        c(err, null, null);
                    }
                }

            });
                
        }
        else {
            // Return cached data
            self.log.info("Pulling data from cache.");
            self.log.info("Cached data:");
            for (var item in self.cache) {
                self.log.info('key:' + item + ' value:' + self.cache[item]);
            }
            callback(null, self.cache, 'Cache');
        }
    },

    /**
     * Check if Update data is needed
     */

    _shouldUpdate: function () {
        this.log.info("Checking cacheExpiryTime.");
        let intervalBetweenUpdates = this.cacheExpiryTime * 60
        return this.lastupdate === 0 ||
                this.lastupdate + intervalBetweenUpdates < (new Date().getTime() / 1000) ||
                this.cache === undefined
    },


    _getData: function(service, type, next) {
        var self = this

        //self.log.info("Service %s", service);

        self.getWaterTankData(function (error, data, source) {
            if (error) {
                service.setCharacteristic(Characteristic.StatusFault, 1);
                self.log.info(error.message);
                return next(error, null);
            }

            let typeName = null
            let value = null

            self.log.info("Updating %s from %s.", type, source);


            switch (type) {
                case DATAVAR.BATTERY:
                    typeName = "StatusLowBattery"
                    value = self._transformPBatteryLevel(data['statusbattery'])
                    service.setCharacteristic(Characteristic.StatusFault, 0);
                    break;
                case DATAVAR.TEMPERATURE:
                    typeName = "Temperature"
                    value = data['temperature']
                    service.setCharacteristic(Characteristic.StatusFault, 0);
                    break;
                case DATAVAR.WATERLEVEL:
                    typeName = "WaterLevel"
                    value = self._check_waterlevel(data['waterlevel'])
                    service.setCharacteristic(Characteristic.StatusFault, 0);
                    break;
                default:
                    let error = new Error("Unknown data type: " + type)
                    self.log.info(error.message);
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
        temperatureSensorService = new Service.TemperatureSensor("Temperature")
        temperatureSensorService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: -100,
                maxValue: 100
            })
            .on('get', this.getTemperature.bind(this));
        temperatureSensorService
            .getCharacteristic(Characteristic.StatusActive).on('get', this.active);
        
        services.push(temperatureSensorService);


        //Battery status
        batterystatusSensorService = new Service.Battery("StatusLowBattery")
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

        waterlevelSensorService.isPrimaryService = true;
        waterlevelSensorService.name = "WaterLevel";
        waterlevelSensorService
            .getCharacteristic(Characteristic.StatusActive).on('get', this.active);

        services.push(waterlevelSensorService);

        return services;
    },

    _transformPBatteryLevel: function (statusbattery) {
        if (isNaN(statusbattery) || statusbattery === null || statusbattery === "" || statusbattery === undefined ) {
            return (0); // Error or unknown response
        } else {
            var battery_voltage = parseFloat(statusbattery)
            if (battery_voltage <= 6.5 && battery_voltage >= 6) {
                return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            }
            else {
                return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
            }
        }
    },

    _check_waterlevel: function (waterlevel) {
        if (isNaN(waterlevel) || waterlevel === null || waterlevel === "" || waterlevel === undefined ) {
            return (0); // Error or unknown response
        } else {
            var waterlevel_percentage = parseFloat(waterlevel)
            if (waterlevel_percentage < 0) {
                return 0;
            }
            else {
                return waterlevel_percentage;
            }
        }
    }

};
