// telegram.js

const TYPE_UZ = {
  apartment: 'Kvartira',
  house: 'Uy / Hovli',
  office: 'Ofis',
  land: 'Yer (Arsa)',
  commercial: 'Noturar joy',
};

function buildText(property, agent) {
  const type = TYPE_UZ[property.property_type] || property.property_type;
  const price = Number(property.price || 0).toLocaleString('en-US');
  const isLand = property.property_type === 'land';
  const isSell = property.purpose === 'sell';
  const line = '━━━━━━━━━━━━━━━';

  const street = (property.landmark || '').split(' | ')[0];
  const moljal = (property.landmark || '').split(' | ')[1];

  let t = '';

  t += `🏠 <b>${isSell ? 'Sotiladi' : 'Ijaraga beriladi'}!</b>\n\n`;

  const locParts = [];
  if (property.region) locParts.push(property.region);
  if (property.district) locParts.push(property.district);
  if (street) locParts.push(street);

  if (locParts.length) {
    t += `📍 <b>Manzil:</b> ${locParts.join(', ')}\n`;
  }

  if (!isLand && property.floor) {
    t += `🏢 <b>Qavati:</b> ${property.floor}`;
    if (property.total_floors) t += ` / ${property.total_floors}`;
    t += `\n`;
  }

  if (!isLand && property.rooms) {
    t += `🛏️ <b>Xonalar soni:</b> ${property.rooms}\n`;
  }

  t += `🏗 <b>Mulkchilik shakli:</b> ${type}\n`;

  if (property.area) {
    t += `📏 <b>Maydoni:</b> ${property.area} ${isLand ? 'sotix' : 'm²'}\n`;
  }

  if (property.mortgage) {
    t += `🏦 <b>Ipoteka:</b> Ha\n`;
  }

  if (property.installment) {
    t += `💳 <b>B/to'lov:</b> Ha\n`;
  }

  if (moljal) {
    t += `📌 <b>Mo'ljal:</b> ${moljal}\n`;
  }

  t += `\n💸 <b>Narxi: $${price}`;
  if (!isSell) t += '/oy';
  t += `</b>\n`;

  t += `${line}\n`;
  t += `📞 <b>Murojaat uchun:</b>\n`;
  if (agent.phone) {
    t += `☎️ ${agent.phone}\n`;
  }
  t += `${line}\n`;

  if (property.display_id) {
    t += `🆔 ${property.display_id}`;
  }

  return t;
}

async function sendPost(bot, chatId, text, photos) {
  if (!photos || photos.length === 0) {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
    });
    return;
  }

  if (photos.length === 1) {
    await bot.sendPhoto(chatId, photos[0], {
      caption: text,
      parse_mode: 'HTML',
    });
    return;
  }

  const media = photos.slice(0, 10).map((url, index) => ({
    type: 'photo',
    media: url,
    ...(index === 0
      ? {
          caption: text,
          parse_mode: 'HTML',
        }
      : {}),
  }));

  await bot.sendMediaGroup(chatId, media);
}

async function sendPropertyPost(property, agent, bot) {
  if (!bot) {
    console.warn("⚠️ Bot yo'q");
    return false;
  }

  const photos = Array.isArray(property.photos)
    ? property.photos.filter(Boolean)
    : [];

  const hasPhotos = photos.length > 0;
  const text = buildText(property, agent);

  let success = false;

  const publicChannel = process.env.CHANNEL_PUBLIC;

  if (publicChannel) {
    if (hasPhotos) {
      try {
        await sendPost(bot, publicChannel, text, photos);
        console.log(`✅ Kanal: ${property.display_id}`);
        success = true;
      } catch (err) {
        console.error('❌ Kanal xato:', err.message);
      }
    } else {
      console.warn(`⚠️ Rasm yo'q, markaziy kanalga yuborilmadi: ${property.display_id}`);
    }
  }

  const agentsChannel = process.env.CHANNEL_AGENTS;

  if (agentsChannel) {
    if (hasPhotos) {
      try {
        await sendPost(bot, agentsChannel, text, photos);
        console.log(`✅ Agentlar kanal: ${property.display_id}`);
      } catch (err) {
        console.error('❌ Agentlar kanal xato:', err.message);
      }
    } else {
      console.warn(`⚠️ Rasm yo'q, agentlar kanaliga yuborilmadi: ${property.display_id}`);
    }
  }

  if (agent.telegram_id) {
    try {
      if (hasPhotos) {
        await sendPost(bot, agent.telegram_id, text, photos);
      } else {
        await bot.sendMessage(agent.telegram_id, text, {
          parse_mode: 'HTML',
        });
      }

      console.log(`✅ Agent bot: ${agent.full_name}`);
      success = true;
    } catch (err) {
      console.error('❌ Agent bot xato:', err.message);
    }
  } else {
    console.warn(`⚠️ telegram_id yo'q: ${agent.full_name}`);
  }

  return success;
}

module.exports = {
  sendPropertyPost,
};