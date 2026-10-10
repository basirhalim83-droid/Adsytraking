// FILE SEMENTARA - HAPUS SETELAH DAPAT KEY-NYA
export default function handler(req, res) {
  const { s } = req.query;
  if (s !== 'adsy2026') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
