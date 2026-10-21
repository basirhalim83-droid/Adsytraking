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
//
// PENTING: status_resi_detail (JSONB besar, raw response kurir) SENGAJA dikecualikan dari
// select list -- kolom ini bisa puluhan KB per baris dan jadi penyebab utama egress meledak.
// Fetch status_resi_detail hanya saat buka modal detail 1 order via dbGetOrderDetail().
// Kolom untuk akuisisi & crm (punya nama/hp/alamat/cs_nama, tidak punya marketplace/sku/buyer/store_name/status)
const TR_LIST_COLUMNS_DEFAULT = 'id,order_date,nama,hp,alamat,produk,qty,total,ekspedisi,kota_tujuan,status_resi,status_resi_step,status_resi_updated_at,upload_batch_id,uploaded_by,cs_nama,followup_attempts,followup_responded,followup_courier_notified,status_resi_detail->>masalah_kategori,status_resi_detail->>bermasalah_since';
// Kolom untuk marketplace (punya buyer/marketplace/sku/store_name/status, tidak punya nama/hp/alamat/cs_nama)
const TR_LIST_COLUMNS_MARKETPLACE = 'id,order_date,produk,qty,unit_price,total,ekspedisi,kota_tujuan,status_resi,status_resi_step,status_resi_updated_at,upload_batch_id,uploaded_by,marketplace,sku,buyer,store_name,status,followup_attempts,followup_responded,followup_courier_notified,status_resi_detail->>masalah_kategori,status_resi_detail->>bermasalah_since';

