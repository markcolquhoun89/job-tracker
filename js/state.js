import { JobTrackerConstants } from './constants.js';
import { JobTrackerDB } from './database.js';
import { JobTrackerUtils } from './utils.js';

/**
 * State Management Module
 * Centralized application state with reactive updates
 */

const { DEFAULT_TYPES, RANGES } = JobTrackerConstants;
const { db, STORES } = JobTrackerDB;

const normalizeTypeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const coerceCompletionFlag = (value) => !(value === false || value === 'false' || value === 0 || value === '0' || value === 'off');

class AppState {
    constructor() {
        // Core data
        this.jobs = [];
        this.types = [];
        this.expenses = [];
        this.settings = new Map();

        // User role & profile
        this.userRole = 'engineer'; // 'engineer', 'manager', 'admin'
        this.userGroup = null;
        this.displayName = localStorage.getItem('nx_displayName') || 'You';

        // Notifications
        this.notifications = [];
        this.lastSyncTime = localStorage.getItem('nx_lastSync') ? new Date(localStorage.getItem('nx_lastSync')) : new Date();

        // View state
        this.viewDate = new Date();
        this.range = RANGES.DAY;
        this.activeTab = 'jobs';

        // UI state
        this.batchMode = false;
        this.batchSelected = new Set();
        this.searchQuery = '';
        this.statusFilter = 'all';

        // Temporary state
        this.deletedJob = null;
        this.deleteTimer = null;
        this.wakeLock = null;

        // Observers for reactive updates
        this.observers = [];
    }

    /**
     * Initialize state from database
     */
    async init() {
        try {
            // Load jobs
            this.jobs = await db.getAll(STORES.JOBS);
            
            // Normalize jobs: add missing fields for backwards compatibility
            this.jobs = this.jobs.map(job => ({
                // Ensure all new fields have defaults
                elf: false,
                elfAddedBy: null,
                elfAddedDate: null,
                candids: false,
                candidsReason: '',
                candidsAddedBy: null,
                candidsAddedDate: null,
                chargeback: false,
                chargebackReason: null,
                chargebackAmount: null,
                chargebackWeek: null,
                chargebackAddedBy: null,
                chargebackAddedDate: null,
                // Spread existing job data (overrides defaults if present)
                ...job
            }));
            
            // Load types
            this.types = await db.getAll(STORES.TYPES);
            if (this.types.length === 0) {
                // Initialize default types
                this.types = Object.entries(DEFAULT_TYPES).map(([code, data]) => ({
                    code,
                    ...data
                }));
                await db.bulkPut(STORES.TYPES, this.types);
            } else {
                let typesChanged = false;

                const byCode = new Map(this.types.map(t => [t.code, t]));

                // Ensure default types exist and carry current default fields
                Object.entries(DEFAULT_TYPES).forEach(([code, defaults]) => {
                    const existing = byCode.get(code);
                    if (existing) {
                        const merged = { ...defaults, ...existing };
                        if (JSON.stringify(existing) !== JSON.stringify(merged)) {
                            byCode.set(code, merged);
                            typesChanged = true;
                        }
                    } else {
                        const created = { code, ...defaults };
                        byCode.set(code, created);
                        typesChanged = true;
                    }
                });

                this.types = Array.from(byCode.values());

                if (typesChanged) {
                    await db.bulkPut(STORES.TYPES, this.types);
                }

                // One-time migration: align built-in defaults with current payout/rule sheet.
                const defaultsMigrationKey = 'nx_defaults_20260317';
                if (localStorage.getItem(defaultsMigrationKey) !== '1') {
                    const defaultCodes = new Set(Object.keys(DEFAULT_TYPES));
                    const migratedTypes = this.types.map(typeObj => {
                        if (!defaultCodes.has(typeObj.code)) return typeObj;
                        const defaults = DEFAULT_TYPES[typeObj.code] || {};
                        return {
                            ...typeObj,
                            pay: defaults.pay,
                            int: defaults.int,
                            countTowardsCompletion: defaults.countTowardsCompletion !== false,
                            isUpgradeType: defaults.isUpgradeType === true
                        };
                    });

                    this.types = migratedTypes;
                    await db.bulkPut(STORES.TYPES, this.types);
                    localStorage.setItem(defaultsMigrationKey, '1');
                }
            }

            // Normalize type codes/flags to avoid stringly-typed completion bugs.
            let normalizedTypesChanged = false;
            const seenTypeCodes = new Set();
            const normalizedTypes = [];
            this.types.forEach(typeObj => {
                const normalizedCode = normalizeTypeCode(typeObj.code);
                if (!normalizedCode || seenTypeCodes.has(normalizedCode)) return;
                seenTypeCodes.add(normalizedCode);

                const normalizedType = {
                    ...typeObj,
                    code: normalizedCode,
                    countTowardsCompletion: coerceCompletionFlag(typeObj.countTowardsCompletion)
                };

                if (
                    normalizedType.code !== typeObj.code ||
                    normalizedType.countTowardsCompletion !== typeObj.countTowardsCompletion
                ) {
                    normalizedTypesChanged = true;
                }

                normalizedTypes.push(normalizedType);
            });

            this.types = normalizedTypes;
            if (normalizedTypesChanged) {
                await db.bulkPut(STORES.TYPES, this.types);
            }

            // Load expenses
            const expenseRecords = await db.getAll(STORES.EXPENSES);
            this.expenses = expenseRecords;

            // Load settings
            const settingsRecords = await db.getAll(STORES.SETTINGS);
            settingsRecords.forEach(({ key, value }) => {
                this.settings.set(key, value);
            });

            // Load user role & profile
            this.userRole = localStorage.getItem('nx_userRole') || 'engineer';
            this.displayName = localStorage.getItem('nx_displayName') || 'You';

            console.log('State initialized:', {
                jobs: this.jobs.length,
                types: this.types.length,
                expenses: this.expenses.length,
                settings: this.settings.size,
                userRole: this.userRole
            });

            return true;
        } catch (error) {
            console.error('State initialization error:', error);
            return false;
        }
    }

