// ... (Purana setup: express, mongoose, models same rahenge)

// 5. GET ALL LOGS: Har doctor ka status dekhne ke liye
app.get('/api/admin/logs', async (req, res) => {
    try {
        const logs = await Coupon.find().sort({ createdAt: -1 });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch logs" });
    }
});

// 6. DASHBOARD STATS (Live Monitoring)
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
