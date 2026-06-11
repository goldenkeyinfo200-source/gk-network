require('dotenv').config();

const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const clientsRoutes = require('./routes/clients');
const leadsRoutes = require('./routes/leads');
const adminRoutes = require('./routes/admin');
const bannersRoutes = require('./routes/banners');

const app = express();
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: false,
});

app.set('bot', bot);

app.use(cors({
  origin: '*',
  credentials: true,
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

async function tgSendMessage(chatId, text, extra = {}) {
  if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN topilmadi');
    return null;
  }

  try {
    return await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      ...extra,
    });
  } catch (err) {
    console.error('Telegram sendMessage error:', err.message);
    return null;
  }
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GK Network API',
  });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      db: 'connected',
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health error:', err);
    res.status(500).json({
      status: 'error',
      db: 'disconnected',
    });
  }
});

/* ==========================
   TELEGRAM WEBHOOK
========================== */

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    const message = update.message;
    const callback = update.callback_query;

    if (message) {
      const chatId = message.chat.id;
      const text = message.text || '';

      const tgId = Number(message.from.id);
      const username = message.from.username || null;
      const firstName = message.from.first_name || '';
      const lastName = message.from.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();

      console.log('Telegram message:', {
        chatId,
        tgId,
        username,
        text,
      });

      if (text.startsWith('/start')) {
        try {
          if (username) {
            await pool.query(
              `
              UPDATE agents
              SET
                telegram_id = $1,
                username = COALESCE(username, $2)
              WHERE
                telegram_id = $1
                OR LOWER(username) = LOWER($2)
                OR LOWER(login) = LOWER($2)
              `,
              [tgId, username]
            );
          }
        } catch (dbErr) {
          console.error('Telegram ID saqlash xato:', dbErr.message);
        }

        await tgSendMessage(
          chatId,
          `Assalomu alaykum, <b>${fullName || 'agent'}</b>!\n\n` +
          `🏠 <b>GK Network</b> botiga xush kelibsiz.\n\n` +
          `Bu yerda siz:\n` +
          `✅ obyekt qo‘shasiz\n` +
          `✅ mijoz qo‘shasiz\n` +
          `✅ mos obyektlarni ko‘rasiz\n` +
          `✅ lidlarni qabul qilasiz\n\n` +
          `Mini App orqali ishlash uchun pastdagi tugmani bosing.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🏠 GK Network ochish',
                    web_app: {
                      url: process.env.MINI_APP_URL || 'https://gk-frontend-one.vercel.app',
                    },
                  },
                ],
              ],
            },
          }
        );

        return res.sendStatus(200);
      }

      await tgSendMessage(
        chatId,
        `Buyruq tushunilmadi.\n\nBoshlash uchun /start ni bosing.`
      );

      return res.sendStatus(200);
    }

    if (callback) {
      console.log('Telegram callback:', callback.data);
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.sendStatus(200);
  }
});

/* ==========================
   API ROUTES
========================== */

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/banners', bannersRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Topilmadi',
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server xatosi',
  });
});

app.listen(PORT, () => {
  console.log(`✅ GK Network API ishlayapti. PORT: ${PORT}`);
});