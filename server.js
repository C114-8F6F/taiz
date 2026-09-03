const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

// تفعيل CORS للسماح بالاتصال من GitHub Pages
app.use(cors());
app.use(express.json());

// الاتصال بقاعدة بيانات PostgreSQL عبر متغيّر البيئة DATABASE_URL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// إنشاء الجداول تلقائياً عند تشغيل السيرفر
async function initDb() {
    try {
        await pool.query(`
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
        console.log("تم إنشاء وتأكيد جداول قاعدة البيانات بنجاح!");
    } catch (err) {
        console.error("خطأ في تهيئة قاعدة البيانات:", err.message);
    }
}

initDb();

// 1. الصفحة الرئيسية للتأكد من عمل السيرفر
app.get('/', (req, res) => {
    res.send('الخادم يعمل بنجاح ومربوط بقاعدة البيانات على Render! 🚀');
});

// 2. مسار تسجيل الدخول / حساب جديد
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

// 3. مسار مشاهدة الإعلانات وتجميع النقاط (مع شرط مهلة 15 دقيقة)
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

        // إضافة 10 نقاط وتحديث وقت المشاهدة الأخيرة
        await pool.query(
            'UPDATE users SET points = points + 10, last_ad_watch = $1 WHERE id = $2',
            [now, user_id]
        );

        res.json({ success: true, message: 'تمت إضافة 10 نقاط إلى حسابك بنجاح!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. مسار طلب سحب الأرباح
app.post('/api/withdraw', async (req, res) => {
    const { user_id, amount, payout_method, account_details } = req.body;

    if (!amount || !payout_method || !account_details) {
        return res.status(400).json({ success: false, message: 'يرجى إدخال جميع بيانات السحب' });
    }

    try {
        await pool.query(
            'INSERT INTO withdrawals (user_id, amount, payout_method, account_details) VALUES ($1, $2, $3, $4)',
            [user_id, amount, payout_method, account_details]
        );

        res.json({ success: true, message: 'تم إرسال طلب السحب بنجاح، وسيتم مراجعته من قبل الإدارة.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. مسار لوحة التحكم للجلب قائمة المستخدمين
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await pool.query('SELECT * FROM users ORDER BY id DESC');
        res.json({ success: true, users: users.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. مسار تعديل حالة حساب المستخدم
app.post('/api/admin/update-status', async (req, res) => {
    const { user_id, account_status } = req.body;

    try {
        await pool.query('UPDATE users SET account_status = $1 WHERE id = $2', [account_status, user_id]);
        res.json({ success: true, message: 'تم تحديث حالة الحساب' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// تشغيل السيرفر
app.listen(port, () => {
    console.log(`الخادم يعمل بنجاح على المنفذ ${port}`);
});
