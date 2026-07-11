// Endpoint buat di-hit cron eksternal (cron-job.org dkk) tiap beberapa jam -- Vercel Hobby
// plan cuma dukung cron native 1x/hari. Auth via header "Authorization: Bearer <CRON_SECRET>"
// ATAU query "?secret=<CRON_SECRET>".
//
// Satu endpoint generik dipakai ketiga tabel (akuisisi/marketplace/crm) -- satu-satunya beda
// antar domain cuma nama tabel, checkResiAuto() udah rute otomatis per-row berdasar
// `ekspedisi` jadi gak perlu percabangan level kategori. Lihat plan: bab 4.
//
// Parameter opsional "?domain=akuisisi|marketplace|crm" (sesi 2026-07-11): kalau di-set,
// cuma proses tabel itu SENDIRIAN dalam invocation ini -- dipakai buat setup 3 cronjob
// terpisah di cron-job.org (1 job per domain, jadwal & timeout bisa diatur sendiri-sendiri,
// tabel yang lelet gak "makan" waktu tabel lain). Kalau parameter gak di-set, tetep loop
// ketiga tabel sekaligus kayak sebelumnya (backward-compatible buat job lama yang belum
// dipecah).

const { sbFetch } = require('../lib/supabase-rest');
const { checkResiAuto, AUTO_EKSPEDISI_LIST } = require('../lib/tracking-router');
const { STAGE_STEP } = require('../lib/stage-engine');
const { sendFonnteWA } = require('../lib/fonnte');

const TABLES = ['akuisisi_orders', 'marketplace_orders', 'crm_orders'];
const DOMAIN_TABLE_MAP = { akuisisi: 'akuisisi_orders', marketplace: 'marketplace_orders', crm: 'crm_orders' };
const PROBLEM_STAGES = ['BERMASALAH', 'RETUR'];
// cron-job.org plan yang dipake cuma dukung timeout maks 30 detik -- itu yang jadi batas
// keras (bukan maxDuration 60s Vercel). ROWS_PER_RUN_SINGLE dipakai kalau ?domain= di-set
// (1 tabel per invocation, jadi bisa lebih longgar); ROWS_PER_RUN_ALL kalau mode gabungan
// lama (3 tabel sekaligus, harus jauh lebih kecil biar semua kebagian dalam 30 detik).
const ROWS_PER_RUN_SINGLE = 100;
const ROWS_PER_RUN_ALL = 50;
const BATCH = 5;

// Order yang udah lebih tua dari ini TAPI masih belum SAMPAI/RETUR kemungkinan besar udah
// gak bakal update lagi (paket ilang/data usang) -- daripada di-cek cron terus-terusan
// selama-lamanya, cron berhenti otomatis nyentuh order setua ini. Datanya TETAP kesimpen &
// tetap bisa dibuka penuh di halaman Tracking (geser date-range picker), cuma gak lagi
// keiket jadwal cron -- kalau butuh cek ulang satu order tua, tetep bisa manual lewat
// tombol "Cek Ulang" di modal detail.
const STALE_CUTOFF_DAYS = 60;

function cutoffDateYMD() {
  const d = new Date();
  d.setDate(d.getDate() - STALE_CUTOFF_DAYS);
  return d.toISOString().slice(0, 10);
}

// Notif WA (ditunda -- lihat plan step 7): sendFonnteWA() sendiri no-op kalau FONNTE_TOKEN
// belum di-set, jadi aman dibiarkan wired di sini walau belum diaktifkan user.
// Rute target: akuisisi_orders/crm_orders -> cari WA CS yang namanya cocok (cs_nama, hasil
// parsing kolom Instruksi Pengiriman pas upload) di tabel team_members; kalau gak ketemu
// (atau buat marketplace_orders yang emang gak punya konsep "CS pribadi") fallback ke 1
// nomor ops via env var OPS_WA_NUMBER.
const OPS_WA_NUMBER = process.env.OPS_WA_NUMBER;

