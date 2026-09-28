// telegram.js
//
// Telegram e'lonlarini 3 xil ko'rinishda yuboradi:
// 1) MARKAZIY KANAL: manzil qisqartiriladi + faqat kompaniya telefoni.
// 2) AGENT SHAXSIY BOTI: manzil qisqartiriladi + agent telefoni.
// 3) AGENTLAR ICHKI KANALI: to'liq manzil + agent telefoni + mulk egasi ma'lumotlari.
//
// CRM bazasidagi to'liq manzil va owner ma'lumotlari o'zgarmaydi.

const fs = require('fs');

const TYPE_UZ = {
  apartment:  'Kvartira',
  house:      'Uy / Hovli',
  office:     'Ofis',
  land:       'Yer (Arsa)',
  commercial: 'Noturar joy',
};

const PUBLIC_PHONE = '+998999997973';

/**
 * Telegramga chiqariladigan qisqa manzil.
 *
 * Misol:
 * "Shaldiramoq, 12/8 | Shaldiramoq" -> "Shaldiramoq"
 * "Shaldiramoq, 12/8"                -> "Shaldiramoq"
 */
function getShortAddress(property) {
  const raw =
    property.landmark ||
    property.address ||
    property.district ||
    property.region ||
    '';

  // "manzil | mo'ljal" formatida bo'lsa, chap tomoni manzil.
  let value = String(raw).split('|')[0].trim();

  // Uy raqamini oxiridan olib tashlash.
  // Misollar: ", 12/8", ", 12", " 12/8"
  value = value
    .replace(/\s*,\s*\d+[A-Za-zА-Яа-я]?(?:\s*[/\\-]\s*\d+[A-Za-zА-Яа-я]?)?\s*$/u, '')
    .replace(/\s+\d+[A-Za-zА-Яа-я]?(?:\s*[/\\-]\s*\d+[A-Za-zА-Яа-я]?)?\s*$/u, '')
    .trim();

  return value;
}

/**
 * To'liq manzil faqat ichki agentlar kanalida ishlatiladi.
 * CRMdagi address maydoni mavjud bo'lsa, u yo'qolib ketmaydi.
 */
function getFullAddress(property) {
  const parts = [];

  if (property.region) parts.push(String(property.region).trim());
  if (property.district) parts.push(String(property.district).trim());

  const address = String(property.address || '').trim();
  if (address) {
    parts.push(address);
  } else if (property.landmark) {
    const landmarkAddress = String(property.landmark).split('|')[0].trim();
    if (landmarkAddress) parts.push(landmarkAddress);
  }

  return [...new Set(parts.filter(Boolean))].join(', ');
}

/**
 * Mo'ljalni alohida olish.
 * landmark: "Shaldiramoq, 12/8 | Shaldiramoq"
 * natija: "Shaldiramoq"
 */
function getLandmark(property) {
  const raw = String(property.landmark || '');
  const parts = raw.split('|');

  if (parts[1] && parts[1].trim()) {
    return parts[1].trim();
  }

  return '';
}

function formatPhone(phone) {
  // Raqamni o'zgartirmaymiz: foydalanuvchi kiritgan bo'lsa,
  // bo'sh joylarni ham olib tashlaymiz.
  return String(phone || '').replace(/\s+/g, '');
}

/**
 * Umumiy e'lon matni.
 *
 * mode:
 *   public  - markaziy kanal
 *   agent   - agentning shaxsiy boti
 *   internal - agentlar ichki kanali
 */
