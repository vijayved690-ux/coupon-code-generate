require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const Coupon = require('./models/Coupon');
const Agent = require('./models/Agent');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection & Call Center Team Auto-Setup
mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('MongoDB Connected Successfully!');
        const team = [
            { name: 'Ruchit', phone: '7600082217' },
            { name: 'Mital', phone: '9558591212' },
            { name: 'Aditi', phone: '8488931212' },
            { name: 'Jay', phone: '9274682553' },
            { name: 'Khyati', phone: '7490029085' }
        ];
        for (let person of team) {
            const exists = await Agent.findOne({ phone: person.phone });
            if (!exists) await Agent.create(person);
        }
    })
    .catch(err => console.error('MongoDB Error:', err));

// Helpers
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
            template_name: templateName, broadcast_name: 'UIC_Campaign', parameters: params
        }, { headers: { 'Authorization': `Bearer ${process.env.WATI_BEARER_TOKEN}` } });
    } catch (err) { console.error(`WATI Error:`, err.message); }
}

// ---------------- API ROUTES ----------------

// 1. AUTHENTICATION
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === (process.env.ADMIN_PASS || 'UicAdmin@2026')) {
        return res.json({ success: true, role: 'admin' });
    }
    if (username === 'user' && password === (process.env.USER_PASS || 'UicStaff@2026')) {
        return res.json({ success: true, role: 'user' });
    }
    res.status(401).json({ success: false, message: "Invalid Credentials" });
});

// 2. SHOOT CAMPAIGN
app.post('/api/campaign/shoot', async (req, res) => {
    try {
        const { targetList, discount, expiryDate, audienceType } = req.body;
        const formattedDate = new Date(expiryDate).toLocaleDateString('en-GB'); 
        
        for (let target of targetList) {
            const code = await generateUniqueCode();
            await Coupon.create({ 
                code, discountPercentage: discount, targetName: target.name,
                doctorPhone: target.phone, location: target.location || 'Ahmedabad',
                proPhone: target.proNumber || null, audienceType: audienceType, 
                expiryDate: new Date(expiryDate)
            });
            const templateName = audienceType === 'Doctor' ? `uic_promo_${discount}` : `patient_promo_${discount}`;
            await sendWatiMessage(target.phone, templateName, [
                { name: 'name', value: target.name }, { name: 'code', value: code }, { name: 'expiry', value: formattedDate }
            ]);
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. WATI WEBHOOK (Intelligence)
app.post('/api/wati/webhook', async (req, res) => {
    try {
        const { waId, buttonText, text } = req.body;
        const btn = buttonText || text;
        const patientBtns = ['I will use the coupon', 'I will use the cupon', 'Need more assistance', 'looking for more assistance', 'Book my test', 'book my test'];

        // A. Doctor Button -> Call PRO
        if (btn === 'Sales Team Please Call Me') {
            const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
            if (lastCoupon && lastCoupon.proPhone) {
                await axios.post('https://api.in1.smartflo.tatateleservices.com/v1/clicktocall', {
                    agent_number: lastCoupon.proPhone, destination_number: waId, caller_id: "07969690921"
                }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}` } });
                await sendWatiMessage(waId, 'sales_call_ack_template', []);
            }
        } 
        // B. Doctor Button -> More Coupon
        else if (btn === 'I Want More Coupon') {
            const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
            const discount = lastCoupon ? lastCoupon.discountPercentage : 10;
            const audience = lastCoupon ? lastCoupon.audienceType : 'Doctor';
            let newCodes = [];
            const expiry = new Date(); expiry.setDate(expiry.getDate() + 7);
            
            for(let i=0; i<5; i++) {
                const c = await generateUniqueCode();
                await Coupon.create({ 
                    code: c, discountPercentage: discount, targetName: lastCoupon?.targetName || 'Requested',
                    doctorPhone: waId, audienceType: audience, source: 'Requested', expiryDate: expiry,
                    proPhone: lastCoupon?.proPhone, location: lastCoupon?.location
                });
                newCodes.push(c);
            }
            await sendWatiMessage(waId, 'extra_coupons_template', [
                { name: 'codes', value: newCodes.join(', ') }, { name: 'expiry', value: expiry.toLocaleDateString('en-GB') }
            ]);
        }
        // C. Patient Buttons -> Round Robin Call Center
        else if (patientBtns.includes(btn)) {
            if (btn === 'I will use the coupon' || btn === 'I will use the cupon') {
                await sendWatiMessage(waId, 'patient_thankyou', []);
            } else {
                const nextAgent = await Agent.findOne({ isOnline: true }).sort({ lastCalledAt: 1 });
                if (nextAgent) {
                    nextAgent.lastCalledAt = new Date(); await nextAgent.save();
                    try {
                        await axios.post('https://api.in1.smartflo.tatateleservices.com/v1/clicktocall', {
                            agent_number: nextAgent.phone, destination_number: waId, caller_id: "07969690921"
                        }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}`, 'Content-Type': 'application/json' } });
                        await sendWatiMessage(waId, 'sales_call_ack_template', []); 
                    } catch (e) { console.error("Tata Tele Error:", e.message); }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) { res.sendStatus(500); }
});

// 4. RECEPTION / USER API (Validate & Redeem)
app.post('/api/coupon/validate', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ code });
        if (!coupon) return res.status(404).json({ valid: false, message: "Invalid Code! (Not Found)" });
        if (coupon.isUsed) return res.status(400).json({ valid: false, message: "Coupon already redeemed!" });
        if (new Date() > coupon.expiryDate) return res.status(400).json({ valid: false, message: "This coupon has expired!" });
        
        res.json({ valid: true, discount: coupon.discountPercentage, name: coupon.targetName || 'Unknown', type: coupon.audienceType });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/coupon/redeem', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ code });
        if (!coupon || coupon.isUsed || new Date() > coupon.expiryDate) {
            return res.status(400).json({ success: false, message: "Cannot redeem." });
        }
        coupon.isUsed = true;
        coupon.redeemedAt = new Date();
        await coupon.save();
        res.json({ success: true, message: "Coupon redeemed successfully!" });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// 5. ADMIN DASHBOARD API
app.get('/api/agents', async (req, res) => res.json(await Agent.find().sort({ name: 1 })));
app.post('/api/agents/toggle', async (req, res) => {
    await Agent.findByIdAndUpdate(req.body.id, { isOnline: req.body.isOnline });
    res.json({ success: true });
});
app.get('/api/admin/dashboard-stats', async (req, res) => {
    const total = await Coupon.countDocuments();
    const redeemed = await Coupon.countDocuments({ isUsed: true });
    res.json({ totalSent: total, usedCount: redeemed });
});
app.get('/api/admin/logs', async (req, res) => res.json(await Coupon.find().sort({ createdAt: -1 }).limit(100)));
app.get('/api/user/redeemed-today', async (req, res) => {
    const start = new Date(); start.setHours(0,0,0,0);
    const logs = await Coupon.find({ isUsed: true, redeemedAt: { $gte: start } }).sort({ redeemedAt: -1 });
    res.json(logs);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));
