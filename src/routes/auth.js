const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Login va parol kerak' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE login = $1 AND is_active = true',
      [login]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(401).json({ error: 'Login yoki parol xato' });
    }

    const valid = await bcrypt.compare(password, agent.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Login yoki parol xato' });
    }

    const now = new Date();
    const trialEnd = agent.trial_end ? new Date(agent.trial_end) : null;
    const paidUntil = agent.paid_until ? new Date(agent.paid_until) : null;

    const isAdmin = agent.role === 'admin';
    const trialActive = trialEnd && trialEnd >= now;
    const paidActive = agent.is_paid === true && paidUntil && paidUntil >= now;

    if (!isAdmin && !trialActive && !paidActive) {
      return res.status(403).json({
        error: '14 кунлик бепул муддат тугаган. Мини аппдан фойдаланиш учун тўлов қилинг.'
      });
    }

    const token = jwt.sign(
      { id: agent.id, role: agent.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );

    res.json({
      token,
      agent: {
        id: agent.id,
        display_id: agent.display_id,
        full_name: agent.full_name,
        phone: agent.phone,
        role: agent.role,
        company_id: agent.company_id,
        trial_start: agent.trial_start,
        trial_end: agent.trial_end,
        is_paid: agent.is_paid,
        paid_until: agent.paid_until
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register
router.post('/register', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Фақат админ агент қўша олади' });
    }

    const { login, password, full_name, phone, company_id } = req.body;

    if (!login || !password || !full_name || !phone) {
      return res.status(400).json({
        error: 'Исм, телефон, логин ва парол мажбурий'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM agents WHERE login = $1',
      [login]
    );

    if (exists.rows.length) {
      return res.status(400).json({ error: 'Бу логин банд' });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO agents (
        display_id,
        login,
        password_hash,
        full_name,
        phone,
        role,
        company_id,
        trial_start,
        trial_end,
        is_active
      )
      VALUES (
        gen_display_id('AG', 'seq_agent'),
        $1,
        $2,
        $3,
        $4,
        'agent',
        $5,
        NOW(),
        NOW() + INTERVAL '14 days',
        true
      )
      RETURNING
        id,
        display_id,
        login,
        full_name,
        phone,
        role,
        company_id,
        trial_start,
        trial_end,
        is_active
      `,
      [
        login,
        hash,
        full_name,
        phone,
        company_id || null
      ]
    );

    res.status(201).json(rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/agents
router.get('/agents', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Фақат админ кўра олади' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        display_id,
        login,
        full_name,
        phone,
        role,
        company_id,
        trial_start,
        trial_end,
        is_active,
        created_at
      FROM agents
      ORDER BY created_at DESC
      `
    );

    res.json(rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json(req.agent);
});

module.exports = router;
