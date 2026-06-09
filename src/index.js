require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const pool    = require('./db/pool');

const app = express();

// ─── Bot — xavfsiz init (BOT_TOKEN yo'q bo'lsa crash bermaydi) ───
let bot = null;
try {
  if (process.env.BOT_TOKEN) {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    console.log('✅ Telegram bot ulandi');
  } else {
    console.warn('⚠️  BOT_TOKEN yo\'q — Telegram o\'chirildi');
  }
} catch (err) {
  console.error('❌ Bot init xato:', err.message);
  bot = null;
}

// Bot yuborish helper — xato bo'lsa server crash bermaydi
async function tgSend(chatId, text, opts = {}) {
  if (!bot) return null;
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error('tgSend xato:', err.message);
    return null;
  }
}

// Bot va helper ni routes uchun global qilish
app.set('bot', bot);
app.set('tgSend', tgSend);

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Webhook ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const msg    = update.message;
      const chatId = msg.chat.id;
      const text   = msg.text || '';

      // /start — Telegram username orqali agentni avtomatik ulash
      if (text.startsWith('/start')) {
        const username = msg.from.username || '';
        let linked = null;

        if (username) {
          const { rows } = await pool.query(
            `UPDATE agents SET telegram_id = $1
             WHERE LOWER(login) = LOWER($2)
             RETURNING login, full_name`,
            [msg.from.id, username]
          );
          linked = rows[0] || null;
        }

        if (linked) {
          await tgSend(chatId,
            `✅ <b>Telegram ID saqlandi!</b>\n\n` +
            `👤 Agent: ${linked.full_name}\n` +
            `🔐 Login: ${linked.login}\n\n` +
            `Endi ob'yekt qo'shganingizda Telegram xabarlar keladi! 🎉`,
            { parse_mode: 'HTML' }
          );
        } else {
          await tgSend(chatId,
            `👋 <b>Salom! GK Network botiga xush kelibsiz.</b>\n\n` +
            `Telegram ID ni agentga ulash:\n` +
            `<code>/link login_ingiz</code>\n\n` +
            `Masalan: <code>/link sardor</code>`,
            { parse_mode: 'HTML' }
          );
        }
      }

      // /link — login orqali qo'lda ulash
      if (text.startsWith('/link ')) {
        const login = text.replace('/link ', '').trim();
        if (!login) {
          await tgSend(chatId, 'Login kiriting. Masalan: /link sardor');
          return res.json({ ok: true });
        }

        const { rows } = await pool.query(
          `UPDATE agents SET telegram_id = $1
           WHERE LOWER(login) = LOWER($2)
           RETURNING login, full_name`,
          [msg.from.id, login]
        );

        if (rows[0]) {
          await tgSend(chatId,
            `✅ <b>Ulandi!</b>\n\n👤 ${rows[0].full_name}\n🔐 @${rows[0].login}`,
            { parse_mode: 'HTML' }
          );
        } else {
          await tgSend(chatId, '❌ Bunday login topilmadi.');
        }
      }
    }

    // Callback — lid qabul/rad
    if (update.callback_query) {
      const q      = update.callback_query;
      const data   = q.data || '';
      const chatId = q.message.chat.id;

      if (data.startsWith('lead_accept_') || data.startsWith('lead_reject_')) {
        const leadId = data.replace('lead_accept_', '').replace('lead_reject_', '');
        const status = data.startsWith('lead_accept_') ? 'accepted' : 'rejected';

        await pool.query(
          `UPDATE lead_exchange SET status=$1, responded_at=NOW() WHERE id=$2`,
          [status, leadId]
        );

        if (bot) {
          await bot.answerCallbackQuery(q.id, {
            text: status === 'accepted' ? '✅ Qabul qilindi' : '❌ Rad etildi'
          });
        }

        await tgSend(chatId,
          status === 'accepted'
            ? '✅ <b>Lid qabul qilindi!</b>'
            : '❌ <b>Lid rad etildi.</b>',
          { parse_mode: 'HTML' }
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(200).json({ ok: false });
  }
});

// ─── API Routes ───────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/clients',    require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/leads',      require('./routes/leads'));

// ─── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ─── 404 ──────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Topilmadi' }));

// ─── Error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ─── Server ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server ishlamoqda: http://localhost:${PORT}`);
});
