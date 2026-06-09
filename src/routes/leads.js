const router = require('express').Router();
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN);

router.use(auth);

/* ==========================
   GET /api/leads
========================== */
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;

    let where =
      type === 'incoming'
        ? 'WHERE le.receiver_id = $1'
        : type === 'outgoing'
        ? 'WHERE le.sender_id = $1'
        : 'WHERE le.sender_id = $1 OR le.receiver_id = $1';

    const { rows } = await pool.query(`
      SELECT
        le.*,
        s.full_name AS sender_name,
        s.phone AS sender_phone,
        r.full_name AS receiver_name,
        r.phone AS receiver_phone,
        c.display_id AS client_display_id,
        c.full_name AS client_name,
        c.phone AS client_phone,
        c.need_type,
        c.property_type,
        c.budget_min,
        c.budget_max,
        c.rooms,
        p.display_id AS property_display_id,
        p.price AS property_price,
        p.district AS property_district,
        p.region AS property_region
      FROM lead_exchange le
      JOIN agents s ON s.id = le.sender_id
      JOIN agents r ON r.id = le.receiver_id
      JOIN clients c ON c.id = le.client_id
      LEFT JOIN properties p ON p.id = le.property_id
      ${where}
      ORDER BY le.created_at DESC
    `, [req.agent.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================
   POST /api/leads
   Obyekt uchun mijoz yuborish
========================== */
router.post('/', async (req, res) => {
  try {
    const { client_id, property_id, notes } = req.body;

    if (!client_id || !property_id) {
      return res.status(400).json({
        error: 'client_id ва property_id керак'
      });
    }

    const clientResult = await pool.query(
      `
      SELECT *
      FROM clients
      WHERE id = $1
        AND agent_id = $2
      `,
      [client_id, req.agent.id]
    );

    const client = clientResult.rows[0];

    if (!client) {
      return res.status(403).json({
        error: 'Бу сизнинг мижозингиз эмас'
      });
    }

    const propertyResult = await pool.query(
      `
      SELECT
        p.*,
        a.id AS owner_agent_id,
        a.full_name AS owner_agent_name,
        a.phone AS owner_agent_phone,
        a.telegram_id AS owner_telegram_id
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1
      `,
      [property_id]
    );

    const property = propertyResult.rows[0];

    if (!property) {
      return res.status(404).json({
        error: 'Объект топилмади'
      });
    }

    if (property.agent_id === req.agent.id) {
      return res.status(400).json({
        error: 'Ўз объектингизга лид юбора олмайсиз'
      });
    }

    const duplicate = await pool.query(
      `
      SELECT id
      FROM lead_exchange
      WHERE client_id = $1
        AND property_id = $2
        AND status IN ('pending', 'accepted')
      LIMIT 1
      `,
      [client_id, property_id]
    );

    if (duplicate.rows.length) {
      return res.status(400).json({
        error: 'Бу мижоз бўйича ушбу объектга лид аллақачон юборилган'
      });
    }

    const leadResult = await pool.query(
      `
      INSERT INTO lead_exchange
      (
        display_id,
        client_id,
        property_id,
        sender_id,
        receiver_id,
        status,
        notes
      )
      VALUES
      (
        gen_display_id('LE','seq_lead'),
        $1,
        $2,
        $3,
        $4,
        'pending',
        $5
      )
      RETURNING *
      `,
      [
        client_id,
        property_id,
        req.agent.id,
        property.agent_id,
        notes || ''
      ]
    );

    const lead = leadResult.rows[0];

    if (property.owner_telegram_id) {
      const text =
`🔔 <b>Янги лид келди!</b>

🏠 <b>Объект:</b> ${property.display_id || property.id}
📍 <b>Манзил:</b> ${property.district || property.region || '-'}
💰 <b>Нарх:</b> $${property.price || '-'}

👤 <b>Лид юборган агент:</b> ${req.agent.full_name}
📞 <b>Агент телефони:</b> ${req.agent.phone || '-'}

🆔 <b>Мижоз:</b> ${client.display_id}
🏘 <b>Талаб:</b> ${client.property_type} · ${client.need_type}
💰 <b>Бюджет:</b> $${client.budget_min || 0} - $${client.budget_max || '?'}

${notes ? `📝 <b>Изоҳ:</b> ${notes}` : ''}

Лид ID: ${lead.display_id}`;

      await bot.sendMessage(property.owner_telegram_id, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Қабул қилиш', callback_data: `lead_accept_${lead.id}` },
              { text: '❌ Рад этиш', callback_data: `lead_reject_${lead.id}` }
            ]
          ]
        }
      });
    }

    res.status(201).json({
      success: true,
      lead
    });

  } catch (err) {
    console.error('Lead yaratish xatosi:', err);
    res.status(500).json({
      error: err.message
    });
  }
});

/* ==========================
   PUT /api/leads/:id/respond
========================== */
router.put('/:id/respond', async (req, res) => {
  try {
    const { action } = req.body;

    const status = action === 'accept' ? 'accepted' : 'rejected';

    const { rows } = await pool.query(
      `
      UPDATE lead_exchange
      SET status = $1,
          responded_at = NOW()
      WHERE id = $2
        AND receiver_id = $3
      RETURNING *
      `,
      [status, req.params.id, req.agent.id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Topilmadi'
      });
    }

    const lead = rows[0];

    const senderResult = await pool.query(
      'SELECT * FROM agents WHERE id = $1',
      [lead.sender_id]
    );

    const sender = senderResult.rows[0];

    if (sender?.telegram_id) {
      const emoji = action === 'accept' ? '✅' : '❌';
      const actionText = action === 'accept' ? 'қабул қилди' : 'рад этди';

      await bot.sendMessage(
        sender.telegram_id,
        `${emoji} <b>${req.agent.full_name}</b> лидни ${actionText}!\n\nЛид ID: ${lead.display_id}`,
        { parse_mode: 'HTML' }
      );
    }

    res.json(lead);

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;