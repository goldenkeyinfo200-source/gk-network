// telegram.js

const TYPE_UZ = {
  apartment:  'Kvartira',
  house:      'Uy / Hovli',
  office:     'Ofis',
  land:       'Yer (Arsa)',
  commercial: 'Noturar joy',
};

function buildText(property, agent) {
  const type   = TYPE_UZ[property.property_type] || property.property_type;
  const price  = Number(property.price).toLocaleString('en-US');
  const isLand = property.property_type === 'land';
  const isSell = property.purpose === 'sell';
  const line   = '━━━━━━━━━━━━━━━';

  const street = (property.landmark || '').split(' | ')[0];
  const moljal = (property.landmark || '').split(' | ')[1];

  let t = '';

  // Sarlavha
  t += `🏠 <b>${isSell ? 'Sotiladi' : 'Ijaraga beriladi'}!</b>\n\n`;

  // Manzil
  const locParts = [];
  if (property.region)   locParts.push(property.region);
  if (property.district) locParts.push(property.district);
  if (street)            locParts.push(street);
  if (locParts.length)   t += `📍 <b>Manzil:</b> ${locParts.join(', ')}\n`;

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

  // Ipoteka — faqat "Ha" bo'lsa ko'rsatilsin
  if (property.mortgage) {
    t += `🏦 <b>Ipoteka:</b> Ha\n`;
  }

  // Muddatli to'lov — faqat "Ha" bo'lsa ko'rsatilsin
  if (property.installment) {
    t += `💳 <b>B/to'lov:</b> Ha\n`;
  }

  // Mo'ljal
  if (moljal) {
    t += `📌 <b>Mo'ljal:</b> ${moljal}\n`;
  }

  // Qo'shimcha ma'lumotlar
  if (property.description) {
    const feats = property.description.split('\n')[0];
    if (feats && feats.trim()) {
      t += `\n📝 <b>Qo'shimcha ma'lumotlar:</b>\n${feats.trim()}\n`;
    }
  }

  // Narx
  t += `\n💸 <b>Narxi: $${price}`;
  if (!isSell) t += '/oy';
  t += `</b>\n`;

  // Ajratgich va kontakt
  t += `${line}\n`;
  t += `📞 <b>Murojaat uchun:</b>\n`;
  if (agent.phone) t += `☎️ ${agent.phone}\n`;
  t += `${line}\n`;
  t += `🆔 ${property.display_id}`;

  return t;
}

async function sendPost(bot, chatId, text) {
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

async function sendPropertyPost(property, agent, bot) {
  if (!bot) { console.warn("⚠️ Bot yo'q"); return false; }

  const text = buildText(property, agent);
  let success = false;

  const publicChannel = process.env.CHANNEL_PUBLIC;
  if (publicChannel) {
    try {
      await sendPost(bot, publicChannel, text);
      console.log(`✅ Kanal: ${property.display_id}`);
      success = true;
    } catch (err) {
      console.error(`❌ Kanal xato:`, err.message);
    }
  }

  const agentsChannel = process.env.CHANNEL_AGENTS;
  if (agentsChannel) {
    try {
      await sendPost(bot, agentsChannel, text);
      console.log(`✅ Agentlar kanal: ${property.display_id}`);
    } catch (err) {
      console.error(`❌ Agentlar kanal xato:`, err.message);
    }
  }

  if (agent.telegram_id) {
    try {
      await sendPost(bot, agent.telegram_id, text);
      console.log(`✅ Agent bot: ${agent.full_name}`);
      success = true;
    } catch (err) {
      console.error(`❌ Agent bot xato:`, err.message);
    }
  } else {
    console.warn(`⚠️ telegram_id yo'q: ${agent.full_name}`);
  }

  return success;
}

module.exports = { sendPropertyPost };
