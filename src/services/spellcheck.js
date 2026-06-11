// spellcheck.js — Oddiy imlo tuzatish (regex, API siz)

function fixSpelling(fields) {
  const result = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!value || typeof value !== 'string') {
      result[key] = value;
      continue;
    }

    let v = value;

    // 1. Ortiqcha bo'shliqlarni tozalash
    v = v.replace(/\s{2,}/g, ' ').trim();

    // 2. Apostroflarni standartlashtirish (` ' ' → ')
    v = v.replace(/[`'']/g, "'");

    // 3. O' va G' harflarini to'g'rilash
    v = v.replace(/o`|o'/gi, (m) => m[0] === 'O' || m[0] === 'o' ? "o'" : "O'");
    v = v.replace(/g`|g'/gi, (m) => m[0] === 'G' || m[0] === 'g' ? "g'" : "G'");

    // 4. Har bir so'zning bosh harfini katta qilish (joy nomlari uchun)
    if (['district', 'landmark', 'region'].includes(key)) {
      v = v.replace(/(?:^|\s)\S/g, (m) => m.toUpperCase());
    }

    // 5. Verguldan keyin bo'sh joy bo'lsin
    v = v.replace(/,(\S)/g, ', $1');

    // 6. Ko'cha qisqartmalarini to'g'rilash
    v = v.replace(/\bko[`'']?ch\.?\b/gi, "Ko'cha");
    v = v.replace(/\bko[`'']?ch\b/gi, "Ko'cha");
    v = v.replace(/\bst\.?\b/gi, 'St.');
    v = v.replace(/\btum\.?\b/gi, 'tumani');
    v = v.replace(/\bmah\.?\b/gi, 'mahallasi');

    // 7. Raqamdan keyin tartib son qo'shimchalarini tozalash
    v = v.replace(/(\d+)\s*[-–]\s*(uy|xona|qavat)/gi, '$1-$2');

    result[key] = v;
  }

  return result;
}

module.exports = { fixSpelling };