    /**
     * Subscribe to state changes
     */
    subscribe(observer) {
        this.observers.push(observer);
        return () => {
            this.observers = this.observers.filter(obs => obs !== observer);
        };
    }

    /**
     * Notify observers of state changes
     */
    notify(event, data) {
        this.observers.forEach(observer => {
            if (typeof observer === 'function') {
                observer(event, data);
            }
        });
    }

    /**
     * Add or update a job
     */
    async saveJob(job) {
        await db.put(STORES.JOBS, job);
        
        const index = this.jobs.findIndex(j => j.id === job.id);
        if (index >= 0) {
            this.jobs[index] = job;
        } else {
            this.jobs.push(job);
        }

        this.notify('job:saved', job);
        return job;
    }

    /**
     * Delete a job
     */
    async deleteJob(jobId) {
        const job = this.jobs.find(j => j.id === jobId);
        if (!job) return false;

        await db.delete(STORES.JOBS, jobId);
        this.jobs = this.jobs.filter(j => j.id !== jobId);

        this.notify('job:deleted', job);
        return true;
    }

    /**
     * Get job by ID
     */
    getJob(jobId) {
        return this.jobs.find(j => j.id === jobId);
    }

    /**
     * Bulk update jobs
     */
    async bulkUpdateJobs(jobs) {
        await db.bulkPut(STORES.JOBS, jobs);
        
        jobs.forEach(updatedJob => {
            const index = this.jobs.findIndex(j => j.id === updatedJob.id);
            if (index >= 0) {
                this.jobs[index] = updatedJob;
            }
        });

        this.notify('jobs:bulk-updated', jobs);
        return true;
    }

    /**
     * Get job type by code
     */
    getType(code) {
        const normalizedCode = normalizeTypeCode(code);
        return this.types.find(t => normalizeTypeCode(t.code) === normalizedCode);
    }

