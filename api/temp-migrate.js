// FILE SEMENTARA - HAPUS SETELAH DIJALANKAN
const { sbFetch } = require('../lib/supabase-rest.js');

module.exports = async function handler(req, res) {
  const { s, step } = req.query;
  if (s !== 'adsy2026') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // step=1 : fix store_name dari upload_batches (per batch, kecil)
  if (step === '1') {
    try {
      const batches = await sbFetch('upload_batches?select=id,store_name&store_name=not.is.null&domain=eq.marketplace&limit=20');
      let fixed = 0;
      for (const batch of batches) {
        await sbFetch(
          `marketplace_orders?upload_batch_id=eq.${encodeURIComponent(batch.id)}&store_name=is.null`,
          { method: 'PATCH', body: JSON.stringify({ store_name: batch.store_name }) }
        );
        fixed++;
      }
      return res.json({ ok: true, step: 1, result: `${fixed} batches processed` });
    } catch (e) {
      return res.json({ ok: false, step: 1, error: e.message });
    }
  }

  // step=2/3/4 : clear status_resi_detail per 50 rows sekali panggil
  const tableMap = { '2': 'marketplace_orders', '3': 'akuisisi_orders', '4': 'crm_orders' };
  const table = tableMap[step];
  if (table) {
    try {
      // Fetch 50 ID dulu
      const rows = await sbFetch(`${table}?select=id&status_resi=eq.SAMPAI&status_resi_detail=not.is.null&limit=50`);
      if (rows.length === 0) {
        return res.json({ ok: true, step, table, result: 'semua sudah bersih!', done: true });
      }
      // Update by ID (cepat, pakai index)
      const ids = rows.map(r => r.id).join(',');
      await sbFetch(
        `${table}?id=in.(${ids})`,
        { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
      );
      return res.json({ ok: true, step, table, cleared: rows.length, done: false, msg: 'panggil lagi sampai done: true' });
    } catch (e) {
      return res.json({ ok: false, step, table, error: e.message });
    }
  }

  res.json({ usage: '?step=1 (fix store_name) | ?step=2 (marketplace) | ?step=3 (akuisisi) | ?step=4 (crm)' });
};
