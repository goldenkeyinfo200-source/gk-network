const router = require('express').Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const pool = require('../db/pool');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'gk-network/banners', resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ── Faqat faol va muddati mos bannerlar (mijoz/agent uchun) ──────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM banners
      WHERE is_active = true
        AND (start_date IS NULL OR start_date <= NOW())
        AND (end_date IS NULL OR end_date >= NOW())
      ORDER BY sort_order ASC, created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Banners GET error:', err);
    res.status(500).json({ error: 'Bannerlarni olishda xato' });
  }
});

// ── Admin uchun hammasi ──────────────────────────────────────────
router.get('/admin/all', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        b.*,
        COUNT(bv.id)::int AS total_views,
        COUNT(bv.id) FILTER (
          WHERE bv.viewed_at >= NOW() - INTERVAL '7 days'
        )::int AS views_week,
        COUNT(bv.id) FILTER (
          WHERE bv.viewed_at >= NOW() - INTERVAL '30 days'
        )::int AS views_month
      FROM banners b
      LEFT JOIN banner_views bv ON bv.banner_id = b.id
      GROUP BY b.id
      ORDER BY b.sort_order ASC, b.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Banners admin GET error:', err);
    res.status(500).json({ error: 'Bannerlarni olishda xato' });
  }
});

// ── Alohida banner statistikasi (grafik uchun) ───────────────────
// GET /api/banners/:id/stats?period=7   (7 yoki 30 kun)
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const days = parseInt(req.query.period) || 30;

    // Kunlik ko'rishlar
    const { rows: daily } = await pool.query(`
      SELECT
        DATE(viewed_at AT TIME ZONE 'Asia/Tashkent') AS day,
        COUNT(*)::int AS views
      FROM banner_views
      WHERE banner_id = $1
        AND viewed_at >= NOW() - ($2 || ' days')::INTERVAL
      GROUP BY day
      ORDER BY day ASC
    `, [id, days]);

    // Umumiy
    const { rows: totals } = await pool.query(`
      SELECT
        COUNT(*)::int                                              AS total,
        COUNT(*) FILTER (WHERE viewed_at >= NOW() - INTERVAL '1 day')::int   AS today,
        COUNT(*) FILTER (WHERE viewed_at >= NOW() - INTERVAL '7 days')::int  AS week,
        COUNT(*) FILTER (WHERE viewed_at >= NOW() - INTERVAL '30 days')::int AS month
      FROM banner_views
      WHERE banner_id = $1
    `, [id]);

    res.json({
      banner_id: Number(id),
      period_days: days,
      totals: totals[0],
      daily,
    });
  } catch (err) {
    console.error('Banner stats error:', err);
    res.status(500).json({ error: 'Statistika olishda xato' });
  }
});

// ── Ko'rishni qayd etish (BannerSlider chaqiradi) ────────────────
// POST /api/banners/:id/view
router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const user_type = req.body?.user_type || 'client';

    // Banner mavjudligini tekshirish
    const { rowCount } = await pool.query(
      'SELECT id FROM banners WHERE id = $1', [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Banner topilmadi' });

    await pool.query(
      'INSERT INTO banner_views (banner_id, user_type) VALUES ($1, $2)',
      [id, user_type]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Banner view error:', err);
    res.status(500).json({ error: 'Ko\'rishni saqlashda xato' });
  }
});

// ── Rasm upload ──────────────────────────────────────────────────
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Rasm tanlanmagan' });
    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ image_url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    console.error('Banner upload error:', err);
    res.status(500).json({ error: 'Rasm yuklashda xato' });
  }
});

// ── Banner qo'shish ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { company, slogan, color, link_url, image_url, start_date, end_date, sort_order } = req.body;
    if (!company) return res.status(400).json({ error: 'Kompaniya nomi kerak' });

    const { rows } = await pool.query(`
      INSERT INTO banners (company, slogan, color, link_url, image_url, start_date, end_date, sort_order, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
      RETURNING *
    `, [
      company,
      slogan || null,
      color || '#8B1A2B',
      link_url || null,
      image_url || null,
      start_date || null,
      end_date || null,
      Number(sort_order || 0),
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Banners POST error:', err);
    res.status(500).json({ error: 'Banner qo\'shishda xato' });
  }
});

// ── Banner tahrirlash ────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { company, slogan, color, link_url, image_url, start_date, end_date, sort_order, is_active } = req.body;

    const { rows } = await pool.query(`
      UPDATE banners SET
        company    = COALESCE($1, company),
        slogan     = $2,
        color      = COALESCE($3, color),
        link_url   = $4,
        image_url  = $5,
        start_date = $6,
        end_date   = $7,
        sort_order = COALESCE($8, sort_order),
        is_active  = COALESCE($9, is_active)
      WHERE id = $10
      RETURNING *
    `, [
      company || null,
      slogan || null,
      color || null,
      link_url || null,
      image_url || null,
      start_date || null,
      end_date || null,
      sort_order ?? null,
      typeof is_active === 'boolean' ? is_active : null,
      id,
    ]);

    if (!rows[0]) return res.status(404).json({ error: 'Banner topilmadi' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Banners PUT error:', err);
    res.status(500).json({ error: 'Banner yangilashda xato' });
  }
});

// ── Banner o'chirish ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM banners WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Banners DELETE error:', err);
    res.status(500).json({ error: 'Banner o\'chirishda xato' });
  }
});

module.exports = router;
