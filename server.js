require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const Coupon = require('./models/Coupon');
const Agent = require('./models/Agent');
const Activity = require('./models/Activity');

// 🚨 SALES BOT MODELS
const SalesQuestion = require('./models/SalesQuestion');
const SalesLog = require('./models/SalesLog');
const SalesPerson = require('./models/SalesPerson'); 

// 🚨 ADVANCED MARKETING MODELS
const CustomTemplate = mongoose.models.CustomTemplate || mongoose.model('CustomTemplate', new mongoose.Schema({
    name: String,
    discountPercentage: String,
    watiTemplateId: String,
    isActive: { type: Boolean, default: true }
}, { timestamps: true }));

const app = express();

// 🚨 LIMIT FIX FOR 5000+ CSV LARGE DATA PUSH
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------
// DATABASE CONNECTION & AUTO-SEEDING
// -----------------------------------------
mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('MongoDB Connected Successfully!');
        
        // --- SEED CALL CENTER AGENTS ---
        const team = [
            { name: 'Ruchit', phone: '917600082217' },
            { name: 'Mital', phone: '919558591212' },
            { name: 'Aditi', phone: '918488931212' },
            { name: 'Jay', phone: '919274682553' },
            { name: 'Khyati', phone: '917490029085' },
            { name: 'Hardik Parikh', phone: '919737900092' } 
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

        // 🚨 AUTO-SEED INITIAL SALES TEAM (Makes it dynamic from now on)
        if ((await SalesPerson.countDocuments()) === 0) {
            const initialSalesTeam = [
                { name: "ALPESH ROHIT", phone: "919574767971", team: "SS" },
                { name: "HARDIK PAREKH", phone: "919737900092", team: "SS" },
                { name: "NAGJI DESAI", phone: "919737248086", team: "SS" },
                { name: "NARENDRA NAI", phone: "918347016137", team: "SS" },
                { name: "SANDEEP UPDHAYAY", phone: "918980776879", team: "SS" },
                { name: "HITEN SHAH", phone: "919601952094", team: "SS" },
                { name: "AMAN DESAI", phone: "919998070509", team: "B" },
                { name: "ARPIT PATEL", phone: "917600083723", team: "B" },
                { name: "CHETAN TUSHAVARA", phone: "919274682548", team: "B" },
                { name: "JITENDRA MEHTA", phone: "918511015012", team: "B" },
                { name: "NISHAL CHOKSI", phone: "919974360230", team: "B" },
                { name: "PRASHANT GARANGE", phone: "919998974351", team: "B" },
                { name: "SHAHEBAJ SHAIKH", phone: "917600085461", team: "B" },
                { name: "YOGESH SOLANKI", phone: "916352950760", team: "B" }
            ];
            await SalesPerson.insertMany(initialSalesTeam);
            console.log("Seeded Initial Sales Team into DB.");
        }

        // 🚨 AUTO-SEED INITIAL BOTS
        if ((await SalesQuestion.countDocuments()) === 0) {
            const initialBots = [
                { keyword: "SS12", team: "SS", time: "09:00", questions: [] },
                { keyword: "SS46", team: "SS", time: "14:30", questions: [] },
                { keyword: "SS70", team: "SS", time: "19:00", questions: [] },
                { keyword: "B1", team: "B", time: "09:00", questions: [] },
                { keyword: "B46", team: "B", time: "14:30", questions: [] },
                { keyword: "B79", team: "B", time: "19:00", questions: [] }
            ];
            await SalesQuestion.insertMany(initialBots);
            console.log("Seeded Initial Bot Configurations into DB.");
        }

    })
    .catch(err => console.error('MongoDB Error:', err));


// -----------------------------------------
// HELPERS & TATA CONFIG
// -----------------------------------------
const TATA_URL = "https://api-smartflo.tatateleservices.com/v1/click_to_call";
const CALLER_ID = "07969690921"; 

