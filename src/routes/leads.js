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

async function saveTelegramId(msg) {
  const tgId = msg.from.id;
  const username = msg.from.username || '';

  if (!username) return null;

  const { rows } = await pool.query(
    `
    UPDATE agents
    SET telegram_id = $1
    WHERE LOWER(login) = LOWER($2)
    RETURNING login, full_name
    `,
    [tgId, username]
  );

  return rows[0] || null;
}

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || '';

      if (text.startsWith('/start')) {
        const linkedAgent = await saveTelegramId(msg);

        if (linkedAgent) {
          await bot.sendMessage(
            chatId,
            `✅ Telegram ID сақланди!\n\n👤 Агент: ${linkedAgent.full_name}\n🔐 Login: ${linkedAgent.login}`
          );
        } else {
          await bot.sendMessage(
            chatId,
            `👋 Салом!\n\nTelegram ID ни агент аккаунтига улаш учун логинингизни юборинг:\n\n/link login\n\nМасалан:\n/link damir`
          );
        }
      }

      if (text.startsWith('/link ')) {
        const login = text.replace('/link ', '').trim();

        if (!login) {
          await bot.sendMessage(chatId, 'Логинни киритинг. Масалан: /link damir');
          return res.json({ ok: true });
        }

        const { rows } = await pool.query(
          `
          UPDATE agents
          SET telegram_id = $1
          WHERE LOWER(login) = LOWER($2)
          RETURNING login, full_name
          `,
          [msg.from.id, login]
        );

        if (rows[0]) {
          await bot.sendMessage(
            chatId,
            `✅ Telegram ID сақланди!\n\n👤 Агент: ${rows[0].full_name}\n🔐 Login: ${rows[0].login}`
          );
        } else {
          await bot.sendMessage(chatId, '❌ Бундай login топилмади.');
        }
      }
    }

    if (update.callback_query) {
      const q = update.callback_query;
      const data = q.data || '';
      const chatId = q.message.chat.id;

      if (data.startsWith('lead_accept_') || data.startsWith('lead_reject_')) {
        const leadId = data.replace('lead_accept_', '').replace('lead_reject_', '');
        const status = data.startsWith('lead_accept_') ? 'accepted' : 'rejected';

        const { rows } = await pool.query(
          `
          UPDATE lead_exchange
          SET status = $1,
              responded_at = NOW()
          WHERE id = $2
          RETURNING *
          `,
          [status, leadId]
        );

        await bot.answerCallbackQuery(q.id, {
          text: status === 'accepted' ? 'Лид қабул қилинди' : 'Лид рад этилди'
        });

        await bot.sendMessage(
          chatId,
          status === 'accepted'
            ? '✅ Лид қабул қилинди'
            : '❌ Лид рад этилди'
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    res.status(200).json({ ok: false });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/leads', require('./routes/leads'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Topilmadi' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server ishlamoqda: http://localhost:${PORT}`);
});