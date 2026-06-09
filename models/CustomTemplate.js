const mongoose = require('mongoose');

const customTemplateSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    discountPercentage: { 
        type: String, 
        required: true 
    },
    watiTemplateId: { 
        type: String, 
        required: true 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('CustomTemplate', customTemplateSchema);
