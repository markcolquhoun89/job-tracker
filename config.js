/**
 * Environment Configuration
 * Load from environment variables or defaults
 * NEVER commit API keys - use .env files
 */

// Read credentials from Vite-exposed environment variables.
// For Cloudflare Pages, provide these as build-time env vars:
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

let _viteEnvUrl = '';
let _viteEnvKey = '';
try {
  _viteEnvUrl = import.meta?.env?.VITE_SUPABASE_URL || '';
  _viteEnvKey = import.meta?.env?.VITE_SUPABASE_ANON_KEY || '';
} catch (e) {
  // import.meta may not exist in some contexts
}

const DEFAULT_SUPABASE_URL = _viteEnvUrl || '';
const DEFAULT_SUPABASE_KEY = _viteEnvKey || '';

// Log what we found for debugging
console.log('[Config] Sources checked:', {
  viteUrl: _viteEnvUrl ? '✓ set' : '✗ empty',
  viteKey: _viteEnvKey ? '✓ set' : '✗ empty',
  finalUrl: DEFAULT_SUPABASE_URL ? DEFAULT_SUPABASE_URL.substring(0, 30) + '...' : '✗ EMPTY',
  finalKey: DEFAULT_SUPABASE_KEY ? '✓ set' : '✗ EMPTY'
});

export const SUPABASE_CONFIG = {
  url: DEFAULT_SUPABASE_URL,
  anonKey: DEFAULT_SUPABASE_KEY
};

// warn if we ended up with empty values after initialization
if (!DEFAULT_SUPABASE_URL || !DEFAULT_SUPABASE_KEY) {
  console.error('[Config] ❌ Supabase config is MISSING - app will not work');
  console.error('[Config] Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in environment variables');
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
