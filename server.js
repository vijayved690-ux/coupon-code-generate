require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path'); // Path module yahan zaroori hai
const Coupon = require('./models/Coupon');
const Agent = require('./models/Agent');
const Activity = require('./models/Activity'); 

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------
// DATABASE CONNECTION & AGENT SEEDING
// -----------------------------------------
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

// -----------------------------------------
// HELPERS
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
            broadcast_name: 'UIC_Campaign', 
            parameters: params
        }, { 
            headers: { 'Authorization': `Bearer ${process.env.WATI_BEARER_TOKEN}` } 
        });
    } catch (err) { 
        console.error(`WATI Error for ${phone}:`, err.response?.data || err.message); 
    }
}

async function logActivity(user, action, details) {
    try {
        await Activity.create({ user, action, details });
    } catch (e) {
        console.error('Logging Error:', e);
    }
}

// -----------------------------------------
// 1. AUTHENTICATION API
// -----------------------------------------
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

// -----------------------------------------
// 2. ADMIN SECURE DATA & ACTIVITY APIs
// -----------------------------------------
app.post('/api/admin/reset-data', async (req, res) => {
    const { password } = req.body;
    if (password !== '456789') {
        await logActivity('Admin Panel', 'RESET ATTEMPT FAILED', 'Incorrect password used');
        return res.status(403).json({ success: false, message: "Wrong Reset Password!" });
    }
    
    await Coupon.deleteMany({});
    await logActivity('Admin Panel', 'DATA RESET SUCCESS', 'All coupon data completely wiped');
    res.json({ success: true });
});

app.post('/api/log-action', async (req, res) => {
    await logActivity(req.body.user || 'Unknown', req.body.action, req.body.details || '');
    res.json({ success: true });
});

app.get('/api/admin/activity-logs', async (req, res) => {
    res.json(await Activity.find().sort({ timestamp: -1 }).limit(50));
});

