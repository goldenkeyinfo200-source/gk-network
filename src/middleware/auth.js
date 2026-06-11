const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token kerak' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, login, role, company_id, full_name, phone, telegram_id FROM agents WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
    req.agent = rows[0];
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token yaroqsiz' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.agent.role)) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }
  next();
};

module.exports = { auth, requireRole };
