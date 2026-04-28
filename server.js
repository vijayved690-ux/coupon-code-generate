require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
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
        // Agents ke aage 91 lagaya gaya hai (as per working project)
        const team = [
            { name: 'Ruchit', phone: '917600082217' },
            { name: 'Mital', phone: '919558591212' },
            { name: 'Aditi', phone: '918488931212' },
            { name: 'Jay', phone: '919274682553' },
            { name: 'Khyati', phone: '917490029085' }
        ];
        
        for (let person of team) {
            const existing = await Agent.findOne({ name: person.name });
            if (existing) {
                existing.phone = person.phone;
                await existing.save();
            } else {
                await Agent.create(person);
            }
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
        if (!exists) {
            isUnique = true;
        }
    }
    return code;
}

// 🚨 SMART NUMBER FORMATTER - ALWAYS 12 DIGITS (with 91 prefix)
function formatTataNumber(phone) {
    if (!phone) return null;
    let num = phone.toString().replace(/\D/g, '').slice(-10); // Aakhri 10 number lega
    return '91' + num; // Hamesha 91 prefix lagayega
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
        console.error(`WATI Template Error for ${phone}:`, err.response?.data || err.message);
    }
}

async function sendWatiTextMessage(phone, text) {
    try {
        await axios.post(`${process.env.WATI_API_ENDPOINT}/api/v1/sendSessionMessage/${phone}?messageText=${encodeURIComponent(text)}`, {}, {
            headers: { 'Authorization': `Bearer ${process.env.WATI_BEARER_TOKEN}` }
        });
    } catch (err) {
        console.error(`WATI Text Error for ${phone}:`, err.message);
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
// APIs (Authentication, Admin, Logs)
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
    const logs = await Activity.find().sort({ timestamp: -1 }).limit(50);
    res.json(logs);
});

