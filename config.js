/**
 * Environment Configuration
 * Load from environment variables or defaults
 * NEVER commit API keys - use .env files
 */

// Supabase configuration - environment variables handled by Vite
export const SUPABASE_CONFIG = {
  url: (typeof import !== 'undefined' && import.meta && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || window.ENV?.SUPABASE_URL || '',
  anonKey: (typeof import !== 'undefined' && import.meta && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || window.ENV?.SUPABASE_ANON_KEY || ''
};

const APP_CONFIG = {
  // Supabase
  SUPABASE_URL: (typeof import !== 'undefined' && import.meta && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || window.ENV?.SUPABASE_URL || 'https://stlzahmiovbrlnhzyuqw.supabase.co',
  SUPABASE_ANON_KEY: (typeof import !== 'undefined' && import.meta && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || window.ENV?.SUPABASE_ANON_KEY || 'sb_publishable_tXVGejkmyvWmX1K0V9btbQ_myc3Uw8Z',
  
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
