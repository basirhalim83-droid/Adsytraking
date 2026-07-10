// Config kolom + parser Excel per domain. Port dari:
// - Marketplace-main/js/upload.js (MP_CONFIG, _findCol, parser harga/tanggal/qty)
// - Validasiorder-main/js/import.js (fix notasi ilmiah, safeParseInt)

// Exact match diutamakan dulu sebelum substring -- hindari bug kolom mirip ketuker
// (mis. Lazada "trackingCode" vs "cdTrackingCode").
function _findCol(headers, keywords) {
  const norm = h => String(h || '').toLowerCase().replace(/\s+/g, '');
  for (const k of keywords) {
    const kn = k.replace(/\s+/g, '');
    const exact = headers.find(h => norm(h) === kn);
    if (exact) return exact;
  }
  return headers.find(h => keywords.some(k => norm(h).includes(k.replace(/\s+/g, '')))) || null;
}

// Excel kadang nyimpen HP/resi angka panjang jadi notasi ilmiah ("6.28E+11").
function _fixSciNotation(val) {
  if (typeof val === 'number') return Math.round(val).toString();
  if (typeof val === 'string' && /\d+\.\d+E[+\-]\d+/i.test(val)) return Math.round(parseFloat(val)).toString();
  return String(val ?? '').trim();
}

