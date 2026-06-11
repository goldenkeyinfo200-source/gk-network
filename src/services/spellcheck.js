function cleanText(value = '') {
  let text = String(value || '');

  text = text.replace(/\s+/g, ' ').trim();

  text = text.replace(/o[`‘’ʼ]/gi, "o'");
  text = text.replace(/g[`‘’ʼ]/gi, "g'");

  text = text.replace(/\bamir temur\b/gi, 'Amir Temur');
  text = text.replace(/\byunusobod\b/gi, 'Yunusobod');

  text = text.replace(/\bko['‘’ʼ`]?ch\.?\b/gi, "Ko'cha");
  text = text.replace(/\btum\.?\b/gi, 'tumani');

  text = text.replace(/(\d+)\s*-\s*uy/gi, '$1-uy');

  return text;
}

function spellcheckProperty(data = {}) {
  return {
    ...data,
    address: cleanText(data.address),
    district: cleanText(data.district),
    description: cleanText(data.description),
    landmark: cleanText(data.landmark || data.moljal),
  };
}

module.exports = {
  cleanText,
  spellcheckProperty,
};