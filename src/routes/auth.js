const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const pool = require('../db/pool');
const { auth } = require('../middleware/auth');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

let bot = null;

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: false });
} else {
  console.warn('⚠️ BOT_TOKEN topilmadi. Forgot password Telegram kodi ishlamaydi.');
}

const resetCodes = new Map();

/* ==========================
   LOGIN
========================== */

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Login va parol kerak' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE login=$1 AND is_active=true',
      [login]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(401).json({ error: 'Login yoki parol xato' });
    }

    const valid = await bcrypt.compare(password, agent.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Login yoki parol xato' });
    }

    const token = jwt.sign(
      {
        id: agent.id,
        role: agent.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES || '7d'
      }
    );

    res.json({
      token,
      agent: {
        id: agent.id,
        display_id: agent.display_id,
        full_name: agent.full_name,
        phone: agent.phone,
        role: agent.role,
        company_id: agent.company_id,
        trial_start: agent.trial_start,
        trial_end: agent.trial_end,
        plan: agent.plan || null,
        plan_end: agent.plan_end || null,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   PUBLIC REGISTER
========================== */

router.post('/register-public', async (req, res) => {
  try {
    const {
      full_name,
      phone,
      company_name,
      login,
      password
    } = req.body;

    if (!full_name || !phone || !login || !password) {
      return res.status(400).json({
        error: 'Барча майдонларни тўлдиринг'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM agents WHERE login=$1',
      [login]
    );

    if (exists.rows.length) {
      return res.status(400).json({
        error: 'Бу логин банд'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO agents
      (
        display_id,
        login,
        password_hash,
        full_name,
        phone,
        role,
        trial_start,
        trial_end,
        is_active
      )
      VALUES
      (
        gen_display_id('AG','seq_agent'),
        $1,
        $2,
        $3,
        $4,
        'agent',
        NOW(),
        NOW() + INTERVAL '14 days',
        true
      )
      RETURNING *
      `,
      [
        login,
        hash,
        full_name,
        phone
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Муваффақиятли рўйхатдан ўтдингиз. 14 кунлик бепул тариф фаоллаштирилди.',
      agent: rows[0]
    });
  } catch (err) {
    console.error('Register public error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   ADMIN REGISTER
========================== */

router.post('/register', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({
        error: 'Фақат админ агент қўша олади'
      });
    }

    const {
      login,
      password,
      full_name,
      phone
    } = req.body;

    if (!login || !password || !full_name || !phone) {
      return res.status(400).json({
        error: 'Login, parol, ism va telefon kerak'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM agents WHERE login=$1',
      [login]
    );

    if (exists.rows.length) {
      return res.status(400).json({
        error: 'Бу логин банд'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO agents
      (
        display_id,
        login,
        password_hash,
        full_name,
        phone,
        role,
        trial_start,
        trial_end,
        is_active
      )
      VALUES
      (
        gen_display_id('AG','seq_agent'),
        $1,
        $2,
        $3,
        $4,
        'agent',
        NOW(),
        NOW() + INTERVAL '14 days',
        true
      )
      RETURNING *
      `,
      [
        login,
        hash,
        full_name,
        phone
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Admin register error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   AGENTS LIST
========================== */

router.get('/agents', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({
        error: 'Фақат админ кўра олади'
      });
    }

    const { rows } = await pool.query(`
      SELECT
        id,
        display_id,
        login,
        full_name,
        phone,
        role,
        trial_start,
        trial_end,
        is_active,
        telegram_id,
        created_at
      FROM agents
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Agents list error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   CHANGE PASSWORD
========================== */

router.put('/change-password', auth, async (req, res) => {
  try {
    const agentId = req.agent.id;

    const {
      currentPassword,
      newPassword,
      confirmPassword
    } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Барча майдонларни тўлдиринг'
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        error: 'Янги пароль камида 4 та белгидан иборат бўлиши керак'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Янги парольлар мос эмас'
      });
    }

    const { rows } = await pool.query(
      `
      SELECT id, password_hash
      FROM agents
      WHERE id=$1
      `,
      [agentId]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(404).json({
        error: 'Агент топилмади'
      });
    }

    const valid = await bcrypt.compare(
      currentPassword,
      agent.password_hash
    );

    if (!valid) {
      return res.status(400).json({
        error: 'Ҳозирги пароль нотўғри'
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE agents
      SET password_hash=$1
      WHERE id=$2
      `,
      [hash, agentId]
    );

    res.json({
      success: true,
      message: 'Пароль муваффақиятли ўзгартирилди'
    });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   FORGOT PASSWORD
   1-qadam: login orqali kod yuborish
========================== */

router.post('/forgot-password', async (req, res) => {
  try {
    const { login } = req.body;

    if (!login) {
      return res.status(400).json({
        error: 'Loginni kiriting'
      });
    }

    if (!bot) {
      return res.status(500).json({
        error: 'Telegram bot sozlanmagan. BOT_TOKEN tekshiring.'
      });
    }

    const { rows } = await pool.query(
      `
      SELECT id, full_name, login, telegram_id
      FROM agents
      WHERE login=$1 AND is_active=true
      `,
      [login]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(404).json({
        error: 'Foydalanuvchi topilmadi'
      });
    }

    if (!agent.telegram_id) {
      return res.status(400).json({
        error: "Bu akkauntga Telegram bog'lanmagan. Botga /start yoki /login login yuboring."
      });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expires = Date.now() + 5 * 60 * 1000;

    resetCodes.set(login, {
      code,
      expires
    });

    await bot.sendMessage(
      agent.telegram_id,
      `🔐 <b>GK Network CRM</b>\n\nParolni tiklash kodi:\n\n<b>${code}</b>\n\nKod 5 daqiqa davomida amal qiladi.\nAgar siz so'ramagan bo'lsangiz, e'tibor bermang.`,
      { parse_mode: 'HTML' }
    );

    res.json({
      success: true,
      message: 'Telegram botga kod yuborildi'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   VERIFY RESET CODE
   2-qadam: kodni tekshirish
========================== */

router.post('/verify-reset-code', async (req, res) => {
  try {
    const { login, code } = req.body;

    if (!login || !code) {
      return res.status(400).json({
        error: 'Login va kod kerak'
      });
    }

    const record = resetCodes.get(login);

    if (!record) {
      return res.status(400).json({
        error: "Avval kod so'rang"
      });
    }

    if (Date.now() > record.expires) {
      resetCodes.delete(login);

      return res.status(400).json({
        error: "Kod muddati o'tgan. Qayta so'rang."
      });
    }

    if (record.code !== String(code)) {
      return res.status(400).json({
        error: "Noto'g'ri kod"
      });
    }

    res.json({
      success: true,
      message: "Kod to'g'ri"
    });
  } catch (err) {
    console.error('Verify reset code error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   RESET PASSWORD
   3-qadam: yangi parol saqlash
========================== */

router.post('/reset-password', async (req, res) => {
  try {
    const {
      login,
      code,
      new_password
    } = req.body;

    if (!login || !code || !new_password) {
      return res.status(400).json({
        error: 'Barcha maydonlar kerak'
      });
    }

    if (new_password.length < 4) {
      return res.status(400).json({
        error: "Parol kamida 4 ta belgi bo'lsin"
      });
    }

    const record = resetCodes.get(login);

    if (!record) {
      return res.status(400).json({
        error: "Avval kod so'rang"
      });
    }

    if (Date.now() > record.expires) {
      resetCodes.delete(login);

      return res.status(400).json({
        error: "Kod muddati o'tgan. Qayta so'rang."
      });
    }

    if (record.code !== String(code)) {
      return res.status(400).json({
        error: "Kod noto'g'ri"
      });
    }

    const hash = await bcrypt.hash(new_password, 10);

    const { rowCount } = await pool.query(
      `
      UPDATE agents
      SET password_hash=$1
      WHERE login=$2 AND is_active=true
      `,
      [hash, login]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: 'Foydalanuvchi topilmadi'
      });
    }

    resetCodes.delete(login);

    res.json({
      success: true,
      message: "Parol muvaffaqiyatli o'zgartirildi"
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   SET TELEGRAM ID
========================== */

router.put('/agents/:id/telegram', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({
        error: 'Faqat admin'
      });
    }

    const { id } = req.params;
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        error: 'telegram_id kerak'
      });
    }

    const exists = await pool.query(
      `
      SELECT id
      FROM agents
      WHERE telegram_id=$1 AND id!=$2
      `,
      [telegram_id, id]
    );

    if (exists.rows.length) {
      return res.status(400).json({
        error: 'Bu Telegram ID boshqa agentga tegishli'
      });
    }

    await pool.query(
      `
      UPDATE agents
      SET telegram_id=$1
      WHERE id=$2
      `,
      [telegram_id, id]
    );

    res.json({
      success: true,
      message: 'Telegram ID saqlandi'
    });
  } catch (err) {
    console.error('Set telegram id error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   CURRENT USER
========================== */

router.get('/me', auth, async (req, res) => {
  res.json(req.agent);
});

module.exports = router;