// 🚨 SMART DELAY FUNCTION (Best for 5000+ shoots)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🚨 STRICT IST DATE FUNCTION (Fix for Server UTC vs India Time)
function getIndianDateStr(dateObj = new Date()) {
    const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
    const ist = new Date(utc + (3600000 * 5.5)); // +5:30 for India
    const y = ist.getFullYear();
    const m = String(ist.getMonth() + 1).padStart(2, '0');
    const d = String(ist.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 🚨 TIME CALCULATION FOR DELAY TRACKING
function getScheduledTime(dateStr, timeStr) {
    if(!timeStr) return Date.now();
    const [year, month, day] = dateStr.split('-');
    const [hours, mins] = timeStr.split(':');
    return new Date(year, month - 1, day, parseInt(hours), parseInt(mins), 0).getTime();
}

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

function formatTataNumber(phone) {
    if (!phone) return null;
    let num = phone.toString().replace(/\D/g, '').slice(-10);
    return '91' + num; 
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
        return true;
    } catch (err) {
        console.error(`WATI Template Error for ${phone} [${templateName}]:`, err.response?.data || err.message);
        return false; 
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

// 🚨 DEMO CSV API ROUTE 🚨
app.get('/api/download-demo-csv', (req, res) => {
    const csvContent = "name,phone,location,proNumber\nDr. Amit Shah,919876543210,Usmanpura,917600082217\nDr. Sneha Dental Clinic,918888888888,Ahmedabad,917043001130";
    res.header('Content-Type', 'text/csv');
    res.attachment('uic_campaign_demo.csv');
    return res.send(csvContent);
});

// 🚨 SYSTEM HEALTH API FOR MEMORY WARNING
app.get('/api/admin/system-health', async (req, res) => {
    const dbSize = await mongoose.connection.db.stats();
    const isMemoryFull = (dbSize.dataSize > 400 * 1024 * 1024); 
    res.json({ isMemoryFull, sizeMB: (dbSize.dataSize / (1024*1024)).toFixed(2) });
});

// -----------------------------------------
// 🚨 ADVANCED MARKETING SYSTEM APIs
// -----------------------------------------
app.get('/api/templates', async (req, res) => {
    try {
        const templates = await CustomTemplate.find().sort({ createdAt: -1 });
        res.json(templates);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/templates', async (req, res) => {
    try {
        const { id, name, discountPercentage, watiTemplateId, isActive } = req.body;
        if (id) {
            await CustomTemplate.findByIdAndUpdate(id, { name, discountPercentage, watiTemplateId, isActive });
        } else {
            await CustomTemplate.create({ name, discountPercentage, watiTemplateId, isActive });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

app.delete('/api/templates/:id', async (req, res) => {
    try {
        await CustomTemplate.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false });
    }
});

// -----------------------------------------
// SHOOT CAMPAIGN API (WITH ADVANCED SCHEDULER & SMART BUFFER FIX)
// -----------------------------------------
app.post('/api/campaign/shoot', async (req, res) => {
    try {
        const { targetList, discount, expiryDate, audienceType, isDynamic, dynamicTemplateId, scheduleTime, campaignName } = req.body;
        const formattedDate = new Date(expiryDate).toLocaleDateString('en-GB');
        
        let delayMs = 0;
        if (scheduleTime) {
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const istNow = new Date(utc + (3600000 * 5.5));

            const [sHours, sMins] = scheduleTime.split(':').map(Number);
            const targetSchedule = new Date(istNow);
            targetSchedule.setHours(sHours, sMins, 0, 0);

            const diffMs = targetSchedule.getTime() - istNow.getTime();

            // 🚨 SMART BUFFER
            if (diffMs < -(5 * 60 * 1000)) { 
                targetSchedule.setDate(targetSchedule.getDate() + 1); 
                delayMs = targetSchedule.getTime() - istNow.getTime();
            } else if (diffMs < 0) {
                delayMs = 0; 
            } else {
                delayMs = diffMs; 
            }
        }

        if (delayMs > 0) {
            res.json({ success: true, message: `Campaign successfully scheduled in background!` });
            setTimeout(() => {
                processCampaignInBackground(targetList, discount, expiryDate, audienceType, formattedDate, isDynamic, dynamicTemplateId, campaignName);
            }, delayMs);
            await logActivity('Scheduler', 'CAMPAIGN QUEUED', `Scheduled campaign for ${targetList.length} targets.`);
        } else {
            res.json({ success: true, message: `Campaign for ${targetList.length} contacts started safely in background!` });
            processCampaignInBackground(targetList, discount, expiryDate, audienceType, formattedDate, isDynamic, dynamicTemplateId, campaignName);
        }

    } catch (error) {
        console.error("Shoot API Error:", error);
    }
});

async function processCampaignInBackground(targetList, discount, expiryDate, audienceType, formattedDate, isDynamic, dynamicTemplateId, campaignName) {
    let validCount = 0; 
    let successCount = 0; 
    let failCount = 0;
    
    await logActivity('System', 'CAMPAIGN STARTED', `Initiating background campaign for ${targetList.length} ${audienceType}s (${discount === 'CBCT' ? 'CBCT' : discount + '% OFF'})`);

    for (let target of targetList) {
        if (!target.phone || target.phone.toString().trim() === '') continue;
        validCount++;

        try {
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
                source: campaignName || audienceType, // 🚨 SAVING EXACT CAMPAIGN NAME
                expiryDate: new Date(expiryDate)
            });

            let templateName = "";
            let params = [];
            const safeName = (target.name && target.name.toString().trim() !== '') ? target.name.toString().trim() : 'Doctor';

            if (isDynamic && dynamicTemplateId) {
                templateName = dynamicTemplateId;
                params = [ 
                    { name: '1', value: safeName }, 
                    { name: '2', value: code.toString() }, 
                    { name: '3', value: formattedDate.toString() } 
                ];
            } else {
                const templateMap = {
                    'Doctor_10': 'temp_10_doctor_coupon', 
                    'Doctor_20': 'temp_20_doctor_coupon', 
                    'Doctor_30': 'doc_dis_30_temp_guj', 
                    'Patient_10': 'patient_10_dis_temp', 
                    'Patient_20': 'patient_20_dis_temp', 
                    'Patient_30': 'patient_30_temp_new_dis',
                    'Dental_CBCT': 'dental_temp_final_2k',
                    'CGHS_Dental_CBCT': 'uic_dental_cghs_templates'
                };

                templateName = templateMap[`${audienceType}_${discount}`];
                if(!templateName) {
                    if(audienceType === 'Dental') templateName = 'dental_temp_final_2k';
                    else if(audienceType === 'CGHS_Dental') templateName = 'uic_dental_cghs_templates';
                }

                if (audienceType === 'Dental' || audienceType === 'CGHS_Dental') {
                    params = [{ name: '1', value: safeName }];
                } else {
                    params = [ 
                        { name: '1', value: safeName }, 
                        { name: '2', value: code.toString() }, 
                        { name: '3', value: formattedDate.toString() } 
                    ];
                }
            }

            if (templateName) {
                const isSent = await sendWatiMessage(target.phone, templateName, params);
                if (isSent) {
                    successCount++; 
                } else {
                    failCount++;
                }
            }

            await sleep(1000); 

        } catch (error) { 
            failCount++; 
        }
    }
    await logActivity('System', 'CAMPAIGN COMPLETED', `Total Processed: ${validCount} | Success: ${successCount} | Failed: ${failCount}`);
}

// -----------------------------------------
// 🚨 PRO DIALER TRIGGER API
// -----------------------------------------
app.get('/api/trigger-call/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const coupon = await Coupon.findOne({ code: code });

        if (!coupon) {
            return res.send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h2 style="color: red;">❌ Invalid Link!</h2>
                    <p>Request not found in database.</p>
                </div>
            `);
        }

        const doctorNumber = coupon.doctorPhone; 
        coupon.proCallClickedAt = new Date();
        coupon.callStatus = 'Completed';
        await coupon.save();

        await logActivity('Link Trigger', 'PRO DIALER OPENED', `PRO clicked to call Doctor +${doctorNumber}`);

        res.send(`
            <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Opening Dialer...</title>
            </head>
            <body style="font-family: sans-serif; text-align: center; margin-top: 50px; background: #f0fdf4;">
                <h1 style="color: #16a34a;">📞 Opening Dialer...</h1>
                <p>Redirecting to call <b>+${doctorNumber}</b></p>
                <p style="font-size: 14px; color: #555; margin-top: 20px;">
                    If the dialer doesn't open automatically, <br><br>
                    <a href="tel:+${doctorNumber}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Click Here to Call</a>
                </p>
                <script>
                    window.location.href = "tel:+${doctorNumber}"; 
                    setTimeout(() => { window.close(); }, 3000);
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h2 style="color: red;">❌ Error Connecting Call</h2>
            </div>
        `);
    }
});


// -----------------------------------------
// 🚨 DYNAMIC SALES BOT APIs
// -----------------------------------------
app.get('/api/sales/team', async (req, res) => { res.json(await SalesPerson.find().sort({ team: -1, name: 1 })); });
app.post('/api/sales/team', async (req, res) => { try { await SalesPerson.create(req.body); res.json({ success: true }); } catch (e) { res.status(400).json({ success: false, error: e.message }); }});
app.put('/api/sales/team/:id', async (req, res) => { await SalesPerson.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }); res.json({ success: true }); });
app.delete('/api/sales/team/:id', async (req, res) => { await SalesPerson.findByIdAndDelete(req.params.id); res.json({ success: true }); });
app.get('/api/sales/questions', async (req, res) => { res.json(await SalesQuestion.find().sort({ team: -1, time: 1 })); });
app.post('/api/sales/questions', async (req, res) => { const { keyword, team, time, questions } = req.body; await SalesQuestion.findOneAndUpdate({ keyword }, { keyword, team, time, questions }, { upsert: true, new: true }); res.json({ success: true });});
app.delete('/api/sales/questions/:id', async (req, res) => { await SalesQuestion.findByIdAndDelete(req.params.id); res.json({ success: true }); });

app.get('/api/sales/tracker', async (req, res) => {
    const { from, to } = req.query;
    let targetDates = [];
    if (from && to) {
        let curr = new Date(from); const end = new Date(to);
        while (curr <= end) { targetDates.push(getIndianDateStr(curr)); curr.setDate(curr.getDate() + 1); }
    } else { targetDates = [getIndianDateStr()]; }

    const logs = await SalesLog.find({ dateStr: { $in: targetDates } });
    const allBots = await SalesQuestion.find();
    const activeTeam = await SalesPerson.find({ isActive: true }); 

    let report = [];
    for (let d of targetDates) {
        activeTeam.forEach(member => {
            const memberBots = allBots.filter(b => b.team === member.team);
            memberBots.forEach(bot => {
                const log = logs.find(l => l.phone === member.phone && l.dateStr === d && l.keyword === bot.keyword);
                let delayStr = "-";
                if (log && log.responseTimeMins != null) {
                    const m = Math.floor(log.responseTimeMins);
                    if (m < 0) delayStr = "Early Reply ⚡"; else if (m < 60) delayStr = `${m} mins delay`; else delayStr = `${Math.floor(m/60)} hr ${m%60} mins delay`;
                }
                report.push({ date: d, name: member.name, phone: member.phone, team: member.team, status: log ? 'Replied' : 'Not Reply', keyword: bot.keyword, delayStr: delayStr, answers: log ? log.answers : [], adminReply: log ? log.adminReplyText : null, time: log ? log.updatedAt : null, questions: bot.questions });
            });
        });
    }
    report.sort((a, b) => { if (a.time && b.time) return new Date(b.time) - new Date(a.time); if (a.time) return -1; if (b.time) return 1; return 0; });
    res.json({ report, bots: allBots, team: activeTeam });
});

app.post('/api/sales/reply', async (req, res) => {
    const { phone, text, date, keyword } = req.body;
    await sendWatiTextMessage(phone, text);
    const targetDate = date || getIndianDateStr();
    await SalesLog.findOneAndUpdate({ phone: phone, dateStr: targetDate, keyword: keyword }, { adminReplyText: text });
    res.json({ success: true });
});

// -----------------------------------------
// 🤖 INTELLIGENT AUTO-SYNC (BACKLOG SCANNER)
// -----------------------------------------
app.post('/api/sales/sync-history', async (req, res) => {
    try {
        const { phone, dateStr, keyword } = req.body;
        const log = await SalesLog.findOne({ phone, dateStr, keyword });
        if (!log) return res.json({ success: false, message: "Pehle ek session hona chahiye jise hum sync karein." });

        const cleanPhone = phone.replace(/\D/g, ''); 
        const watiRes = await axios.get(`${process.env.WATI_API_ENDPOINT}/api/v1/getMessages/${cleanPhone}?pageSize=50`, {
            headers: { 'Authorization': `Bearer ${process.env.WATI_BEARER_TOKEN}` }
        });

        let items = watiRes.data?.messages?.items || watiRes.data?.items || [];
        if(items.length === 0) return res.json({ success: false, message: "WATI mein chat history nahi mili." });

        items.sort((a, b) => new Date(a.created || a.timestamp).getTime() - new Date(b.created || b.timestamp).getTime());

        let rawAnswers = [];
        let isSessionActive = false;

        for (let i = 0; i < items.length; i++) {
            const msg = items[i];
            const text = (msg.text || '').trim();
            const msgDate = getIndianDateStr(new Date(msg.created || msg.timestamp));
            
            if (!text || msgDate !== dateStr) continue;

            if (!msg.owner && text.toLowerCase().includes(keyword.toLowerCase())) {
                isSessionActive = true;
                rawAnswers = []; 
                continue;
            }

            if (isSessionActive) {
                if (msg.owner && text.toLowerCase().includes("thank you")) {
                    isSessionActive = false;
                } else if (!msg.owner) {
                    rawAnswers.push(text);
                }
            }
        }

        if (rawAnswers.length > 0) {
            log.answers = rawAnswers;
            await log.save();
            return res.json({ success: true, message: `Successfully synchronized ${rawAnswers.length} answers from backlog.` });
        } else {
            return res.json({ success: false, message: "No new matching answers found." });
        }
    } catch (error) {
        return res.json({ success: false, message: "Sync Error: WATI API se connection toot gaya." });
    }
});

// -----------------------------------------
// WATI WEBHOOK (CALLING & INTELLIGENCE & SALES)
// -----------------------------------------
app.post('/api/wati/webhook', async (req, res) => {
    res.status(200).send("OK");

    try {
        const body = req.body;
        let rawBtn = body.text || body.buttonText || "";
        if (body.type === 'interactive') {
            if (body.buttonReply) rawBtn = body.buttonReply.title || rawBtn;
            if (body.listReply) rawBtn = body.listReply.title || rawBtn;
        } else if (body.type === 'button') {
            rawBtn = body.button?.text || rawBtn;
        }
        
        rawBtn = rawBtn.trim();
        const btnLower = rawBtn.toLowerCase();
        const waId = body.waId || body.sender || "";

        if (!waId) return;

        const [activeTeam, allBots] = await Promise.all([ SalesPerson.find({ isActive: true }), SalesQuestion.find() ]);
        const salesMember = activeTeam.find(s => formatTataNumber(s.phone) === formatTataNumber(waId));

        if (salesMember) {
            const today = getIndianDateStr(); 
            
            let matchedBot = allBots.find(b => {
                let cleanKeyword = b.keyword.toLowerCase().replace('yes i will reply', '').trim();
                let cleanBtn = btnLower.replace('yes i will reply', '').trim();
                if (cleanBtn === cleanKeyword) return true;
                let btnWords = btnLower.replace(/[^a-z0-9]/g, ' ').split(' ');
                return btnWords.includes(cleanKeyword);
            });
            
            if (matchedBot) {
                const now = new Date();
                const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                const istNow = new Date(utc + (3600000 * 5.5));
                
                const [hours, mins] = matchedBot.time.split(':').map(Number);
                const scheduledIst = new Date(istNow);
                scheduledIst.setHours(hours, mins, 0, 0); 
                
                const delayMins = (istNow.getTime() - scheduledIst.getTime()) / 60000; 

                await SalesLog.findOneAndUpdate(
                    { phone: salesMember.phone, dateStr: today, keyword: matchedBot.keyword },
                    { 
                        $setOnInsert: { answers: [] }, 
                        $set: { name: salesMember.name, team: salesMember.team, adminReplyText: '', responseTimeMins: delayMins, updatedAt: new Date() } 
                    },
                    { upsert: true, new: true }
                );
                return;
            } 
            else if (body.eventType === 'message' && body.type === 'text') {
                let log = await SalesLog.findOne({ phone: salesMember.phone, dateStr: today }).sort({ updatedAt: -1 });
                
                if (!log) {
                    const memberBots = allBots.filter(b => b.team === salesMember.team);
                    let fallbackKeyword = memberBots.length > 0 ? memberBots[0].keyword : 'AUTO-CATCH';
                    
                    log = await SalesLog.create({
                        phone: salesMember.phone, dateStr: today, name: salesMember.name, team: salesMember.team,
                        keyword: fallbackKeyword, answers: [], responseTimeMins: 0, updatedAt: new Date()
                    });
                }

                const now = new Date();
                const lastUpdate = new Date(log.updatedAt);
                const diffSecs = (now - lastUpdate) / 1000;
                
                if (log.answers.length > 0 && diffSecs <= 1) { 
                    log.answers[log.answers.length - 1] += "\n" + rawBtn;
                } else {
                    log.answers.push(rawBtn);
                }
                log.markModified('answers'); 
                log.updatedAt = new Date(); 
                await log.save();
                return;
            }
        }

        if (!rawBtn) return;
        if (body.eventType && body.eventType !== 'message') return;

        const phone10 = waId.replace(/\D/g, '').slice(-10);
        const couponRegex = new RegExp(phone10 + '$');

        // 1. 🚨 RATING LOGIC
        if (btnLower.includes('rate this initiative') || btnLower.includes('આ પહેલને રેટ કરો')) {
            const lastCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
            if (lastCoupon) { lastCoupon.buttonClicked = rawBtn; await lastCoupon.save(); }
            await sendWatiMessage(waId, 'doc_rate_inti_star', []);
        }
        else if (btnLower.includes('★') || btnLower.includes('star')) {
            let ratingValue = 0;
            if (btnLower.includes('5')) ratingValue = 5; else if (btnLower.includes('4')) ratingValue = 4; else if (btnLower.includes('3')) ratingValue = 3; else if (btnLower.includes('2')) ratingValue = 2; else if (btnLower.includes('1')) ratingValue = 1;
            if (ratingValue > 0) {
                const lastCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
                if (lastCoupon) { lastCoupon.rating = ratingValue; lastCoupon.buttonClicked = rawBtn; await lastCoupon.save(); await sendWatiTextMessage(waId, "Thank you! 🙏"); }
            }
        }
        
        // 2. 🚨 SMART SALES TEAM CALL CATCHER
        else if (
            (btnLower.includes('sales team') && btnLower.includes('call')) ||
            btnLower.includes('connect with doctor') || 
            btnLower.includes('સેલ્સ ટીમ, મને કોલ કરો') || 
            btnLower.includes('ask sales team') || 
            btnLower.includes('details about cbct')
        ) {
            const lastCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
            if (lastCoupon) {
                const twoMinsAgo = new Date(Date.now() - 2 * 60000);
                if (lastCoupon.callStatus === 'Pending' && lastCoupon.updatedAt > twoMinsAgo) return; 

                lastCoupon.requestCallAt = new Date(); 
                lastCoupon.callStatus = 'Pending'; 
                lastCoupon.buttonClicked = rawBtn; 
                await lastCoupon.save();
                
                const discountValue = lastCoupon.discountPercentage === 'CBCT' ? 'CBCT Service' : `${lastCoupon.discountPercentage}%`;

                if (lastCoupon.proPhone) {
                    if (lastCoupon.audienceType === 'Dental' || lastCoupon.audienceType === 'CGHS_Dental' || lastCoupon.discountPercentage === 'CBCT') {
                        await sendWatiMessage(lastCoupon.proPhone, 'pro_doc_dental_notify', [{ name: "1", value: lastCoupon.targetName || "Doctor" }, { name: "2", value: `+${lastCoupon.doctorPhone}` }, { name: "3", value: discountValue }, { name: "4", value: lastCoupon.code }]);
                    } else {
                        await sendWatiMessage(lastCoupon.proPhone, 'doc_temp_discount_pro_message', [{ name: "1", value: `+${lastCoupon.doctorPhone}` }, { name: "2", value: discountValue }, { name: "3", value: lastCoupon.code }]);
                    }
                }
                
                await sendWatiMessage(waId, 'sales_call_ack_template', []);
            }
        }

        // 3. 🚨 REFERRAL BOOKS
        else if (btnLower.includes('referral') || btnLower.includes('book')) {
            const lastCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
            if (lastCoupon && lastCoupon.proPhone) {
                lastCoupon.buttonClicked = rawBtn; 
                await lastCoupon.save();
                
                await sendWatiMessage(lastCoupon.proPhone, 'pro_referral_alert', [{ name: "1", value: lastCoupon.targetName || "Doctor" }, { name: "2", value: `+${lastCoupon.doctorPhone}` }]);
                await sendWatiTextMessage(waId, "Thank you! 🙏 Our PRO will deliver the UIC Referral Books to your clinic very soon.");
            }
        }

        // 4. 🚨 EXACT MATCH 3 COUPONS LOGIC
        else if (
            btnLower === 'need 3 more coupons' || 
            btnLower === 'need more 3 coupons' || 
            btnLower.includes('need 3 more') || 
            btnLower.includes('need more 3') || 
            (btnLower.includes('3') && (btnLower.includes('more') || btnLower.includes('coupon')))
        ) {
            const lastCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
            if (lastCoupon) { 
                lastCoupon.buttonClicked = rawBtn; 
                await lastCoupon.save(); 
            }
            const discount = lastCoupon ? lastCoupon.discountPercentage : 30;
            
            // 🚨 FIX: INHERIT ORIGINAL CAMPAIGN NAME INSTEAD OF 'REQUESTED 3'
            let campaignSource = lastCoupon?.source;
            if (!campaignSource || campaignSource.includes('Requested')) {
                campaignSource = lastCoupon?.audienceType || 'Doctor';
            }

            let newCodes = []; 
            const expiry = new Date(); 
            expiry.setMonth(expiry.getMonth() + 1);
            
            for (let i = 0; i < 3; i++) {
                const c = await generateUniqueCode();
                await Coupon.create({ 
                    code: c, 
                    discountPercentage: discount, 
                    targetName: lastCoupon?.targetName || 'Requested', 
                    doctorPhone: waId, 
                    audienceType: 'Doctor', 
                    source: campaignSource, // 👈 Saved correct source
                    expiryDate: expiry, 
                    proPhone: lastCoupon?.proPhone, 
                    location: lastCoupon?.location 
                });
                newCodes.push(c);
            }
            
            let discountText = discount === 'CBCT' ? 'CBCT Service' : `${discount}% Discount`;
            await sendWatiMessage(waId, 'dis_more_temp_all', [{ name: '1', value: discountText }, { name: '2', value: newCodes.join(', ') }, { name: '3', value: expiry.toLocaleDateString('en-GB') }]);
        }

        // 5. 🚨 GENERAL COUPON FALLBACK (WITH MAX 5 CAP & DYNAMIC NUMBER EXTRACTION)
        else if (btnLower.includes('more coupon') || btnLower.includes('મને વધુ કૂપન જોઈએ છે') || btnLower.includes('વધુ કૂપન') || btnLower.includes('coupon') || btnLower.includes('કૂપન')) {
            const lastCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
            if (lastCoupon) { 
                lastCoupon.buttonClicked = rawBtn; 
                await lastCoupon.save(); 
            }
            
            const discount = lastCoupon ? lastCoupon.discountPercentage : 30;
            
            // Extract exact number requested (e.g. "Need 50 coupons" -> 50)
            let requestCount = 5; 
            const numberMatch = rawBtn.match(/\d+/);
            if (numberMatch) {
                requestCount = parseInt(numberMatch[0]);
            } else if (btnLower.includes('three') || btnLower.includes('ત્રણ')) {
                requestCount = 3;
            }

            // 🚨 STRICT ABUSE VALIDATION: Limit to Max 5 coupons!
            if (requestCount > 5) {
                requestCount = 5;
            } else if (requestCount < 1) {
                requestCount = 1;
            }

            let newCodes = []; 
            const expiry = new Date(); 
            expiry.setMonth(expiry.getMonth() + 1);

            // 🚨 FIX: INHERIT ORIGINAL CAMPAIGN NAME INSTEAD OF 'REQUESTED'
            let campaignSource = lastCoupon?.source;
            if (!campaignSource || campaignSource.includes('Requested')) {
                campaignSource = lastCoupon?.audienceType || 'Doctor';
            }

            for (let i = 0; i < requestCount; i++) {
                const c = await generateUniqueCode();
                await Coupon.create({ 
                    code: c, 
                    discountPercentage: discount, 
                    targetName: lastCoupon?.targetName || 'Requested', 
                    doctorPhone: waId, 
                    audienceType: 'Doctor', 
                    source: campaignSource, // 👈 Saved correct source
                    expiryDate: expiry, 
                    proPhone: lastCoupon?.proPhone, 
                    location: lastCoupon?.location 
                });
                newCodes.push(c);
            }
            
            let discountText = discount === 'CBCT' ? 'CBCT Service' : `${discount}% Discount`;
            await sendWatiMessage(waId, 'dis_more_temp_all', [{ name: '1', value: discountText }, { name: '2', value: newCodes.join(', ') }, { name: '3', value: expiry.toLocaleDateString('en-GB') }]);
        }

        // 6. 🚨 PATIENT CONNECT ASSISTANCE
        else if (['assistance', 'book my test', 'use the coupon', 'use the cupon'].some(kw => btnLower.includes(kw))) {
            const patientCoupon = await Coupon.findOne({ doctorPhone: { $regex: couponRegex } }).sort({ createdAt: -1 });
            
            if (patientCoupon) {
                const twoMinsAgo = new Date(Date.now() - 2 * 60000);
                if (patientCoupon.callStatus === 'Completed' && patientCoupon.updatedAt > twoMinsAgo) return; 
                patientCoupon.buttonClicked = rawBtn;
                await patientCoupon.save();
            }

            const nextAgent = await Agent.findOne({ isOnline: true }).sort({ lastCalledAt: 1 });
            
            if (nextAgent) {
                nextAgent.lastCalledAt = new Date();
                await nextAgent.save();

                try {
                    const tataAgentNumber = formatTataNumber(nextAgent.phone);
                    const tataDestNumber = formatTataNumber(waId);

                    await axios.post(TATA_URL, {
                        agent_number: tataAgentNumber, destination_number: tataDestNumber, caller_id: CALLER_ID
                    }, { headers: { 'Authorization': `Bearer ${process.env.TATA_TELE_TOKEN}`, 'Content-Type': 'application/json' } });

                    if (patientCoupon) {
                        patientCoupon.agentAssigned = nextAgent.name;
                        patientCoupon.callStatus = 'Completed'; 
                        await patientCoupon.save();
                    }

                    if (btnLower.includes('use the coupon') || btnLower.includes('use the cupon')) {
                        await sendWatiMessage(waId, 'patient_thankyou', []);
                    } else {
                        await sendWatiMessage(waId, 'sales_call_ack_template', []);
                    }

                } catch (tataError) {
                    if (patientCoupon) {
                        patientCoupon.agentAssigned = nextAgent.name;
                        patientCoupon.callStatus = 'Failed'; 
                        await patientCoupon.save();
                    }
                }
            } else {
                 if (patientCoupon) {
                     patientCoupon.callStatus = 'Pending'; 
                     await patientCoupon.save();
                 }
            }
        }
    } catch (error) {
        console.error("Webhook Internal Logic Error:", error);
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
        
        // 🚨 RETURN CAMPAIGN NAME FOR BIG TEXT UI
        res.json({ 
            valid: true, 
            discount: coupon.discountPercentage, 
            name: coupon.targetName || 'Unknown', 
            type: coupon.audienceType,
            campaignName: coupon.source || coupon.audienceType 
        });
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/coupon/redeem', async (req, res) => {
    try {
        const { code, branch, patientRegNo } = req.body;
        const coupon = await Coupon.findOne({ code });
        if (!coupon || coupon.isUsed) return res.status(400).json({ success: false });

        coupon.isUsed = true;
        coupon.redeemedAt = new Date();
        coupon.branchRedeemed = branch;
        coupon.patientRegNo = patientRegNo; 
        await coupon.save();

        await logActivity(branch || 'Reception Panel', 'COUPON REDEEMED', `Code ${code} redeemed (Reg No: ${patientRegNo || 'N/A'})`);
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
        query = query.limit(10000); 
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
