const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    keyword: { type: String, required: true, unique: true }, 
    team: { type: String, required: true }, // 'SS' or 'B'
    time: { type: String, required: true }, // Format: "09:00", "14:30"
    questions: [{ type: String }] // Dynamic array (Jitne chahe utne questions)
}, { timestamps: true });

module.exports = mongoose.model('SalesQuestion', schema);
