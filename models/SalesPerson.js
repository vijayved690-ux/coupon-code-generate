const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    team: { type: String, required: true }, // 'SS' or 'B'
    isActive: { type: Boolean, default: true } // Disable karne ke liye
}, { timestamps: true });

module.exports = mongoose.model('SalesPerson', schema);
