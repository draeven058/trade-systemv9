-- ============================================================
-- TRADE SYSTEM v3 — Run this in Supabase SQL Editor
-- ============================================================

-- Add per-trader brokerage settings
ALTER TABLE traders ADD COLUMN IF NOT EXISTS nse_rate  numeric default 3000;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS mcx_scripts jsonb default '[]';

-- Ensure all existing tables are present
CREATE TABLE IF NOT EXISTS users (
  id         uuid primary key default gen_random_uuid(),
  username   text unique not null,
  password   text not null,
  name       text default '',
  role       text default 'USER' check (role in ('ADMIN','USER')),
  active     boolean default true,
  created_at timestamptz default now()
);
CREATE TABLE IF NOT EXISTS traders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text default '',
  note        text default '',
  active      boolean default true,
  nse_rate    numeric default 3000,
  mcx_scripts jsonb default '[]',
  created_by  text,
  created_at  timestamptz default now()
);
CREATE TABLE IF NOT EXISTS weeks (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  start_date date,
  end_date   date,
  status     text default 'open',
  created_by text,
  created_at timestamptz default now()
);
CREATE TABLE IF NOT EXISTS trades (
  id             uuid primary key default gen_random_uuid(),
  trader_id      uuid references traders(id) on delete cascade,
  week_id        uuid references weeks(id) on delete cascade,
  trade_date     text default '',
  action         text default 'BUY',
  qty            numeric default 0,
  price          numeric default 0,
  vol            numeric default 0,
  script         text default '',
  type           text default 'NORMAL',
  exchange       text default 'NSE',
  is_settlement  boolean default false,
  sort_order     integer default 0,
  created_at     timestamptz default now()
);
CREATE TABLE IF NOT EXISTS settlement_rates (
  id         uuid primary key default gen_random_uuid(),
  week_id    uuid references weeks(id) on delete cascade,
  script     text not null,
  rate       numeric not null,
  exchange   text default 'NSE',
  created_at timestamptz default now(),
  unique(week_id, script)
);
CREATE TABLE IF NOT EXISTS user_settings (
  username    text primary key,
  nse_rate    numeric default 3000,
  mcx_scripts jsonb default '[]',
  updated_at  timestamptz default now()
);

-- Disable RLS
ALTER TABLE users            DISABLE ROW LEVEL SECURITY;
ALTER TABLE traders          DISABLE ROW LEVEL SECURITY;
ALTER TABLE weeks            DISABLE ROW LEVEL SECURITY;
ALTER TABLE trades           DISABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_rates DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings    DISABLE ROW LEVEL SECURITY;

-- Default admin
INSERT INTO users (username, password, name, role, active)
VALUES ('admin', 'admin123', 'Administrator', 'ADMIN', true)
ON CONFLICT (username) DO NOTHING;

-- DONE!
