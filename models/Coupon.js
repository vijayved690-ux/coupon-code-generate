const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: { 
        type: String, 
        required: true, 
        unique: true, 
        length: 5 
    },
    discountPercentage: { 
        type: Number, 
        required: true 
    },
    doctorPhone: { 
        type: String, 
        required: true 
    },
    isUsed: { 
        type: Boolean, 
        default: false 
    },
    source: { 
        type: String, 
        enum: ['Campaign', 'Requested'], 
        default: 'Campaign' 
    },
    expiryDate: { 
        type: Date, 
        required: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

couponSchema.index({ doctorPhone: 1, createdAt: 1 });
module.exports = mongoose.model('Coupon', couponSchema);
