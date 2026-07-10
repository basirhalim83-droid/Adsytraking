-- adsy-tracking: daftar CS/tim per domain (Akuisisi/CRM) + nomor WA-nya.
-- Dipakai buat rute notif WA pas paket bermasalah -- ke nomor CS yang pegang order itu,
-- bukan cuma 1 nomor ops. Nama CS dikenali otomatis dari kolom "Instruksi Pengiriman" pas
-- upload (format "Pengirim CS <nama> / Adv. <nama> / <nama>", pola sama kayak ValidasiOrder).
-- Jalankan setelah sql/001-003. Aman dijalankan berkali-kali.

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain in ('akuisisi', 'crm')),
  name text not null,
  no_wa text not null,
  created_at timestamptz default now(),
  unique (domain, name)
);

create index if not exists idx_team_members_domain on team_members (domain);

alter table team_members enable row level security;

drop policy if exists "team_members_all_authenticated" on team_members;
create policy "team_members_all_authenticated" on team_members for all to authenticated using (true) with check (true);

alter table akuisisi_orders add column if not exists cs_nama text;
alter table crm_orders add column if not exists cs_nama text;

create index if not exists idx_akuisisi_orders_cs_nama on akuisisi_orders (cs_nama);
create index if not exists idx_crm_orders_cs_nama on crm_orders (cs_nama);
