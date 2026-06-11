const router = require('express').Router();
const pool = require('../db/pool');

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

router.get('/admin/all', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM banners
      ORDER BY sort_order ASC, created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Banners admin GET error:', err);
    res.status(500).json({ error: 'Bannerlarni olishda xato' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      company,
      slogan,
      color,
      link_url,
      image_url,
      start_date,
      end_date,
      sort_order
    } = req.body;

    if (!company) {
      return res.status(400).json({ error: 'Kompaniya nomi kerak' });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO banners (
        company, slogan, color, link_url, image_url,
        start_date, end_date, sort_order, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
      RETURNING *
      `,
      [
        company,
        slogan || null,
        color || '#8B1A2B',
        link_url || null,
        image_url || null,
        start_date || null,
        end_date || null,
        sort_order || 0
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Banners POST error:', err);
    res.status(500).json({ error: 'Banner qo‘shishda xato' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const {
      company,
      slogan,
      color,
      link_url,
      image_url,
      start_date,
      end_date,
      sort_order,
      is_active
    } = req.body;

    const { rows } = await pool.query(
      `
      UPDATE banners
      SET
        company = COALESCE($1, company),
        slogan = $2,
        color = COALESCE($3, color),
        link_url = $4,
        image_url = $5,
        start_date = $6,
        end_date = $7,
        sort_order = COALESCE($8, sort_order),
        is_active = COALESCE($9, is_active)
      WHERE id = $10
      RETURNING *
      `,
      [
        company || null,
        slogan || null,
        color || null,
        link_url || null,
        image_url || null,
        start_date || null,
        end_date || null,
        sort_order ?? null,
        typeof is_active === 'boolean' ? is_active : null,
        id
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Banner topilmadi' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Banners PUT error:', err);
    res.status(500).json({ error: 'Banner yangilashda xato' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM banners WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Banners DELETE error:', err);
    res.status(500).json({ error: 'Banner o‘chirishda xato' });
  }
});

module.exports = router;