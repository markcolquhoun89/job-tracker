(function () {
/**
 * Integration Bridge
 * Connects the new modular system with existing app.js code
 * 
 * This file should be loaded AFTER all modules but BEFORE app.js
 */

// Initialize the database and state on page load
(async function initModules() {
    console.log('Initializing modular system...');
    
    try {
        // Initialize database
        await window.JobTrackerDB.db.init();
        console.log('✓ Database initialized');
        
        // Initialize state
        await window.JobTrackerState.init();
        console.log('✓ State loaded');
        
        // Mark modules as ready
        window.modulesReady = true;
        
        // Initialize Supabase client
        if (window.SupabaseClient && APP_CONFIG.SUPABASE_URL) {
            console.log('[Bridge] Initializing Supabase client...');
            window.supabaseClient = new SupabaseClient(
                APP_CONFIG.SUPABASE_URL,
                APP_CONFIG.SUPABASE_ANON_KEY
            );
            
            const hasSession = await window.supabaseClient.init();
            if (hasSession) {
                console.log('✓ Supabase client initialized with existing session');
                
                // Initialize sync engine
                if (window.SyncEngine) {
                    window.syncEngine = new SyncEngine(
                        window.supabaseClient,
                        window.JobTrackerDB,
                        window.JobTrackerState
                    );
                    await window.syncEngine.init();
                    console.log('✓ Sync engine initialized');
                }
            } else {
                console.log('✓ Supabase client initialized (no session yet)');
            }
        }
        
        // Make the modular state available as a global for app.js compatibility
        // Wait a tick to ensure app.js has run
        setTimeout(() => {
            if (window.state) {
                // Update app.js state with modular state
                window.JobTrackerCompat.syncState();
                console.log('✓ State synchronized');
            }
        }, 100);
        
        // Dispatch event for app.js to know modules are ready
        window.dispatchEvent(new Event('modulesReady'));
        
        console.log('✓ Modular system ready');
    } catch (error) {
        console.error('Module initialization failed:', error);
        alert('Failed to initialize app. Please refresh the page.');
    }
})();

// Compatibility layer - provides global functions that wrap the new modules
window.JobTrackerCompat = {
    // Save jobs to database instead of localStorage
    async saveState() {
        const legacyState = window.state || {};
        
        if (legacyState.jobs && legacyState.jobs.length > 0) {
            await window.JobTrackerDB.bulkPut(window.JobTrackerDB.STORES.JOBS, legacyState.jobs);
        }
        
        if (legacyState.types) {
            const types = Object.entries(legacyState.types).map(([code, data]) => ({
                code,
                ...data,
                upgradePay: data?.upgradePay ?? data?.upgrade ?? data?.ug ?? null
            }));
            await window.JobTrackerDB.bulkPut(window.JobTrackerDB.STORES.TYPES, types);
        }
    },
    
    // Load state from database
    async loadState() {
        const jobs = await window.JobTrackerDB.getAll(window.JobTrackerDB.STORES.JOBS);
        const types = await window.JobTrackerDB.getAll(window.JobTrackerDB.STORES.TYPES);
        
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
        if (!window.state || !window.JobTrackerState) return;
        
        // Sync from modular state to legacy state
        window.state.jobs = window.JobTrackerState.jobs;
        
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

})();
