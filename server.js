require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const Coupon = require('./models/Coupon');

const app = express();
app.use(express.json());
app.use(cors());

// Serve Static Frontend (Admin UI)
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// --- HELPER: 5-Digit Unique Code Generator ---
async function generateUniqueCode() {
    let isUnique = false;
    let code;
    while (!isUnique) {
        code = Math.floor(10000 + Math.random() * 90000).toString();
        const exists = await Coupon.findOne({ code });
        if (!exists) isUnique = true;
    }
    return code;
}

// --- HELPER: Send WATI Message ---
async function sendWatiMessage(phone, templateName, params) {
    try {
        await axios.post(`${process.env.WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`, {
            template_name: templateName,
            broadcast_name: 'Doctor_Coupon_Campaign',
            parameters: params
        }, {
            headers: { 'Authorization': `Bearer ${process.env.WATI_BEARER_TOKEN}` }
        });
    } catch (err) {
        console.error(`WATI Error for ${phone}:`, err.response?.data || err.message);
    }
}

// ==========================================
// API ROUTES
// ==========================================

// 1. SHOOT CAMPAIGN (Triggered from UI)
app.post('/api/campaign/shoot', async (req, res) => {
    try {
        const { doctors, discount } = req.body;
        
        for (let doc of doctors) {
            const code = await generateUniqueCode();
            await Coupon.create({ code, discountPercentage: discount, doctorPhone: doc.phone });
            
            const params = [
                { name: 'name', value: doc.name },
                { name: 'discount', value: `${discount}%` },
                { name: 'code', value: code }
            ];
            // Update 'doctor_promo_with_button' to your exact WATI template name
            await sendWatiMessage(doc.phone, 'doctor_promo_with_button', params);
        }
        res.status(200).json({ success: true, message: "Campaign Executed" });
    } catch (error) {
        res.status(500).json({ error: 'Campaign execution failed' });
    }
});

// 2. WATI WEBHOOK (More Coupon Request)
app.post('/api/wati/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (data.buttonText === 'More Coupon' || data.text === 'More Coupon') {
            const phone = data.waId; 
            
            // Check daily limit (Max 5 requested per day)
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            
            const couponsToday = await Coupon.countDocuments({
                doctorPhone: phone,
                source: 'Requested',
                createdAt: { $gte: startOfDay }
            });

            if (couponsToday >= 5) {
                // Optional: Send limit reached message
                return res.json({ status: 'limit_reached' });
            }

            // Generate exactly 5 new codes
            let newCodes = [];
            for(let i = 0; i < 5; i++) {
                const code = await generateUniqueCode();
                await Coupon.create({ 
                    code, 
                    discountPercentage: 10, // Adjust default requested discount here
                    doctorPhone: phone,
                    source: 'Requested'
                });
                newCodes.push(code);
            }

            const params = [{ name: 'codes', value: newCodes.join(', ') }];
            // Update 'extra_coupons_template' to your exact WATI template name
            await sendWatiMessage(phone, 'extra_coupons_template', params);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook Error:", error);
        res.sendStatus(500);
    }
});

// 3. ADMIN DASHBOARD STATS
app.get('/api/admin/dashboard-stats', async (req, res) => {
    const totalSent = await Coupon.countDocuments();
    const usedCount = await Coupon.countDocuments({ isUsed: true });
    const requestedCount = await Coupon.countDocuments({ source: 'Requested' });
    
    res.json({
        totalSent,
        usedCount,
        requestedCount,
        unusedCount: totalSent - usedCount
    });
});

// 4. ADMIN DASHBOARD LOGS
app.get('/api/admin/logs', async (req, res) => {
    const logs = await Coupon.find().sort({ createdAt: -1 }).limit(100); // Last 100 logs
    res.json(logs);
});

// 5. VALIDATE COUPON (For your validation portal)
app.post('/api/coupon/validate', async (req, res) => {
    const { code } = req.body;
    const coupon = await Coupon.findOne({ code });

    if (!coupon) return res.status(404).json({ valid: false, message: "Code not found" });
    if (coupon.isUsed) return res.status(400).json({ valid: false, message: "Coupon already used" });

    res.json({ valid: true, discountPercentage: coupon.discountPercentage });
});

// 6. REDEEM COUPON
app.post('/api/coupon/redeem', async (req, res) => {
    const { code } = req.body;
    const coupon = await Coupon.findOneAndUpdate({ code, isUsed: false }, { isUsed: true }, { new: true });
    
    if (!coupon) return res.status(400).json({ success: false, message: "Invalid or already used" });
    res.json({ success: true, message: "Coupon applied successfully" });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
