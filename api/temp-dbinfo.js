// FILE SEMENTARA - HAPUS SETELAH DIPAKAI
const { sbFetch } = require('../lib/supabase-rest.js');

module.exports = async function handler(req, res) {
  const { s } = req.query;
  if (s !== 'adsy2026') return res.status(401).json({ error: 'unauthorized' });

  const tables = ['akuisisi_orders', 'marketplace_orders', 'crm_orders', 'upload_batches'];
  const result = {};

  for (const t of tables) {
    try {
      // Count total rows
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/${t}?select=id`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'count=exact',
            'Range-Unit': 'items',
            Range: '0-0',
          }
        }
      );
      const contentRange = r.headers.get('content-range') || '';
      const total = contentRange.split('/')[1] || '?';

      // Count rows still with status_resi_detail
      let withDetail = '?';
      if (['akuisisi_orders', 'marketplace_orders', 'crm_orders'].includes(t)) {
        const r2 = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/${t}?select=id&status_resi_detail=not.is.null`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              Prefer: 'count=exact',
              'Range-Unit': 'items',
              Range: '0-0',
            }
          }
        );
        const cr2 = r2.headers.get('content-range') || '';
        withDetail = cr2.split('/')[1] || '?';
      }

      result[t] = { total_rows: total, rows_with_detail: withDetail };
    } catch (e) {
      result[t] = { error: e.message };
    }
  }

  res.json(result);
};
