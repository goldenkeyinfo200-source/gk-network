const router = require('express').Router();
const pool = require('../db/pool');
const { auth } = require('../middleware/auth');
const { uploadPhotos } = require('../services/cloudinary');
const { sendPropertyPost } = require('../services/telegram');
const spellcheck = require('../services/spellcheck');
const multer = require('multer');

const fixSpelling =
  spellcheck.fixSpelling ||
  spellcheck.spellcheckProperty ||
  ((data) => data);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(auth);

function normalizeStatus(status) {
  const map = {
    Faol: 'active',
    Band: 'reserved',
    Arxivlash: 'archived',
    Sotildi: 'sold',
    active: 'active',
    reserved: 'reserved',
    archived: 'archived',
    sold: 'sold',
    inactive: 'inactive',
  };

  return map[status] || status || null;
}

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
    } else if (agent.role === 'company') {
      params.push(agent.company_id);
      where += ` AND p.company_id = $${params.length}`;
    }

    if (status) {
      params.push(normalizeStatus(status));
      where += ` AND p.status = $${params.length}`;
    } else {
      where += ` AND p.status <> 'archived'`;
    }

    if (purpose) {
      params.push(purpose);
      where += ` AND p.purpose = $${params.length}`;
    }

    if (type) {
      params.push(type);
      where += ` AND p.property_type = $${params.length}`;
    }

    const agentParamIdx = params.length + 1;

    const { rows } = await pool.query(`
      SELECT
        p.id, p.display_id, p.purpose, p.property_type,
        p.rooms, p.area, p.floor, p.total_floors,
        p.price, p.region, p.district, p.landmark,
        p.mortgage, p.installment, p.photos,
        p.status, p.agent_id, p.company_id,
        p.description, p.created_at,
        p.post_status, p.posted_at,
        a.full_name AS agent_name,
        a.phone AS agent_phone,
        (p.agent_id = $${agentParamIdx}) AS is_own,
        CASE WHEN p.agent_id = $${agentParamIdx}
          THEN p.address ELSE p.landmark END AS display_address,
        CASE WHEN p.agent_id = $${agentParamIdx}
          THEN p.owner_phone ELSE NULL END AS owner_phone,
        (SELECT COUNT(*) FROM clients c
         WHERE c.status = 'active'
           AND c.need_type = CASE WHEN p.purpose='sell' THEN 'buy' ELSE 'rent' END
           AND c.property_type = p.property_type
           AND p.price BETWEEN COALESCE(c.budget_min,0) AND COALESCE(c.budget_max,999999999)
           AND (c.rooms = p.rooms OR c.rooms IS NULL)
        ) AS matched_clients
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
      SELECT p.*, a.full_name AS agent_name, a.phone AS agent_phone,
        (p.agent_id = $2) AS is_own
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1
    `, [req.params.id, req.agent.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    const prop = rows[0];

    if (!prop.is_own && req.agent.role !== 'admin') {
      prop.owner_name = null;
      prop.owner_phone = null;
      prop.address = prop.landmark || prop.district;
    }

    res.json(prop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties
router.post('/', upload.array('photos', 10), async (req, res) => {
  try {
    let {
      purpose, property_type, rooms, area, floor, total_floors,
      price, region, district, address, landmark,
      owner_name, owner_phone, mortgage, installment, description,
      location_url
    } = req.body;

    if (!purpose || !property_type || !price) {
      return res.status(400).json({ error: 'Maqsad, tur va narx majburiy' });
    }

    const fixed = fixSpelling({
      district: district || '',
      landmark: landmark || '',
      address: address || '',
      description: description || '',
    });

    district = fixed.district || district;
    landmark = fixed.landmark || landmark;
    address = fixed.address || address;
    description = fixed.description || description;

    let photoUrls = [];
    if (req.files?.length > 0) {
      photoUrls = await uploadPhotos(req.files);
    }

    const { rows } = await pool.query(`
      INSERT INTO properties (
        display_id, agent_id, company_id,
        purpose, property_type, rooms, area, floor, total_floors,
        price, region, district, address, landmark,
        owner_name, owner_phone, mortgage, installment,
        description, photos, location_url
      ) VALUES (
        gen_display_id('P','seq_property'), $1, $2,
        $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20
      ) RETURNING *
    `, [
      req.agent.id, req.agent.company_id,
      purpose, property_type,
      rooms || null, area || null, floor || null, total_floors || null,
      price,
      region || null, district || null, address || null, landmark || null,
      owner_name || null, owner_phone || null,
      mortgage === 'true' || mortgage === true,
      installment === 'true' || installment === true,
      description || null,
      photoUrls,
      location_url || null,
    ]);

    const property = rows[0];
    const bot = req.app.get('bot');

    try {
      const ok = await sendPropertyPost(property, req.agent, bot);

      await pool.query(
        'UPDATE properties SET post_status=$1, posted_at=NOW() WHERE id=$2',
        [ok ? 'posted' : 'failed', property.id]
      );

      property.post_status = ok ? 'posted' : 'failed';
    } catch (tgErr) {
      console.error('Telegram post xato:', tgErr.message);

      await pool.query(
        'UPDATE properties SET post_status=$1 WHERE id=$2',
        ['failed', property.id]
      );

      property.post_status = 'failed';
    }

    res.status(201).json(property);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/properties/:id
router.put('/:id', upload.array('photos', 10), async (req, res) => {
  try {
    const { rows: ex } = await pool.query(
      'SELECT agent_id, photos FROM properties WHERE id=$1',
      [req.params.id]
    );

    if (!ex[0]) return res.status(404).json({ error: 'Topilmadi' });

    if (ex[0].agent_id !== req.agent.id && req.agent.role !== 'admin') {
      return res.status(403).json({ error: "Ruxsat yo'q" });
    }

    let photos = Array.isArray(ex[0].photos) ? ex[0].photos : [];

    let deletedPhotos = [];
    try {
      deletedPhotos = JSON.parse(req.body.deletedPhotos || '[]');
    } catch {
      deletedPhotos = [];
    }

    if (Array.isArray(deletedPhotos) && deletedPhotos.length > 0) {
      photos = photos.filter(photo => !deletedPhotos.includes(photo));
    }

    if (req.files?.length > 0) {
      const newPhotoUrls = await uploadPhotos(req.files);
      photos = [...photos, ...newPhotoUrls].slice(0, 10);
    }

    let {
      price, status, description, mortgage, installment,
      address, landmark, district, region,
      purpose, property_type, rooms, area, floor, total_floors,
      owner_name, owner_phone, location_url
    } = req.body;

    status = normalizeStatus(status);

    const fixed = fixSpelling({
      district: district || '',
      landmark: landmark || '',
      address: address || '',
      description: description || '',
    });

    district = fixed.district || district;
    landmark = fixed.landmark || landmark;
    address = fixed.address || address;
    description = fixed.description || description;

    const parseBool = (value) => {
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return null;
    };

    const { rows } = await pool.query(`
      UPDATE properties SET
        price         = COALESCE($1,  price),
        status        = COALESCE($2,  status),
        description   = COALESCE($3,  description),
        mortgage      = COALESCE($4,  mortgage),
        installment   = COALESCE($5,  installment),
        address       = COALESCE($6,  address),
        landmark      = COALESCE($7,  landmark),
        district      = COALESCE($8,  district),
        region        = COALESCE($9,  region),
        purpose       = COALESCE($10, purpose),
        property_type = COALESCE($11, property_type),
        rooms         = COALESCE($12, rooms),
        area          = COALESCE($13, area),
        floor         = COALESCE($14, floor),
        total_floors  = COALESCE($15, total_floors),
        owner_name    = COALESCE($16, owner_name),
        owner_phone   = COALESCE($17, owner_phone),
        location_url  = COALESCE($18, location_url),
        photos        = $19,
        updated_at    = NOW()
      WHERE id = $20
      RETURNING *
    `, [
      price || null,
      status || null,
      description || null,
      parseBool(mortgage),
      parseBool(installment),
      address || null,
      landmark || null,
      district || null,
      region || null,
      purpose || null,
      property_type || null,
      rooms || null,
      area || null,
      floor || null,
      total_floors || null,
      owner_name || null,
      owner_phone || null,
      location_url || null,
      photos,
      req.params.id
    ]);

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/:id/repost
router.post('/:id/repost', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, a.full_name as agent_name, a.phone as agent_phone
      FROM properties p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1 AND p.agent_id = $2
    `, [req.params.id, req.agent.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    const property = rows[0];
    const bot = req.app.get('bot');
    const ok = await sendPropertyPost(property, req.agent, bot);

    await pool.query(
      'UPDATE properties SET post_status=$1, posted_at=NOW() WHERE id=$2',
      [ok ? 'posted' : 'failed', property.id]
    );

    res.json({ success: ok, post_status: ok ? 'posted' : 'failed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id/matches
router.get('/:id/matches', async (req, res) => {
  try {
    const { rows: propRows } = await pool.query(
      'SELECT id, purpose, property_type, rooms, price, status FROM properties WHERE id=$1',
      [req.params.id]
    );

    const prop = propRows[0];

    if (!prop) return res.status(404).json({ error: 'Topilmadi' });
    if (prop.status === 'archived') return res.json([]);

    const needType = prop.purpose === 'sell' ? 'buy' : 'rent';

    const { rows } = await pool.query(`
      SELECT
        c.id, c.display_id, c.need_type, c.property_type,
        c.rooms, c.budget_min, c.budget_max, c.region,
        c.status, c.agent_id,
        a.full_name AS agent_name, a.phone AS agent_phone,
        (c.agent_id = $1) AS is_own,
        CASE WHEN c.agent_id = $1 THEN c.full_name ELSE 'Mijoz ' || c.display_id END AS display_name,
        CASE WHEN c.agent_id = $1 THEN c.phone ELSE NULL END AS phone
      FROM clients c
      JOIN agents a ON a.id = c.agent_id
      WHERE c.status = 'active'
        AND c.need_type = $2
        AND c.property_type = $3
        AND $4 BETWEEN COALESCE(c.budget_min,0) AND COALESCE(c.budget_max,999999999)
        AND ($5::int IS NULL OR c.rooms = $5 OR c.rooms IS NULL)
      ORDER BY (c.agent_id = $1) DESC, c.created_at DESC
    `, [req.agent.id, needType, prop.property_type, prop.price, prop.rooms]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;