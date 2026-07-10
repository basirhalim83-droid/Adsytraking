-- adsy-tracking: daftar toko per marketplace (Shopee/TikTok/Lazada)
-- Dipakai upload modal (dropdown pilih toko, bukan ketik manual) + filter di Tracking Marketplace.
-- Jalankan setelah sql/001_init.sql. Aman dijalankan berkali-kali.

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('shopee', 'tiktok', 'lazada')),
  name text not null,
  created_at timestamptz default now(),
  unique (marketplace, name)
);

create index if not exists idx_stores_marketplace on stores (marketplace);

alter table stores enable row level security;

drop policy if exists "stores_all_authenticated" on stores;
create policy "stores_all_authenticated" on stores for all to authenticated using (true) with check (true);
