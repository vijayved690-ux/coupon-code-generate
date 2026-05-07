const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    dateStr: String, // 'YYYY-MM-DD' formatting for daily tracking
    phone: String,
    name: String,
    team: String, // 'SS' or 'B'
    keyword: String, // The bot they replied to
    answers: [{ type: String }], // Their text replies
    adminReplyText: String // Status of admin reply
}, { timestamps: true });

module.exports = mongoose.model('SalesLog', schema);
