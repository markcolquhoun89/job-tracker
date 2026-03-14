/**
 * Integration Bridge
 * Connects the new modular system with existing app.js code
 *
 * Acts as the orchestrator during startup and provides compatibility
 * helpers used by legacy code paths. Exports initialization routines
 * for the ES module world.
 */

import { JobTrackerDB } from './database.js';
import { JobTrackerState } from './state.js';
import { SupabaseClient, initSupabase, supabaseClient } from './supabase-client.js';
import { SyncEngine } from './sync.js';
import { SUPABASE_CONFIG } from '../config.js';

export let modulesReady = false;

/**
 * Core initialization - should only be called once
 */
export async function initModules() {
    // prevent double-initialization
    if (modulesReady) {
        console.log('[Bridge] Modules already initialized, skipping');
        return !!window.supabaseClient?.getStatus?.().isAuthenticated;
    }

    console.log('[Bridge] Initializing modular system...');
    let isUserAuthenticated = false;
    
    try {
        // Initialize database
        console.log('[Bridge] Initializing database...');
        await JobTrackerDB.db.init();
        console.log('✓ Database initialized');
        
        // Initialize state
        console.log('[Bridge] Initializing state...');
        await JobTrackerState.init();
        // Keep legacy/global state reference for sync and inline handlers.
        window.state = JobTrackerState;
        console.log('✓ State loaded');
        
        // Initialize Supabase client if configured
        console.log('[Bridge] Checking Supabase config...', {
            hasUrl: !!SUPABASE_CONFIG?.url,
            hasKey: !!SUPABASE_CONFIG?.anonKey,
            url: SUPABASE_CONFIG?.url?.substring(0, 30) + '...' || 'MISSING'
        });
        if (!SUPABASE_CONFIG?.url || !SUPABASE_CONFIG?.anonKey) {
            // additional debug output
            console.warn('[Bridge] SUPABASE_CONFIG object:', SUPABASE_CONFIG);
        }
        
        if (SUPABASE_CONFIG?.url && SUPABASE_CONFIG?.anonKey) {
            console.log('[Bridge] Initializing Supabase client...');
            // assign singleton via helper
            const client = initSupabase(
                SUPABASE_CONFIG.url,
                SUPABASE_CONFIG.anonKey
            );
            
            // expose globally for modals.js and other modules
            window.supabaseClient = client;
            console.log('✓ Supabase client exposed globally');
            
            // Wrap init with timeout so it doesn't hang forever
            try {
                const initPromise = client.init();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Supabase auth check timeout')), 5000)
                );
                
                const hasSession = await Promise.race([initPromise, timeoutPromise]);
                isUserAuthenticated = hasSession;
                
                if (hasSession) {
                    console.log('✓ Supabase client initialized with existing session');
                    
                    // Initialize sync engine only if we have an active session
                    try {
                        const syncEngine = new SyncEngine(
                            client,
                            JobTrackerDB,
                            JobTrackerState
                        );
                        await syncEngine.init();
                        // Expose sync engine globally for modals to use
                        window.syncEngine = syncEngine;
                        client.syncEngine = syncEngine;
                        console.log('✓ Sync engine initialized');
                    } catch (syncError) {
                        console.warn('[Bridge] Sync engine init failed (non-critical):', syncError);
                    }
                } else {
                    console.log('✓ Supabase client initialized (no session yet - user needs to sign in)');
                }
            } catch (authError) {
                console.warn('[Bridge] Supabase auth check failed or timed out:', authError.message);
                console.log('✓ Supabase client ready (auth check skipped)');
            }
        } else {
            console.warn('[Bridge] Supabase not configured - authentication disabled');
            // show configuration alert to user once
            setTimeout(() => {
                if (window.JobTrackerModals && typeof window.JobTrackerModals.customAlert === 'function') {
                    window.JobTrackerModals.customAlert(
                        'Configuration Error',
                        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment (see README.md).',
                        true
                    );
                }
            }, 1000);
            // Still set a dummy client so modals don't crash
            window.supabaseClient = null;
        }
        
        // dispatch event for compatibility hooks
        const evt = new Event('modulesReady');
        window.dispatchEvent(evt);
        modulesReady = true;
        console.log('✓ Modular system ready');
    } catch (error) {
        console.error('[Bridge] Module initialization failed:', error);
        modulesReady = false;
        // Don't alert - let app continue with degraded functionality
    }
    
    return isUserAuthenticated;
}

// helper export for legacy code
export function whenModulesReady(callback) {
    if (modulesReady) {
        callback();
    } else {
        window.addEventListener('modulesReady', callback, { once: true });
    }
}
// Compatibility layer - provides functions that wrap the new modules
export const JobTrackerCompat = {
    // Save jobs to database instead of localStorage
    async saveState() {
        const legacyState = window.state || {};

        if (legacyState.jobs && legacyState.jobs.length > 0) {
            await JobTrackerDB.bulkPut(JobTrackerDB.STORES.JOBS, legacyState.jobs);
        }

        if (legacyState.types) {
            const types = Object.entries(legacyState.types).map(([code, data]) => ({
                code,
                ...data,
                upgradePay: data?.upgradePay ?? data?.upgrade ?? data?.ug ?? null
            }));
            await JobTrackerDB.bulkPut(JobTrackerDB.STORES.TYPES, types);
        }
    },

    // Load state from database
    async loadState() {
        const jobs = await JobTrackerDB.getAll(JobTrackerDB.STORES.JOBS);
        const types = await JobTrackerDB.getAll(JobTrackerDB.STORES.TYPES);

        // Convert types array back to object for backward compatibility
        const typesObj = {};
        types.forEach(t => {
            typesObj[t.code] = {
                pay: t.pay,
                int: t.int,
                upgradePay: t.upgradePay ?? t.upgrade ?? t.ug ?? null
            };
        });

        return {
            jobs,
            types: typesObj
        };
    },

    // Sync legacy state with modular state
    syncState() {
        if (!window.state || !JobTrackerState) return;

        // Sync from modular state to legacy state
        window.state.jobs = JobTrackerState.jobs;

        // Convert types to legacy format
        const existingTypes = window.state.types || {};
        const typesObj = {};
        JobTrackerState.types.forEach(t => {
            const modularUpgrade = t.upgradePay ?? t.upgrade ?? t.ug ?? null;
            const existingUpgrade = existingTypes[t.code]?.upgradePay
                ?? existingTypes[t.code]?.upgrade
                ?? existingTypes[t.code]?.ug
                ?? null;
            const resolvedUpgrade = modularUpgrade != null ? modularUpgrade : existingUpgrade;

            typesObj[t.code] = {
                pay: t.pay,
                int: t.int,
                upgradePay: t.code === 'BTTW' ? (resolvedUpgrade ?? 44) : resolvedUpgrade
            };
        });
        window.state.types = { ...existingTypes, ...typesObj };
    }
};


