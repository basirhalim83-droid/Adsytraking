// FILE SEMENTARA - HAPUS SETELAH DIJALANKAN
const { sbFetch } = require('../lib/supabase-rest.js');

module.exports = async function handler(req, res) {
  const { s } = req.query;
  if (s !== 'adsy2026') return res.status(401).json({ error: 'unauthorized' });

  // Cek apakah kolom resi sudah ada dengan coba fetch
  const results = {};

  // Test akuisisi_orders.resi
  try {
    await sbFetch('akuisisi_orders?select=resi&limit=1');
    results.akuisisi_resi = 'sudah ada';
  } catch (e) {
    results.akuisisi_resi = `tidak ada: ${e.message}`;
  }

  // Test crm_orders.resi
  try {
    await sbFetch('crm_orders?select=resi&limit=1');
    results.crm_resi = 'sudah ada';
  } catch (e) {
    results.crm_resi = `tidak ada: ${e.message}`;
  }

  res.json({ ok: true, results, note: 'jalankan ?step=addcol untuk tambah kolom resi' });
};
