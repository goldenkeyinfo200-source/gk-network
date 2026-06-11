const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');

// GET /api/banners — barcha faol bannerlar (hammaga ochiq)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, company, slogan, color, link_url, sort_order
      FROM banners
      WHERE is_active = true
      ORDER BY sort_order ASC, created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/banners — yangi banner (faqat admin)
router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { company, slogan, color, link_url, sort_order } = req.body;
    if (!company) return res.status(400).json({ error: 'Kompaniya nomi kerak' });
    const { rows } = await pool.query(`
      INSERT INTO banners (company, slogan, color, link_url, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [company, slogan || null, color || '#8B1A2B', link_url || null, sort_order || 0]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/banners/:id — tahrirlash (faqat admin)
router.put('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { company, slogan, color, link_url, sort_order, is_active } = req.body;
    const { rows } = await pool.query(`
      UPDATE banners SET
        company    = COALESCE($1, company),
        slogan     = COALESCE($2, slogan),
        color      = COALESCE($3, color),
        link_url   = COALESCE($4, link_url),
        sort_order = COALESCE($5, sort_order),
        is_active  = COALESCE($6, is_active)
      WHERE id = $7
      RETURNING *
    `, [company||null, slogan||null, color||null, link_url||null,
        sort_order!=null?sort_order:null, is_active!=null?is_active:null,
        req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/banners/:id — o'chirish (faqat admin)
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM banners WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
