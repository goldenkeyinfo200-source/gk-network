const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Login va parol kerak' });

    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE login = $1 AND is_active = true',
      [login]
    );

    const agent = rows[0];
    if (!agent) return res.status(401).json({ error: 'Login yoki parol xato' });

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: 'Login yoki parol xato' });

    const token = jwt.sign(
      { id: agent.id, role: agent.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES }
    );

    res.json({
      token,
      agent: {
        id: agent.id,
        display_id: agent.display_id,
        full_name: agent.full_name,
        role: agent.role,
        company_id: agent.company_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (faqat admin)
router.post('/register', async (req, res) => {
  try {
    const { login, password, full_name, phone, role, company_id } = req.body;
    
    const exists = await pool.query('SELECT id FROM agents WHERE login = $1', [login]);
    if (exists.rows[0]) return res.status(400).json({ error: 'Bu login band' });

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO agents (display_id, login, password_hash, full_name, phone, role, company_id)
       VALUES (gen_display_id('AG', 'seq_agent'), $1, $2, $3, $4, $5, $6)
       RETURNING id, display_id, full_name, role`,
      [login, hash, full_name, phone, role || 'agent', company_id || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').auth, (req, res) => {
  res.json(req.agent);
});

module.exports = router;
