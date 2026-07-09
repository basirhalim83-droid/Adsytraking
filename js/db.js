// ── Supabase Client ───────────────────────────────────────────────────────────
// URL & anon key gak di-hardcode di sini -- diambil dari /api/config (baca Vercel
// Environment Variables). WAJIB panggil `await initSupabaseClient()` di awal tiap
// halaman sebelum manggil fungsi apa pun lain di file ini.
let _sb = null;
async function initSupabaseClient() {
  if (_sb) return _sb;
  const res = await fetch('/api/config');
  const cfg = await res.json();
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY belum di-set di Environment Variables Vercel');
  }
  _sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return _sb;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function sbSignUp(email, password, name) {
  const { data, error } = await _sb.auth.signUp({
    email, password,
    options: { data: { name } },
  });
  if (error) throw error;
  if (data.user) {
    // Self-heal: pastikan row profiles kebentuk walau trigger DB gagal
    await _sb.from('profiles').upsert({ id: data.user.id, email, name, role: 'user' });
  }
  return data;
}

async function sbLogin(email, password) {
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

async function sbLogout() {
  await _sb.auth.signOut();
  sessionStorage.clear();
  window.location.href = 'index.html';
}

async function sbGetSession() {
  const { data } = await _sb.auth.getSession();
  return data.session;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
async function dbGetProfile(userId) {
  const { data, error } = await _sb.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

// ── Tracking orders (generik, dipakai ketiga domain: akuisisi/marketplace/crm) ─
// Satu implementasi buat 3 tabel -- kontrak kolom tracking-nya seragam (lihat sql/001_init.sql),
// jadi gak perlu fan-out query kayak MarketDash lama yang punya 3 tabel per-marketplace.
async function dbGetTrackableOrders(table, filters = {}) {
  let q = _sb.from(table).select('*').order('order_date', { ascending: false });
  if (filters.dateFrom) q = q.gte('order_date', filters.dateFrom);
  if (filters.dateTo)   q = q.lte('order_date', filters.dateTo);
  if (filters.marketplace) q = q.eq('marketplace', filters.marketplace);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ── Upload batches ────────────────────────────────────────────────────────────
// Dedup within batch by id (keep last), cek existing id di Supabase per-chunk 500,
// upsert new rows aja. Port dari Marketplace-main/js/db.js (dbBulkInsertMarketplaceOrders),
// digeneralisasi -- satu implementasi dipakai 3 domain karena tabelnya udah seragam kolomnya.
async function dbBulkInsertOrders(table, rows, batchId, uploaderId) {
  const inserts = rows.map(r => ({ ...r, upload_batch_id: batchId, uploaded_by: uploaderId }));

  const seen = new Map();
  inserts.forEach(r => seen.set(r.id, r));
  const unique = Array.from(seen.values());

  const allIds = unique.map(r => r.id);
  const existingIds = new Set();
  const CHECK_CHUNK = 500;
  for (let i = 0; i < allIds.length; i += CHECK_CHUNK) {
    const chunk = allIds.slice(i, i + CHECK_CHUNK);
    const { data } = await _sb.from(table).select('id').in('id', chunk);
    (data || []).forEach(r => existingIds.add(r.id));
  }

  const newRows = unique.filter(r => !existingIds.has(r.id));
  const skipped = unique.length - newRows.length;

  const CHUNK = 500;
  for (let i = 0; i < newRows.length; i += CHUNK) {
    const chunk = newRows.slice(i, i + CHUNK);
    const { error } = await _sb.from(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }

  return { saved: newRows.length, skipped };
}

async function dbInsertUploadBatch(batch) {
  const { error } = await _sb.from('upload_batches').insert(batch);
  if (error) throw error;
}

async function dbDeleteUploadBatchRow(batchId) {
  await _sb.from('upload_batches').delete().eq('id', batchId);
}

async function dbUpdateUploadBatchCount(batchId, count) {
  await _sb.from('upload_batches').update({ record_count: count }).eq('id', batchId);
}

async function dbGetUploadBatches(domain) {
  const { data, error } = await _sb.from('upload_batches').select('*, profiles(name)').eq('domain', domain).order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Hapus batch + semua order anaknya (tabel ditentukan pemanggil sesuai domain).
async function dbDeleteUploadBatch(batchId, table) {
  const { error: delOrdersErr } = await _sb.from(table).delete().eq('upload_batch_id', batchId);
  if (delOrdersErr) throw delOrdersErr;
  const { error: delBatchErr } = await _sb.from('upload_batches').delete().eq('id', batchId);
  if (delBatchErr) throw delBatchErr;
}

// ── Toko (per marketplace) -- dipakai dropdown upload & filter Tracking Marketplace ─
async function dbGetStores(marketplace) {
  let q = _sb.from('stores').select('*').order('name');
  if (marketplace) q = q.eq('marketplace', marketplace);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function dbAddStore(marketplace, name) {
  const { data, error } = await _sb.from('stores').insert({ marketplace, name }).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('Toko dengan nama itu sudah terdaftar di marketplace ini.');
    throw error;
  }
  return data;
}

async function dbDeleteStore(id) {
  const { error } = await _sb.from('stores').delete().eq('id', id);
  if (error) throw error;
}
