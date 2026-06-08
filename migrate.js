const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const schema = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free','pro','corporate')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  telegram_id BIGINT UNIQUE,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  company_id UUID REFERENCES companies(id),
  role TEXT DEFAULT 'agent' CHECK (role IN ('admin','agent','company')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id),
  company_id UUID REFERENCES companies(id),
  full_name TEXT,
  phone TEXT,
  need_type TEXT NOT NULL CHECK (need_type IN ('buy','rent')),
  property_type TEXT NOT NULL CHECK (property_type IN ('apartment','house','office','land')),
  rooms INTEGER,
  budget_min NUMERIC(12,2),
  budget_max NUMERIC(12,2),
  region TEXT,
  district TEXT,
  mortgage BOOLEAN DEFAULT false,
  installment BOOLEAN DEFAULT false,
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','sold')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id),
  company_id UUID REFERENCES companies(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('sell','rent')),
  property_type TEXT NOT NULL CHECK (property_type IN ('apartment','house','office','land')),
  rooms INTEGER,
  area NUMERIC(8,2),
  floor INTEGER,
  total_floors INTEGER,
  price NUMERIC(12,2) NOT NULL,
  region TEXT,
  district TEXT,
  address TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  mortgage BOOLEAN DEFAULT false,
  installment BOOLEAN DEFAULT false,
  description TEXT,
  photos TEXT[],
  status TEXT DEFAULT 'active' CHECK (status IN ('active','reserved','sold','inactive')),
  post_status TEXT DEFAULT 'pending' CHECK (post_status IN ('pending','posted','failed')),
  tg_message_id BIGINT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_exchange (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id),
  sender_id UUID NOT NULL REFERENCES agents(id),
  receiver_id UUID NOT NULL REFERENCES agents(id),
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','closed')),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id),
  client_id UUID REFERENCES clients(id),
  telegram_id BIGINT,
  agent_id UUID REFERENCES agents(id),
  status TEXT DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  address TEXT,
  region TEXT,
  total_units INTEGER DEFAULT 0,
  sold_units INTEGER DEFAULT 0,
  delivery_date DATE,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning','construction','ready')),
  photos TEXT[],
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL,
  rooms INTEGER,
  area NUMERIC(8,2),
  floor INTEGER,
  price NUMERIC(12,2),
  status TEXT DEFAULT 'available' CHECK (status IN ('available','reserved','sold')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS seq_client   START 1;
CREATE SEQUENCE IF NOT EXISTS seq_property START 1;
CREATE SEQUENCE IF NOT EXISTS seq_agent    START 1;
CREATE SEQUENCE IF NOT EXISTS seq_company  START 1;
CREATE SEQUENCE IF NOT EXISTS seq_lead     START 1;
CREATE SEQUENCE IF NOT EXISTS seq_project  START 1;

CREATE OR REPLACE FUNCTION gen_display_id(prefix TEXT, seq_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN prefix || '-' || LPAD(nextval(seq_name)::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS idx_clients_agent ON clients(agent_id);
CREATE INDEX IF NOT EXISTS idx_props_agent ON properties(agent_id);
CREATE INDEX IF NOT EXISTS idx_props_type ON properties(purpose, property_type);
CREATE INDEX IF NOT EXISTS idx_leads_receiver ON lead_exchange(receiver_id);
`;

async function migrate() {
  try {
    console.log('Bazaga ulanmoqda...');
    await pool.query(schema);
    console.log('✅ Barcha jadvallar yaratildi!');

    // Test admin user
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(`
      INSERT INTO agents (display_id, login, password_hash, full_name, role)
      VALUES ('AG-0001', 'admin', $1, 'Admin', 'admin')
      ON CONFLICT (login) DO NOTHING
    `, [hash]);
    console.log('✅ Admin foydalanuvchi yaratildi: login=admin, parol=admin123');

  } catch (err) {
    console.error('❌ Xato:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