// -----------------------------------------
// SHOOT CAMPAIGN API
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
            let cleanProPhone = target.proNumber ? target.proNumber.toString().trim().replace(/\D/g, '') : null;

            await Coupon.create({
                code,
                discountPercentage: discount,
                targetName: target.name,
                doctorPhone: target.phone.toString().trim(),
                location: target.location || 'Ahmedabad',
                proPhone: cleanProPhone, 
                audienceType: audienceType,
                expiryDate: new Date(expiryDate)
            });

            const templateMap = {
                'Doctor_10': 'temp_10_doctor_coupon',
                'Doctor_20': 'temp_20_doctor_coupon',
                'Doctor_30': 'dis_temp_doctor_30', 
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
// WATI WEBHOOK (CALLING & INTELLIGENCE)
// -----------------------------------------
app.post('/api/wati/webhook', async (req, res) => {
    try {
        const { waId, buttonText, text } = req.body;
        const rawBtn = (buttonText || text || "").trim();
        const btnLower = rawBtn.toLowerCase();

        // 1. RATING
        if (btnLower === 'rate this initiative') {
            await sendWatiMessage(waId, 'rate_doc_coupon', []);
            await logActivity('System Webhook', 'RATING TEMPLATE SENT', `Feedback requested from ${waId}`);
        }
        else if (btnLower.includes('★') || btnLower.includes('star')) {
            let ratingValue = 0;
            if (btnLower.includes('5')) ratingValue = 5;
            else if (btnLower.includes('4')) ratingValue = 4;
            else if (btnLower.includes('3')) ratingValue = 3;
            else if (btnLower.includes('2')) ratingValue = 2;
            else if (btnLower.includes('1')) ratingValue = 1;

            if (ratingValue > 0) {
                const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
                if (lastCoupon) {
                    lastCoupon.rating = ratingValue;
                    await lastCoupon.save();
                    await sendWatiTextMessage(waId, "Thank you for your valuable feedback! We deeply appreciate your support. 🙏");
                    await logActivity('System Webhook', 'RATING RECEIVED', `Doctor ${waId} gave ${ratingValue} Stars ⭐`);
                }
            }
        }
        // 2. PRO CALLING
        else if (btnLower === 'sales team please call me') {
            const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
            
            if (lastCoupon && lastCoupon.proPhone) {
                try {
                    const tataAgentNumber = formatTataNumber(lastCoupon.proPhone);
                    const tataDestNumber = formatTataNumber(waId);
                    const tataCallerId = "07969690921"; // Aapka correct DID

                    await logActivity('System Webhook', 'CALL ATTEMPT', `Agent: ${tataAgentNumber}, Dest: ${tataDestNumber}`);

                    // 🚨 EXACT URL FROM WORKING REFERENCE
                    await axios.post('https://api-smartflo.tatateleservices.com/v1/click_to_call', {
                        agent_number: tataAgentNumber,
                        destination_number: tataDestNumber,
                        caller_id: tataCallerId
                    }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}` } });

                    await sendWatiMessage(waId, 'sales_call_ack_template', []);
                    await logActivity('System Webhook', 'PRO CALL SUCCESS', `Connecting Doctor to PRO`);
                } catch (tataError) {
                    const errMsg = tataError.response?.data ? JSON.stringify(tataError.response.data) : tataError.message;
                    await logActivity('System Webhook', 'PRO CALL FAILED', `API Error: ${errMsg}`);
                }
            } else {
                await logActivity('System Webhook', 'PRO CALL FAILED', `No PRO Number found in database for Doctor ${waId}`);
            }
        }
        // 3. MORE COUPONS
        else if (btnLower.includes('more coupon')) {
            const lastCoupon = await Coupon.findOne({ doctorPhone: waId }).sort({ createdAt: -1 });
            const discount = lastCoupon ? lastCoupon.discountPercentage : 30;
            let newCodes = [];
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 1);

            for (let i = 0; i < 5; i++) {
                const c = await generateUniqueCode();
                await Coupon.create({
                    code: c, discountPercentage: discount, targetName: lastCoupon?.targetName || 'Requested',
                    doctorPhone: waId, audienceType: 'Doctor', source: 'Requested',
                    expiryDate: expiry, proPhone: lastCoupon?.proPhone, location: lastCoupon?.location
                });
                newCodes.push(c);
            }

            const discountText = `${discount}% Discount`;
            await sendWatiMessage(waId, 'dis_more_temp_all', [
                { name: '1', value: discountText },
                { name: '2', value: newCodes.join(', ') },
                { name: '3', value: expiry.toLocaleDateString('en-GB') }
            ]);

            await logActivity('System Webhook', 'MORE COUPONS SENT', `Sent 5 new codes of ${discount}% to ${waId}`);
        }
        // 4. PATIENT CALLING
        else if (['need more assistance', 'looking for more assistance', 'book my test', 'i will use the coupon', 'i will use the cupon'].includes(btnLower)) {
            if (btnLower.includes('use the coupon') || btnLower.includes('use the cupon')) {
                await sendWatiMessage(waId, 'patient_thankyou', []);
            } else {
                const nextAgent = await Agent.findOne({ isOnline: true }).sort({ lastCalledAt: 1 });
                if (nextAgent) {
                    nextAgent.lastCalledAt = new Date();
                    await nextAgent.save();

                    try {
                        const tataAgentNumber = formatTataNumber(nextAgent.phone);
                        const tataDestNumber = formatTataNumber(waId);
                        const tataCallerId = "07969690921"; // Aapka correct DID

                        // 🚨 EXACT URL FROM WORKING REFERENCE
                        await axios.post('https://api-smartflo.tatateleservices.com/v1/click_to_call', {
                            agent_number: tataAgentNumber,
                            destination_number: tataDestNumber,
                            caller_id: tataCallerId
                        }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}`, 'Content-Type': 'application/json' } });

                        await sendWatiMessage(waId, 'sales_call_ack_template', []);
                        await logActivity('System Webhook', 'AGENT CALL SUCCESS', `Patient connected to Agent ${nextAgent.name}`);
                    } catch (tataError) {
                        const errMsg = tataError.response?.data ? JSON.stringify(tataError.response.data) : tataError.message;
                        await logActivity('System Webhook', 'AGENT CALL FAILED', `API Error: ${errMsg}`);
                    }
                } else {
                     await logActivity('System Webhook', 'AGENT CALL FAILED', `No Call Center Agents are currently online.`);
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook Error:", error);
        res.sendStatus(500);
    }
});

// -----------------------------------------
// Dashboard & Validation APIs
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

        await logActivity(branch || 'Reception Panel', 'COUPON REDEEMED', `Code ${code} redeemed successfully`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/agents', async (req, res) => {
    const agents = await Agent.find().sort({ name: 1 });
    res.json(agents);
});

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
    if (!isExport) {
        query = query.limit(100);
    }
    const logs = await query.exec();
    res.json(logs);
});

app.get('/api/user/redeemed-today', async (req, res) => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const logs = await Coupon.find({ isUsed: true, redeemedAt: { $gte: start } }).sort({ redeemedAt: -1 });
    res.json(logs);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));
