const deepmerge         = require('deepmerge');

let Cache               = require('./cache');
let Remote              = require('./remote');
let SwitchAccessory     = require('./accessories/switch');
let TelevisionAccessory = require('./accessories/television');
let EventEmitter        = require('events');

let Homebridge, Platform, Storage;

module.exports = class Device extends EventEmitter {
    constructor(config, platform, homebridge) {
        super();

        Platform   = platform;
        Storage    = platform.storage;
        Homebridge = homebridge;

        this.config = deepmerge.all([
            {
                uuid: '',
                wol: {}
            },
            Platform.config,
            config
        ]);

        // Check if we have device info
        if (!this.config.ip) throw new Error(`TV IP address is required for ${this.config.name}`);
        if (!this.config.mac) throw new Error(`TV MAC address is required for ${this.config.name}`);

        this.UUID         = Homebridge.hap.uuid.generate(this.config.mac + this.config.uuid);
        this.applications = null;

        this.initLogger();
        this.initStorage();
        this.initRefresh();
        this.initInfo();

        this.cache       = new Cache();
        this.remote      = new Remote(this);
        this.accessories = [
            new TelevisionAccessory(this, Platform, Homebridge)
        ];

        // Switches
        this.config.switches.forEach((element, index) => {
            try {
               let accessory = new SwitchAccessory({
                    ...element,
                    identifier: parseInt(index) + 1
               }, this, Platform, Homebridge);

                this.accessories.push(accessory);
            } catch(error) {
                this.log.error(error.message);
            }
        });

        setTimeout(() => this.emit('loaded'), 8000);
    }

    initLogger() {
        let logger = Object.assign(Object.create(Object.getPrototypeOf(Platform.log)), Platform.log, {
            prefix: this.config.name
        });

        this.log       = function(message) { logger.log(null, message); }
        this.log.error = function(message) { logger.error(message); }
        this.log.debug = function(message) { logger.debug('[DEBUG]', message); }
    }

    initStorage() {
        this.storage = new Proxy(Storage.get(this.UUID), {
            set: (obj, prop, value) => {
                obj[prop] = value;
                Storage.save();
                return true;
            }
        });
    }

    initRefresh() {
        if ([null, false].indexOf(this.config.refresh) !== -1) { return; }

        this.on('paired', () => {
            let intervals = require('./options/refresh')(this.config);

            if (intervals.main) {
                setInterval(() => this.accessories[0].services.main.getValue(), intervals.main);
            }

            if (intervals.switch && this.accessories.length > 1) {
                setInterval(() => this.accessories.slice(1).forEach(element => element.services.main.getValue()), intervals.switch);
            }
        });
    }

    initInfo() {
        this.on('loaded', () => {
            this.remote.getInfo().then(data => {
                this.storage['frametv']    = data.device.FrameTVSupport == 'true';
                this.storage['tokenauth']  = data.device.TokenAuthSupport == 'true';
                this.storage['powerstate'] = data.device.PowerState !== undefined;

                // Reinitialize Remote after we
                // fetch device informations
                this.remote.init();
            }).catch(() => {});
        });
    }
}