function buildText(property, agent, mode = 'public') {
  const type   = TYPE_UZ[property.property_type] || property.property_type;
  const price  = Number(property.price).toLocaleString('en-US');
  const isLand = property.property_type === 'land';
  const isSell = property.purpose === 'sell';
  const line   = '━━━━━━━━━━━━━━━';

  const shortAddress = getShortAddress(property);
  const fullAddress  = getFullAddress(property);
  const moljal       = getLandmark(property);

  let t = '';

  // Sarlavha
  t += `🏠 <b>${isSell ? 'Sotiladi' : 'Ijaraga beriladi'}!</b>\n\n`;

  // Manzil:
  // Markaziy kanal va agent shaxsiy botida uy raqami ko'rsatilmaydi.
  if (mode === 'internal') {
    if (fullAddress) {
      t += `📍 <b>Manzil:</b> ${fullAddress}\n`;
    }
  } else {
    if (shortAddress) {
      t += `📍 <b>Manzil:</b> ${shortAddress}\n`;
    }
  }

  // Qavat
  if (!isLand && property.floor) {
    t += `🏢 <b>Qavati:</b> ${property.floor}${property.total_floors ? ' / ' + property.total_floors : ''}\n`;
  }

  // Xonalar
  if (!isLand && property.rooms) {
    t += `🛏️ <b>Xonalar soni:</b> ${property.rooms}\n`;
  }

  // Mulkchilik shakli
  t += `🏗 <b>Mulkchilik shakli:</b> ${type}\n`;

  // Maydon
  if (property.area) {
    t += `📏 <b>Maydoni:</b> ${property.area} ${isLand ? 'sotix' : 'm²'}\n`;
  }

  // Ipoteka
  if (property.mortgage) {
    t += `🏦 <b>Ipoteka:</b> Ha\n`;
  }

  // Muddatli to'lov
  if (property.installment) {
    t += `💳 <b>B/to'lov:</b> Ha\n`;
  }

  // Mo'ljal
  if (moljal) {
    t += `📌 <b>Mo'ljal:</b> ${moljal}\n`;
  }

  // Qo'shimcha ma'lumotlar
  if (property.description) {
    const feats = String(property.description).split('\n')[0];
    if (feats && feats.trim()) {
      t += `\n📝 <b>Qo'shimcha ma'lumotlar:</b>\n${feats.trim()}\n`;
    }
  }

  // Narx
  t += `\n💸 <b>Narxi: $${price}`;
  if (!isSell) t += '/oy';
  t += `</b>\n`;

  // Kontakt
  t += `${line}\n`;
  t += `📞 <b>Murojaat uchun:</b>\n`;

  if (mode === 'public') {
    // Faqat markaziy kanal uchun kompaniya raqami.
    t += `☎️ ${PUBLIC_PHONE}\n`;
  } else {
    // Agent boti va ichki kanal uchun agentning o'z raqami.
    const agentPhone = formatPhone(agent && agent.phone);
    if (agentPhone) {
      t += `☎️ ${agentPhone}\n`;
    }
  }

  // Ichki agentlar kanalida owner ma'lumotlari saqlanadi.
  if (mode === 'internal') {
    if (property.owner_name) {
      t += `👤 <b>Mulk egasi:</b> ${property.owner_name}\n`;
    }

    if (property.owner_phone) {
      t += `☎️ <b>Egasi telefoni:</b> ${formatPhone(property.owner_phone)}\n`;
    }
  }

  t += `${line}\n`;
  t += `🆔 ${property.display_id}`;

  return t;
}

/**
 * Mulk rasmlarini massiv ko'rinishida olish.
 * Har xil nomdagi maydonlarni qo'llab-quvvatlaydi:
 * photos, images, photo_urls, image_urls, media, photo.
 * Element: string (URL / file_id / lokal yo'l) yoki { url | file_id | path }.
 * Agar maydon JSON string bo'lsa, parse qilinadi.
 */
function getPhotos(property) {
  const candidates = [
    property.photos,
    property.images,
    property.photo_urls,
    property.image_urls,
    property.media,
    property.photo,
  ];

  let list = [];
  for (const c of candidates) {
    if (!c) continue;
    let v = c;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.startsWith('[')) {
        try { v = JSON.parse(trimmed); } catch (_) { v = [trimmed]; }
      } else {
        v = trimmed.split(',').map((x) => x.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(v)) v = [v];
    list = v;
    if (list.length) break;
  }

  return list
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') return item;
      return item.url || item.file_id || item.path || item.src || null;
    })
    .filter(Boolean)
    .slice(0, 10); // Telegram albomi maksimum 10 ta
}

// Lokal fayl yo'li bo'lsa oqimga aylantiramiz, aks holda (URL / file_id) o'zini beramiz.
function toMedia(src) {
  const isUrl = /^https?:\/\//i.test(src);
  if (!isUrl && fs.existsSync(src)) return fs.createReadStream(src);
  return src;
}

