(function () {
/**
 * Utility Functions
 * Common helpers used throughout the application
 */

const { STATUS, ANIMATION, DATE_FORMAT, SATURDAY_MULTIPLIER } = window.JobTrackerConstants;

window.JobTrackerUtils = {
    /**
     * Generate unique ID
     */
    generateID() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    /**
     * Format relative time (e.g., "5m ago", "2h ago")
     */
    timeAgo(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        const days = Math.floor(hrs / 24);
        return days + 'd ago';
    },

    /**
     * Debounce function execution
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Sanitize HTML to prevent XSS
     */
    sanitizeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

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
    },

    /**
     * Check if date is a Saturday
     */
    isSaturday(dateStr) {
        const date = new Date(dateStr + 'T00:00:00');
        return date.getDay() === 6;
    },

    /**
     * Calculate Saturday premium fee
     */
    calculateSaturdayFee(baseFee) {
        return baseFee * SATURDAY_MULTIPLIER;
    },

    /**
     * Get base fee from Saturday premium fee
     */
    getBaseFeeFromSaturday(saturdayFee) {
        return saturdayFee / SATURDAY_MULTIPLIER;
    },

    /**
     * Check if job should have Saturday premium
     */
    shouldApplySaturdayPremium(job) {
        return this.isSaturday(job.date) && 
               job.status === STATUS.COMPLETED && 
               parseFloat(job.fee) > 0;
    },

    /**
     * Calculate fee for a job (with Saturday premium if applicable)
     */
    calculateJobFee(job, types) {
        const typeData = types.find(t => t.code === job.type);
        if (!typeData) return 0;

        let baseFee = 0;
        if (job.status === STATUS.COMPLETED) {
            baseFee = typeData.pay || 0;
        } else if (job.status === STATUS.INTERNALS) {
            baseFee = typeData.int || 0;
        }

        // Apply Saturday premium if applicable
        if (this.isSaturday(job.date) && job.status === STATUS.COMPLETED && baseFee > 0) {
            return this.calculateSaturdayFee(baseFee);
        }

        return baseFee;
    },

    /**
     * Get week number
     */
    getWeekNumber(date) {
        const d = new Date(date);
        // Week starts on Saturday
        const daysToSat = (d.getDay() + 1) % 7;
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - daysToSat);
        startOfWeek.setHours(0, 0, 0, 0);
        
        const startOfYear = new Date(startOfWeek.getFullYear(), 0, 1);
        const daysSinceStart = Math.floor((startOfWeek - startOfYear) / 86400000);
        return Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);
    },

    /**
     * Format date for display
     */
    formatDate(date, format = 'LONG') {
        if (!date) return '';
        const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
        return d.toLocaleDateString('en-GB', DATE_FORMAT[format]);
    },

    /**
     * Get date range for current view
     */
    getDateRange(viewDate, range) {
        const d = new Date(viewDate);
        d.setHours(0, 0, 0, 0);

        if (range === 'day') {
            return { start: d, end: d };
        }

        if (range === 'week') {
            const daysToSat = (d.getDay() + 1) % 7;
            const start = new Date(d);
            start.setDate(d.getDate() - daysToSat);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return { start, end };
        }

        if (range === 'month') {
            const start = new Date(d.getFullYear(), d.getMonth(), 1);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            return { start, end };
        }

        // year
        const start = new Date(d.getFullYear(), 0, 1);
        const end = new Date(d.getFullYear(), 11, 31);
        return { start, end };
    },

    /**
     * Check if job date is within range
     */
    isJobInRange(job, viewDate, range) {
        const jobDate = new Date(job.date + 'T00:00:00');
        jobDate.setHours(0, 0, 0, 0);
        
        const { start, end } = this.getDateRange(viewDate, range);
        
        return jobDate >= start && jobDate <= end;
    },

    /**
     * Trend badge HTML generator
     */
    trendBadge(current, previous) {
        if (previous === 0 && current === 0) return '';
        if (previous === 0) return '<span class="trend-badge up">▲ NEW</span>';
        const pct = ((current - previous) / previous * 100).toFixed(0);
        if (pct > 0) return `<span class="trend-badge up">▲ ${pct}%</span>`;
        if (pct < 0) return `<span class="trend-badge down">▼ ${Math.abs(pct)}%</span>`;
        return '<span class="trend-badge flat">— 0%</span>';
    },

    /**
     * Create toast notification
     */
    showToast(message, duration = 3000, actions = null) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        const safeMessage = window.JobTrackerUtils && typeof window.JobTrackerUtils.sanitizeHTML === 'function'
            ? window.JobTrackerUtils.sanitizeHTML(message)
            : String(message ?? '');

        let html = `<span>${safeMessage}</span>`;
        if (actions) {
            const safeLabel = window.JobTrackerUtils && typeof window.JobTrackerUtils.sanitizeHTML === 'function'
                ? window.JobTrackerUtils.sanitizeHTML(actions.label)
                : String(actions.label ?? '');
            html += `<button class="toast-undo" onclick="${actions.onClick}">${safeLabel}</button>`;
        }

        toast.innerHTML = html;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    },

    /**
     * Export data as JSON file
     */
    async exportDataAsFile(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `job-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /**
     * Import data from JSON file
     */
    async importDataFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    reject(new Error('No file selected'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        resolve(data);
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            };

            input.click();
        });
    },

    /**
     * Validate job data
     */
    validateJob(job) {
        const errors = [];
        
        if (!job.type) errors.push('Job type is required');
        if (!job.date) errors.push('Date is required');
        if (job.fee && isNaN(parseFloat(job.fee))) errors.push('Invalid fee amount');
        if (job.status && !Object.values(STATUS).includes(job.status)) {
            errors.push('Invalid status');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    },

    /**
     * Deep clone object
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
};

})();