    /**
     * Get job type config (alias for getType for compatibility)
     */
    getTypeConfig(code) {
        return this.getType(code);
    }

    /**
     * Get jobs for previous period (for trend comparison)
     */
    getPrevScope() {
        const { isJobInRange } = JobTrackerUtils;
        const prevDate = new Date(this.viewDate);
        
        if (this.range === 'day') {
            prevDate.setDate(prevDate.getDate() - 1);
        } else if (this.range === 'week') {
            prevDate.setDate(prevDate.getDate() - 7);
        } else if (this.range === 'month') {
            prevDate.setMonth(prevDate.getMonth() - 1);
        } else {
            prevDate.setFullYear(prevDate.getFullYear() - 1);
        }
        
        return this.jobs.filter(j => isJobInRange(j, prevDate, this.range));
    }

    /**
     * Get current scope (filtered jobs for view)
     */
    getScope() {
        const { isJobInRange } = JobTrackerUtils;
        return this.jobs.filter(j => isJobInRange(j, this.viewDate, this.range));
    }

    /**
     * Save job type
     */
    async saveType(type) {
        const normalizedType = {
            ...type,
            code: normalizeTypeCode(type.code),
            countTowardsCompletion: coerceCompletionFlag(type.countTowardsCompletion)
        };

        await db.put(STORES.TYPES, normalizedType);
        
        const index = this.types.findIndex(t => normalizeTypeCode(t.code) === normalizeTypeCode(normalizedType.code));
        if (index >= 0) {
            this.types[index] = normalizedType;
        } else {
            this.types.push(normalizedType);
        }

        this.notify('type:saved', normalizedType);
        return normalizedType;
    }

    /**
     * Get expense for date
     */
    getExpense(date) {
        const expense = this.expenses.find(e => e.date === date);
        return expense ? expense.amount : 0;
    }

    /**
     * Save expense
     */
    async saveExpense(date, amount) {
        if (amount > 0) {
            const expense = { date, amount };
            await db.put(STORES.EXPENSES, expense);
            
            const index = this.expenses.findIndex(e => e.date === date);
            if (index >= 0) {
                this.expenses[index] = expense;
            } else {
                this.expenses.push(expense);
            }
        } else {
            // Delete expense if amount is 0 or negative
            await db.delete(STORES.EXPENSES, date);
            this.expenses = this.expenses.filter(e => e.date !== date);
        }

        this.notify('expense:saved', { date, amount });
    }

    /**
     * Get setting
     */
    getSetting(key, defaultValue = null) {
        return this.settings.get(key) || defaultValue;
    }

    /**
     * Save setting
     */
    async saveSetting(key, value) {
        await db.put(STORES.SETTINGS, { key, value });
        this.settings.set(key, value);
        this.notify('setting:saved', { key, value });
    }

    /**
     * Export all data
     */
    async exportAll() {
        return await db.exportData();
    }

    /**
     * Import all data
     */
    async importAll(data) {
        const result = await db.importData(data);
        if (result) {
            await this.init(); // Reload state
            this.notify('data:imported', data);
        }
        return result;
    }

    /**
     * Get filtered jobs for current view
     */
    getFilteredJobs() {
        let filtered = [...this.jobs];

        // Apply search filter
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(j => 
                j.type.toLowerCase().includes(query) ||
                (j.jobID && j.jobID.toLowerCase().includes(query)) ||
                (j.notes && j.notes.toLowerCase().includes(query))
            );
        }

        // Apply status filter
        if (this.statusFilter !== 'all') {
            filtered = filtered.filter(j => j.status === this.statusFilter);
        }

