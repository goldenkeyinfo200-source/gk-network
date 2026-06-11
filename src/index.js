require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');

const app = express();

/* ==========================
   TELEGRAM BOT INIT
========================== */

let bot = null;

try {
  if (process.env.BOT_TOKEN) {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    console.log('✅ Telegram bot ulandi');
  } else {
    console.warn("⚠️ BOT_TOKEN yo'q — Telegram o'chirildi");
  }
} catch (err) {
  console.error('❌ Bot init xato:', err.message);
  bot = null;
}

async function tgSend(chatId, text, opts = {}) {
  if (!bot) return null;

  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error('tgSend xato:', err.message);
    return null;
  }
}

app.set('bot', bot);
app.set('tgSend', tgSend);

/* ==========================
   MIDDLEWARE
========================== */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ==========================
   TELEGRAM WEBHOOK
========================== */

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = msg.text || '';

      const telegramId = String(msg.from.id);
      const tgUsername = msg.from.username || null;
      const firstName = msg.from.first_name || '';
      const lastName = msg.from.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();

      /* ==========================
         /start
      ========================== */

      if (text.startsWith('/start')) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS telegram_users (
            telegram_id TEXT PRIMARY KEY,
            tg_username TEXT,
            full_name TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        await pool.query(
          `
          INSERT INTO telegram_users (
            telegram_id,
            tg_username,
            full_name,
            updated_at
          )
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (telegram_id)
          DO UPDATE SET
            tg_username = EXCLUDED.tg_username,
            full_name = EXCLUDED.full_name,
            updated_at = NOW()
          `,
          [telegramId, tgUsername, fullName]
        );

        let linkedAgent = null;

        // Агар Telegram username агент login билан бир хил бўлса — автомат улайди
        if (tgUsername) {
          const { rows } = await pool.query(
            `
            UPDATE agents
            SET telegram_id = $1
            WHERE LOWER(login) = LOWER($2)
            RETURNING id, login, full_name, phone, telegram_id
            `,
            [telegramId, tgUsername]
          );

          linkedAgent = rows[0] || null;
        }

        if (linkedAgent) {
          await tgSend(
            chatId,
            `✅ <b>Telegram ID avtomatik saqlandi!</b>\n\n` +
              `👤 Agent: <b>${linkedAgent.full_name || '-'}</b>\n` +
              `🔐 Login: <b>${linkedAgent.login || '-'}</b>\n` +
              `🆔 Telegram ID: <code>${telegramId}</code>\n\n` +
              `Endi sizga lidlar, postlar va xabarlar shu bot orqali keladi.\n\n` +
              `Quyidagi tugma orqali GK Network Mini App ni oching 👇`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '🏠 GK Network ni ochish',
                      web_app: {
                        url:
                          process.env.MINI_APP_URL ||
                          'https://gk-frontend-one.vercel.app'
                      }
                    }
                  ]
                ]
              }
            }
          );

          return res.json({ ok: true });
        }

        await tgSend(
          chatId,
          `👋 <b>Assalomu alaykum!</b>\n\n` +
            `GK Network botiga xush kelibsiz.\n\n` +
            `✅ Telegram ID avtomatik olindi:\n` +
            `<code>${telegramId}</code>\n\n` +
            `Endi GK Network Mini App ni oching va login qiling.\n` +
            `Login qilganingizdan keyin Telegram ID profilingizga avtomatik bog'lanadi.\n\n` +
            `📌 Bot orqali sizga quyidagilar keladi:\n` +
            `• yangi lidlar\n` +
            `• tayyor postlar\n` +
            `• agentlar uchun xabarlar\n` +
            `• admin e'lonlari\n\n` +
            `Quyidagi tugmani bosing 👇`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🏠 GK Network ni ochish',
                    web_app: {
                      url:
                        process.env.MINI_APP_URL ||
                        'https://gk-frontend-one.vercel.app'
                    }
                  }
                ]
              ]
            }
          }
        );

        return res.json({ ok: true });
      }

      /* ==========================
         /id
      ========================== */

      if (text.startsWith('/id')) {
        await tgSend(
          chatId,
          `🆔 Sizning Telegram ID:\n<code>${telegramId}</code>`,
          { parse_mode: 'HTML' }
        );

        return res.json({ ok: true });
      }

      /* ==========================
         /link login
      ========================== */

      if (text.startsWith('/link ')) {
        const login = text.replace('/link ', '').trim();

        if (!login) {
          await tgSend(chatId, 'Login kiriting. Masalan: /link sardor');
          return res.json({ ok: true });
        }

        const { rows } = await pool.query(
          `
          UPDATE agents
          SET telegram_id = $1
          WHERE LOWER(login) = LOWER($2)
          RETURNING login, full_name
          `,
          [telegramId, login]
        );

        if (rows[0]) {
          await tgSend(
            chatId,
            `✅ <b>Telegram akkaunt ulandi!</b>\n\n` +
              `👤 Agent: <b>${rows[0].full_name}</b>\n` +
              `🔐 Login: <b>${rows[0].login}</b>\n` +
              `🆔 Telegram ID: <code>${telegramId}</code>`,
            { parse_mode: 'HTML' }
          );
        } else {
          await tgSend(chatId, '❌ Bunday login topilmadi.');
        }

        return res.json({ ok: true });
      }
    }

    /* ==========================
       CALLBACK QUERY
    ========================== */

    if (update.callback_query) {
      const q = update.callback_query;
      const data = q.data || '';
      const chatId = q.message.chat.id;

      if (data.startsWith('lead_accept_') || data.startsWith('lead_reject_')) {
        const leadId = data
          .replace('lead_accept_', '')
          .replace('lead_reject_', '');

        const status = data.startsWith('lead_accept_')
          ? 'accepted'
          : 'rejected';

        await pool.query(
          `
          UPDATE lead_exchange
          SET status = $1,
              responded_at = NOW()
          WHERE id = $2
          `,
          [status, leadId]
        );

        if (bot) {
          await bot.answerCallbackQuery(q.id, {
            text:
              status === 'accepted'
                ? '✅ Qabul qilindi'
                : '❌ Rad etildi'
          });
        }

        await tgSend(
          chatId,
          status === 'accepted'
            ? '✅ <b>Lid qabul qilindi!</b>'
            : '❌ <b>Lid rad etildi.</b>',
          { parse_mode: 'HTML' }
        );

        return res.json({ ok: true });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: false });
  }
});

/* ==========================
   API ROUTES
========================== */

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/admin', require('./routes/admin'));

/* ==========================
   HEALTH CHECK
========================== */

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date()
  });
});

/* ==========================
   404
========================== */

app.use((req, res) => {
  res.status(404).json({ error: 'Topilmadi' });
});

/* ==========================
   ERROR HANDLER
========================== */

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

/* ==========================
   SERVER
========================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server ishlamoqda: http://localhost:${PORT}`);
});