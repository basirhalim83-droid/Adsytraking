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
// Di-page pake .range() 1000 per batch -- PostgREST default max-rows 1000, tanpa ini query
// diam-diam kepotong pas order-nya lebih dari 1000 (ketauan dari Tracking Akuisisi yang macet
// pas "Total: 1000" padahal resi aslinya lebih banyak).
async function dbGetTrackableOrders(table, filters = {}) {
  const PAGE = 1000;
  let all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    let q = _sb.from(table).select('*').order('order_date', { ascending: false });
    if (filters.dateFrom) q = q.gte('order_date', filters.dateFrom);
    if (filters.dateTo)   q = q.lte('order_date', filters.dateTo);
    if (filters.marketplace) q = q.eq('marketplace', filters.marketplace);
    q = q.range(page * PAGE, (page + 1) * PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    all = all.concat(data || []);
    hasMore = (data || []).length === PAGE;
    page++;
  }
  return all;
}

// Follow-up manual buat resi Bermasalah (percobaan/direspon/diinfo kurir) -- status ringkas
// aja, gak ada tabel histori terpisah (keputusan user 2026-07-11, lihat sql/006).
async function dbUpdateFollowup(table, id, patch) {
  const { error } = await _sb.from(table).update(patch).eq('id', id);
  if (error) throw error;
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
  // Duplikat DALAM FILE ITU SENDIRI (resi sama muncul >1x) -- sebelumnya di-dedup diam-diam di
  // sini tanpa pernah dilaporin ke user, jadi kalau upload 155 baris taunya cuma 153 tersimpan
  // tanpa penjelasan. Sekarang dihitung terpisah dari "skipped" (yang emang udah ada di database).
  const duplicateInBatch = inserts.length - unique.length;

  const allIds = unique.map(r => r.id);
  const existingIds = new Set();
  const CHECK_CHUNK = 500;
  for (let i = 0; i < allIds.length; i += CHECK_CHUNK) {
    const chunk = allIds.slice(i, i + CHECK_CHUNK);
    const { data } = await _sb.from(table).select('id').in('id', chunk);
    (data || []).forEach(r => existingIds.add(r.id));
  }

  const newRows = unique.filter(r => !existingIds.has(r.id));
  const updateRows = unique.filter(r => existingIds.has(r.id));

  const CHUNK = 500;
  for (let i = 0; i < newRows.length; i += CHUNK) {
    const chunk = newRows.slice(i, i + CHUNK);
    const { error } = await _sb.from(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }

  // Resi yang UDAH ada di database -- upload ulang dianggap "refresh" data sumber (dipakai
  // buat backfill order lama yang kena bug parsing versi lama, mis. ekspedisi kosong gara-gara
  // header typo yang gak ke-detect). Upsert cuma nyertain kolom ini di payload -- Postgres ON
  // CONFLICT DO UPDATE cuma nge-update kolom yang disertain, jadi status_resi*/followup_*
  // (punya cron/interaksi user, bukan urusan upload) SENGAJA gak ikut ke-reset.
  const REFRESH_FIELDS = ['nama', 'hp', 'alamat', 'kota_tujuan', 'produk', 'qty', 'total', 'ekspedisi', 'order_date', 'cs_nama', 'buyer', 'sku', 'unit_price', 'status', 'upload_batch_id', 'uploaded_by'];
  if (updateRows.length) {
    const patches = updateRows.map(r => {
      const patch = {};
      REFRESH_FIELDS.forEach(f => { if (r[f] !== undefined) patch[f] = r[f]; });
      patch.id = r.id;
      return patch;
    });
    for (let i = 0; i < patches.length; i += CHUNK) {
      const chunk = patches.slice(i, i + CHUNK);
      const { error } = await _sb.from(table).upsert(chunk, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  return { saved: newRows.length, updated: updateRows.length, duplicateInBatch };
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

// ── Tim/CS (per domain akuisisi/crm) -- target notif WA pas order bermasalah ───
async function dbGetTeamMembers(domain) {
  let q = _sb.from('team_members').select('*').order('name');
  if (domain) q = q.eq('domain', domain);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function dbAddTeamMember(domain, name, noWa) {
  const { data, error } = await _sb.from('team_members').insert({ domain, name, no_wa: noWa }).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('Nama itu sudah terdaftar di domain ini.');
    throw error;
  }
  return data;
}

async function dbDeleteTeamMember(id) {
  const { error } = await _sb.from('team_members').delete().eq('id', id);
  if (error) throw error;
}

// ── Mapping kode SKU -> nama produk (copy manual dari ekosistem ValidasiOrder) ─
async function dbGetSkuMap() {
  const { data, error } = await _sb.from('sku_produk').select('kode,nama_produk');
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(r => map.set(String(r.kode).trim().toUpperCase(), r.nama_produk));
  return map;
}
