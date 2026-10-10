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
        `marketplace_orders?upload_batch_id=eq.${encodeURIComponent(batch.id)}&store_name=is.null`,
        { method: 'PATCH', body: JSON.stringify({ store_name: batch.store_name }) }
      );
      fixed1++;
    }
    results.fix_store_name = `${fixed1} batches processed`;
  } catch (e) {
    results.fix_store_name = `ERROR: ${e.message}`;
  }

  // SQL 2: Clear status_resi_detail order yang sudah SAMPAI — bulk sekaligus
  try {
    await sbFetch(
      'marketplace_orders?status_resi=eq.SAMPAI&status_resi_detail=not.is.null',
      { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
    );
    results.clear_detail = 'done (bulk update)';
  } catch (e) {
    results.clear_detail = `ERROR: ${e.message}`;
  }

  // SQL 2b: akuisisi_orders juga
  try {
    await sbFetch(
      'akuisisi_orders?status_resi=eq.SAMPAI&status_resi_detail=not.is.null',
      { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
    );
    results.clear_detail_akuisisi = 'done (bulk update)';
  } catch (e) {
    results.clear_detail_akuisisi = `ERROR: ${e.message}`;
  }

  // SQL 2c: crm_orders juga
  try {
    await sbFetch(
      'crm_orders?status_resi=eq.SAMPAI&status_resi_detail=not.is.null',
      { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
    );
    results.clear_detail_crm = 'done (bulk update)';
  } catch (e) {
    results.clear_detail_crm = `ERROR: ${e.message}`;
  }

  res.json({ ok: true, results });
};
