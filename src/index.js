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
          // Login yoki username orqali agentni topib, telegram_id saqlaymiz
          const updateResult = await pool.query(
            `UPDATE agents
             SET telegram_id = $1,
                 username    = $2
             WHERE
               (
                 LOWER(login)    = LOWER($2)
                 OR LOWER(username) = LOWER($2)
                 OR telegram_id  = $1
               )
             RETURNING id, login`,
            [tgId, username || '']
          );

          if (updateResult.rowCount > 0) {
            console.log('Telegram ID saqlandi:', updateResult.rows[0].login, '->', tgId);
          } else {
            console.log('Agent topilmadi, username:', username, 'tgId:', tgId);
          }
        } catch (dbErr) {
          console.error('Telegram ID saqlash xato:', dbErr.message);
        }

        // Allaqachon bog'langanmi?
        const alreadyLinked = await pool.query(
          'SELECT id, full_name FROM agents WHERE telegram_id=$1',
          [tgId]
        );

        if (alreadyLinked.rowCount === 0) {
          await tgSendMessage(
            chatId,
            `Assalomu alaykum, <b>${fullName || 'agent'}</b>! \n\n` +
            `GK Network CRM botiga xush kelibsiz.\n\n` +
            `Akkauntingizni boghlash uchun CRM loginingizni yuboring:\n\n` +
            `/login sizning_loginингиз\n\n` +
            `Masalan: /login sardor85`
          );
          return res.sendStatus(200);
        }

        const agentName = alreadyLinked.rows[0].full_name || fullName || 'agent';

        await tgSendMessage(
          chatId,
          `Xush kelibsiz, <b>${agentName}</b>! Telegram akkauntingiz boghlangan.\n\nMini App orqali ishlash uchun pastdagi tugmani bosing.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'GK Network ochish',
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

      // Agent loginini yozib o'z akkauntini bog'lashi
      if (text.startsWith('/login ')) {
        const loginInput = text.replace('/login ', '').trim().toLowerCase();
        try {
          const linkResult = await pool.query(
            `UPDATE agents
             SET telegram_id = $1, username = $2
             WHERE LOWER(login) = $3
               AND (telegram_id IS NULL OR telegram_id = $1)
             RETURNING id, login, full_name`,
            [tgId, username || '', loginInput]
          );

          if (linkResult.rowCount > 0) {
            const agent = linkResult.rows[0];
            console.log('Bot orqali boqlandi:', agent.login, '->', tgId);
            await tgSendMessage(
              chatId,
              `✅ <b>${agent.full_name || agent.login}</b>, Telegram akkauntingiz muvaffaqiyatli bog'landi!\n\nEndi parolni tiklash va bildirishnomalar ishlaydi.`,
            );
          } else {
            await tgSendMessage(
              chatId,
              `❌ <b>${loginInput}</b> logini topilmadi yoki allaqachon boshqa akkauntga bog'langan.\n\nLoginni to'g'ri kiritdingizmi?`
            );
          }
        } catch (dbErr) {
          console.error('Login orqali boqlash xato:', dbErr.message);
          await tgSendMessage(chatId, '❌ Xatolik yuz berdi. Qayta urinib koring.');
        }
        return res.sendStatus(200);
      }

      await tgSendMessage(
        chatId,
        `Buyruq tushunilmadi.\n\n/start — botni boshlash\n/login <b>loginингиз</b> — akkauntni bog'lash`
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