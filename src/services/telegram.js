// telegram.js — @gk_ipoteka kanalga ob'yekt post yuborish

const TYPE_UZ = {
  apartment: '🏠 Kvartira',
  house:     '🏡 Uy / Hovli',
  office:    '🏢 Ofis',
  land:      '🏗 Yer',
};

const PURPOSE_UZ = {
  sell: '🔴 SOTILADI',
  rent: '🟡 IJARAGA',
};

// Post matni yasash
function buildPostText(property, agent) {
  const type    = TYPE_UZ[property.property_type] || property.property_type;
  const purpose = PURPOSE_UZ[property.purpose]    || property.purpose;
  const price   = Number(property.price).toLocaleString('en-US');

  let text = `${purpose}\n`;
  text    += `${type}\n\n`;

  // O'lchamlar
  const parts = [];
  if (property.rooms)       parts.push(`🛏 ${property.rooms} xona`);
  if (property.area)        parts.push(`📐 ${property.area} m²`);
  if (property.floor && property.total_floors)
    parts.push(`🏢 ${property.floor}/${property.total_floors} qavat`);
  if (parts.length) text += parts.join('  ·  ') + '\n';

  // Narx
  text += `\n💰 <b>$${price}</b>`;
  if (property.purpose === 'rent') text += '/oy';
  text += '\n';

  // Manzil — faqat ko'cha nomi (uy raqami yashirin)
  const loc = [];
  if (property.region)   loc.push(property.region);
  if (property.district) loc.push(property.district);
  if (property.landmark) loc.push(property.landmark); // Ko'cha nomi
  if (loc.length) text += `\n📍 ${loc.join(', ')}\n`;

  // Qulayliklar
  if (property.mortgage)    text += `✅ Ipoteka mumkin\n`;
  if (property.installment) text += `✅ Muddatli to'lov\n`;

  // Tavsif (xususiyatlar)
  if (property.description) {
    const feats = property.description.split('\n')[0]; // Birinchi qator = chiplar
    if (feats) text += `\n🔑 ${feats}\n`;
  }

  // Agent
  text += `\n👤 <b>${agent.full_name || 'Agent'}</b>`;
  if (agent.phone) text += ` · 📞 ${agent.phone}`;
  text += `\n🆔 ${property.display_id}`;

  return text;
}

// @gk_ipoteka kanalga post yuborish
async function sendPropertyPost(property, agent, bot) {
  if (!bot) {
    console.warn('Bot yo\'q — Telegram post yuborilmadi');
    return false;
  }

  const channel = process.env.CHANNEL_PUBLIC; // @gk_ipoteka kanal ID
  if (!channel) {
    console.warn('CHANNEL_PUBLIC yo\'q — post yuborilmadi');
    return false;
  }

  const text   = buildPostText(property, agent);
  const photos = (property.photos || []).filter(Boolean);

  try {
    if (photos.length > 0) {
      // Rasmlar bilan post — MediaGroup
      const media = photos.slice(0, 10).map((url, i) => ({
        type:  'photo',
        media: url,
        ...(i === 0 ? { caption: text, parse_mode: 'HTML' } : {}),
      }));
      await bot.sendMediaGroup(channel, media);
    } else {
      // Faqat matn
      await bot.sendMessage(channel, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '📞 Bog\'lanish', url: `https://t.me/${(agent.telegram_username || '').replace('@', '')}` },
          ]]
        }
      });
    }

    // Agentlar guruhi — to'liq ma'lumot (mulkdor tel ham)
    const agentsChannel = process.env.CHANNEL_AGENTS;
    if (agentsChannel) {
      let agentText = text;
      if (property.address)     agentText += `\n\n🗺 <b>Aniq manzil:</b> ${property.address}`;
      if (property.owner_name)  agentText += `\n👤 <b>Mulkdor:</b> ${property.owner_name}`;
      if (property.owner_phone) agentText += `\n📱 <b>Mulkdor tel:</b> ${property.owner_phone}`;

      await bot.sendMessage(agentsChannel, agentText, { parse_mode: 'HTML' });
    }

    return true;
  } catch (err) {
    console.error('Telegram post xato:', err.message);
    return false;
  }
}

module.exports = { sendPropertyPost, buildPostText };
