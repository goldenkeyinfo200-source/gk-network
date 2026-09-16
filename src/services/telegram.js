// Railway redeploy trigger 2026-09-16
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// --- Botni xavfsiz ishga tushirish ---
// BOT_TOKEN noto'g'ri yoki yo'q bo'lsa ham, bu fayl butun serverni
// (index.js / routes/properties.js orqali) qulatib qo'ymasligi kerak.
let bot = null;
if (process.env.BOT_TOKEN) {
  try {
    bot = new TelegramBot(process.env.BOT_TOKEN);
  } catch (err) {
    console.error('[telegram.js] Botni ishga tushirishda xatolik:', err.message);
  }
} else {
  console.warn('[telegram.js] BOT_TOKEN topilmadi — Telegram funksiyalari o\'chirilgan.');
}

// Ommaviy kanal uchun Golden Key Info telefon raqami.
// Railway Variables ichida PUBLIC_PHONE bersangiz, keyinchalik kodni o'zgartirmasdan almashtirish mumkin.
const PUBLIC_PHONE = process.env.PUBLIC_PHONE || '+998 99 999 79 73';

// Kirill harflarini lotinga o'girish (foydalanuvchi matnlari uchun)
function toLatin(value) {
  if (value === null || value === undefined) return '';
  const map = {
    'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v', 'Г': 'G', 'г': 'g',
    'Д': 'D', 'д': 'd', 'Е': 'E', 'е': 'e', 'Ё': 'Yo', 'ё': 'yo', 'Ж': 'J', 'ж': 'j',
    'З': 'Z', 'з': 'z', 'И': 'I', 'и': 'i', 'Й': 'Y', 'й': 'y', 'К': 'K', 'к': 'k',
    'Л': 'L', 'л': 'l', 'М': 'M', 'м': 'm', 'Н': 'N', 'н': 'n', 'О': 'O', 'о': 'o',
    'П': 'P', 'п': 'p', 'Р': 'R', 'р': 'r', 'С': 'S', 'с': 's', 'Т': 'T', 'т': 't',
    'У': 'U', 'у': 'u', 'Ф': 'F', 'ф': 'f', 'Х': 'X', 'х': 'x', 'Ц': 'Ts', 'ц': 'ts',
    'Ч': 'Ch', 'ч': 'ch', 'Ш': 'Sh', 'ш': 'sh', 'Щ': 'Sh', 'щ': 'sh', 'Ъ': '', 'ъ': '',
    'Ы': 'I', 'ы': 'i', 'Ь': '', 'ь': '', 'Э': 'E', 'э': 'e', 'Ю': 'Yu', 'ю': 'yu',
    'Я': 'Ya', 'я': 'ya', 'Ў': 'O‘', 'ў': 'o‘', 'Қ': 'Q', 'қ': 'q', 'Ғ': 'G‘', 'ғ': 'g‘',
    'Ҳ': 'H', 'ҳ': 'h'
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

// Obyekt uchun asosiy post matni
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
  if (!bot) {
    console.warn('[telegram.js] sendPropertyPost chaqirildi, lekin bot ishga tushmagan (BOT_TOKEN yo\'q).');
    return false;
  }

  const publicText = buildPublicPostText(property);
  const agentText = buildAgentPostText(property, agent);
  const photos = property.photos || [];

  // "Batafsil" tugmasi fotosiz postlarda qoladi.
  const publicKeyboard = {
    inline_keyboard: [[
      { text: '🔍 Batafsil', callback_data: `prop_${property.id}` }
    ]]
  };

  try {
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
  } catch (err) {
    console.error('[telegram.js] sendPropertyPost xatolik:', err.message);
    return false;
  }

  return true;
}

// Yangi bino uchun post
async function sendProjectPost(project, company) {
  if (!bot) {
    console.warn('[telegram.js] sendProjectPost chaqirildi, lekin bot ishga tushmagan (BOT_TOKEN yo\'q).');
    return false;
  }
  if (!process.env.CHANNEL_NEWBUILDS) return false;

  const available = project.total_units - project.sold_units;
  let text = `🏗 <b>YANGI BINO</b>\n`;
  text += `<b>${project.name}</b>\n\n`;

  if (project.region) text += `📍 ${project.region}\n`;
  text += `🏠 Jami: ${project.total_units} ta\n`;
  text += `✅ Mavjud: <b>${available} ta</b>\n`;
  if (project.delivery_date) {
    text += `📅 Topshirish: ${new Date(project.delivery_date).toLocaleDateString('uz-UZ')}\n`;
  }
  if (project.description) text += `\n📝 ${project.description}\n`;
  text += `\n🏢 <b>${company.name}</b>`;

  const photos = project.photos || [];

  try {
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
  } catch (err) {
    console.error('[telegram.js] sendProjectPost xatolik:', err.message);
    return false;
  }

  return true;
}

module.exports = { sendPropertyPost, sendProjectPost };
