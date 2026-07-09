// Endpoint buat di-hit cron eksternal (cron-job.org dkk) tiap beberapa jam -- Vercel Hobby
// plan cuma dukung cron native 1x/hari. Auth via header "Authorization: Bearer <CRON_SECRET>"
// ATAU query "?secret=<CRON_SECRET>".
//
// Satu endpoint generik loop ketiga tabel (akuisisi/marketplace/crm) -- satu-satunya beda
// antar domain cuma nama tabel, checkResiAuto() udah rute otomatis per-row berdasar
// `ekspedisi` jadi gak perlu percabangan level kategori. Lihat plan: bab 4.

const { sbFetch } = require('../lib/supabase-rest');
const { checkResiAuto, AUTO_EKSPEDISI_LIST } = require('../lib/tracking-router');
const { STAGE_STEP } = require('../lib/stage-engine');
const { sendFonnteWA } = require('../lib/fonnte');

const TABLES = ['akuisisi_orders', 'marketplace_orders', 'crm_orders'];
const PROBLEM_STAGES = ['BERMASALAH', 'RETUR'];
const ROWS_PER_RUN = 300;
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

// Notif WA (ditunda -- lihat plan step 7): target sementara 1 nomor ops via env var
// OPS_WA_NUMBER. sendFonnteWA() sendiri no-op kalau FONNTE_TOKEN belum di-set, jadi aman
// dibiarkan wired di sini walau belum diaktifkan user.
const OPS_WA_NUMBER = process.env.OPS_WA_NUMBER;

module.exports = async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.secret;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const ekspedisiFilter = AUTO_EKSPEDISI_LIST.map(e => encodeURIComponent(e)).join(',');
  const cutoff = cutoffDateYMD();
  let checked = 0, updated = 0, failed = 0, notified = 0;
  const errors = [];

  for (const table of TABLES) {
    let rows;
    try {
      rows = await sbFetch(
        `${table}?select=id,ekspedisi,kota_tujuan,status_resi,produk&ekspedisi=in.(${ekspedisiFilter})&status_resi=not.in.(SAMPAI,RETUR)&id=not.like.IMP-*&order_date=gte.${cutoff}&order=id&limit=${ROWS_PER_RUN}`
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
          if (isProblem && !wasProblem && OPS_WA_NUMBER) {
            const label = stage === 'RETUR' ? 'RETUR' : 'BERMASALAH';
            const msg = `⚠️ Order ${table.replace('_orders', '')} (resi ${row.id}, produk "${row.produk || '-'}") sekarang berstatus *${label}*. Cek di menu Tracking Resi ya.`;
            try { await sendFonnteWA(OPS_WA_NUMBER, msg); notified++; } catch { /* gak fatal -- status_resi tetep keupdate */ }
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
