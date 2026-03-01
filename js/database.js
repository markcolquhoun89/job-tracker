(function () {
/**
 * Database Abstraction Layer
 * Handles IndexedDB with automatic localStorage migration and fallback
 */

const DB_NAME = 'JobTrackerDB';
const DB_VERSION = 1;
const STORES = {
    JOBS: 'jobs',
    TYPES: 'types',
    EXPENSES: 'expenses',
    SETTINGS: 'settings',
    METADATA: 'metadata'
};

class Database {
    constructor() {
        this.db = null;
        this.ready = false;
        this.useLocalStorage = false;
        this.migrationComplete = false;
    }

    /**
     * Initialize database and migrate from localStorage if needed
     */
    async init() {
        try {
            await this.openDB();
            await this.migrateFromLocalStorage();
            this.ready = true;
            return true;
        } catch (error) {
            console.warn('IndexedDB not available, falling back to localStorage', error);
            this.useLocalStorage = true;
            this.ready = true;
            return true;
        }
    }

    /**
     * Open IndexedDB connection
     */
    openDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Jobs store
                if (!db.objectStoreNames.contains(STORES.JOBS)) {
                    const jobStore = db.createObjectStore(STORES.JOBS, { keyPath: 'id' });
                    jobStore.createIndex('date', 'date', { unique: false });
                    jobStore.createIndex('status', 'status', { unique: false });
                    jobStore.createIndex('type', 'type', { unique: false });
                    jobStore.createIndex('completedAt', 'completedAt', { unique: false });
                }

                // Types store
                if (!db.objectStoreNames.contains(STORES.TYPES)) {
                    db.createObjectStore(STORES.TYPES, { keyPath: 'code' });
                }

                // Expenses store
                if (!db.objectStoreNames.contains(STORES.EXPENSES)) {
                    db.createObjectStore(STORES.EXPENSES, { keyPath: 'date' });
                }

                // Settings store
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }

                // Metadata store
                if (!db.objectStoreNames.contains(STORES.METADATA)) {
                    db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * Migrate data from localStorage to IndexedDB
     */
    async migrateFromLocalStorage() {
        if (this.migrationComplete) return;

        const migrationKey = 'nx_migrated_to_db';
        const alreadyMigrated = localStorage.getItem(migrationKey);

        if (alreadyMigrated === 'true') {
            this.migrationComplete = true;
            return;
        }

        try {
            // Migrate jobs
            const jobs = this.safeParseJSON(localStorage.getItem('nx_jobs'), []);
            if (jobs.length > 0) {
                await this.bulkPut(STORES.JOBS, jobs);
                console.log(`Migrated ${jobs.length} jobs to IndexedDB`);
            }

            // Migrate types
            const types = this.safeParseJSON(localStorage.getItem('nx_types'), {});
            const typeArray = Object.entries(types).map(([code, data]) => ({ code, ...data }));
            if (typeArray.length > 0) {
                await this.bulkPut(STORES.TYPES, typeArray);
                console.log(`Migrated ${typeArray.length} job types to IndexedDB`);
            }

            // Migrate expenses
            const expenses = this.safeParseJSON(localStorage.getItem('nx_expenses'), {});
            const expenseArray = Object.entries(expenses).map(([date, amount]) => ({ date, amount }));
            if (expenseArray.length > 0) {
                await this.bulkPut(STORES.EXPENSES, expenseArray);
                console.log(`Migrated ${expenseArray.length} expenses to IndexedDB`);
            }

            // Migrate settings
            const settingsKeys = [
                'nx_theme', 'nx_accent', 'nx_accent_dark', 'nx_accent_light', 
                'nx_gradient', 'nx_target', 'nx_tax', 'nx_goal', 'nx_bests',
                'nx_bg_anim', 'nx_notif', 'nx_wakelock', 'nx_panel_order'
            ];

            for (const key of settingsKeys) {
                const value = localStorage.getItem(key);
                if (value !== null) {
                    await this.put(STORES.SETTINGS, { key, value });
                }
            }

            // Mark migration complete
            localStorage.setItem(migrationKey, 'true');
            this.migrationComplete = true;
            console.log('Migration from localStorage completed successfully');

        } catch (error) {
            console.error('Migration error:', error);
            // Don't throw - keep localStorage as fallback
        }
    }

    /**
     * Safe JSON parse with fallback
     */
    safeParseJSON(str, defaultValue) {
        try {
            return str ? JSON.parse(str) : defaultValue;
        } catch (e) {
            console.error('JSON parse error:', e);
            return defaultValue;
        }
    }

    /**
     * Get a single item by key
     */
    async get(storeName, key) {
        if (this.useLocalStorage) {
            return this.getFromLocalStorage(storeName, key);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all items from a store
     */
    async getAll(storeName) {
        if (this.useLocalStorage) {
            return this.getAllFromLocalStorage(storeName);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Put a single item (insert or update)
     */
    async put(storeName, item) {
        if (this.useLocalStorage) {
            return this.putToLocalStorage(storeName, item);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Bulk put items
     */
    async bulkPut(storeName, items) {
        if (this.useLocalStorage) {
            for (const item of items) {
                await this.putToLocalStorage(storeName, item);
            }
            return;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            let completed = 0;
            const errors = [];

            items.forEach(item => {
                const request = store.put(item);
                request.onsuccess = () => {
                    completed++;
                    if (completed === items.length) resolve();
                };
                request.onerror = () => {
                    errors.push(request.error);
                    completed++;
                    if (completed === items.length) {
                        if (errors.length > 0) reject(errors);
                        else resolve();
                    }
                };
            });
        });
    }

    /**
     * Delete an item by key
     */
    async delete(storeName, key) {
        if (this.useLocalStorage) {
            return this.deleteFromLocalStorage(storeName, key);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Query items by index
     */
    async queryByIndex(storeName, indexName, value) {
        if (this.useLocalStorage) {
            const all = await this.getAllFromLocalStorage(storeName);
            return all.filter(item => item[indexName] === value);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Export all data (for backup)
     */
    async exportData() {
        const data = {
            version: DB_VERSION,
            exportDate: new Date().toISOString(),
            jobs: await this.getAll(STORES.JOBS),
            types: await this.getAll(STORES.TYPES),
            expenses: await this.getAll(STORES.EXPENSES),
            settings: await this.getAll(STORES.SETTINGS),
            metadata: await this.getAll(STORES.METADATA)
        };
        return data;
    }

    /**
     * Import data (from backup)
     */
    async importData(data) {
        try {
            if (data.jobs) await this.bulkPut(STORES.JOBS, data.jobs);
            if (data.types) await this.bulkPut(STORES.TYPES, data.types);
            if (data.expenses) await this.bulkPut(STORES.EXPENSES, data.expenses);
            if (data.settings) await this.bulkPut(STORES.SETTINGS, data.settings);
            if (data.metadata) await this.bulkPut(STORES.METADATA, data.metadata);
            return true;
        } catch (error) {
            console.error('Import error:', error);
            return false;
        }
    }

    // LocalStorage fallback methods
    getFromLocalStorage(storeName, key) {
        const data = this.getAllFromLocalStorage(storeName);
        return data.find(item => {
            if (storeName === STORES.JOBS) return item.id === key;
            if (storeName === STORES.TYPES) return item.code === key;
            if (storeName === STORES.EXPENSES) return item.date === key;
            if (storeName === STORES.SETTINGS) return item.key === key;
            if (storeName === STORES.METADATA) return item.key === key;
            return false;
        });
    }

    getAllFromLocalStorage(storeName) {
        const lsKey = this.getLSKey(storeName);
        const data = localStorage.getItem(lsKey);
        
        if (storeName === STORES.JOBS) {
            return this.safeParseJSON(data, []);
        } else if (storeName === STORES.TYPES) {
            const types = this.safeParseJSON(data, {});
            return Object.entries(types).map(([code, data]) => ({ code, ...data }));
        } else if (storeName === STORES.EXPENSES) {
            const expenses = this.safeParseJSON(data, {});
            return Object.entries(expenses).map(([date, amount]) => ({ date, amount }));
        } else if (storeName === STORES.SETTINGS) {
            // Settings are spread across multiple localStorage keys
            const settings = [];
            const keys = ['nx_theme', 'nx_accent', 'nx_accent_dark', 'nx_accent_light', 
                         'nx_gradient', 'nx_target', 'nx_tax', 'nx_goal', 'nx_bests',
                         'nx_bg_anim', 'nx_notif', 'nx_wakelock', 'nx_panel_order'];
            keys.forEach(key => {
                const value = localStorage.getItem(key);
                if (value !== null) settings.push({ key, value });
            });
            return settings;
        }
        return [];
    }

    putToLocalStorage(storeName, item) {
        if (storeName === STORES.JOBS) {
            const jobs = this.safeParseJSON(localStorage.getItem('nx_jobs'), []);
            const index = jobs.findIndex(j => j.id === item.id);
            if (index >= 0) jobs[index] = item;
            else jobs.push(item);
            localStorage.setItem('nx_jobs', JSON.stringify(jobs));
        } else if (storeName === STORES.SETTINGS) {
            localStorage.setItem(item.key, item.value);
        }
        // Add other stores as needed
        return Promise.resolve();
    }

    deleteFromLocalStorage(storeName, key) {
        if (storeName === STORES.JOBS) {
            const jobs = this.safeParseJSON(localStorage.getItem('nx_jobs'), []);
            const filtered = jobs.filter(j => j.id !== key);
            localStorage.setItem('nx_jobs', JSON.stringify(filtered));
        }
        return Promise.resolve();
    }

    getLSKey(storeName) {
        const map = {
            [STORES.JOBS]: 'nx_jobs',
            [STORES.TYPES]: 'nx_types',
            [STORES.EXPENSES]: 'nx_expenses'
        };
        return map[storeName] || storeName;
    }
}

// Create singleton instance
const db = new Database();

// Export for use in other modules
window.JobTrackerDB = {
    db,
    STORES,
    init: () => db.init(),
    get: (...args) => db.get(...args),
    getAll: (...args) => db.getAll(...args),
    put: (...args) => db.put(...args),
    bulkPut: (...args) => db.bulkPut(...args),
    delete: (...args) => db.delete(...args),
    queryByIndex: (...args) => db.queryByIndex(...args),
    exportData: () => db.exportData(),
    importData: (data) => db.importData(data)
};

})();
