-- adsy-tracking: schema awal
-- Jalankan sekali di Supabase SQL Editor (project baru, berdiri sendiri).
-- Aman dijalankan berkali-kali (semua IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).

-- ── profiles ──────────────────────────────────────────────────────────────
-- role disertakan dari awal (beda dari csorder-main yang nambah role belakangan
-- di luar app, lihat feedback_changesummary/project notes).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'user',
  no_wa text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_all" on profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);

-- Auto-create profile row saat user baru signup (jaga-jaga kalau insert client-side gagal)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── upload_batches ────────────────────────────────────────────────────────
-- Satu tabel dipakai bertiga (akuisisi/marketplace/crm), dibedain kolom `domain`.
create table if not exists upload_batches (
  id text primary key,
  domain text not null check (domain in ('akuisisi', 'marketplace', 'crm')),
  marketplace text,
  store_name text,
  uploaded_by uuid references profiles(id),
  record_count int default 0,
  uploaded_at timestamptz default now()
);

alter table upload_batches enable row level security;

drop policy if exists "upload_batches_all_authenticated" on upload_batches;
create policy "upload_batches_all_authenticated" on upload_batches for all to authenticated using (true) with check (true);

-- ── akuisisi_orders ───────────────────────────────────────────────────────
create table if not exists akuisisi_orders (
  id text primary key,
  created_at timestamptz default now(),
  order_date date,
  nama text,
  hp text,
  alamat text,
  produk text,
  qty int,
  total numeric,
  resi text,
  ekspedisi text,
  kota_tujuan text,
  status_resi text,
  status_resi_step int,
  status_resi_updated_at timestamptz,
  status_resi_detail jsonb,
  upload_batch_id text references upload_batches(id) on delete set null,
  uploaded_by uuid references profiles(id)
);

create index if not exists idx_akuisisi_orders_status_resi on akuisisi_orders (status_resi);
create index if not exists idx_akuisisi_orders_upload_batch on akuisisi_orders (upload_batch_id);

alter table akuisisi_orders enable row level security;
drop policy if exists "akuisisi_orders_all_authenticated" on akuisisi_orders;
create policy "akuisisi_orders_all_authenticated" on akuisisi_orders for all to authenticated using (true) with check (true);

-- ── crm_orders ────────────────────────────────────────────────────────────
-- Struktur identik akuisisi_orders, tabel terpisah total (permintaan eksplisit user).
create table if not exists crm_orders (
  id text primary key,
  created_at timestamptz default now(),
  order_date date,
  nama text,
  hp text,
  alamat text,
  produk text,
  qty int,
  total numeric,
  resi text,
  ekspedisi text,
  kota_tujuan text,
  status_resi text,
  status_resi_step int,
  status_resi_updated_at timestamptz,
  status_resi_detail jsonb,
  upload_batch_id text references upload_batches(id) on delete set null,
  uploaded_by uuid references profiles(id)
);

create index if not exists idx_crm_orders_status_resi on crm_orders (status_resi);
create index if not exists idx_crm_orders_upload_batch on crm_orders (upload_batch_id);

alter table crm_orders enable row level security;
drop policy if exists "crm_orders_all_authenticated" on crm_orders;
create policy "crm_orders_all_authenticated" on crm_orders for all to authenticated using (true) with check (true);

-- ── marketplace_orders ───────────────────────────────────────────────────
-- Satu tabel dengan kolom `marketplace` enum (shopee/tiktok/lazada), bukan 3 tabel
-- terpisah seperti MarketDash lama -- fresh build, tanpa beban legacy.
create table if not exists marketplace_orders (
  id text primary key,
  marketplace text not null check (marketplace in ('shopee', 'tiktok', 'lazada')),
  created_at timestamptz default now(),
  order_date date,
  sku text,
  produk text,
  qty int,
  unit_price numeric,
  total numeric,
  status text,
  buyer text,
  store_name text,
  ekspedisi text,
  kota_tujuan text,
  status_resi text,
  status_resi_step int,
  status_resi_updated_at timestamptz,
  status_resi_detail jsonb,
  upload_batch_id text references upload_batches(id) on delete set null,
  uploaded_by uuid references profiles(id)
);

create index if not exists idx_marketplace_orders_marketplace on marketplace_orders (marketplace);
create index if not exists idx_marketplace_orders_status_resi on marketplace_orders (status_resi);
create index if not exists idx_marketplace_orders_upload_batch on marketplace_orders (upload_batch_id);

alter table marketplace_orders enable row level security;
drop policy if exists "marketplace_orders_all_authenticated" on marketplace_orders;
create policy "marketplace_orders_all_authenticated" on marketplace_orders for all to authenticated using (true) with check (true);