// -----------------------------------------
// 3. SHOOT CAMPAIGN API
// -----------------------------------------
app.post('/api/campaign/shoot', async (req, res) => {
    try {
        const { targetList, discount, expiryDate, audienceType } = req.body;
        const formattedDate = new Date(expiryDate).toLocaleDateString('en-GB'); 
        let validCount = 0;
        
        for (let target of targetList) {
            if (!target.phone || target.phone.toString().trim() === '') continue;

            validCount++;
            const code = await generateUniqueCode();
            
            await Coupon.create({ 
                code, 
                discountPercentage: discount, 
                targetName: target.name,
                doctorPhone: target.phone, 
                location: target.location || 'Ahmedabad',
                proPhone: target.proNumber || null, 
                audienceType: audienceType, 
                expiryDate: new Date(expiryDate)
            });

            const templateMap = {
                'Doctor_10': 'temp_10_doctor_coupon',
                'Doctor_20': 'temp_20_doctor_coupon',
                'Doctor_30': 'temp_doctor_30_dis_new',
                'Patient_10': 'patient_10_dis_temp',
                'Patient_20': 'patient_20_dis_temp',
                'Patient_30': 'patient_30_temp_new_dis'
            };

            const templateName = templateMap[`${audienceType}_${discount}`];
            if (!templateName) continue;

            const safeName = (target.name && target.name.toString().trim() !== '') ? target.name.toString().trim() : 'Doctor';

            const params = [
                { name: '1', value: safeName }, 
                { name: '2', value: code.toString() }, 
                { name: '3', value: formattedDate.toString() }
            ];
            
            await sendWatiMessage(target.phone, templateName, params);
        }
        
        await logActivity('Admin Panel', 'CAMPAIGN FIRED', `Generated ${validCount} coupons for ${audienceType} (${discount}% OFF)`);
        res.json({ success: true });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// -----------------------------------------
// 4. WATI WEBHOOK (INTELLIGENCE & CALLING)
// -----------------------------------------
app.post('/api/wati/webhook', async (req, res) => {
    try {
        const { waId, buttonText, text } = req.body;
        const btn = (buttonText || text || "").trim();
        const patientBtns = ['I will use the coupon', 'I will use the cupon', 'Need more assistance', 'looking for more assistance', 'Book my test', 'book my test'];

        // A. DOCTOR: PRO CALL
        if (btn === 'Sales Team Please Call Me') {
            const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
            if (lastCoupon && lastCoupon.proPhone) {
                await axios.post('https://api.in1.smartflo.tatateleservices.com/v1/clicktocall', {
                    agent_number: lastCoupon.proPhone, 
                    destination_number: waId, 
                    caller_id: "07969690921"
                }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}` } });
                
                await sendWatiMessage(waId, 'sales_call_ack_template', []);
                await logActivity('WATI Webhook', 'PRO CALL TRIGGERED', `Doctor ${waId} -> PRO ${lastCoupon.proPhone}`);
            }
        } 
        // B. DOCTOR: MORE COUPONS
        else if (btn === 'I want to More Coupon' || btn === 'I Want More Coupon') {
            const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
            const discount = lastCoupon ? lastCoupon.discountPercentage : 30;
            let newCodes = [];
            const expiry = new Date(); expiry.setMonth(expiry.getMonth() + 1); 
            
            for(let i=0; i<5; i++) {
                const c = await generateUniqueCode();
                await Coupon.create({ 
                    code: c, discountPercentage: discount, targetName: lastCoupon?.targetName || 'Doctor',
                    doctorPhone: waId, audienceType: 'Doctor', source: 'Requested', 
                    expiryDate: expiry, proPhone: lastCoupon?.proPhone, location: lastCoupon?.location
                });
                newCodes.push(c);
            }
            
            await sendWatiMessage(waId, 'dis_more_temp_all', [
                { name: '1', value: `${discount}% Discount` }, 
                { name: '2', value: newCodes.join(', ') }, 
                { name: '3', value: expiry.toLocaleDateString('en-GB') }
            ]);
            await logActivity('WATI Webhook', 'MORE COUPONS SENT', `Doctor ${waId} requested 5 codes`);
        }
        // C. PATIENT: ROUND ROBIN AGENTS
        else if (patientBtns.includes(btn)) {
            const nextAgent = await Agent.findOne({ isOnline: true }).sort({ lastCalledAt: 1 });
            if (nextAgent) {
                nextAgent.lastCalledAt = new Date(); await nextAgent.save();
                await axios.post('https://api.in1.smartflo.tatateleservices.com/v1/clicktocall', {
                    agent_number: nextAgent.phone, destination_number: waId, caller_id: "07969690921"
                }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}` } });
                
                await logActivity('WATI Webhook', 'AGENT CALL TRIGGERED', `Patient ${waId} -> Agent ${nextAgent.name}`);
            }
        }
        res.sendStatus(200);
    } catch (error) { res.sendStatus(500); }
});

// -----------------------------------------
// 5. RECEPTION / ADMIN / DASHBOARD APIs
// -----------------------------------------
app.post('/api/coupon/validate', async (req, res) => {
    try {
        const { code } = req.body;
        const coupon = await Coupon.findOne({ code });
        if (!coupon) return res.status(404).json({ valid: false, message: "Invalid Code!" });
        if (coupon.isUsed) return res.status(400).json({ valid: false, message: "Already redeemed!" });
        if (new Date() > coupon.expiryDate) return res.status(400).json({ valid: false, message: "Expired!" });
        res.json({ valid: true, discount: coupon.discountPercentage, name: coupon.targetName || 'Unknown', type: coupon.audienceType });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/coupon/redeem', async (req, res) => {
    try {
        const { code, branch } = req.body;
        const coupon = await Coupon.findOne({ code });
        if (!coupon || coupon.isUsed) return res.status(400).json({ success: false });
        
        coupon.isUsed = true;
        coupon.redeemedAt = new Date();
        coupon.branchRedeemed = branch;
        await coupon.save();
        
        await logActivity(branch || 'Reception', 'COUPON REDEEMED', `Code ${code} used`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

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

app.get('/api/admin/logs', async (req, res) => {
    const isExport = req.query.export === 'true';
    let query = Coupon.find().sort({ createdAt: -1 });
    if (!isExport) query = query.limit(100);
    res.json(await query.exec());
});

app.get('/api/user/redeemed-today', async (req, res) => {
    const start = new Date(); start.setHours(0,0,0,0);
    res.json(await Coupon.find({ isUsed: true, redeemedAt: { $gte: start } }).sort({ redeemedAt: -1 }));
});

// Aakhri catch-all route for index.html
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));
