-- adsy-tracking: index performa buat query yang selalu filter by order_date
-- (date-range picker di tiap halaman Tracking, dan filter umur order di cron mulai sesi ini).
-- Jalankan setelah sql/001_init.sql & sql/002_stores.sql. Aman dijalankan berkali-kali.

create index if not exists idx_akuisisi_orders_order_date on akuisisi_orders (order_date);
create index if not exists idx_marketplace_orders_order_date on marketplace_orders (order_date);
create index if not exists idx_crm_orders_order_date on crm_orders (order_date);
