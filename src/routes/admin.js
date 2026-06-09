const router  = require('express').Router();
const pool    = require('../db/pool');
const bcrypt  = require('bcryptjs');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);
router.use(requireRole('admin'));

// ─── GET /api/admin/agents — barcha agentlar ────────────
router.get('/agents', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        a.id, a.display_id, a.login, a.full_name, a.phone,
        a.role, a.is_active, a.telegram_id,
        a.trial_start, a.trial_end,
        a.plan, a.plan_start, a.plan_end,
        a.created_at,
        -- Statistika
        (SELECT COUNT(*) FROM clients c WHERE c.agent_id = a.id) as clients_count,
        (SELECT COUNT(*) FROM properties p WHERE p.agent_id = a.id) as props_count,
        (SELECT COUNT(*) FROM properties p WHERE p.agent_id = a.id AND p.status='active') as active_props,
        -- Trial holati
        CASE
          WHEN a.plan = 'pro'       THEN 'pro'
          WHEN a.plan = 'corporate' THEN 'corporate'
          WHEN NOW() < a.trial_end  THEN 'trial'
          ELSE 'expired'
        END as subscription_status,
        -- Qolgan kunlar
        CASE
          WHEN a.plan IN ('pro','corporate') AND a.plan_end IS NOT NULL
            THEN GREATEST(0, EXTRACT(DAY FROM (a.plan_end - NOW()))::int)
          WHEN NOW() < a.trial_end
            THEN GREATEST(0, EXTRACT(DAY FROM (a.trial_end - NOW()))::int)
          ELSE 0
        END as days_left,
        -- So'nggi faollik
        GREATEST(
          COALESCE((SELECT MAX(created_at) FROM clients c WHERE c.agent_id = a.id), '2000-01-01'),
          COALESCE((SELECT MAX(created_at) FROM properties p WHERE p.agent_id = a.id), '2000-01-01')
        ) as last_activity
      FROM agents a
      WHERE a.role != 'admin'
      ORDER BY a.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/stats — umumiy statistika ────────────
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM agents WHERE role != 'admin') as total_agents,
        (SELECT COUNT(*) FROM agents WHERE role != 'admin' AND is_active = true) as active_agents,
        (SELECT COUNT(*) FROM agents WHERE role != 'admin' AND is_active = false) as inactive_agents,
        (SELECT COUNT(*) FROM agents WHERE plan IN ('pro','corporate')) as paid_agents,
        (SELECT COUNT(*) FROM agents WHERE NOW() < trial_end AND plan IS NULL) as trial_agents,
        (SELECT COUNT(*) FROM agents WHERE NOW() >= trial_end AND plan IS NULL) as expired_agents,
        (SELECT COUNT(*) FROM clients) as total_clients,
        (SELECT COUNT(*) FROM properties) as total_properties,
        (SELECT COUNT(*) FROM properties WHERE status = 'active') as active_properties,
        (SELECT COUNT(*) FROM clients WHERE created_at > NOW() - INTERVAL '24 hours') as clients_today,
        (SELECT COUNT(*) FROM properties WHERE created_at > NOW() - INTERVAL '24 hours') as props_today,
        (SELECT COUNT(*) FROM lead_exchange WHERE created_at > NOW() - INTERVAL '24 hours') as leads_today
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/admin/agents/:id/toggle — yoq/o'chir ──────
router.put('/agents/:id/toggle', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE agents SET is_active = NOT is_active
       WHERE id = $1 AND role != 'admin'
       RETURNING id, login, full_name, is_active`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    const agent = rows[0];
    const tgSend = req.app.get('tgSend');

    // Agentga Telegram xabar
    if (tgSend) {
      const { rows: agentRows } = await pool.query(
        'SELECT telegram_id FROM agents WHERE id=$1', [req.params.id]
      );
      if (agentRows[0]?.telegram_id) {
        const msg = agent.is_active
          ? `✅ <b>Hisobingiz faollashtirildi!</b>\n\nGK Network ga xush kelibsiz!`
          : `⚠️ <b>Hisobingiz vaqtincha to'xtatildi.</b>\n\nBatafsil ma'lumot uchun admin bilan bog'laning.`;
        await tgSend(agentRows[0].telegram_id, msg, { parse_mode: 'HTML' });
      }
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/admin/agents/:id/plan — tarif berish ───────
router.put('/agents/:id/plan', async (req, res) => {
  try {
    const { plan, days } = req.body;
    // plan: 'trial' | 'pro' | 'corporate' | 'free'
    // days: necha kun (default: 30)

    const planDays = parseInt(days) || 30;
    let updateQuery, params;

    if (plan === 'trial') {
      updateQuery = `
        UPDATE agents SET
          plan = NULL,
          plan_start = NULL,
          plan_end = NULL,
          trial_end = NOW() + INTERVAL '${planDays} days',
          is_active = true
        WHERE id = $1 AND role != 'admin'
        RETURNING id, login, full_name, plan, trial_end, is_active
      `;
      params = [req.params.id];
    } else if (plan === 'free') {
      updateQuery = `
        UPDATE agents SET
          plan = NULL,
          plan_start = NULL,
          plan_end = NULL,
          trial_end = NOW() - INTERVAL '1 day',
          is_active = true
        WHERE id = $1 AND role != 'admin'
        RETURNING id, login, full_name, plan, trial_end, is_active
      `;
      params = [req.params.id];
    } else {
      updateQuery = `
        UPDATE agents SET
          plan = $2,
          plan_start = NOW(),
          plan_end = NOW() + INTERVAL '${planDays} days',
          is_active = true
        WHERE id = $1 AND role != 'admin'
        RETURNING id, login, full_name, plan, plan_end, is_active
      `;
      params = [req.params.id, plan];
    }

    const { rows } = await pool.query(updateQuery, params);
    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    const agent = rows[0];
    const tgSend = req.app.get('tgSend');

    // Agentga xabar
    if (tgSend) {
      const { rows: ar } = await pool.query(
        'SELECT telegram_id FROM agents WHERE id=$1', [req.params.id]
      );
      if (ar[0]?.telegram_id) {
        const planNames = { pro: 'Pro', corporate: 'Korporativ', trial: "Sinov (bepul)" };
        const msg = plan === 'free'
          ? `⚠️ <b>Sizning tarifingiz tugadi.</b>\n\nDavom etish uchun to'lov qiling.`
          : `🎉 <b>${planNames[plan] || plan} tarifi faollashtirildi!</b>\n\n📅 ${planDays} kun davom etadi.`;
        await tgSend(ar[0].telegram_id, msg, { parse_mode: 'HTML' });
      }
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/agents — yangi agent qo'shish ───────
router.post('/agents', async (req, res) => {
  try {
    const { login, password, full_name, phone, plan, days } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Login va parol kerak' });

    const exists = await pool.query('SELECT id FROM agents WHERE login=$1', [login]);
    if (exists.rows.length) return res.status(400).json({ error: 'Bu login band' });

    const hash     = await bcrypt.hash(password, 10);
    const planDays = parseInt(days) || 30;

    const { rows } = await pool.query(`
      INSERT INTO agents (
        display_id, login, password_hash, full_name, phone, role,
        trial_start, trial_end, is_active,
        plan, plan_start, plan_end
      ) VALUES (
        gen_display_id('AG','seq_agent'), $1, $2, $3, $4, 'agent',
        NOW(), NOW() + INTERVAL '${plan === 'trial' ? planDays : 14} days', true,
        $5,
        CASE WHEN $5 IS NOT NULL THEN NOW() ELSE NULL END,
        CASE WHEN $5 IS NOT NULL THEN NOW() + INTERVAL '${planDays} days' ELSE NULL END
      ) RETURNING id, display_id, login, full_name, phone, role, is_active, trial_end, plan
    `, [login, hash, full_name || '', phone || '', plan || null]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/report — kunlik hisobot ─────────────
router.post('/report', async (req, res) => {
  try {
    const tgSend   = req.app.get('tgSend');
    const adminChatId = process.env.ADMIN_TELEGRAM_ID;

    // Statistika
    const { rows: stats } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM agents WHERE role!='admin' AND is_active=true) as active_agents,
        (SELECT COUNT(*) FROM agents WHERE role!='admin' AND plan IN ('pro','corporate')) as paid,
        (SELECT COUNT(*) FROM agents WHERE role!='admin' AND NOW()<trial_end AND plan IS NULL) as trial,
        (SELECT COUNT(*) FROM agents WHERE role!='admin' AND NOW()>=trial_end AND plan IS NULL AND is_active=true) as expired,
        (SELECT COUNT(*) FROM clients WHERE created_at>NOW()-INTERVAL '24h') as new_clients,
        (SELECT COUNT(*) FROM properties WHERE created_at>NOW()-INTERVAL '24h') as new_props,
        (SELECT COUNT(*) FROM lead_exchange WHERE created_at>NOW()-INTERVAL '24h') as new_leads
    `);
    const s = stats[0];

    // Bugun muddati tugaganlar
    const { rows: expiredToday } = await pool.query(`
      SELECT full_name, login, phone, telegram_id
      FROM agents
      WHERE role!='admin'
        AND (
          (plan IS NULL AND trial_end::date = CURRENT_DATE)
          OR (plan IS NOT NULL AND plan_end::date = CURRENT_DATE)
        )
    `);

    // 3 kun ichida tugaydigan agentlar
    const { rows: expiringSoon } = await pool.query(`
      SELECT full_name, login, phone, telegram_id,
        GREATEST(
          CASE WHEN plan IS NULL THEN trial_end ELSE plan_end END
        ) as end_date
      FROM agents
      WHERE role!='admin' AND is_active=true
        AND (
          (plan IS NULL AND trial_end BETWEEN NOW() AND NOW()+INTERVAL '3 days')
          OR (plan IS NOT NULL AND plan_end BETWEEN NOW() AND NOW()+INTERVAL '3 days')
        )
    `);

    // Hisobot matni
    let report = `📊 <b>GK Network — Kunlik Hisobot</b>\n`;
    report += `📅 ${new Date().toLocaleDateString('uz-UZ')}\n\n`;
    report += `👥 <b>Agentlar:</b>\n`;
    report += `  • Faol: ${s.active_agents}\n`;
    report += `  • To'lovli (Pro/Corp): ${s.paid}\n`;
    report += `  • Sinov: ${s.trial}\n`;
    report += `  • Muddati o'tgan: ${s.expired}\n\n`;
    report += `📈 <b>Bugungi faollik:</b>\n`;
    report += `  • Yangi mijozlar: ${s.new_clients}\n`;
    report += `  • Yangi ob'yektlar: ${s.new_props}\n`;
    report += `  • Yangi lidlar: ${s.new_leads}\n`;

    if (expiredToday.length > 0) {
      report += `\n⚠️ <b>Bugun muddati tugadi (${expiredToday.length} ta):</b>\n`;
      expiredToday.forEach(a => {
        report += `  • ${a.full_name || a.login}`;
        if (a.phone) report += ` · ${a.phone}`;
        report += '\n';
      });
    }

    if (expiringSoon.length > 0) {
      report += `\n🔔 <b>3 kun ichida tugaydi (${expiringSoon.length} ta):</b>\n`;
      expiringSoon.forEach(a => {
        const days = Math.ceil((new Date(a.end_date) - new Date()) / 86400000);
        report += `  • ${a.full_name || a.login} — ${days} kun\n`;
      });
    }

    // Admin ga yuborish
    if (tgSend && adminChatId) {
      await tgSend(adminChatId, report, { parse_mode: 'HTML' });
    }

    // Muddati tugagan agenflarga eslatma yuborish
    if (tgSend) {
      for (const a of expiringSoon) {
        if (a.telegram_id) {
          const days = Math.ceil((new Date(a.end_date) - new Date()) / 86400000);
          await tgSend(a.telegram_id,
            `⏰ <b>Eslatma!</b>\n\nGK Network tarifingiz <b>${days} kun</b> ichida tugaydi.\n\nDavom etish uchun admin bilan bog'laning.`,
            { parse_mode: 'HTML' }
          );
        }
      }
    }

    res.json({
      success: true,
      report_sent: !!(tgSend && adminChatId),
      stats: s,
      expired_today: expiredToday.length,
      expiring_soon: expiringSoon.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
