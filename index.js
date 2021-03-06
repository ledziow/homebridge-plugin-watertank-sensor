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
    BATTERY: 'batteryType',
    BATTERYLEVEL: 'batterylevel'
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

    this.active = 0;
    this.cache = undefined;
    this.isFetching = false;
    this.callbackQueue = [];
    this.software = undefined;
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

                            self.software = location.software;

                            var temp_data = {
                                'temperature': location.measurement.temperature,
                                'waterlevel': location.measurement.percent,
                                'statusbattery': location.measurement.volts,
                                'last_con': location.measurement.datatime
                            };
                            data = temp_data;
                        }
                    })

                    self.cache = data;
                    self.log.info("Fetched data:");
                    for (var item in self.cache) {
                        self.log.info('key:' + item + ' value:' + self.cache[item]);
                    }

                    self.lastupdate = new Date().getTime() / 1000;

                    if (((self.lastupdate / 60) - (new Date(self.cache['last_con']).getTime() / 1000 * 60)) >= 120) {
                        self.active = 0
                    } else {
                        self.active = 1
                    }
                    self.log.info('Last data recieved ' + ((self.lastupdate / 60) - (new Date(self.cache['last_con']).getTime() / 1000 * 60)) + ' min. ago.');

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
                (new Date().getTime() / 1000) - this.lastupdate >= intervalBetweenUpdates||
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
                    break;
                case DATAVAR.BATTERYLEVEL:
                    typeName = "BatteryLevel"
                    value = self._calculate_battery_percentage(data['statusbattery'])
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

    getBatteryLevel: function(next) {
        var self = this

        self._getData(
            batterystatusSensorService,
            DATAVAR.BATTERYLEVEL,
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

    getActiveState: function(callback) {
        this.log('Active status: %s', this.active);
        callback(null, this.active);
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
            .setCharacteristic(Characteristic.Manufacturer, "WL for Mojdomek.eu")
            .setCharacteristic(Characteristic.Model, "WaterTankSensor - Homebridge")
            .setCharacteristic(Characteristic.SoftwareRevision, this.software)
            .setCharacteristic(Characteristic.SerialNumber, this.device_id);
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
            .getCharacteristic(Characteristic.StatusActive).on('get', this.getActiveState.bind(this));
        
        services.push(temperatureSensorService);


        //Battery status
        batterystatusSensorService = new Service.Battery("Battery")
        batterystatusSensorService
            .getCharacteristic(Characteristic.StatusLowBattery)
            .on('get', this.getLowBattery.bind(this));

        batterystatusSensorService
            .getCharacteristic(Characteristic.BatteryLevel)
            .on('get', this.getBatteryLevel.bind(this));
        
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
            .getCharacteristic(Characteristic.StatusActive).on('get', this.getActiveState.bind(this));

        services.push(waterlevelSensorService);

        return services;
    },

    _transformPBatteryLevel: function (statusbattery) {
        if (isNaN(statusbattery) || statusbattery === null || statusbattery === "" || statusbattery === undefined ) {
            return (0); // Error or unknown response
        } else {
            var battery_voltage = parseFloat(statusbattery)
            if (battery_voltage < 5.5) {
                return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
            }
            else {
                return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
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
    },

    _calculate_battery_percentage: function (battery_voltage) {
        if (isNaN(battery_voltage) || battery_voltage === null || battery_voltage === "" || battery_voltage === undefined ) {
            return (0); // Error or unknown response
        } else if (parseFloat(battery_voltage) <= 5.75) {
            return (10); 
        } else if (parseFloat(battery_voltage) > 5.75 && parseFloat(battery_voltage) <= 5.83) {
            return (20); 
        } else if (parseFloat(battery_voltage) > 5.83 && parseFloat(battery_voltage) <= 5.91) {
            return (30); 
        } else if (parseFloat(battery_voltage) > 5.91 && parseFloat(battery_voltage) <= 5.98) {
            return (40); 
        } else if (parseFloat(battery_voltage) > 5.98 && parseFloat(battery_voltage) <= 6.05) {
            return (50); 
        } else if (parseFloat(battery_voltage) > 6.05 && parseFloat(battery_voltage) <= 6.12) {
            return (60); 
        } else if (parseFloat(battery_voltage) > 6.12 && parseFloat(battery_voltage) <= 6.19) {
            return (70); 
        } else if (parseFloat(battery_voltage) > 6.19 && parseFloat(battery_voltage) <= 6.25) {
            return (80); 
        } else if (parseFloat(battery_voltage) > 6.25 && parseFloat(battery_voltage) <= 6.31) {
            return (90); 
        } else if (parseFloat(battery_voltage) > 6.31) {
            return (100); 
        } else {
            return 0;
        }
    }

};
