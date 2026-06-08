const router = require('express').Router();
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');
const { uploadPhotos } = require('../services/cloudinary');
const { sendPropertyPost } = require('../services/telegram');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(auth);

// GET /api/properties
router.get('/', async (req, res) => {
  try {
    const { status, purpose, type, mine } = req.query;
    const agent = req.agent;

    let where = 'WHERE 1=1';
    const params = [];

    if (mine === 'true') {
      params.push(agent.id);
      where += ` AND p.agent_id = $${params.length}`;
    } else if (agent.role === 'agent') {
      // Hammasi korsatiladi, lekin boshqaniki - cheklangan
    } else if (agent.role === 'company') {
      params.push(agent.company_id);
      where += ` AND p.company_id = $${params.length}`;
    }

    if (status) { params.push(status); where += ` AND p.status = $${params.length}`; }
    if (purpose) { params.push(purpose); where += ` AND p.purpose = $${params.length}`; }
    if (type) { params.push(type); where += ` AND p.property_type = $${params.length}`; }

    const { rows } = await pool.query(`
      SELECT
        p.id, p.display_id, p.purpose, p.property_type,
        p.rooms, p.area, p.floor, p.total_floors, p.price,
        p.region, p.district, p.mortgage, p.installment,
        p.photos, p.status, p.agent_id, p.created_at,
        p.post_status, p.posted_at,
        a.full_name as agent_name,
        (p.agent_id = $${params.length + 1}) as is_own,
        CASE WHEN p.agent_id = $${params.length + 1} THEN p.address ELSE p.district END as display_address,
        CASE WHEN p.agent_id = $${params.length + 1} THEN p.owner_phone ELSE NULL END as owner_phone,
        (SELECT COUNT(*) FROM clients c
         WHERE c.status = 'active'
           AND c.need_type = CASE WHEN p.purpose='sell' THEN 'buy' ELSE 'rent' END
           AND c.property_type = p.property_type
           AND p.price BETWEEN COALESCE(c.budget_min,0) AND COALESCE(c.budget_max,999999999)
           AND (c.rooms = p.rooms OR c.rooms IS NULL)
        ) as matched_clients
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      ${where}
      ORDER BY p.created_at DESC
    `, [...params, agent.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, a.full_name as agent_name, a.phone as agent_phone,
        (p.agent_id = $2) as is_own
      FROM properties p JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1
    `, [req.params.id, req.agent.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    const prop = rows[0];
    // Privacy
    if (!prop.is_own && req.agent.role !== 'admin') {
      prop.owner_name = null;
      prop.owner_phone = null;
      prop.address = prop.district; // Faqat tuman
    }

    res.json(prop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties — yangi obyekt + rasmlar
router.post('/', upload.array('photos', 10), async (req, res) => {
  try {
    const {
      purpose, property_type, rooms, area, floor, total_floors,
      price, region, district, address, landmark,
      owner_name, owner_phone, mortgage, installment, description
    } = req.body;

    // Rasmlarni Cloudinary ga yuklash
    let photoUrls = [];
    if (req.files && req.files.length > 0) {
      photoUrls = await uploadPhotos(req.files);
    }

    const { rows } = await pool.query(`
      INSERT INTO properties
        (display_id, agent_id, company_id, purpose, property_type,
         rooms, area, floor, total_floors, price, region, district,
         address, landmark, owner_name, owner_phone,
         mortgage, installment, description, photos)
      VALUES
        (gen_display_id('P','seq_property'), $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19)
      RETURNING *
    `, [
      req.agent.id, req.agent.company_id, purpose, property_type,
      rooms || null, area || null, floor || null, total_floors || null,
      price, region, district, address, landmark,
      owner_name, owner_phone,
      mortgage === 'true', installment === 'true', description,
      photoUrls
    ]);

    const property = rows[0];

    // Telegram kanalga avtomatik post yuborish
    try {
      await sendPropertyPost(property, req.agent);
      await pool.query(
        'UPDATE properties SET post_status=$1, posted_at=NOW() WHERE id=$2',
        ['posted', property.id]
      );
    } catch (tgErr) {
      console.error('Telegram post xato:', tgErr.message);
      await pool.query('UPDATE properties SET post_status=$1 WHERE id=$2', ['failed', property.id]);
    }

    res.status(201).json(property);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/properties/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows: ex } = await pool.query('SELECT agent_id FROM properties WHERE id=$1', [req.params.id]);
    if (!ex[0]) return res.status(404).json({ error: 'Topilmadi' });
    if (ex[0].agent_id !== req.agent.id && req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }

    const { price, status, description, mortgage, installment, address } = req.body;
    const { rows } = await pool.query(`
      UPDATE properties SET price=$1, status=$2, description=$3,
        mortgage=$4, installment=$5, address=$6
      WHERE id=$7 RETURNING *
    `, [price, status, description, mortgage, installment, address, req.params.id]);

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id/matches — Mos mijozlar
router.get('/:id/matches', async (req, res) => {
  try {
    const { rows: propRows } = await pool.query('SELECT * FROM properties WHERE id=$1', [req.params.id]);
    const prop = propRows[0];
    if (!prop) return res.status(404).json({ error: 'Topilmadi' });

    const needType = prop.purpose === 'sell' ? 'buy' : 'rent';

    const { rows } = await pool.query(`
      SELECT
        c.id, c.display_id, c.need_type, c.property_type,
        c.rooms, c.budget_min, c.budget_max, c.region, c.status,
        c.agent_id, a.full_name as agent_name, a.phone as agent_phone,
        (c.agent_id = $1) as is_own,
        CASE WHEN c.agent_id = $1 THEN c.full_name ELSE 'Mijoz ' || c.display_id END as display_name,
        CASE WHEN c.agent_id = $1 THEN c.phone ELSE NULL END as phone
      FROM clients c
      JOIN agents a ON a.id = c.agent_id
      WHERE c.status = 'active'
        AND c.need_type = $2
        AND c.property_type = $3
        AND $4 BETWEEN COALESCE(c.budget_min, 0) AND COALESCE(c.budget_max, 999999999)
        AND ($5::int IS NULL OR c.rooms = $5 OR c.rooms IS NULL)
      ORDER BY c.agent_id = $1 DESC, c.created_at DESC
    `, [req.agent.id, needType, prop.property_type, prop.price, prop.rooms]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
