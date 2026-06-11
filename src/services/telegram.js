// telegram.js

const TYPE_UZ = {
  apartment:  '🏠 Kvartira',
  house:      '🏡 Uy / Hovli',
  office:     '🏢 Ofis',
  land:       '🏗 Yer (Arsa)',
  commercial: '🏬 Noturar joy',
};

const PURPOSE_UZ = {
  sell: '🔴 SOTILADI',
  rent: '🟡 IJARAGA',
};

function buildText(property, agent, includePrivate = false) {
  const type    = TYPE_UZ[property.property_type] || property.property_type;
  const purpose = PURPOSE_UZ[property.purpose]    || property.purpose;
  const price   = Number(property.price).toLocaleString('en-US');

  let t = `${purpose}  |  ${type}\n`;

  const dims = [];
  if (property.rooms)                          dims.push(`🛏 ${property.rooms} xona`);
  if (property.area)                           dims.push(`📐 ${property.area} m²`);
  if (property.floor && property.total_floors) dims.push(`🏢 ${property.floor}/${property.total_floors} qavat`);
  if (dims.length) t += dims.join('  ·  ') + '\n';

  t += `\n💰 <b>$${price}</b>`;
  if (property.purpose === 'rent') t += '/oy';
  t += '\n';

  const loc = [];
  if (property.region)   loc.push(property.region);
  if (property.district) loc.push(property.district);
  if (loc.length) t += `\n📍 ${loc.join(', ')}\n`;

  if (property.mortgage)    t += `✅ Ipoteka mumkin\n`;
  if (property.installment) t += `✅ Muddatli to'lov\n`;

  if (property.description) {
    const feats = property.description.split('\n')[0];
    if (feats) {
      // Emoji ikonkalarni olib tashlash
      const cleanFeats = feats.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/gu, '').trim();
      if (cleanFeats) t += `\n🔑 ${cleanFeats}\n`;
    }
  }

  t += `\n👤 <b>${agent.full_name || 'Agent'}</b>`;
  if (agent.phone) t += `  📞 ${agent.phone}`;
  t += `\n🆔 ${property.display_id}`;

  // Faqat agent uchun — yashirin ma'lumotlar
  if (includePrivate) {
    t += '\n\n━━━━━━━━━━━━━━━━━━';
    if (property.address)     t += `\n🗺 <b>Aniq manzil:</b> ${property.address}`;
    if (property.owner_name)  t += `\n👤 <b>Mulkdor:</b> ${property.owner_name}`;
    if (property.owner_phone) t += `\n📱 <b>Tel:</b> <code>${property.owner_phone}</code>`;
  }

  return t;
}

async function sendPost(bot, chatId, text, photos) {
  if (photos.length > 0) {
    const media = photos.slice(0, 10).map((url, i) => ({
      type:  'photo',
      media: url,
      ...(i === 0 ? { caption: text, parse_mode: 'HTML' } : {}),
    }));
    await bot.sendMediaGroup(chatId, media);
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }
}

async function sendPropertyPost(property, agent, bot) {
  if (!bot) { console.warn('⚠️  Bot yo\'q'); return false; }

  const photos     = (property.photos || []).filter(Boolean);
  const publicText = buildText(property, agent, false);
  const agentText  = buildText(property, agent, true);
  let   success    = false;

  // 1. Markaziy kanal
  const publicChannel = process.env.CHANNEL_PUBLIC;
  if (publicChannel) {
    try {
      await sendPost(bot, publicChannel, publicText, photos);
      console.log(`✅ Kanal: ${property.display_id}`);
      success = true;
    } catch (err) {
      console.error(`❌ Kanal xato:`, err.message);
    }
  } else {
    console.warn('⚠️  CHANNEL_PUBLIC yo\'q');
  }

  // 2. Agentlar kanali (xuddi markaziy kanal formati)
  const agentsChannel = process.env.CHANNEL_AGENTS;
  if (agentsChannel) {
    try {
      await sendPost(bot, agentsChannel, publicText, photos);
      console.log(`✅ Agentlar kanal: ${property.display_id}`);
    } catch (err) {
      console.error(`❌ Agentlar kanal xato:`, err.message);
    }
  }

  // 3. Agentga botda — kanal bilan bir xil format (aniq manzil va mulkdor tel yo'q)
  if (agent.telegram_id) {
    try {
      await sendPost(bot, agent.telegram_id, publicText, photos);
      console.log(`✅ Agent bot: ${agent.full_name}`);
      success = true;
    } catch (err) {
      console.error(`❌ Agent bot xato:`, err.message);
    }
  }

  return success;
}

module.exports = { sendPropertyPost };
