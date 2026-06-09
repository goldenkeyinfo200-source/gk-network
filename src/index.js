require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./db/pool');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Telegram webhook
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    // /start
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || '';

      if (text.startsWith('/start')) {
        await bot.sendMessage(
          chatId,
          `👋 Салом, ${msg.from.first_name || 'агент'}!\n\n🏠 GK Network га хуш келибсиз!\n\nКириш учун логин ва паролингизни Mini App орқали киритинг.`
        );
      }
    }

    // Inline button callbacks
    if (update.callback_query) {
      const q = update.callback_query;
      const data = q.data || '';
      const chatId = q.message.chat.id;

      if (data.startsWith('lead_accept_') || data.startsWith('lead_reject_')) {
        const leadId = data.replace('lead_accept_', '').replace('lead_reject_', '');
        const status = data.startsWith('lead_accept_') ? 'accepted' : 'rejected';

        const result = await pool.query(
          `
          UPDATE lead_exchange
          SET status = $1,
              responded_at = NOW()
          WHERE id = $2
          RETURNING *
          `,
          [status, leadId]
        );

        if (result.rows[0]) {
          await bot.answerCallbackQuery(q.id, {
            text: status === 'accepted' ? 'Лид қабул қилинди' : 'Лид рад этилди'
          });

          await bot.sendMessage(
            chatId,
            status === 'accepted'
              ? '✅ Лид қабул қилинди'
              : '❌ Лид рад этилди'
          );
        } else {
          await bot.answerCallbackQuery(q.id, {
            text: 'Лид топилмади'
          });
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    res.status(200).json({ ok: false });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/leads', require('./routes/leads'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Topilmadi' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server ishlamoqda: http://localhost:${PORT}`);
});