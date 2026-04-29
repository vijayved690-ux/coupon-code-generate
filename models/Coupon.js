const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    discountPercentage: { type: Number, required: true },
    targetName: { type: String },
    doctorPhone: { type: String },
    proPhone: { type: String },
    location: { type: String },
    audienceType: { type: String }, // 'Doctor' or 'Patient'
    source: { type: String },
    expiryDate: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
    redeemedAt: { type: Date },
    branchRedeemed: { type: String },
    rating: { type: Number, default: 0 },
    
    // --- Advanced Tracking Fields ---
    requestCallAt: { type: Date },      
    proCallClickedAt: { type: Date },   
    callStatus: { type: String, default: 'None' },
    agentAssigned: { type: String },
    buttonClicked: { type: String }
}, { 
    timestamps: true, 
    strict: false // 🚨 Yeh safety lock lagaya hai taaki DB koi data block na kare
});

module.exports = mongoose.model('Coupon', couponSchema);
