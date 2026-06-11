const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');

/* ==========================
   LOGIN
========================== */

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({
        error: 'Login va parol kerak'
      });
    }

    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE login=$1 AND is_active=true',
      [login]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(401).json({
        error: 'Login yoki parol xato'
      });
    }

    const valid = await bcrypt.compare(password, agent.password_hash);

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
        expiresIn: process.env.JWT_EXPIRES || '7d'
      }
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
        trial_end: agent.trial_end
      }
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* ==========================
   PUBLIC REGISTER
========================== */

router.post('/register-public', async (req, res) => {
  try {
    const {
      full_name,
      phone,
      company_name,
      login,
      password
    } = req.body;

    if (!full_name || !phone || !login || !password) {
      return res.status(400).json({
        error: 'Барча майдонларни тўлдиринг'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM agents WHERE login=$1',
      [login]
    );

    if (exists.rows.length) {
      return res.status(400).json({
        error: 'Бу логин банд'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO agents
      (
        display_id,
        login,
        password_hash,
        full_name,
        phone,
        role,
        trial_start,
        trial_end,
        is_active
      )
      VALUES
      (
        gen_display_id('AG','seq_agent'),
        $1,
        $2,
        $3,
        $4,
        'agent',
        NOW(),
        NOW() + INTERVAL '14 days',
        true
      )
      RETURNING *
      `,
      [
        login,
        hash,
        full_name,
        phone
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Муваффақиятли рўйхатдан ўтдингиз. 14 кунлик бепул тариф фаоллаштирилди.',
      agent: rows[0]
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* ==========================
   ADMIN REGISTER
========================== */

router.post('/register', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({
        error: 'Фақат админ агент қўша олади'
      });
    }

    const {
      login,
      password,
      full_name,
      phone
    } = req.body;

    if (!login || !password || !full_name || !phone) {
      return res.status(400).json({
        error: 'Login, parol, ism va telefon kerak'
      });
    }

    const exists = await pool.query(
      'SELECT id FROM agents WHERE login=$1',
      [login]
    );

    if (exists.rows.length) {
      return res.status(400).json({
        error: 'Бу логин банд'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO agents
      (
        display_id,
        login,
        password_hash,
        full_name,
        phone,
        role,
        trial_start,
        trial_end,
        is_active
      )
      VALUES
      (
        gen_display_id('AG','seq_agent'),
        $1,
        $2,
        $3,
        $4,
        'agent',
        NOW(),
        NOW() + INTERVAL '14 days',
        true
      )
      RETURNING *
      `,
      [
        login,
        hash,
        full_name,
        phone
      ]
    );

    res.status(201).json(rows[0]);

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* ==========================
   AGENTS LIST
========================== */

router.get('/agents', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({
        error: 'Фақат админ кўра олади'
      });
    }

    const { rows } = await pool.query(`
      SELECT
        id,
        display_id,
        login,
        full_name,
        phone,
        role,
        trial_start,
        trial_end,
        is_active,
        created_at
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

/* ==========================
   CHANGE PASSWORD
   Agent o'zi parolini o'zgartiradi
========================== */

router.put('/change-password', auth, async (req, res) => {
  try {
    const agentId = req.agent.id;

    const {
      currentPassword,
      newPassword,
      confirmPassword
    } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Барча майдонларни тўлдиринг'
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        error: 'Янги пароль камида 4 та белгидан иборат бўлиши керак'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Янги парольлар мос эмас'
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        id,
        password_hash
      FROM agents
      WHERE id=$1
      `,
      [agentId]
    );

    const agent = rows[0];

    if (!agent) {
      return res.status(404).json({
        error: 'Агент топилмади'
      });
    }

    const valid = await bcrypt.compare(
      currentPassword,
      agent.password_hash
    );

    if (!valid) {
      return res.status(400).json({
        error: 'Ҳозирги пароль нотўғри'
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE agents
      SET password_hash=$1
      WHERE id=$2
      `,
      [hash, agentId]
    );

    res.json({
      success: true,
      message: 'Пароль муваффақиятли ўзгартирилди'
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* ==========================
   CURRENT USER
========================== */

router.get('/me', auth, async (req, res) => {
  res.json(req.agent);
});

module.exports = router;