        return filtered;
    }

    /**
     * Return jobs within the currently selected view date/range
     * This mirrors the old `state.getScope()` helper used by the
     * render logic.  It uses the shared utility so calculations stay
     * consistent with other modules.
     */
    getScope() {
        const { isJobInRange } = JobTrackerUtils;
        return this.jobs.filter(j => isJobInRange(j, this.viewDate, this.range));
    }

    /**
     * Set view date
     */
    setViewDate(date) {
        this.viewDate = new Date(date);
        this.notify('view:date-changed', this.viewDate);
    }

    /**
     * Set view range
     */
    setRange(range) {
        this.range = range;
        this.notify('view:range-changed', range);
    }

    /**
     * Set active tab
     */
    setActiveTab(tab) {
        this.activeTab = tab;
        this.notify('view:tab-changed', tab);
    }

    /**
     * Toggle batch mode
     */
    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        if (!this.batchMode) {
            this.batchSelected.clear();
        }
        this.notify('ui:batch-mode-changed', this.batchMode);
    }

    /**
     * Toggle batch selection for a job
     */
    toggleBatchSelect(jobId) {
        if (this.batchSelected.has(jobId)) {
            this.batchSelected.delete(jobId);
        } else {
            this.batchSelected.add(jobId);
        }
        this.notify('ui:batch-selection-changed', this.batchSelected);
    }

    /**
     * Set search query
     */
    setSearchQuery(query) {
        this.searchQuery = query;
        this.notify('ui:search-changed', query);
    }

    /**
     * Set status filter
     */
    setStatusFilter(status) {
        this.statusFilter = status;
        this.notify('ui:filter-changed', status);
    }

    /**
     * Set user role (engineer/manager/admin)
     */
    setUserRole(role) {
        if (!['engineer', 'manager', 'admin'].includes(role)) return;
        this.userRole = role;
        localStorage.setItem('nx_userRole', role);
        this.notify('user:role-changed', role);
    }

    /**
     * Set display name (for leaderboards)
     */
    setDisplayName(name) {
        this.displayName = name || 'You';
        localStorage.setItem('nx_displayName', this.displayName);
        this.notify('user:display-name-changed', this.displayName);
    }

    /**
     * Add notification
     */
    addNotification(type, message, metadata = {}) {
        const notif = {
            id: generateID(),
            type,
            message,
            metadata,
            createdAt: new Date(),
            read: false
        };
        this.notifications.unshift(notif);
        this.notify('notification:added', notif);
        return notif;
    }

    /**
     * Mark notification as read
     */
    markNotificationRead(notifId) {
        const notif = this.notifications.find(n => n.id === notifId);
        if (notif) {
            notif.read = true;
            this.notify('notification:read', notifId);
        }
    }

    /**
     * Clear old notifications
     */
    clearOldNotifications(daysOld = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);
        this.notifications = this.notifications.filter(n => n.createdAt > cutoff);
    }

    /**
     * Update last sync time
     */
    updateLastSync() {
        this.lastSyncTime = new Date();
        localStorage.setItem('nx_lastSync', this.lastSyncTime.toISOString());
    }

    /**
     * Clear all user data - called on logout/session failure
     * Wipes IndexedDB and resets in-memory state
     */
    async clearAllData() {
        console.log('[State] Clearing all user data (logout)');
        
        // Clear in-memory state
        this.jobs = [];
        this.types = [];
        this.expenses = [];
        this.settings.clear();
        this.notifications = [];
        this.batchSelected.clear();
        this.searchQuery = '';
        this.statusFilter = 'all';
        
        // Clear all IndexedDB stores
        try {
            const tx = db.transaction([STORES.JOBS, STORES.TYPES, STORES.EXPENSES, STORES.SETTINGS], 'readwrite');
            tx.objectStore(STORES.JOBS).clear();
            tx.objectStore(STORES.TYPES).clear();
            tx.objectStore(STORES.EXPENSES).clear();
            tx.objectStore(STORES.SETTINGS).clear();
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = reject;
            });
            console.log('[State] All IndexedDB stores cleared');
        } catch (error) {
            console.error('[State] Error clearing IndexedDB:', error);
            throw error;
        }
        
        // Notify subscribers
        this.notify('state:cleared');
    }
}

// Create singleton instance
const appState = new AppState();

// Export for use in other modules
export const JobTrackerState = appState;
