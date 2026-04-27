const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    isOnline: { type: Boolean, default: true },
    lastCalledAt: { type: Date, default: Date.now } 
});

module.exports = mongoose.model('Agent', agentSchema);
