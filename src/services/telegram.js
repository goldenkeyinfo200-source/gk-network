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
  const line    = '━━━━━━━━━━━━━━━━━';

  let t = `${purpose}\n\n`;
  t += `${type}\n`;
  t += `${line}\n`;

  if (property.rooms)       t += `🛏 Xona:      ${property.rooms} ta\n`;
  if (property.area)        t += `📐 Maydon:    ${property.area} m²\n`;
  if (property.floor && property.total_floors)
                            t += `🏢 Qavat:     ${property.floor} / ${property.total_floors}\n`;
  if (property.region)      t += `📍 Shahar:    ${property.region}\n`;
  if (property.district)    t += `🏘 Tuman:     ${property.district}\n`;

  // Ko'cha — landmark dan birinchi qism
  const street = (property.landmark || '').split(' | ')[0];
  const moljal = (property.landmark || '').split(' | ')[1];
  if (street)  t += `🛣 Ko'cha:    ${street}\n`;
  if (moljal)  t += `🧭 Mo'ljal:   ${moljal}\n`;

  t += `${line}\n`;
  t += `💰 Narx:   <b>$${price}`;
  if (property.purpose === 'rent') t += '/oy';
  t += `</b>\n`;
  t += `${line}\n`;

  if (property.description) {
    const feats = property.description.split('\n')[0];
    if (feats) {
      const clean = feats
        .replace(/\p{Emoji_Presentation}\s*/gu, '')
        .replace(/\p{Extended_Pictographic}\s*/gu, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^,\s*|,\s*$/g, '')
        .trim();
      if (clean) t += `🔑 ${clean}\n`;
    }
  }

  const extras = [];
  if (property.mortgage)    extras.push("✅ Ipoteka");
  if (property.installment) extras.push("✅ Muddatli to'lov");
  if (extras.length) t += extras.join('  ') + '\n';

  t += `${line}\n`;
  t += `👤 <b>${agent.full_name || 'Agent'}</b>`;
  if (agent.phone) t += `  📞 ${agent.phone}`;
  t += `\n🆔 ${property.display_id}\n`;
  t += line;

  if (includePrivate) {
    t += '\n\n━━━━━━━━━━━━━━━━━━';
    if (property.address)     t += `\n🗺 <b>Aniq manzil:</b> ${property.address}`;
    if (property.owner_name)  t += `\n👤 <b>Mulkdor:</b> ${property.owner_name}`;
    if (property.owner_phone) t += `\n📱 <b>Tel:</b> <code>${property.owner_phone}</code>`;
  }

  return t;
}

async function sendPost(bot, chatId, text) {
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

async function sendPropertyPost(property, agent, bot) {
  if (!bot) { console.warn('⚠️  Bot yo\'q'); return false; }

  const photos     = (property.photos || []).filter(Boolean);
  const publicText = buildText(property, agent, false);
  const agentText  = buildText(property, agent, true);
  let   success    = false;

  // Agentga botda
  if (agent.telegram_id) {
    try {
      await sendPost(bot, agent.telegram_id, publicText);
      console.log(`✅ Agent bot: ${agent.full_name}`);
      success = true;
    } catch (err) {
      console.error(`❌ Agent bot xato:`, err.message);
    }
  } else {
    console.warn(`⚠️  telegram_id yo'q: ${agent.full_name}`);
  }

  return success;
}

module.exports = { sendPropertyPost };
