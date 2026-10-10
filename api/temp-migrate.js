// FILE SEMENTARA - HAPUS SETELAH DIJALANKAN
const { sbFetch } = require('../lib/supabase-rest.js');

module.exports = async function handler(req, res) {
  const { s } = req.query;
  if (s !== 'adsy2026') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const results = {};

  // SQL 1: Fix store_name NULL di marketplace_orders dari upload_batches
  try {
    const batches = await sbFetch('upload_batches?select=id,store_name&store_name=not.is.null&domain=eq.marketplace');
    let fixed1 = 0;
    for (const batch of batches) {
      await sbFetch(
        `marketplace_orders?upload_batch_id=eq.${batch.id}&store_name=is.null`,
        { method: 'PATCH', body: JSON.stringify({ store_name: batch.store_name }) }
      );
      fixed1++;
    }
    results.fix_store_name = `${batches.length} batches processed`;
  } catch (e) {
    results.fix_store_name = `ERROR: ${e.message}`;
  }

  // SQL 2: Clear status_resi_detail order yang sudah SAMPAI (semua kurir, bukan hanya SPX)
  try {
    const rows = await sbFetch('marketplace_orders?select=id&status_resi=eq.SAMPAI&status_resi_detail=not.is.null&limit=500');
    for (const row of rows) {
      await sbFetch(
        `marketplace_orders?id=eq.${row.id}`,
        { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
      );
    }
    results.clear_detail = `${rows.length} rows cleared`;
  } catch (e) {
    results.clear_detail = `ERROR: ${e.message}`;
  }

  res.json({ ok: true, results });
};