function _safeParseInt(v) {
  const n = parseInt(String(v || '').replace(/\D/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 2147483647) return null;
  return n;
}

function _parsePrice(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return Math.round(val);
  let s = String(val).replace(/[^0-9.,]/g, '');
  if (!s) return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(',', '');
  return Math.round(parseFloat(s) || 0);
}

function _parseQty(val) {
  return parseInt(String(val || '1').replace(/[^0-9]/g, '')) || 1;
}

function _parseDate(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (!isNaN(raw) && raw > 1000) {
    return new Date((parseFloat(raw) - 25569) * 86400 * 1000).toISOString().slice(0, 10);
  }
  const cleaned = String(raw).replace(/\//g, '-').replace(/\./g, '-').split(' ')[0];
  const d = new Date(cleaned);
  return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

// Normalisasi kode ekspedisi -- dipakai lib/stage-engine.js buat rute ke Mengantar/POS/SPX.
function _normalizeEkspedisi(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('-')) s = s.split('-').pop().trim(); // Shopee: "Reguler (Cashless)-SPX Standard"
  const up = s.toUpperCase().replace(/-MENG(ANTAR)?$/i, ''); // "-MENG" = penanda booking via aggregator Mengantar
  if (up.includes('SPX'))      return 'SPX';
  if (up.includes('POS'))      return 'POS';
  if (up.includes('JNE'))      return 'JNE';
  if (up.includes('J&T') || up.includes('JNT')) return 'J&T';
  if (up.includes('ANTERAJA')) return 'ANTERAJA';
  if (up.includes('SICEPAT'))  return 'SICEPAT';
  if (up.includes('NINJA'))    return 'NINJA';
  if (up.includes('ID EXPRESS') || up.includes('IDEXPRESS') || up.includes('IDX')) return 'IDEXPRESS';
  if (up.includes('LION'))     return 'LION';
  if (up.includes('WAHANA'))   return 'WAHANA';
  if (up.includes('SAP'))      return 'SAP';
  if (up.includes('TIKI'))     return 'TIKI';
  return up;
}

// ── Marketplace (Shopee/TikTok/Lazada) -- port near-verbatim dari Marketplace-main ─
const MP_CONFIG = {
  shopee: {
    label: 'Shopee',
    detect: h => h.some(x => x.includes('no. pesanan') || x.includes('sku induk') || x.includes('nama produk')),
    transposed: false,
    map: {
      id: h => _findCol(h, ['no. resi', 'nomor resi', 'resi', 'nomor lacak']),
      date: h => _findCol(h, ['waktu pesanan dibuat']),
      sku: h => _findCol(h, ['nomor referensi sku']),
      produk: h => _findCol(h, ['nama produk']),
      qty: h => _findCol(h, ['jumlah']),
      unit_price: h => _findCol(h, ['harga awal']),
      discount: h => _findCol(h, ['diskon dari penjual', 'diskon penjual']),
      status: h => _findCol(h, ['status pesanan']),
      ekspedisi: h => _findCol(h, ['opsi pengiriman']),
      buyer: h => _findCol(h, ['username (pembeli)', 'username']),
      kota_tujuan: h => _findCol(h, ['kota/kabupaten']),
    },
  },
  tiktok: {
    label: 'TikTok Shop',
    detect: h => h.some(x => x.includes('order id') || x.includes('seller sku') || x.includes('order status')),
    transposed: false,
    map: {
      id: h => _findCol(h, ['tracking id']),
      date: h => _findCol(h, ['created time']),
      sku: h => _findCol(h, ['seller sku']),
      produk: h => _findCol(h, ['product name']),
      qty: h => _findCol(h, ['quantity']),
      unit_price: h => _findCol(h, ['sku unit original price']),
      discount: h => _findCol(h, ['sku seller discount', 'seller discount']),
      status: h => _findCol(h, ['order status']),
      ekspedisi: h => _findCol(h, ['shipping provider name']),
      buyer: h => _findCol(h, ['buyer username']),
      kota_tujuan: h => _findCol(h, ['regency and city']),
    },
  },
  lazada: {
    label: 'Lazada',
    detect: h => h.some(x => x.includes('ordernumber') || x.includes('sellersku') || x.includes('itemname')),
    transposed: false,
    map: {
      id: h => _findCol(h, ['trackingcode']),
      date: h => _findCol(h, ['createtime']),
      sku: h => _findCol(h, ['sellersku']),
      produk: h => _findCol(h, ['itemname']),
      qty: h => null,
      unit_price: h => _findCol(h, ['unitprice']),
      status: h => _findCol(h, ['status']),
      ekspedisi: h => _findCol(h, ['shippingprovider']),
      buyer: h => _findCol(h, ['customername']),
      kota_tujuan: h => _findCol(h, ['shippingcity']),
    },
  },
};

function _detectMarketplace(headers) {
  const h = headers.map(x => String(x || '').toLowerCase());
  for (const [mp, cfg] of Object.entries(MP_CONFIG)) {
    if (cfg.detect(h)) return mp;
  }
  return null;
}

function _parseMarketplaceRows(rows, mp, mapping) {
  return rows.map((row, i) => {
    const get = col => col ? (row[col] ?? '') : '';
    const skuRaw = String(get(mapping.sku) || '').trim();
    const qtyRaw = mapping.qty ? _parseQty(get(mapping.qty)) : 1;
    const unit_price = _parsePrice(get(mapping.unit_price));
    const discount = mapping.discount ? _parsePrice(get(mapping.discount)) : 0;
    const total = Math.max(0, (unit_price * qtyRaw) - discount);
    const rawDate = get(mapping.date);
    return {
      id: _fixSciNotation(get(mapping.id) || ('IMP-' + mp + '-' + i)) || ('IMP-' + mp + '-' + i),
      marketplace: mp,
      order_date: _parseDate(rawDate),
      sku: skuRaw,
      produk: String(get(mapping.produk) || '').trim(),
      qty: qtyRaw,
      unit_price,
      total,
      status: String(get(mapping.status) || '').trim(),
      buyer: String(get(mapping.buyer) || '').trim(),
      ekspedisi: _normalizeEkspedisi(get(mapping.ekspedisi)),
      kota_tujuan: String(get(mapping.kota_tujuan) || '').trim(),
    };
  }).filter(r => r.id && r.id.trim());
}

// ── Akuisisi & CRM -- format sendiri, gak ada legacy yg perlu dideteksi otomatis ──
function _makeSimpleOrderConfig(domainLabel) {
  return {
    label: domainLabel,
    map: {
      id: h => _findCol(h, ['no. resi', 'nomor resi', 'resi', 'awb']),
      date: h => _findCol(h, ['tanggal', 'tgl']),
      nama: h => _findCol(h, ['nama', 'nama pelanggan', 'customer']),
      hp: h => _findCol(h, ['no hp', 'no telpon', 'no telepon', 'hp', 'whatsapp', 'no wa', 'nomor hp']),
      alamat: h => _findCol(h, ['alamat']),
      kota_tujuan: h => _findCol(h, ['kabupaten', 'kota', 'kota/kabupaten', 'kota tujuan']),
      produk: h => _findCol(h, ['produk', 'nama produk', 'jumlah pesanan']),
      qty: h => _findCol(h, ['qty', 'quantity', 'jumlah']),
      total: h => _findCol(h, ['total pembayaran', 'total', 'harga', 'nominal']),
      pembayaran: h => _findCol(h, ['pembayaran', 'metode pembayaran']),
      ekspedisi: h => _findCol(h, ['ekspedisi', 'kurir', 'expedisi']),
      instruksi: h => _findCol(h, ['instruksi pengiriman', 'instruksi']),
    },
  };
}
const AKUISISI_CONFIG = _makeSimpleOrderConfig('Akuisisi');
const CRM_CONFIG = _makeSimpleOrderConfig('CRM');

// Format baku: "Pengirim CS <nama CS> / Adv. <nama ADV> / <nama ADM>" (pola sama
// kayak ValidasiOrder-main/app.html) -- kita cuma butuh nama CS-nya (segmen pertama),
// dipakai buat rute notif WA ke CS yang pegang order itu (lihat team_members).
function extractCsName(instruksi) {
  const parts = String(instruksi || '').split('/');
  return (parts[0] || '')
    .replace(/^Pengirim\s+CS\s+/i, '')
    .replace(/^Pengirim\s+/i, '')
    .replace(/^CS\s+/i, '')
    .trim();
}

function _parseSimpleOrderRows(rows, mapping, domain) {
  return rows.map((row, i) => {
    const get = col => col ? (row[col] ?? '') : '';
    const rawDate = get(mapping.date);
    const ekspedisiRaw = get(mapping.ekspedisi) || get(mapping.pembayaran);
    return {
      id: _fixSciNotation(get(mapping.id) || ('IMP-' + domain + '-' + i)) || ('IMP-' + domain + '-' + i),
      order_date: _parseDate(rawDate),
      nama: String(get(mapping.nama) || '').trim(),
      hp: _fixSciNotation(get(mapping.hp)),
      alamat: String(get(mapping.alamat) || '').trim(),
      kota_tujuan: String(get(mapping.kota_tujuan) || '').trim(),
      produk: String(get(mapping.produk) || '').trim(),
      qty: _safeParseInt(get(mapping.qty)) || 1,
      total: _parsePrice(get(mapping.total)),
      ekspedisi: _normalizeEkspedisi(ekspedisiRaw),
      cs_nama: extractCsName(get(mapping.instruksi)),
    };
  }).filter(r => r.id && r.id.trim());
}

// ── Baca sheet Excel -- handle normal & transposed (TikTok) ────────────────────
function _readSheet(ws, isTransposed) {
  if (!isTransposed) {
    const headers = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0]?.map(String) || [];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return { headers, rows };
  }
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = raw.map(r => String(r[0] || ''));
  const numRecords = Math.max(...raw.map(r => r.length)) - 1;
  const rows = [];
  for (let col = 1; col <= numRecords; col++) {
    const obj = {};
    raw.forEach((r, i) => { obj[headers[i]] = r[col] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}
