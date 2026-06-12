/**
 * /api/app — Mijoz Mini App uchun backend routes
 * Auth: Telegram ID (JWT token)
 */

const router = require('express').Router();
const pool = require('../db/pool');
const jwt = require('jsonwebtoken');

// ─── Middleware: Telegram ID orqali auth ─────────────────
const appAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token kerak' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'client') return res.status(401).json({ error: "Ruxsat yo'q" });

    const { rows } = await pool.query(
      'SELECT * FROM app_clients WHERE id = $1',
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    req.client = rows[0];
    next();
  } catch {
    res.status(401).json({ error: "Token yaroqsiz" });
  }
};

/* ==========================
   REGISTER / LOGIN
   Ism + telefon + telegram_id
========================== */

router.post('/auth', async (req, res) => {
  try {
    const { full_name, phone, telegram_id } = req.body;

    if (!full_name || !phone) {
      return res.status(400).json({ error: "Ism va telefon kerak" });
    }

    // Mavjud mijozni topish (telefon yoki telegram_id bo'yicha)
    let client;

    if (telegram_id) {
      const { rows } = await pool.query(
        'SELECT * FROM app_clients WHERE telegram_id = $1 OR phone = $2 LIMIT 1',
        [String(telegram_id), phone]
      );
      client = rows[0];
    } else {
      const { rows } = await pool.query(
        'SELECT * FROM app_clients WHERE phone = $1 LIMIT 1',
        [phone]
      );
      client = rows[0];
    }

    if (client) {
      // Mavjud mijoz — ma'lumotlarini yangilash
      const { rows } = await pool.query(
        `UPDATE app_clients
         SET full_name = $1, telegram_id = COALESCE($2, telegram_id), updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [full_name, telegram_id ? String(telegram_id) : null, client.id]
      );
      client = rows[0];
    } else {
      // Yangi mijoz
      const { rows } = await pool.query(
        `INSERT INTO app_clients (full_name, phone, telegram_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [full_name, phone, telegram_id ? String(telegram_id) : null]
      );
      client = rows[0];
    }

    const token = jwt.sign(
      { id: client.id, type: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   CURRENT CLIENT
========================== */

router.get('/me', appAuth, async (req, res) => {
  res.json(req.client);
});

/* ==========================
   PROPERTIES — Ko'rish uchun
========================== */

router.get('/properties', appAuth, async (req, res) => {
  try {
    const {
      purpose,       // 'sell' | 'rent'
      property_type, // 'apartment' | 'house' | 'office' | 'land'
      rooms,
      price_min,
      price_max,
      region,
      mortgage,
      installment,
      page = 1,
      limit = 20,
    } = req.query;

    const params = [];
    let where = "WHERE p.status = 'active'";

    if (purpose) {
      params.push(purpose);
      where += ` AND p.purpose = $${params.length}`;
    }

    if (property_type) {
      params.push(property_type);
      where += ` AND p.property_type = $${params.length}`;
    }

    if (rooms) {
      params.push(Number(rooms));
      where += ` AND p.rooms = $${params.length}`;
    }

    if (price_min) {
      params.push(Number(price_min));
      where += ` AND p.price >= $${params.length}`;
    }

    if (price_max) {
      params.push(Number(price_max));
      where += ` AND p.price <= $${params.length}`;
    }

    if (region) {
      params.push(`%${region}%`);
      where += ` AND (p.region ILIKE $${params.length} OR p.district ILIKE $${params.length})`;
    }

    if (mortgage === 'true') {
      where += ` AND p.mortgage = true`;
    }

    if (installment === 'true') {
      where += ` AND p.installment = true`;
    }

    const offset = (Number(page) - 1) * Number(limit);
    params.push(Number(limit));
    params.push(offset);

    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.display_id,
        p.purpose,
        p.property_type,
        p.rooms,
        p.area,
        p.floor,
        p.total_floors,
        p.price,
        p.region,
        p.district,
        p.landmark,
        p.mortgage,
        p.installment,
        p.description,
        p.photos,
        p.created_at,
        a.id          AS agent_id,
        a.full_name   AS agent_name,
        a.phone       AS agent_phone,
        a.telegram_id AS agent_telegram_id
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Count
    const countParams = params.slice(0, -2);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM properties p JOIN agents a ON a.id = p.agent_id ${where}`,
      countParams
    );

    res.json({
      data: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   PROPERTY DETAIL
========================== */

router.get('/properties/:id', appAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.*,
        a.id          AS agent_id,
        a.full_name   AS agent_name,
        a.phone       AS agent_phone,
        a.telegram_id AS agent_telegram_id
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1 AND p.status = 'active'
    `, [req.params.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   ARIZA QOLDIRISH
   Mijoz obyektga ariza beradi
========================== */

router.post('/applications', appAuth, async (req, res) => {
  try {
    const { property_id, type, message } = req.body;
    // type: 'buy' | 'rent' | 'sell' | 'rent_out'

    if (!property_id || !type) {
      return res.status(400).json({ error: "Obyekt va ariza turi kerak" });
    }

    // Obyekt mavjudmi?
    const { rows: propRows } = await pool.query(
      `SELECT p.*, a.telegram_id as agent_telegram_id, a.full_name as agent_name
       FROM properties p JOIN agents a ON a.id = p.agent_id
       WHERE p.id = $1 AND p.status = 'active'`,
      [property_id]
    );

    if (!propRows[0]) {
      return res.status(404).json({ error: 'Obyekt topilmadi' });
    }

    const property = propRows[0];

    // Ariza mavjudmi (takroriy)?
    const { rows: existing } = await pool.query(
      `SELECT id FROM app_applications
       WHERE client_id = $1 AND property_id = $2 AND status = 'pending'`,
      [req.client.id, property_id]
    );

    if (existing.length) {
      return res.status(400).json({ error: "Siz allaqachon ariza qoldirgansiz" });
    }

    // Arizani saqlash
    const { rows } = await pool.query(
      `INSERT INTO app_applications
         (client_id, property_id, type, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.client.id, property_id, type, message || '']
    );

    const application = rows[0];

    // Agentga Telegram bildirishnoma
    if (property.agent_telegram_id) {
      try {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN, { polling: false });

        const typeUz = {
          buy: 'Sotib olish',
          rent: 'Ijaraga olish',
          sell: 'Sotish',
          rent_out: 'Ijaraga berish',
        };

        await bot.sendMessage(
          property.agent_telegram_id,
          `📋 <b>Yangi ariza!</b>\n\n` +
          `🏠 Obyekt: <b>${property.display_id}</b>\n` +
          `📌 Ariza turi: <b>${typeUz[type] || type}</b>\n` +
          `👤 Mijoz: <b>${req.client.full_name}</b>\n` +
          `📞 Telefon: <b>${req.client.phone}</b>\n` +
          (message ? `💬 Izoh: ${message}\n` : '') +
          `\nMijoz bilan bog'laning!`,
          { parse_mode: 'HTML' }
        );
      } catch (tgErr) {
        console.error('Telegram bildirishnoma xato:', tgErr.message);
      }
    }

    res.status(201).json({ success: true, application });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   MENING ARIZALARIM
========================== */

router.get('/applications', appAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        aa.*,
        p.display_id  AS property_display_id,
        p.property_type,
        p.purpose,
        p.price,
        p.photos,
        p.region,
        p.district,
        a.full_name   AS agent_name,
        a.phone       AS agent_phone,
        a.telegram_id AS agent_telegram_id
      FROM app_applications aa
      JOIN properties p ON p.id = aa.property_id
      JOIN agents a ON a.id = p.agent_id
      WHERE aa.client_id = $1
      ORDER BY aa.created_at DESC
    `, [req.client.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   ARIZANI BEKOR QILISH
========================== */

router.delete('/applications/:id', appAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM app_applications WHERE id = $1 AND client_id = $2',
      [req.params.id, req.client.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ error: "Ko'rib chiqilgan arizani bekor qilib bo'lmaydi" });
    }

    await pool.query('DELETE FROM app_applications WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