const TABLE_DOMAIN = { akuisisi_orders: 'akuisisi', marketplace_orders: 'marketplace', crm_orders: 'crm' };
const TABLE_SELECT = {
  akuisisi_orders: 'id,ekspedisi,kota_tujuan,status_resi,produk,cs_nama',
  marketplace_orders: 'id,ekspedisi,kota_tujuan,status_resi,produk',
  crm_orders: 'id,ekspedisi,kota_tujuan,status_resi,produk,cs_nama',
};

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

async function loadTeamLookup() {
  // { akuisisi: { 'nama cs (lowercase)': no_wa }, crm: { ... } }
  const lookup = { akuisisi: {}, crm: {} };
  try {
    const members = await sbFetch('team_members?select=domain,name,no_wa');
    (members || []).forEach(m => {
      if (!lookup[m.domain]) lookup[m.domain] = {};
      lookup[m.domain][normalizeName(m.name)] = m.no_wa;
    });
  } catch (e) {
    // Gak fatal -- fallback ke OPS_WA_NUMBER kalau gagal (mis. tabel belum ada karena
    // sql/004_team_members.sql belum dijalanin).
  }
  return lookup;
}

function resolveWaTarget(teamLookup, table, row) {
  const domain = TABLE_DOMAIN[table];
  const csWa = teamLookup[domain]?.[normalizeName(row.cs_nama)];
  return csWa || OPS_WA_NUMBER;
}

module.exports = async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.secret;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const domainParam = req.query.domain;
  let tablesToRun = TABLES;
  let rowsPerRun = ROWS_PER_RUN_ALL;
  if (domainParam) {
    const table = DOMAIN_TABLE_MAP[domainParam];
    if (!table) {
      res.status(400).json({ error: `domain tidak dikenal: "${domainParam}" -- pakai akuisisi/marketplace/crm` });
      return;
    }
    tablesToRun = [table];
    rowsPerRun = ROWS_PER_RUN_SINGLE;
  }

  const ekspedisiFilter = AUTO_EKSPEDISI_LIST.map(e => encodeURIComponent(e)).join(',');
  const cutoff = cutoffDateYMD();
  const teamLookup = await loadTeamLookup();
  let checked = 0, updated = 0, failed = 0, notified = 0;
  const errors = [];

  for (const table of tablesToRun) {
    let rows;
    try {
      rows = await sbFetch(
        `${table}?select=${TABLE_SELECT[table]}&ekspedisi=in.(${ekspedisiFilter})&status_resi=not.in.(SAMPAI,RETUR)&id=not.like.IMP-*&order_date=gte.${cutoff}&order=id&limit=${rowsPerRun}`
      );
    } catch (e) {
      errors.push(`${table}: gagal fetch (${e.message})`);
      continue;
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await Promise.all(batch.map(async row => {
        checked++;
        try {
          const { stage, detail } = await checkResiAuto(row);
          await sbFetch(`${table}?id=eq.${encodeURIComponent(row.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status_resi: stage,
              status_resi_step: STAGE_STEP[stage],
              status_resi_updated_at: new Date().toISOString(),
              status_resi_detail: detail,
            }),
          });
          updated++;

          // Notif cuma pas TRANSISI baru ke Bermasalah/Retur -- bukan re-notif tiap cron
          // kalau statusnya emang udah bermasalah dari run sebelumnya.
          const wasProblem = PROBLEM_STAGES.includes(row.status_resi);
          const isProblem = PROBLEM_STAGES.includes(stage);
          const waTarget = isProblem && !wasProblem ? resolveWaTarget(teamLookup, table, row) : null;
          if (waTarget) {
            const label = stage === 'RETUR' ? 'RETUR' : 'BERMASALAH';
            const msg = `⚠️ Order ${table.replace('_orders', '')} (resi ${row.id}, produk "${row.produk || '-'}") sekarang berstatus *${label}*. Cek di menu Tracking Resi ya.`;
            try { await sendFonnteWA(waTarget, msg); notified++; } catch { /* gak fatal -- status_resi tetep keupdate */ }
          }
        } catch (e) {
          failed++;
          errors.push(`${table}/${row.id}: ${e.message}`);
        }
      }));
    }
  }

  res.status(200).json({ checked, updated, failed, notified, staleCutoff: cutoff, errors: errors.slice(0, 20) });
};
