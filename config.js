/**
 * Environment Configuration
 * Load from environment variables or defaults
 * NEVER commit API keys - use .env files
 */

// Supabase configuration - environment variables handled by Vite
// Safely read `import.meta.env` without causing syntax errors in non-module contexts
let _viteEnvUrl = '';
let _viteEnvKey = '';
let _rawEnvUrl = '';
let _rawEnvKey = '';
try {
  // Vite only exposes env vars prefixed with VITE_.
  // developers who set SUPABASE_URL / SUPABASE_ANON_KEY directly
  // will not see them during development unless they are added to
  // `.env` with the VITE_ prefix or injected via window.ENV.
  _viteEnvUrl = import.meta?.env?.VITE_SUPABASE_URL || '';
  _viteEnvKey = import.meta?.env?.VITE_SUPABASE_ANON_KEY || '';
  _rawEnvUrl = import.meta?.env?.SUPABASE_URL || '';
  _rawEnvKey = import.meta?.env?.SUPABASE_ANON_KEY || '';
} catch (e) {
  // import.meta may not exist; fall back later
}

if ((_rawEnvUrl || _rawEnvKey) && !_viteEnvUrl && !_viteEnvKey) {
  console.warn(
    '[Config] Detected SUPABASE_URL/SUPABASE_ANON_KEY without VITE_ prefix. ' +
    'Rename them to VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY or configure via window.ENV.'
  );
}

// Production defaults - we no longer ship any hard‑coded project credentials.
// The values must come from environment variables (Vite `import.meta.env` or
// `window.ENV` for Cloudflare Pages).  Leaving these blank will trigger a
// validation error so the developer is forced to configure them properly.
const DEFAULT_SUPABASE_URL = _viteEnvUrl || window.ENV?.SUPABASE_URL || '';
const DEFAULT_SUPABASE_KEY = _viteEnvKey || window.ENV?.SUPABASE_ANON_KEY || '';

export const SUPABASE_CONFIG = {
  url: DEFAULT_SUPABASE_URL,
  anonKey: DEFAULT_SUPABASE_KEY
};

const APP_CONFIG = {
  // Supabase
  SUPABASE_URL: DEFAULT_SUPABASE_URL,
  SUPABASE_ANON_KEY: DEFAULT_SUPABASE_KEY,
  
  // Feature flags
  CLOUD_SYNC_ENABLED: true,
  OFFLINE_FIRST: true,
  
  // Environment
  ENVIRONMENT: 'production',
  IS_PRODUCTION: true,
  
  // App version
  APP_VERSION: '2.0.0',
  
  // Sync settings
  SYNC_INTERVAL: 30000, // 30 seconds
  SYNC_TIMEOUT: 10000, // 10 second timeout
  
  // Storage
  USE_INDEXEDDB: true,
  USE_LOCALSTORAGE: true,
  
  // Logging
  DEBUG: false,
  
  /**
   * Validate configuration
   */
  validate() {
    const errors = [];
    
    if (!this.SUPABASE_URL) {
      errors.push('SUPABASE_URL is required');
    }
    if (!this.SUPABASE_ANON_KEY) {
      errors.push('SUPABASE_ANON_KEY is required');
    }
    
    if (errors.length > 0) {
      console.error('[Config] Validation failed:', errors);
      return false;
    }
    
    console.log('[Config] Validated successfully');
    return true;
  },
  
  /**
   * Log configuration (safely)
   */
  log() {
    console.log('[Config] Configuration:', {
      ENVIRONMENT: this.ENVIRONMENT,
      CLOUD_SYNC_ENABLED: this.CLOUD_SYNC_ENABLED,
      OFFLINE_FIRST: this.OFFLINE_FIRST,
      APP_VERSION: this.APP_VERSION,
      DEBUG: this.DEBUG,
      SUPABASE_URL: this.SUPABASE_URL ? this.SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET',
      SUPABASE_ANON_KEY: this.SUPABASE_ANON_KEY ? this.SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'NOT SET'
    });
  }
};

// Export for use
if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = APP_CONFIG;
}
