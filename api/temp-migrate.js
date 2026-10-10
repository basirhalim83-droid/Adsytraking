// FILE SEMENTARA - HAPUS SETELAH DIJALANKAN
const { sbFetch } = require('../lib/supabase-rest.js');

module.exports = async function handler(req, res) {
  const { s, step } = req.query;
  if (s !== 'adsy2026') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // step=1 : fix store_name dari upload_batches
  if (step === '1') {
    try {
      const batches = await sbFetch('upload_batches?select=id,store_name&store_name=not.is.null&domain=eq.marketplace');
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

  // step=2 : clear status_resi_detail marketplace SAMPAI
  if (step === '2') {
    try {
      await sbFetch(
        'marketplace_orders?status_resi=eq.SAMPAI&status_resi_detail=not.is.null',
        { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
      );
      return res.json({ ok: true, step: 2, result: 'marketplace done' });
    } catch (e) {
      return res.json({ ok: false, step: 2, error: e.message });
    }
  }

  // step=3 : clear status_resi_detail akuisisi SAMPAI
  if (step === '3') {
    try {
      await sbFetch(
        'akuisisi_orders?status_resi=eq.SAMPAI&status_resi_detail=not.is.null',
        { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
      );
      return res.json({ ok: true, step: 3, result: 'akuisisi done' });
    } catch (e) {
      return res.json({ ok: false, step: 3, error: e.message });
    }
  }

  // step=4 : clear status_resi_detail crm SAMPAI
  if (step === '4') {
    try {
      await sbFetch(
        'crm_orders?status_resi=eq.SAMPAI&status_resi_detail=not.is.null',
        { method: 'PATCH', body: JSON.stringify({ status_resi_detail: null }) }
      );
      return res.json({ ok: true, step: 4, result: 'crm done' });
    } catch (e) {
      return res.json({ ok: false, step: 4, error: e.message });
    }
  }

  res.json({ usage: 'tambahkan ?step=1, ?step=2, ?step=3, atau ?step=4' });
};
