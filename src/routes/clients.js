const router = require('express').Router();
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');

// Barcha routelarga auth
router.use(auth);

// GET /api/clients — o'z mijozlari
router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const agent = req.agent;

    let where = agent.role === 'admin'
      ? 'WHERE 1=1'
      : agent.role === 'company'
      ? 'WHERE c.company_id = $1'
      : 'WHERE c.agent_id = $1';

    const params = agent.role === 'admin' ? [] : [
      agent.role === 'company' ? agent.company_id : agent.id
    ];

    if (status) {
      // Aniq status berilsa — shuni ko'rsat (arxiv ham ko'rinadi)
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    } else {
      // Status berilmasa — arxivdagilarni yashir
      where += ` AND c.status <> 'archived'`;
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (c.full_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.display_id ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(`
      SELECT c.*, a.full_name as agent_name,
        (SELECT COUNT(*) FROM properties p
         WHERE p.status = 'active'
           AND p.purpose = CASE WHEN c.need_type='buy' THEN 'sell' ELSE 'rent' END
           AND p.property_type = c.property_type
           AND p.price BETWEEN COALESCE(c.budget_min, 0) AND COALESCE(c.budget_max, 999999999)
           AND (p.rooms = c.rooms OR c.rooms IS NULL)
        ) as matched_count
      FROM clients c
      JOIN agents a ON a.id = c.agent_id
      ${where}
      ORDER BY c.created_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.full_name as agent_name, a.phone as agent_phone
       FROM clients c JOIN agents a ON a.id = c.agent_id
       WHERE c.id = $1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    // Privacy: boshqa agentning mijozi bo'lsa — telefon yashirin
    const client = rows[0];
    const isOwn = client.agent_id === req.agent.id || req.agent.role === 'admin';
    if (!isOwn) {
      client.phone = null;
      client.full_name = 'Mijoz ' + client.display_id;
    }

    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients — yangi mijoz
router.post('/', async (req, res) => {
  try {
    const {
      full_name, phone, need_type, property_type,
      rooms, budget_min, budget_max, region, district,
      mortgage, installment, notes
    } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO clients
        (display_id, agent_id, company_id, full_name, phone,
         need_type, property_type, rooms, budget_min, budget_max,
         region, district, mortgage, installment, notes)
      VALUES
        (gen_display_id('C','seq_client'), $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      req.agent.id, req.agent.company_id, full_name, phone,
      need_type, property_type, rooms, budget_min, budget_max,
      region, district, mortgage || false, installment || false, notes
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Topilmadi' });
    if (existing[0].agent_id !== req.agent.id && req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }

    let {
      full_name, phone, need_type, property_type,
      rooms, budget_min, budget_max, region, district,
      mortgage, installment, notes, status
    } = req.body;

    // done → avtomatik archived
    if (status === 'done') {
      status = 'archived';
    }

    const { rows } = await pool.query(`
      UPDATE clients SET
        full_name=$1, phone=$2, need_type=$3, property_type=$4,
        rooms=$5, budget_min=$6, budget_max=$7, region=$8,
        district=$9, mortgage=$10, installment=$11, notes=$12, status=$13
      WHERE id=$14 RETURNING *
    `, [full_name, phone, need_type, property_type, rooms,
        budget_min, budget_max, region, district,
        mortgage, installment, notes, status, req.params.id]);

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT agent_id FROM clients WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    if (rows[0].agent_id !== req.agent.id && req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id/matches — Smart Match
router.get('/:id/matches', async (req, res) => {
  try {
    const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = clientRows[0];
    if (!client) return res.status(404).json({ error: 'Topilmadi' });

    // Arxivlangan mijoz uchun moslik qaytarma
    if (client.status === 'archived') {
      return res.json([]);
    }

    const purposeMap = { buy: 'sell', rent: 'rent' };

    const { rows } = await pool.query(`
      SELECT
        p.id, p.display_id, p.purpose, p.property_type,
        p.rooms, p.area, p.floor, p.total_floors,
        p.price, p.region, p.district,
        p.mortgage, p.installment, p.description,
        p.photos, p.status, p.agent_id,
        a.full_name as agent_name, a.phone as agent_phone,
        (p.agent_id = $1) as is_own,
        CASE WHEN p.agent_id = $1 THEN p.address ELSE NULL END as address,
        CASE WHEN p.agent_id = $1 THEN p.owner_name ELSE NULL END as owner_name,
        CASE WHEN p.agent_id = $1 THEN p.owner_phone ELSE NULL END as owner_phone
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.status = 'active'
        AND p.purpose = $2
        AND p.property_type = $3
        AND p.price BETWEEN $4 AND $5
        AND ($6::int IS NULL OR p.rooms = $6)
      ORDER BY p.agent_id = $1 DESC, p.created_at DESC
    `, [
      req.agent.id,
      purposeMap[client.need_type] || client.need_type,
      client.property_type,
      client.budget_min || 0,
      client.budget_max || 999999999,
      client.rooms || null
    ]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;