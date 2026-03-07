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

export async function initModules() {
    console.log('Initializing modular system...');
    
    try {
        // Initialize database
        await JobTrackerDB.db.init();
        console.log('✓ Database initialized');
        
        // Initialize state
        await JobTrackerState.init();
        console.log('✓ State loaded');
        
        // Initialize Supabase client if configured
        if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
            console.log('[Bridge] Initializing Supabase client...');
            // assign singleton via helper
            const client = initSupabase(
                SUPABASE_CONFIG.url,
                SUPABASE_CONFIG.anonKey
            );
            
            const hasSession = await client.init();
            if (hasSession) {
                console.log('✓ Supabase client initialized with existing session');
                
                // Initialize sync engine
                const syncEngine = new SyncEngine(
                    client,
                    JobTrackerDB,
                    JobTrackerState
                );
                await syncEngine.init();
                console.log('✓ Sync engine initialized');
            } else {
                console.log('✓ Supabase client initialized (no session yet)');
            }
        }
        
        // sync legacy state if any (app.js may call this itself later)
        if (window.state) {
            JobTrackerCompat.syncState();
            console.log('✓ State synchronized');
        }

        // dispatch event for compatibility hooks
        const evt = new Event('modulesReady');
        window.dispatchEvent(evt);
        modulesReady = true;
        console.log('✓ Modular system ready');
    } catch (error) {
        console.error('Module initialization failed:', error);
        alert('Failed to initialize app. Please refresh the page.');
    }
}

// automatically kick off initialization when imported
initModules();

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
        window.JobTrackerState.types.forEach(t => {
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

// Helper to ensure modules are ready before executing code
window.whenModulesReady = function(callback) {
    if (window.modulesReady) {
        callback();
    } else {
        window.addEventListener('modulesReady', callback, { once: true });
    }
};

