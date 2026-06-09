-- agents jadvaliga plan ustunlarini qo'shish
-- Railway yoki lokal DB da bir marta ishlatiladi

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS plan        TEXT CHECK (plan IN ('pro','corporate')),
  ADD COLUMN IF NOT EXISTS plan_start  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_end    TIMESTAMPTZ;

-- ADMIN_TELEGRAM_ID ni .env ga qo'shish kerak
-- Telegram dan o'z chat ID ni olish:
-- https://api.telegram.org/botTOKEN/getUpdates
-- Botga /start yuboring, "from":{"id":XXXXXXX} — shu raqam

-- Tekshirish
SELECT id, login, full_name, plan, trial_end, plan_end, is_active 
FROM agents 
ORDER BY created_at DESC;
