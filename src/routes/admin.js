
/* ==========================
   CLIENT STATS
   Mini App mijozlar statistikasi
========================== */

router.get('/client-stats', auth, async (req, res) => {
  try {
    if (req.agent.role !== 'admin') {
      return res.status(403).json({ error: 'Faqat admin' });
    }

    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM app_clients) AS total,
        (SELECT COUNT(*) FROM app_clients WHERE created_at >= CURRENT_DATE) AS today,
        (SELECT COUNT(*) FROM app_clients WHERE created_at >= date_trunc('week', NOW())) AS this_week,
        (SELECT COUNT(*) FROM app_applications) AS applications
    `);

    const { rows: recent } = await pool.query(`
      SELECT full_name, phone, telegram_id, created_at
      FROM app_clients
      ORDER BY created_at DESC
      LIMIT 10
    `);

    res.json({ ...rows[0], recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
