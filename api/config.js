// Public configuration for the browser. The anon key is designed to be public;
// access to data is enforced by row level security in Supabase.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    features: {
      ai: !!process.env.ANTHROPIC_API_KEY,
      gmail: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      commas: !!process.env.COMMAS_API_KEY,
      files: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
}
