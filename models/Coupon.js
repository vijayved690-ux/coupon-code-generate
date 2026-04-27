const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, length: 5 },
    discountPercentage: { type: Number, required: true },
    targetName: { type: String }, 
    doctorPhone: { type: String, required: true }, 
    location: { type: String }, 
    proPhone: { type: String }, 
    audienceType: { type: String, enum: ['Doctor', 'Patient'], required: true },
    isUsed: { type: Boolean, default: false },
    redeemedAt: { type: Date }, 
    source: { type: String, enum: ['Campaign', 'Requested'], default: 'Campaign' },
    expiryDate: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});

couponSchema.index({ doctorPhone: 1, createdAt: 1 });
module.exports = mongoose.model('Coupon', couponSchema);
