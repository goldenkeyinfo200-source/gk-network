const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({
        error: 'Login va parol kerak'
      });
    }

    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE login = $1 AND is_active = true',
      [login]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(401).json({
        error: 'Login yoki parol xato'
      });
    }

    const valid = await bcrypt.compare(
      password,
      agent.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: 'Login yoki parol xato'
      });
    }

    const token = jwt.sign(
      {
        id: agent.id,
        role: agent.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES || '30d'
      }
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
    res.status(500).json({
      error: err.message
    });
  }
});


// REGISTER AGENT
router.post('/register', async (req, res) => {
  try {

    const {
      full_name,
      phone,
      login,
      password,
      company_id
    } = req.body;

    const exists = await pool.query(
      'SELECT id FROM agents WHERE login=$1',
      [login]
    );

    if (exists.rows.length) {
      return res.status(400).json({
        error: 'Bu login band'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const trialStart = new Date();

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const { rows } = await pool.query(
      `
      INSERT INTO agents (
        display_id,
        full_name,
        phone,
        login,
        password_hash,
        role,
        trial_start,
        trial_end,
        is_active,
        company_id
      )
      VALUES (
        gen_display_id('AG','seq_agent'),
        $1,$2,$3,$4,
        'agent',
        $5,
        $6,
        true,
        $7
      )
      RETURNING *
      `,
      [
        full_name,
        phone,
        login,
        hash,
        trialStart,
        trialEnd,
        company_id || null
      ]
    );

    res.status(201).json(rows[0]);

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// AGENTS LIST
router.get('/agents', auth, async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT
      id,
      display_id,
      full_name,
      phone,
      login,
      role,
      trial_start,
      trial_end,
      is_active
      FROM agents
      ORDER BY created_at DESC
    `);

    res.json(rows);

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// ME
router.get('/me', auth, (req, res) => {
  res.json(req.agent);
});

module.exports = router;
