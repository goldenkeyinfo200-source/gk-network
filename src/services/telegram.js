// telegram.js

const TYPE_UZ = {
  apartment:  'Kvartira',
  house:      'Uy / Hovli',
  office:     'Ofis',
  land:       'Yer (Arsa)',
  commercial: 'Noturar joy',
};

function buildText(property, agent) {
  const type  = TYPE_UZ[property.property_type] || property.property_type;
  const price = Number(property.price).toLocaleString('en-US');
  const isLand = property.property_type === 'land';
  const line = '━━━━━━━━━━━━━━━';

  const street = (property.landmark || '').split(' | ')[0];
  const moljal = (property.landmark || '').split(' | ')[1];

  let t = '';

  // Sarlavha
  const purposeTitle = property.purpose === 'rent' ? 'Ijaraga beriladi' : 'Sotiladi';
  t += `🏠 ${purposeTitle}!\n\n`;

  // Asosiy ma'lumotlar
  const loc = [];
  if (property.region)   loc.push(property.region);
  if (property.district) loc.push(property.district);
  if (street)            loc.push(street);
  if (loc.length)        t += `📍 Manzil: ${loc.join(', ')}\n`;

  if (!isLand && property.floor) t += `🏢 Qavati: ${property.floor}${property.total_floors ? ' / ' + property.total_floors : ''}\n`;
  if (!isLand && property.rooms) t += `🛏️ Xonalar soni: ${property.rooms}\n`;
  t += `🏗 Mulkchilik shakli: ${type}\n`;
  if (property.area)             t += `📏 Maydoni: ${property.area} ${isLand ? 'sotix' : 'm²'}\n`;
  if (property.mortgage !== undefined) t += `🏦 Ipoteka: ${property.mortgage ? 'Ha' : '—'}\n`;
  if (property.installment !== undefined) t += `💳 B/to'lov: ${property.installment ? 'Ha' : '—'}\n`;
  if (moljal)                    t += `📌 Mo'ljal: ${moljal}\n`;

  // Qo'shimcha ma'lumotlar
  if (property.description) {
    const feats = property.description.split('\n')[0];
    if (feats && feats.trim()) {
      t += `📝 Qo'shimcha ma'lumotlar: ${feats.trim()}\n`;
    }
  }

  // Narx
  t += `\n💸 Narxi: $${price}`;
  if (property.purpose === 'rent') t += '/oy';
  t += '\n';

  // Ajratgich
  t += `${line}\n`;

  // Kontakt
  t += `📞 Murojaat uchun:\n`;
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
