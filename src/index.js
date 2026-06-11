require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const clientsRoutes = require('./routes/clients');
const leadsRoutes = require('./routes/leads');
const adminRoutes = require('./routes/admin');
const bannersRoutes = require('./routes/banners');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

async function tgSendMessage(chatId, text, extra = {}) {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.error('BOT_TOKEN topilmadi');
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...extra
    })
  });

  const data = await res.json();

  if (!data.ok) {
    console.error('Telegram sendMessage error:', data);
  }

  return data;
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GK Network API'
  });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      db: 'connected',
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error('Health error:', err);
    res.status(500).json({
      status: 'error',
      db: 'disconnected'
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
      const tgId = String(message.from.id);
      const username = message.from.username || null;
      const firstName = message.from.first_name || '';
      const lastName = message.from.last_name || '';
      const fullName = `${firstName} ${lastName}`.trim();

      console.log('Telegram message:', {
        chatId,
        tgId,
        username,
        text
      });

      if (text.startsWith('/start')) {
        await pool.query(
          `
          UPDATE agents
          SET
            telegram_id = $1,
            username = COALESCE(username, $2)
          WHERE
            telegram_id::text = $1
            OR username = $2
            OR login = $2
          `,
          [tgId, username]
        );

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
                      url: process.env.MINI_APP_URL || 'https://gk-frontend-one.vercel.app'
                    }
                  }
                ]
              ]
            }
          }
        );

        return res.sendStatus(200);
      }

      await tgSendMessage(
        chatId,
        `Buyruq tushunilmadi.\n\n` +
        `Boshlash uchun /start ni bosing.`,
      );

      return res.sendStatus(200);
    }

    if (callback) {
      console.log('Telegram callback:', callback.data);
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
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
    error: 'Topilmadi'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server xatosi'
  });
});

app.listen(PORT, () => {
  console.log(`✅ GK Network API ishlayapti. PORT: ${PORT}`);
});