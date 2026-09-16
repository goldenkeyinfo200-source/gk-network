// Railway redeploy trigger 2026-09-14
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN);

// Ommaviy kanal uchun Golden Key Info telefon raqami.
// Railway Variables ichida PUBLIC_PHONE bersangiz, keyinchalik kodni o'zgartirmasdan almashtirish mumkin.
const PUBLIC_PHONE = process.env.PUBLIC_PHONE || '+998 99 999 79 73';

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

// Obyekt uchun asosiy post matni
function toLatin(value) {
  if (value === null || value === undefined) return '';
  const map = {
    'А':'A','а':'a','Б':'B','б':'b','В':'V','в':'v','Г':'G','г':'g',
    'Д':'D','д':'d','Е':'E','е':'e','Ё':'Yo','ё':'yo','Ж':'J','ж':'j',
    'З':'Z','з':'z','И':'I','и':'i','Й':'Y','й':'y','К':'K','к':'k',
    'Л':'L','л':'l','М':'M','м':'m','Н':'N','н':'n','О':'O','о':'o',
    'П':'P','п':'p','Р':'R','р':'r','С':'S','с':'s','Т':'T','т':'t',
    'У':'U','у':'u','Ф':'F','ф':'f','Х':'X','х':'x','Ц':'Ts','ц':'ts',
    'Ч':'Ch','ч':'ch','Ш':'Sh','ш':'sh','Щ':'Sh','щ':'sh','Ъ':'','ъ':'',
    'Ы':'I','ы':'i','Ь':'','ь':'','Э':'E','э':'e','Ю':'Yu','ю':'yu',
    'Я':'Ya','я':'ya','Ў':'O‘','ў':'o‘','Қ':'Q','қ':'q','Ғ':'G‘','ғ':'g‘',
    'Ҳ':'H','ҳ':'h'
  };
  return String(value).split('').map(ch => map[ch] ?? ch).join('');
}

const TYPE_UZ = {
  apartment: '🏠 Kvartira',
  house: '🏡 Hovli',
  office: '🏢 Ofis',
  land: '🏗 Yer uchastkasi'
};

const PURPOSE_UZ = {
  sell: 'SOTILADI',
  rent: 'IJARAGA'
};

function buildPropertyBaseText(property) {
  const type = TYPE_UZ[property.property_type] || toLatin(property.property_type);
  const purpose = PURPOSE_UZ[property.purpose] || toLatin(property.purpose);
  const price = Number(property.price).toLocaleString('uz-UZ');

  let text = `🏷 <b>${purpose}</b> ${type}\n\n`;

  if (property.address || property.region || property.district) {
    const address = property.address || [property.region, property.district].filter(Boolean).join(', ');
    text += `📍 <b>Manzil:</b> ${toLatin(address)}\n`;
  }
  if (property.floor && property.total_floors) {
    text += `🏢 Qavat: ${property.floor}/${property.total_floors}\n`;
  }
  if (property.rooms) text += `🛏 Xonalar soni: ${property.rooms} ta\n`;
  if (property.area) text += `📐 Maydoni: ${property.area} m²\n`;

  if (property.landmark) text += `📌 Mo‘ljal: ${toLatin(property.landmark)}\n`;
  if (property.mortgage) text += `✅ Ipoteka mumkin\n`;
  if (property.installment) text += `✅ Muddatli to‘lov\n`;

  if (property.description) {
    text += `\n📝 <b>Qo‘shimcha ma’lumotlar:</b>\n${toLatin(property.description)}\n`;
  }

  text += `\n💰 <b>Narxi: $${price}</b>\n`;
  return text;
}

// Ommaviy kanal posti: agent telefoni o'rniga Golden Key Info raqami chiqadi
function buildPublicPostText(property) {
  let text = buildPropertyBaseText(property);
  text += `\n📞 <b>Murojaat uchun:</b> ${PUBLIC_PHONE}`;
  text += `\n🆔 ${property.display_id}`;
  return text;
}

// Agentlar ichki kanali: agentning o'z ismi va telefoni saqlanadi
function buildAgentPostText(property, agent) {
  let text = buildPropertyBaseText(property);

  text += `\n👤 <b>${toLatin(agent.full_name || 'Agent')}</b>`;
  if (agent.phone) text += ` · 📞 ${toLatin(agent.phone)}`;
  text += `\n🆔 ${property.display_id}`;

  if (property.address) text += `\n🗺 <b>Manzil:</b> ${toLatin(property.address)}`;
  if (property.owner_name) text += `\n👤 <b>Egasi:</b> ${toLatin(property.owner_name)}`;
  if (property.owner_phone) text += `\n📱 <b>Egasi tel:</b> ${toLatin(property.owner_phone)}`;

  return text;
}

// Kanalga post yuborish
async function sendPropertyPost(property, agent) {
  const publicText = buildPublicPostText(property);
  const agentText = buildAgentPostText(property, agent);
  const photos = property.photos || [];

  // Agentga olib boradigan "Bog'lanish" tugmasi ommaviy kanaldan olib tashlandi.
  // "Batafsil" tugmasi fotosiz postlarda qoladi.
  const publicKeyboard = {
    inline_keyboard: [[
      { text: '🔍 Батафсил', callback_data: `prop_${property.id}` }
    ]]
  };

  // 1. Ommaviy kanal — Golden Key Info raqami bilan
  if (process.env.CHANNEL_PUBLIC) {
    if (photos.length > 0) {
      const media = photos.map((url, i) => ({
        type: 'photo',
        media: url,
        ...(i === 0 ? { caption: publicText, parse_mode: 'HTML' } : {})
      }));
      await bot.sendMediaGroup(process.env.CHANNEL_PUBLIC, media);
    } else {
      await bot.sendMessage(process.env.CHANNEL_PUBLIC, publicText, {
        parse_mode: 'HTML',
        reply_markup: publicKeyboard
      });
    }
  }

  // 2. Agentlar kanali — agentning o'z telefoni va to'liq ma'lumot bilan
  if (process.env.CHANNEL_AGENTS) {
    await bot.sendMessage(process.env.CHANNEL_AGENTS, agentText, {
      parse_mode: 'HTML'
    });
  }

  return true;
}

// Yangi bino uchun post
async function sendProjectPost(project, company) {
  if (!process.env.CHANNEL_NEWBUILDS) return;

  const available = project.total_units - project.sold_units;
  let text = `🏗 <b>YANGI BINO</b>\n`;
  text += `<b>${project.name}</b>\n\n`;

  if (project.region) text += `📍 ${project.region}\n`;
  text += `🏠 Jami: ${project.total_units} та\n`;
  text += `✅ Mavjud: <b>${available} та</b>\n`;
  if (project.delivery_date) {
    text += `📅 Topshirish: ${new Date(project.delivery_date).toLocaleDateString('uz-UZ')}\n`;
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


