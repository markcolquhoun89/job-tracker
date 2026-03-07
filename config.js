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

  // debug helper: log entire environment in development so users can
  // spot missing variables quickly.
  if (import.meta.env && import.meta.env.MODE === 'development') {
    console.debug('[Config] import.meta.env dump:', import.meta.env);
  }
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
// allow manual configuration stored in localStorage for development or
// when environment variables are not available (e.g. static build).
const _storageUrl = (typeof localStorage !== 'undefined') ? localStorage.getItem('nx_supabase_url') || '' : '';
const _storageKey = (typeof localStorage !== 'undefined') ? localStorage.getItem('nx_supabase_key') || '' : '';

const DEFAULT_SUPABASE_URL = _viteEnvUrl || window.ENV?.SUPABASE_URL || _storageUrl || '';
const DEFAULT_SUPABASE_KEY = _viteEnvKey || window.ENV?.SUPABASE_ANON_KEY || _storageKey || '';

export const SUPABASE_CONFIG = {
  url: DEFAULT_SUPABASE_URL,
  anonKey: DEFAULT_SUPABASE_KEY
};

// warn if we ended up with empty values after initialization
if (!DEFAULT_SUPABASE_URL || !DEFAULT_SUPABASE_KEY) {
  console.warn('[Config] Supabase config is empty or incomplete:', {
    DEFAULT_SUPABASE_URL,
    DEFAULT_SUPABASE_KEY: DEFAULT_SUPABASE_KEY ? '***' : '(empty)'
  });
}

/**
 * Save Supabase configuration to localStorage (runtime override).
 * Also updates global APP_CONFIG and SUPABASE_CONFIG.
 * @param {string} url
 * @param {string} anonKey
 */
export function saveSupabaseConfig(url, anonKey) {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('nx_supabase_url', url);
      localStorage.setItem('nx_supabase_key', anonKey);
    } catch (e) {
      console.warn('[Config] Failed to write supabase config to storage', e);
    }
  }
  SUPABASE_CONFIG.url = url;
  SUPABASE_CONFIG.anonKey = anonKey;
  if (APP_CONFIG) {
    APP_CONFIG.SUPABASE_URL = url;
    APP_CONFIG.SUPABASE_ANON_KEY = anonKey;
  }
}

// Log configuration when running locally to aid debugging
if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'development') {
  APP_CONFIG.log && APP_CONFIG.log();
}

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
