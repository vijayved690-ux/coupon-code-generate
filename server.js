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

// Serve Admin UI
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// -----------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------
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

async function sendWatiMessage(phone, templateName, params) {
    try {
        await axios.post(`${process.env.WATI_API_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`, {
            template_name: templateName,
            broadcast_name: 'UIC_Coupon_Campaign',
            parameters: params
        }, {
            headers: { 'Authorization': `Bearer ${process.env.WATI_BEARER_TOKEN}` }
        });
    } catch (err) {
        console.error(`WATI Error for ${phone}:`, err.response?.data || err.message);
    }
}

// -----------------------------------------
// API ROUTES
// -----------------------------------------

// 1. SHOOT CAMPAIGN
app.post('/api/campaign/shoot', async (req, res) => {
    try {
        const { doctors, discount, expiryDate } = req.body;
        const formattedDate = new Date(expiryDate).toLocaleDateString('en-GB'); 
        
        for (let doc of doctors) {
            const code = await generateUniqueCode();
            await Coupon.create({ 
                code, 
                discountPercentage: discount, 
                doctorPhone: doc.phone,
                expiryDate: new Date(expiryDate)
            });
            
            // Dynamic template selection based on discount (e.g., uic_promo_10, uic_promo_20)
            const templateName = `uic_promo_${discount}`;
            const params = [
                { name: 'name', value: doc.name },
                { name: 'code', value: code },
                { name: 'expiry', value: formattedDate }
            ];
            await sendWatiMessage(doc.phone, templateName, params);
        }
        res.status(200).json({ success: true, message: "Campaign Executed" });
    } catch (error) {
        res.status(500).json({ error: 'Campaign execution failed', details: error.message });
    }
});

// 2. WATI WEBHOOK (More Coupon Request)
app.post('/api/wati/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (data.buttonText === 'More Coupon' || data.text === 'More Coupon') {
            const phone = data.waId; 
            
            // Limit Check: Max 5 requested per day
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            
            const couponsToday = await Coupon.countDocuments({
                doctorPhone: phone,
                source: 'Requested',
                createdAt: { $gte: startOfDay }
            });

            if (couponsToday >= 5) {
                return res.json({ status: 'limit_reached' });
            }

            // --- SMART LOGIC: Check last discount given to this doctor ---
            const lastCoupon = await Coupon.findOne({ doctorPhone: phone }).sort({ createdAt: -1 });
            const dynamicDiscount = lastCoupon ? lastCoupon.discountPercentage : 10; // Default to 10% if no history found
            
            // Set expiry to 7 days from today for extra requested coupons
            const extraCouponExpiry = new Date();
            extraCouponExpiry.setDate(extraCouponExpiry.getDate() + 7);
            const formattedExpiry = extraCouponExpiry.toLocaleDateString('en-GB');

            let newCodes = [];
            for(let i = 0; i < 5; i++) {
                const code = await generateUniqueCode();
                await Coupon.create({ 
                    code, 
                    discountPercentage: dynamicDiscount, 
                    doctorPhone: phone,
                    source: 'Requested',
                    expiryDate: extraCouponExpiry
                });
                newCodes.push(code);
            }

            // Send WATI message with the 5 new codes
            const params = [
                { name: 'codes', value: newCodes.join(', ') },
                { name: 'expiry', value: formattedExpiry }
            ];
            await sendWatiMessage(phone, 'extra_coupons_template', params);
        }
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(500);
    }
});

// 3. ADMIN DASHBOARD STATS
app.get('/api/admin/dashboard-stats', async (req, res) => {
    try {
        const totalSent = await Coupon.countDocuments();
        const usedCount = await Coupon.countDocuments({ isUsed: true });
        const requestedCount = await Coupon.countDocuments({ source: 'Requested' });
        
        const today = new Date();
        const expiredCount = await Coupon.countDocuments({ expiryDate: { $lt: today }, isUsed: false });

        res.json({
            totalSent,
            usedCount,
            requestedCount,
            unusedCount: totalSent - usedCount - expiredCount,
            expiredCount
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// 4. ADMIN DASHBOARD LOGS
app.get('/api/admin/logs', async (req, res) => {
    try {
        const logs = await Coupon.find().sort({ createdAt: -1 }).limit(100);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch logs" });
    }
});

// 5. VALIDATE COUPON (Portal Check)
app.post('/api/coupon/validate', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ code });

        if (!coupon) return res.status(404).json({ valid: false, message: "Code not found" });
        if (coupon.isUsed) return res.status(400).json({ valid: false, message: "Coupon already used" });

        if (new Date() > coupon.expiryDate) {
            return res.status(400).json({ valid: false, message: "This coupon has expired!" });
        }

        res.json({ valid: true, discountPercentage: coupon.discountPercentage });
    } catch (error) {
        res.status(500).json({ error: "Server error during validation" });
    }
});

// 6. REDEEM COUPON
app.post('/api/coupon/redeem', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ code });

        if (!coupon || coupon.isUsed || new Date() > coupon.expiryDate) {
            return res.status(400).json({ success: false, message: "Invalid, expired, or already used" });
        }

        coupon.isUsed = true;
        await coupon.save();
        res.json({ success: true, message: "Coupon applied successfully" });
    } catch (error) {
        res.status(500).json({ error: "Server error during redemption" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
