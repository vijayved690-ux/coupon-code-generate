const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    discountPercentage: { type: Number, required: true },
    targetName: { type: String },
    doctorPhone: { type: String },
    proPhone: { type: String },
    location: { type: String },
    audienceType: { type: String },
    source: { type: String },
    expiryDate: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
    redeemedAt: { type: Date },
    branchRedeemed: { type: String },
    rating: { type: Number, default: 0 } // YAHAN RATING ADD KIYI HAI
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);
