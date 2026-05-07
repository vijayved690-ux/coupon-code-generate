const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    keyword: { type: String, required: true, unique: true }, // e.g., SS46, B1
    questions: [{ type: String }] // Array of 3-4 questions
}, { timestamps: true });

module.exports = mongoose.model('SalesQuestion', schema);
