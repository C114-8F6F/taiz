const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// الربط بقاعدة بيانات Render
const pool = new Pool({
  connectionString: 'postgresql://taiz_user:vteJXCd86HitZZfbi47f3mATSpzgqm07@dpg-dacrtl9t0dsc73f0924g-a.oregon-postgres.render.com/taiz',
  ssl: { rejectUnauthorized: false }
});

// إنشاء الجداول تلقائياً عند التشغيل
const initDB = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      email VARCHAR(100),
      device_id VARCHAR(255),
      ip_address VARCHAR(45),
      balance_rial DECIMAL(12, 2) DEFAULT 0.00,
      points INT DEFAULT 0,
      account_status VARCHAR(20) DEFAULT 'active',
      verification_status VARCHAR(20) DEFAULT 'unverified',
      rank_level VARCHAR(50) DEFAULT 'عضو جديد',
      is_unlimited_ads BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_activity_limits (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_ad_watch_time TIMESTAMP WITH TIME ZONE,
      points_purchases_this_week INT DEFAULT 0,
      last_points_purchase_date TIMESTAMP WITH TIME ZONE,
      last_withdrawal_date TIMESTAMP WITH TIME ZONE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      payout_method VARCHAR(50),
      amount DECIMAL(12, 2) NOT NULL,
      account_details TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      admin_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  try {
    await pool.query(queryText);
    console.log("✅ تم تأسيس الجداول بنجاح على قاعدة بيانات Render!");
  } catch (err) {
    console.error("❌ خطأ أثناء إنشاء الجداول:", err);
  }
};

initDB();

// --- مسارات التطبيق (API Endpoints) ---

// 1. تسجيل / دخول المستخدم
app.post('/api/users/register', async (req, res) => {
  const { full_name, phone_number, email, device_id, ip_address } = req.body;
  try {
    const newUser = await pool.query(
      `INSERT INTO users (full_name, phone_number, email, device_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (phone_number) DO UPDATE SET ip_address = $5, device_id = $4
       RETURNING *`,
      [full_name, phone_number, email, device_id, ip_address]
    );
    const userId = newUser.rows[0].id;
    await pool.query(
      `INSERT INTO user_activity_limits (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );
    res.json({ success: true, user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. التحقق من إعلانات الـ 15 دقيقة
app.post('/api/ads/watch', async (req, res) => {
  const { user_id } = req.body;
  try {
    const userRes = await pool.query(`SELECT is_unlimited_ads FROM users WHERE id = $1`, [user_id]);
    const limitsRes = await pool.query(`SELECT last_ad_watch_time FROM user_activity_limits WHERE user_id = $1`, [user_id]);
    
    const isUnlimited = userRes.rows[0]?.is_unlimited_ads;
    const lastWatch = limitsRes.rows[0]?.last_ad_watch_time;

    if (!isUnlimited && lastWatch) {
      const diffMinutes = (new Date() - new Date(lastWatch)) / (1000 * 60);
      if (diffMinutes < 15) {
        const remaining = Math.ceil(15 - diffMinutes);
        return res.status(400).json({ success: false, message: `يرجى الانتظار ${remaining} دقيقة قبل مشاهدة الإعلان التالي.` });
      }
    }

    // تحديث التوقيت وإضافة النقاط
    await pool.query(`UPDATE user_activity_limits SET last_ad_watch_time = NOW() WHERE user_id = $1`, [user_id]);
    await pool.query(`UPDATE users SET points = points + 10 WHERE id = $1`, [user_id]);

    res.json({ success: true, message: "تمت مشاهدة الإعلان وإضافة 10 نقاط!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. طلب سحب الأرباح (مرة أسبوعياً)
app.post('/api/withdraw', async (req, res) => {
  const { user_id, amount, payout_method, account_details } = req.body;
  try {
    const limitsRes = await pool.query(`SELECT last_withdrawal_date FROM user_activity_limits WHERE user_id = $1`, [user_id]);
    const lastWithdraw = limitsRes.rows[0]?.last_withdrawal_date;

    if (lastWithdraw) {
      const diffDays = (new Date() - new Date(lastWithdraw)) / (1000 * 60 * 60 * 24);
      if (diffDays < 7) {
        const remainingDays = Math.ceil(7 - diffDays);
        return res.status(400).json({ success: false, message: `يمكنك تقديم طلب سحب جديد بعد ${remainingDays} أيام.` });
      }
    }

    // تسجيل طلب السحب قيد المراجعة
    await pool.query(
      `INSERT INTO transactions (user_id, type, payout_method, amount, account_details, status)
       VALUES ($1, 'withdrawal', $2, $3, $4, 'pending')`,
      [user_id, payout_method, amount, account_details]
    );

    res.json({ success: true, message: "تم تقديم طلب السحب بنجاح وهو قيد مراجعة الإدارة." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. مسار الإدارة: جلب كافة المستخدمين
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await pool.query(`SELECT * FROM users ORDER BY created_at DESC`);
    res.json({ success: true, users: users.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. مسار الإدارة: تعديل حالة الحساب (تجميد / تقييد / حظر)
app.post('/api/admin/update-status', async (req, res) => {
  const { user_id, account_status } = req.body;
  try {
    await pool.query(`UPDATE users SET account_status = $1 WHERE id = $2`, [account_status, user_id]);
    res.json({ success: true, message: "تم تحديث حالة الحساب بنجاح." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 الخادم يعمل بنجاح على المنفذ ${PORT}`));

