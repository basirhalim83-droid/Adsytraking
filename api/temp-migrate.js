// FILE SEMENTARA - HAPUS SETELAH DIJALANKAN
const { sbFetch } = require('../lib/supabase-rest.js');

module.exports = async function handler(req, res) {
  const { s, step } = req.query;
  if (s !== 'adsy2026') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // step=env : cek semua env vars yang ada
  if (step === 'env') {
    const keys = Object.keys(process.env).filter(k =>
      k.includes('SUPA') || k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('DB_')
    );
    const result = {};
    keys.forEach(k => { result[k] = process.env[k] ? '✓ ada' : 'kosong'; });
    return res.json(result);
  }

  // step=sql : jalankan SQL langsung via pg
  if (step === 'sql') {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;
    if (!dbUrl) return res.json({ error: 'Tidak ada DATABASE_URL / POSTGRES_URL di env vars' });

    const { Client } = require('pg');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      const sqls = [
        `UPDATE marketplace_orders SET status_resi_detail = NULL WHERE status_resi = 'SAMPAI' AND status_resi_detail IS NOT NULL`,
        `UPDATE akuisisi_orders SET status_resi_detail = NULL WHERE status_resi = 'SAMPAI' AND status_resi_detail IS NOT NULL`,
        `UPDATE crm_orders SET status_resi_detail = NULL WHERE status_resi = 'SAMPAI' AND status_resi_detail IS NOT NULL`,
        `UPDATE marketplace_orders mo SET store_name = ub.store_name FROM upload_batches ub WHERE mo.upload_batch_id = ub.id AND mo.store_name IS NULL AND ub.store_name IS NOT NULL`,
      ];
      const results = [];
      for (const sql of sqls) {
        const r = await client.query(sql);
        results.push({ sql: sql.slice(0, 50), rowCount: r.rowCount });
      }
      await client.end();
      return res.json({ ok: true, results });
    } catch (e) {
      await client.end().catch(() => {});
      return res.json({ ok: false, error: e.message });
    }
  }

  res.json({ usage: '?step=env (cek env vars) | ?step=sql (jalankan SQL)' });
};
