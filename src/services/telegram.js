const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN);

const TYPE_UZ = {
  apartment: '🏠 Квартира',
  house: '🏡 Ҳовли',
  office: '🏢 Офис',
  land: '🏗 Ер участка'
};

const PURPOSE_UZ = {
  sell: 'СОТИЛАДИ',
  rent: 'ИЖАРАГА'
};

// Obyekt uchun post matni
function buildPostText(property, agent) {
  const type = TYPE_UZ[property.property_type] || property.property_type;
  const purpose = PURPOSE_UZ[property.purpose] || property.purpose;
  const price = Number(property.price).toLocaleString('uz-UZ');

  let text = `🏷 <b>${purpose}</b>\n`;
  text += `${type}\n\n`;

  if (property.rooms) text += `🛏 ${property.rooms} хона`;
  if (property.area) text += ` · 📐 ${property.area} м²`;
  if (property.floor && property.total_floors) text += ` · 🏢 ${property.floor}/${property.total_floors} қават`;
  text += '\n';

  text += `💰 <b>$${price}</b>\n`;

  if (property.region || property.district) {
    text += `📍 ${[property.region, property.district].filter(Boolean).join(', ')}\n`;
  }

  if (property.mortgage) text += `✅ Ипотека мумкин\n`;
  if (property.installment) text += `✅ Муддатли тўлов\n`;

  if (property.description) {
    text += `\n📝 ${property.description}\n`;
  }

  text += `\n👤 <b>${agent.full_name || 'Агент'}</b>`;
  if (agent.phone) text += ` · 📞 ${agent.phone}`;
  text += `\n🆔 ${property.display_id}`;

  return text;
}

// Kanalga post yuborish
async function sendPropertyPost(property, agent) {
  const text = buildPostText(property, agent);
  const photos = property.photos || [];

  const keyboard = {
    inline_keyboard: [[
      { text: '📞 Боғланиш', url: `https://t.me/${agent.telegram?.replace('@', '') || 'username'}` },
      { text: '🔍 Батафсил', callback_data: `prop_${property.id}` }
    ]]
  };

  // 1. Ommaviy kanal
  if (process.env.CHANNEL_PUBLIC) {
    if (photos.length > 0) {
      const media = photos.map((url, i) => ({
        type: 'photo',
        media: url,
        ...(i === 0 ? { caption: text, parse_mode: 'HTML' } : {})
      }));
      await bot.sendMediaGroup(process.env.CHANNEL_PUBLIC, media);
    } else {
      await bot.sendMessage(process.env.CHANNEL_PUBLIC, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }
  }

  // 2. Agentlar kanali (to'liq ma'lumot)
  if (process.env.CHANNEL_AGENTS) {
    let agentText = text;
    if (property.address) agentText += `\n🗺 <b>Manзil:</b> ${property.address}`;
    if (property.owner_name) agentText += `\n👤 <b>Egasi:</b> ${property.owner_name}`;
    if (property.owner_phone) agentText += `\n📱 <b>Egasi tel:</b> ${property.owner_phone}`;

    await bot.sendMessage(process.env.CHANNEL_AGENTS, agentText, { parse_mode: 'HTML' });
  }

  return true;
}

// Yangi bino uchun post
async function sendProjectPost(project, company) {
  if (!process.env.CHANNEL_NEWBUILDS) return;

  const available = project.total_units - project.sold_units;
  let text = `🏗 <b>ЯНГИ БИНО</b>\n`;
  text += `<b>${project.name}</b>\n\n`;

  if (project.region) text += `📍 ${project.region}\n`;
  text += `🏠 Жами: ${project.total_units} та\n`;
  text += `✅ Мавжуд: <b>${available} та</b>\n`;
  if (project.delivery_date) {
    text += `📅 Топшириш: ${new Date(project.delivery_date).toLocaleDateString('uz-UZ')}\n`;
  }
  if (project.description) text += `\n📝 ${project.description}\n`;
  text += `\n🏢 <b>${company.name}</b>`;

  const photos = project.photos || [];
  if (photos.length > 0) {
    const media = photos.map((url, i) => ({
      type: 'photo',
      media: url,
      ...(i === 0 ? { caption: text, parse_mode: 'HTML' } : {})
    }));
    await bot.sendMediaGroup(process.env.CHANNEL_NEWBUILDS, media);
  } else {
    await bot.sendMessage(process.env.CHANNEL_NEWBUILDS, text, { parse_mode: 'HTML' });
  }
}

module.exports = { sendPropertyPost, sendProjectPost };