const CAPTION_LIMIT = 1024;

/**
 * Rasm bilan yuborish:
 *  - rasm yo'q      -> oddiy matn
 *  - 1 ta rasm      -> sendPhoto (matn caption)
 *  - 2+ rasm        -> sendMediaGroup (matn 1-rasmning caption'i)
 *  - matn 1024 dan uzun bo'lsa: rasmlar alohida, matn keyin alohida xabar
 *  - rasm yuborishda xato bo'lsa: matn baribir yuboriladi (post yo'qolmaydi)
 */
async function sendPost(bot, chatId, text, photos = []) {
  if (!photos.length) {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return;
  }

  const fitsCaption = text.length <= CAPTION_LIMIT;

  try {
    if (photos.length === 1) {
      await bot.sendPhoto(
        chatId,
        toMedia(photos[0]),
        fitsCaption ? { caption: text, parse_mode: 'HTML' } : {}
      );
    } else {
      const media = photos.map((src, i) => {
        const item = { type: 'photo', media: toMedia(src) };
        if (i === 0 && fitsCaption) {
          item.caption = text;
          item.parse_mode = 'HTML';
        }
        return item;
      });
      await bot.sendMediaGroup(chatId, media);
    }

    if (!fitsCaption) {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error(`⚠️ Rasm yuborishda xato, matn yuboriladi:`, err.message);
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }
}

async function sendPropertyPost(property, agent, bot) {
  if (!bot) {
    console.warn("⚠️ Bot yo'q");
    return false;
  }

  let success = false;
  const photos = getPhotos(property);
  console.log(`🖼 Rasmlar soni: ${photos.length} | ${property.display_id}`);

  // ─────────────────────────────────────────────────────
  // 1. MARKAZIY KANAL
  // Manzil: qisqa
  // Telefon: faqat +998999997973
  // ─────────────────────────────────────────────────────
  const publicChannel = process.env.CHANNEL_PUBLIC;

  if (publicChannel) {
    try {
      const publicText = buildText(property, agent, 'public');

      await sendPost(bot, publicChannel, publicText, photos);

      console.log(
        `✅ Markaziy kanal: ${property.display_id} | telefon=${PUBLIC_PHONE}`
      );

      success = true;
    } catch (err) {
      console.error(`❌ Markaziy kanal xato:`, err.message);
    }
  }

  // ─────────────────────────────────────────────────────
  // 2. AGENTLAR ICHKI KANALI
  // Manzil: to'liq
  // Telefon: agentniki
  // Owner: saqlanadi
  // ─────────────────────────────────────────────────────
  const agentsChannel = process.env.CHANNEL_AGENTS;

  if (agentsChannel) {
    try {
      const internalText = buildText(property, agent, 'internal');

      await sendPost(bot, agentsChannel, internalText, photos);

      console.log(`✅ Agentlar ichki kanali: ${property.display_id}`);
    } catch (err) {
      console.error(`❌ Agentlar kanal xato:`, err.message);
    }
  }

  // ─────────────────────────────────────────────────────
  // 3. AGENTNING SHAXSIY BOTI
  // Manzil: qisqa
  // Telefon: agentniki
  // Uy raqami: yashiriladi
  // ─────────────────────────────────────────────────────
  if (agent && agent.telegram_id) {
    try {
      const agentText = buildText(property, agent, 'agent');

      await sendPost(bot, agent.telegram_id, agentText, photos);

      console.log(
        `✅ Agent bot: ${agent.full_name} | telefon=${formatPhone(agent.phone) || 'yo‘q'}`
      );

      success = true;
    } catch (err) {
      console.error(`❌ Agent bot xato:`, err.message);
    }
  } else {
    const agentName = (agent && agent.full_name) ? agent.full_name : "noma'lum agent";
    console.warn(`⚠️ telegram_id yo'q: ${agentName}`);
  }

  return success;
}

module.exports = {
  sendPropertyPost,
  buildText,
  getShortAddress,
  getFullAddress,
  getPhotos,
};
