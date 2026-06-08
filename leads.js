const router = require('express').Router();
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.BOT_TOKEN);

router.use(auth);

// GET /api/leads — o'ziga kelgan va yuborgan lidlar
router.get('/', async (req, res) => {
  try {
    const { type } = req.query; // incoming | outgoing
    
    let where = type === 'incoming'
      ? 'WHERE le.receiver_id = $1'
      : type === 'outgoing'
      ? 'WHERE le.sender_id = $1'
      : 'WHERE le.sender_id = $1 OR le.receiver_id = $1';

    const { rows } = await pool.query(`
      SELECT le.*,
        s.full_name as sender_name, s.phone as sender_phone,
        r.full_name as receiver_name,
        c.display_id as client_display_id, c.need_type, c.property_type,
        c.budget_min, c.budget_max, c.rooms,
        CASE WHEN le.receiver_id = $1 THEN c.full_name ELSE c.full_name END as client_name,
        CASE WHEN le.receiver_id = $1 AND le.status='accepted' THEN c.phone ELSE NULL END as client_phone
      FROM lead_exchange le
      JOIN agents s ON s.id = le.sender_id
      JOIN agents r ON r.id = le.receiver_id
      JOIN clients c ON c.id = le.client_id
      ${where}
      ORDER BY le.created_at DESC
    `, [req.agent.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads — lid yuborish
router.post('/', async (req, res) => {
  try {
    const { client_id, receiver_id, notes } = req.body;

    // Client o'zining mijozimi tekshirish
    const { rows: clientRows } = await pool.query(
      'SELECT * FROM clients WHERE id=$1 AND agent_id=$2', [client_id, req.agent.id]
    );
    if (!clientRows[0]) return res.status(403).json({ error: 'Bu sizning mijozingiz emas' });

    const { rows } = await pool.query(`
      INSERT INTO lead_exchange (display_id, client_id, sender_id, receiver_id, notes)
      VALUES (gen_display_id('LE','seq_lead'), $1, $2, $3, $4)
      RETURNING *
    `, [client_id, req.agent.id, receiver_id, notes]);

    const lead = rows[0];

    // Receiver agentga Telegram xabar
    const receiver = await pool.query('SELECT * FROM agents WHERE id=$1', [receiver_id]);
    const client = clientRows[0];

    if (receiver.rows[0]?.telegram_id) {
      const text = `🔔 <b>Янги лид келди!</b>\n\n`
        + `👤 Юборувчи: ${req.agent.full_name}\n`
        + `🆔 Мижоз: ${client.display_id}\n`
        + `🏠 ${client.property_type} · ${client.need_type === 'buy' ? 'Сотиб олади' : 'Ижарага'}\n`
        + `💰 Бюджет: $${client.budget_min || 0} - $${client.budget_max || '?'}\n`
        + (notes ? `📝 Изоҳ: ${notes}` : '');

      await bot.sendMessage(receiver.rows[0].telegram_id, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Қабул қилдим', callback_data: `lead_accept_${lead.id}` },
            { text: '❌ Рад этдим', callback_data: `lead_reject_${lead.id}` }
          ]]
        }
      });
    }

    res.status(201).json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leads/:id/respond — qabul/rad
router.put('/:id/respond', async (req, res) => {
  try {
    const { action } = req.body; // accept | reject
    const status = action === 'accept' ? 'accepted' : 'rejected';

    const { rows } = await pool.query(`
      UPDATE lead_exchange SET status=$1, responded_at=NOW()
      WHERE id=$2 AND receiver_id=$3
      RETURNING *
    `, [status, req.params.id, req.agent.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    // Sender ga xabar
    const lead = rows[0];
    const sender = await pool.query('SELECT * FROM agents WHERE id=$1', [lead.sender_id]);
    
    if (sender.rows[0]?.telegram_id) {
      const emoji = action === 'accept' ? '✅' : '❌';
      const actionText = action === 'accept' ? 'қабул қилди' : 'рад этди';
      await bot.sendMessage(
        sender.rows[0].telegram_id,
        `${emoji} <b>${req.agent.full_name}</b> лидни ${actionText}!\nЛид ID: ${lead.display_id}`,
        { parse_mode: 'HTML' }
      );
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
