const { registerPlugin } = require('@capacitor/core');

const Wifi = registerPlugin('Wifi');
const NetStore = registerPlugin('NetStore');

module.exports = { Wifi, NetStore };