async function dbGetTrackableOrders(table, filters = {}) {
  const cols = table === 'marketplace_orders' ? TR_LIST_COLUMNS_MARKETPLACE : TR_LIST_COLUMNS_DEFAULT;
  const PAGE = 1000;
  let all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    let q = _sb.from(table).select(cols).order('order_date', { ascending: false });
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

// Fetch 1 order lengkap termasuk status_resi_detail -- dipanggil hanya saat buka modal detail.
// Dipisah dari dbGetTrackableOrders supaya status_resi_detail (JSONB besar) tidak ikut
// ditarik saat list biasa → hemat egress signifikan.
async function dbGetOrderDetail(table, id) {
  const { data, error } = await _sb.from(table).select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null; // row not found — order baru belum dicek
    throw error;
  }
  return data;
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

// ── Akuisisi: query langsung dari CS Input (real-time, tanpa sync) ────────────
// Order data diambil dari all_orderan CS Input, tracking status dari akuisisi_orders.
// Ini menggantikan sync cron VPS yang sebelumnya copy data ke akuisisi_orders.
const _AUTO_EKSPEDISI = ['SPX','POS','JNE','J&T','SICEPAT','ANTERAJA','NINJA','IDEXPRESS','LION'];
const _CS_INPUT_URL = 'https://lqpcnzdssvvcayqvdjxs.supabase.co';
const _CS_INPUT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcGNuemRzc3Z2Y2F5cXZkanhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMTgxMDIsImV4cCI6MjA5MDU5NDEwMn0.4M4okAfJWhBD6AbL71utafrFL-ZgbVxcz3ANLnG_jH4';

function _extractEkspedisiCS(pembayaran, resi) {
  if (resi && /^MGT\d/i.test(String(resi).trim())) return 'SAP';
  if (!pembayaran) return '';
  const p = pembayaran.toUpperCase();
  const map = [['SPX','SPX'],['SICEPAT','SICEPAT'],['ANTERAJA','ANTERAJA'],['IDEXPRESS','IDEXPRESS'],['NINJA','NINJA'],['LION','LION'],['J&T','J&T'],['JNT','J&T'],['JNE','JNE'],['POS','POS'],['SAP','SAP']];
  for (const [k, v] of map) if (p.includes(k)) return v;
  return '';
}

async function dbGetAkuisisiOrders(dateFrom, dateTo) {
  // 0. Kick off SKU map fetch di background (jalan paralel dengan all_orderan fetch di bawah)
  const _skuMapPromise = dbGetSkuMap().catch(() => new Map());

  // Fallback: bersihkan kolom jumlah kalau SKU tidak ketemu di nama
  // "4 BOX NEW PRIMAGOLD" → "PRIMAGOLD", "*1 BOTOL NEW HERBAPIL*" → "HERBAPIL"
  function _cleanJumlah(jumlah) {
    return String(jumlah || '')
      .replace(/\*/g, '')
      .replace(/^\d+\s+(BOTOL|BOX|PCS|BTL)\s+(NEW\s+)?/i, '')
      .trim();
  }

  // 1. Fetch order data langsung dari CS Input all_orderan (real-time)
  // SKU map jalan paralel di background (_skuMapPromise), akan di-await setelah loop ini selesai
  const PAGE = 1000;
  let csOrders = [], offset = 0;
  while (true) {
    const params = [
      'select=id,tanggal,nama,hp,alamat,jumlah,quantity,total_pembayaran,pembayaran,kabupaten,cs,resi',
      'sumber=eq.cs_input',
      'tanggal=gte.' + dateFrom,
      'tanggal=lte.' + dateTo,
      'order=tanggal.desc,id.desc',
      'limit=' + PAGE,
      'offset=' + offset,
    ].join('&');
    const r = await fetch(_CS_INPUT_URL + '/rest/v1/all_orderan?' + params, {
      headers: { apikey: _CS_INPUT_KEY, Authorization: 'Bearer ' + _CS_INPUT_KEY },
    });
    if (!r.ok) throw new Error('CS Input query gagal: ' + r.status);
    const batch = await r.json();
    csOrders = csOrders.concat(batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  // Tunggu SKU map (sudah jalan paralel, biasanya sudah resolve sebelum loop selesai)
  const _skuMap = await _skuMapPromise;

  // Resolve produk dari segmen SKU di kolom nama, format: "NAMA PELANGGAN|SKU_BUNDLE|PROMO"
  // SKU bisa bundle: "HRB 1 MAK 1" = 1x Herbanesia + 1x Maksir
  function _csSkuToProduk(rawNama) {
    const sku = (rawNama || '').split('|')[1]?.trim() || '';
    if (!sku) return '';
    const tokens = [...sku.matchAll(/([A-Za-z]+)\s*(\d+)/g)];
    if (!tokens.length) return '';
    return tokens.map(([, code]) => _skuMap.get(code.toUpperCase()) || code.toUpperCase()).join(' + ');
  }

  // 2. Map ke shape yang sama dengan akuisisi_orders
  const mapped = csOrders.map(r => {
    const resiClean = r.resi ? String(r.resi).replace(/^'+/, '').trim() : '';
    const namaClean = (r.nama || '').split('|')[0].trim() || r.nama || '';
    const produkFromSku = _csSkuToProduk(r.nama);
    return {
      id: resiClean || ('IMP-' + r.id),
      _cs_id: r.id,
      order_date: r.tanggal,
      nama: namaClean,
      hp: r.hp || '',
      alamat: r.alamat || '',
      produk: produkFromSku || _cleanJumlah(r.jumlah),
      qty: r.quantity || 1,
      total: r.total_pembayaran || 0,
      ekspedisi: _extractEkspedisiCS(r.pembayaran, resiClean),
      kota_tujuan: r.kabupaten || '',
      cs_nama: r.cs || '',
      status_resi: null, status_resi_step: null, status_resi_updated_at: null,
      followup_attempts: 0, followup_responded: false, followup_courier_notified: false,
      masalah_kategori: null,
    };
  });

  // 3. Batch query akuisisi_orders untuk tracking status (skip IMP-)
  const resiIds = mapped.filter(o => !o.id.startsWith('IMP-')).map(o => o.id);
  if (resiIds.length) {
    const CHUNK = 500;
    const trackMap = {};
    for (let i = 0; i < resiIds.length; i += CHUNK) {
      const chunk = resiIds.slice(i, i + CHUNK);
      const { data } = await _sb.from('akuisisi_orders')
        .select('id,status_resi,status_resi_step,status_resi_updated_at,ekspedisi,followup_attempts,followup_responded,followup_courier_notified,status_resi_detail->>masalah_kategori,status_resi_detail->>bermasalah_since')
        .in('id', chunk);
      (data || []).forEach(t => { trackMap[t.id] = t; });
    }
    mapped.forEach(o => {
      const t = trackMap[o.id];
      if (!t) return;
      o.status_resi            = t.status_resi;
      o.status_resi_step       = t.status_resi_step;
      o.status_resi_updated_at = t.status_resi_updated_at;
      o.followup_attempts      = t.followup_attempts      || 0;
      o.followup_responded     = t.followup_responded     || false;
      o.followup_courier_notified = t.followup_courier_notified || false;
      o.masalah_kategori       = t.masalah_kategori       || null;
      o.bermasalah_since       = t.bermasalah_since       || null;
      if (t.ekspedisi) o.ekspedisi = t.ekspedisi; // prefer stored (mungkin sudah diedit manual)
    });

    // Final pass: order yang ekspedisinya tidak didukung auto-track
    // → paksa ke MANUAL, meski sudah ada di akuisisi_orders sebagai BELUM_DICEK
    mapped.forEach(o => {
      if (!o.status_resi || o.status_resi === 'BELUM_DICEK') {
        const isAkResi = /^AK/i.test(o.id);
        const isUnsupportedEksp = o.ekspedisi && !_AUTO_EKSPEDISI.includes(o.ekspedisi);
        if (isAkResi || isUnsupportedEksp) {
          o.status_resi = 'MANUAL';
          o.status_resi_step = 1;
        }
      }
    });
  }

  return mapped;
}

// ── Mapping kode SKU -> nama produk (copy manual dari ekosistem ValidasiOrder) ─
async function dbGetSkuMap() {
  const { data, error } = await _sb.from('sku_produk').select('kode,nama_produk');
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(r => map.set(String(r.kode).trim().toUpperCase(), r.nama_produk));
  return map;
}
