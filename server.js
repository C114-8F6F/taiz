const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

// تفعيل CORS بالكامل لمنع حظر الطلبات من GitHub Pages
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// الاتصال المباشر بقاعدة بيانات PostgreSQL على Render
const connectionString = 'postgresql://taiz_user:vteJXCd86HitZZfbi47f3mATSpzgqm07@dpg-dacrtl9t0dsc73f0924g-a.oregon-postgres.render.com/taiz';

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// اختبار الاتصال وتأسيس الجداول
async function initDb() {
    try {
        const client = await pool.connect();
        console.log("✅ تم الاتصال بقاعدة البيانات بنجاح!");
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR(100) NOT NULL,
                phone_number VARCHAR(20) UNIQUE NOT NULL,
                device_id VARCHAR(100),
                balance_rial NUMERIC(10, 2) DEFAULT 0.00,
                points INT DEFAULT 0,
                account_status VARCHAR(20) DEFAULT 'active',
                last_ad_watch TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS withdrawals (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                amount NUMERIC(10, 2) NOT NULL,
                payout_method VARCHAR(50) NOT NULL,
                account_details TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ تم إنشاء وتأكيد الجداول بنجاح!");
        client.release();
    } catch (err) {
        console.error("❌ خطأ في الاتصال بقاعدة البيانات:", err.message);
    }
}

initDb();

// 1. اختبار استجابة السيرفر
app.get('/', (req, res) => {
    res.json({ status: "online", message: "الخادم يعمل ومربوط بنجاح!" });
});

// 2. تسجيل الدخول / حساب جديد
app.post('/api/users/register', async (req, res) => {
    const { full_name, phone_number, device_id } = req.body;

    if (!phone_number || !full_name) {
        return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
    }

    try {
        let userResult = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phone_number]);
        
        if (userResult.rows.length === 0) {
            userResult = await pool.query(
                'INSERT INTO users (full_name, phone_number, device_id) VALUES ($1, $2, $3) RETURNING *',
                [full_name, phone_number, device_id || 'WEB']
            );
        }

        res.json({ success: true, user: userResult.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. مشاهدة الإعلانات
app.post('/api/ads/watch', async (req, res) => {
    const { user_id } = req.body;

    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const user = userRes.rows[0];
        const now = new Date();

        if (user.last_ad_watch) {
            const lastWatch = new Date(user.last_ad_watch);
            const diffMinutes = (now - lastWatch) / (1000 * 60);

            if (diffMinutes < 15) {
                const remaining = Math.ceil(15 - diffMinutes);
                return res.json({ 
                    success: false, 
                    message: `يرجى الانتظار ${remaining} دقيقة قبل مشاهدة الإعلان التالي.` 
                });
            }
        }

        await pool.query(
            'UPDATE users SET points = points + 10, last_ad_watch = $1 WHERE id = $2',
            [now, user_id]
        );

        res.json({ success: true, message: 'تمت إضافة 10 نقاط بنجاح!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. طلب السحب
app.post('/api/withdraw', async (req, res) => {
    const { user_id, amount, payout_method, account_details } = req.body;

    if (!amount || !payout_method || !account_details) {
        return res.status(400).json({ success: false, message: 'يرجى إدخال جميع البيانات' });
    }

    try {
        await pool.query(
            'INSERT INTO withdrawals (user_id, amount, payout_method, account_details) VALUES ($1, $2, $3, $4)',
            [user_id, amount, payout_method, account_details]
        );

        res.json({ success: true, message: 'تم إرسال طلب السحب بنجاح.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. جلب المستخدمين للوحة التحكم
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await pool.query('SELECT * FROM users ORDER BY id DESC');
        res.json({ success: true, users: users.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. تحديث حالة الحساب
app.post('/api/admin/update-status', async (req, res) => {
    const { user_id, account_status } = req.body;

    try {
        await pool.query('UPDATE users SET account_status = $1 WHERE id = $2', [account_status, user_id]);
        res.json({ success: true, message: 'تم تحديث حالة الحساب' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(port, () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
});
