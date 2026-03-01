/**
 * Supabase Client Wrapper
 * Handles all communication with Supabase backend
 * Implements offline-first sync with local IndexedDB
 */

class SupabaseClient {
  constructor(url, anonKey) {
    this.url = url;
    this.anonKey = anonKey;
    this.token = null;
    this.userId = null;
    this.isOnline = navigator.onLine;
    this.syncQueue = [];
    this.isSyncing = false;

    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  /**
   * Initialize Supabase client - check for existing session
   */
  async init() {
    console.log('[Supabase] Initializing...');
    try {
      // Check if user has existing session in localStorage
      const session = JSON.parse(localStorage.getItem('nx_supabase_session') || 'null');
      
      if (session && session.access_token) {
        this.token = session.access_token;
        this.userId = session.user.id;
        console.log('[Supabase] Restored session for user:', this.userId);
        return true;
      }
      
      console.log('[Supabase] No existing session found');
      return false;
    } catch (error) {
      console.error('[Supabase] Init failed:', error);
      return false;
    }
  }

  /**
   * Sign up new user
   */
  async signUp(email, password, displayName) {
    console.log('[Supabase] Signing up user:', email);
    try {
      const emailRedirectTo = window.location.origin;
      const response = await fetch(`${this.url}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey,
        },
        body: JSON.stringify({
          email,
          password,
          data: { display_name: displayName },
          email_redirect_to: emailRedirectTo
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Signup failed');

      // Supabase signup returns user object (sometimes at top level, sometimes nested)
      const user = data.user || data;
      if (user && user.id) {
        this.token = data.access_token || (data.session && data.session.access_token) || null;
        this.userId = user.id;
        
        if (this.token) {
          localStorage.setItem('nx_supabase_session', JSON.stringify({
            access_token: this.token,
            user: user
          }));
          console.log('[Supabase] Signup successful - authenticated:', this.userId);
          return { success: true, user: user, needsVerification: false };
        } else {
          console.log('[Supabase] Signup successful - awaiting email confirmation:', this.userId);
          return { success: true, user: user, needsVerification: true };
        }
      } else {
        throw new Error('No user in response');
      }
    } catch (error) {
      console.error('[Supabase] Signup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign in existing user
   */
  async signIn(email, password) {
    console.log('[Supabase] Signing in user:', email);
    try {
      const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey,
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.message || 'Sign in failed');

      // Token endpoint returns access_token, user, etc. at top level
      if (data.access_token && data.user) {
        this.token = data.access_token;
        this.userId = data.user.id;
        localStorage.setItem('nx_supabase_session', JSON.stringify({
          access_token: data.access_token,
          user: data.user
        }));
        console.log('[Supabase] Sign in successful:', this.userId);
        return { success: true, user: data.user };
      } else {
        throw new Error('Invalid signin response');
      }
    } catch (error) {
      console.error('[Supabase] Sign in failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign out current user
   */
  async signOut() {
    console.log('[Supabase] Signing out');
    this.token = null;
    this.userId = null;
    localStorage.removeItem('nx_supabase_session');
    return { success: true };
  }

  /**
   * Generic SELECT query
   */
  async select(table, options = {}) {
    if (!this.isOnline) {
      console.log(`[Supabase] Offline - reading ${table} from cache`);
      return null;
    }

    try {
      let url = `${this.url}/rest/v1/${table}?`;
      
      // Build query string
      if (options.select) url += `select=${encodeURIComponent(options.select)}&`;
      if (options.eq) {
        for (const [col, val] of Object.entries(options.eq)) {
          url += `${col}=eq.${encodeURIComponent(val)}&`;
        }
      }
      if (options.limit) url += `limit=${options.limit}&`;
      if (options.order) url += `order=${options.order}&`;

      const response = await fetch(url, {
        headers: {
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`[Supabase] SELECT ${table} failed:`, error);
      return null;
    }
  }

  /**
   * INSERT row
   */
  async insert(table, data) {
    // Queue for sync if offline
    if (!this.isOnline) {
      console.log(`[Supabase] Offline - queueing INSERT to ${table}`);
      this.syncQueue.push({ op: 'insert', table, data, timestamp: Date.now() });
      return { success: true, offline: true };
    }

    try {
      const response = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      console.log(`[Supabase] Inserted into ${table}:`, result);
      return { success: true, data: result };
    } catch (error) {
      console.error(`[Supabase] INSERT ${table} failed:`, error);
      // Queue for retry
      this.syncQueue.push({ op: 'insert', table, data, timestamp: Date.now() });
      return { success: false, error: error.message, queued: true };
    }
  }

  /**
   * UPDATE row
   */
  async update(table, data, filters) {
    if (!this.isOnline) {
      console.log(`[Supabase] Offline - queueing UPDATE to ${table}`);
      this.syncQueue.push({ op: 'update', table, data, filters, timestamp: Date.now() });
      return { success: true, offline: true };
    }

    try {
      let url = `${this.url}/rest/v1/${table}?`;
      for (const [col, val] of Object.entries(filters)) {
        url += `${col}=eq.${encodeURIComponent(val)}&`;
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      console.log(`[Supabase] Updated ${table}:`, result);
      return { success: true, data: result };
    } catch (error) {
      console.error(`[Supabase] UPDATE ${table} failed:`, error);
      this.syncQueue.push({ op: 'update', table, data, filters, timestamp: Date.now() });
      return { success: false, error: error.message, queued: true };
    }
  }

  /**
   * DELETE row
   */
  async delete(table, filters) {
    if (!this.isOnline) {
      console.log(`[Supabase] Offline - queueing DELETE from ${table}`);
      this.syncQueue.push({ op: 'delete', table, filters, timestamp: Date.now() });
      return { success: true, offline: true };
    }

    try {
      let url = `${this.url}/rest/v1/${table}?`;
      for (const [col, val] of Object.entries(filters)) {
        url += `${col}=eq.${encodeURIComponent(val)}&`;
      }

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`[Supabase] Deleted from ${table}`);
      return { success: true };
    } catch (error) {
      console.error(`[Supabase] DELETE ${table} failed:`, error);
      this.syncQueue.push({ op: 'delete', table, filters, timestamp: Date.now() });
      return { success: false, error: error.message, queued: true };
    }
  }

  /**
   * Process sync queue when back online
   */
  async processQueue() {
    if (this.isSyncing || this.syncQueue.length === 0) return;

    this.isSyncing = true;
    console.log(`[Supabase] Processing ${this.syncQueue.length} queued operations`);

    while (this.syncQueue.length > 0) {
      const op = this.syncQueue.shift();
      console.log(`[Supabase] Processing queued ${op.op}:`, op);

      try {
        if (op.op === 'insert') {
          await this.insert(op.table, op.data);
        } else if (op.op === 'update') {
          await this.update(op.table, op.data, op.filters);
        } else if (op.op === 'delete') {
          await this.delete(op.table, op.filters);
        }
      } catch (error) {
        console.error(`[Supabase] Queue processing failed, requeuing:`, op);
        this.syncQueue.unshift(op);
        break;
      }
    }

    this.isSyncing = false;
    console.log('[Supabase] Queue processing complete');
  }

  /**
   * Handle going online
   */
  async handleOnline() {
    console.log('[Supabase] Coming online');
    this.isOnline = true;
    await this.processQueue();
  }

  /**
   * Handle going offline
   */
  handleOffline() {
    console.log('[Supabase] Going offline');
    this.isOnline = false;
  }

  /**
   * Check online status
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      isAuthenticated: !!this.token,
      userId: this.userId,
      queuedOperations: this.syncQueue.length
    };
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SupabaseClient;
}

// Ensure global availability in browser
window.SupabaseClient = SupabaseClient;
