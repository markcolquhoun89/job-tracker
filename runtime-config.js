// Static runtime config fallback for deployments where env injection/functions are unavailable.
window.RUNTIME_ENV = Object.assign({}, window.RUNTIME_ENV || {}, {
  VITE_SUPABASE_URL: 'https://stlzahmiovbrlnhzyuqw.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_tXVGejkmyvWmX1K0V9btbQ_myc3Uw8Z'
});
