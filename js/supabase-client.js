/**
 * Supabase Client Wrapper
 * Handles all communication with Supabase backend
 * Implements offline-first sync with local IndexedDB
 */

export class SupabaseClient {
  constructor(url, anonKey) {
    this.url = url;
    this.anonKey = anonKey;
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = null;
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
        this.refreshToken = session.refresh_token || null;
        this.expiresAt = session.expires_at || null;
        this.userId = session?.user?.id || null;

        const verified = await this.verifySession();
        if (verified) {
          console.log('[Supabase] Restored valid session for user:', this.userId);
          return true;
        }

        console.warn('[Supabase] Stored session is invalid or expired, clearing session');
        this.clearSession();
        return false;
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
          data: { display_name: displayName, role: 'engineer' },
          email_redirect_to: emailRedirectTo
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Signup failed');

      // Supabase signup returns user object (sometimes at top level, sometimes nested)
      const user = data.user || data;
      if (user && user.id) {
        this.token = data.access_token || (data.session && data.session.access_token) || null;
        this.refreshToken = data.refresh_token || (data.session && data.session.refresh_token) || null;
        this.expiresAt = data.expires_at || (data.session && data.session.expires_at) || null;
        this.userId = user.id;
        
        if (this.token) {
          this.persistSession(user);
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
        this.refreshToken = data.refresh_token || null;
        this.expiresAt = data.expires_at || null;
        this.userId = data.user.id;
        this.persistSession(data.user);
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
   * Sign out current user - clears session and triggers data wipe
   */
  async signOut() {
    console.log('[Supabase] Signing out user:', this.userId);
    this.clearSession();
    
    // Signal to app that user is logging out
    window.dispatchEvent(new Event('supabase:logout'));
    
    return { success: true };
  }

  /**
   * Clear session tokens
   */
  clearSession() {
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this.userId = null;
    localStorage.removeItem('nx_supabase_session');
  }

  /**
   * Revoke all other active sessions for this user (keeps current session alive).
   * Called automatically after sign-in to prevent shared-device data leaks.
   */
  async signOutOtherSessions() {
    if (!this.token) return;
    try {
      await fetch(`${this.url}/auth/v1/logout?scope=others`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        }
      });
      console.log('[Supabase] Other sessions revoked');
    } catch (e) {
      console.warn('[Supabase] Could not revoke other sessions (non-critical):', e.message);
    }
  }

  /**
   * Full logout - clears session and tells state to wipe data
   */
  async fullLogout() {
    console.log('[Supabase] Full logout - clearing all user data');
    await this.signOut();
    // Let listeners know to wipe all data
    window.dispatchEvent(new Event('supabase:wipe-data'));
    return { success: true };
  }

  persistSession(user) {
    localStorage.setItem('nx_supabase_session', JSON.stringify({
      access_token: this.token,
      refresh_token: this.refreshToken,
      expires_at: this.expiresAt,
      user
    }));
  }

  async verifySession() {
    if (!this.token) return false;

    try {
      const response = await fetch(`${this.url}/auth/v1/user`, {
        headers: {
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        }
      });

      if (response.ok) {
        const user = await response.json();
        this.userId = user?.id || this.userId;
        this.persistSession(user || { id: this.userId });
        return true;
      }

      if (response.status === 401 && this.refreshToken) {
        return await this.refreshSession();
      }

      // Explicit auth rejection — clear tokens (no data wipe; only user action triggers that)
      console.warn('[Supabase] Session explicitly rejected (status', response.status, ') - clearing tokens');
      this.clearSession();
      return false;
    } catch (error) {
      // Network error — could be offline. Keep stored session so local data stays intact.
      console.warn('[Supabase] Session verification network error:', error.message);
      if (!this.isOnline) {
        console.log('[Supabase] Offline — keeping stored session');
        return true;
      }
      // Online but fetch failed (e.g. DNS/timeout) — don't wipe, just skip verification
      this.clearSession();
      return false;
    }
  }

  async refreshSession() {
    if (!this.refreshToken) return false;

    try {
      const response = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey,
        },
        body: JSON.stringify({ refresh_token: this.refreshToken })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error_description || data.message || `HTTP ${response.status}`);
      }

      this.token = data.access_token;
      this.refreshToken = data.refresh_token || this.refreshToken;
      this.expiresAt = data.expires_at || this.expiresAt;
      this.userId = data?.user?.id || this.userId;
      this.persistSession(data.user || { id: this.userId });
      console.log('[Supabase] Session refreshed for user:', this.userId);
      return true;
    } catch (error) {
      console.warn('[Supabase] Session refresh failed:', error);
      this.clearSession();
      return false;
    }
  }

  async authorizedFetch(url, options = {}, retryOn401 = true) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    const headers = {
      ...(options.headers || {}),
      'apikey': this.anonKey,
      'Authorization': `Bearer ${this.token}`,
    };

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 && retryOn401) {
      const refreshed = await this.refreshSession();
      if (!refreshed) {
        throw new Error('HTTP 401: Session expired. Please sign in again.');
      }

      response = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          'apikey': this.anonKey,
          'Authorization': `Bearer ${this.token}`,
        }
      });
    }

    return response;
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

      const response = await this.authorizedFetch(url);

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
      const response = await this.authorizedFetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      // Supabase returns empty response by default for inserts
      console.log(`[Supabase] Inserted into ${table}`);
      return { success: true };
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

      const response = await this.authorizedFetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      console.log(`[Supabase] Updated ${table}`);
      return { success: true };
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

      const response = await this.authorizedFetch(url, {
        method: 'DELETE'
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

    const hasSession = await this.verifySession();
    if (!hasSession) {
      console.warn('[Supabase] Cannot process queue: no valid session');
      return;
    }

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
      isAuthenticated: !!this.token && !!this.userId,
      userId: this.userId,
      queuedOperations: this.syncQueue.length,
      hasRefreshToken: !!this.refreshToken,
      expiresAt: this.expiresAt
    };
  }
}

// Module exports
export let supabaseClient = null;

/**
 * Convenience initializer used by bridge or other modules.
 * @param {string} url
 * @param {string} anonKey
 * @returns {SupabaseClient}
 */
export function initSupabase(url, anonKey) {
  supabaseClient = new SupabaseClient(url, anonKey);
  return supabaseClient;
}


typeof window !== 'undefined' && (window.SupabaseClient = SupabaseClient); // keep for legacy compatibility

