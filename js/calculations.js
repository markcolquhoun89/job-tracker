/**
 * Calculation Module
 * Business logic for calculating statistics and metrics
 */

import { JobTrackerConstants } from './constants.js';
import { JobTrackerState } from './state.js';

const { STATUS } = JobTrackerConstants;
const state = JobTrackerState;

export const JobTrackerCalculations = {
    /**
     * Calculate comprehensive statistics for a list of jobs
     */
    calculate(list) {
        const isCompletionEligibleType = (job) => {
            const cfg = state.getTypeConfig(job.type);
            if (!cfg) return true;
            const raw = cfg.countTowardsCompletion;
            return !(raw === false || raw === 'false' || raw === 0 || raw === '0' || raw === 'off');
        };

        const resolved = list.filter(j => [STATUS.COMPLETED, STATUS.FAILED, STATUS.INTERNALS].includes(j.status) && isCompletionEligibleType(j));
        const noHybrid = resolved.filter(j => !j.type.toUpperCase().startsWith('HY'));

        // Completion rate calculator
        const calculateRate = (arr) => {
            if (!arr.length) return 0;
            const points = arr.reduce((sum, job) => {
                if (job.status === STATUS.COMPLETED) return sum + 1;
                return sum;
            }, 0);
            return ((points / arr.length) * 100).toFixed(1);
        };

        // Revenue calculations
        const totalCash = list.reduce((sum, j) => sum + parseFloat(j.fee || 0), 0);
        const completedRev = list.filter(j => j.status === STATUS.COMPLETED).reduce((sum, j) => sum + parseFloat(j.fee || 0), 0);
        const failedRev = list.filter(j => j.status === STATUS.FAILED).reduce((sum, j) => sum + parseFloat(j.fee || 0), 0);
        const internalRev = list.filter(j => j.status === STATUS.INTERNALS).reduce((sum, j) => sum + parseFloat(j.fee || 0), 0);
        const pendingRev = list.filter(j => j.status === STATUS.PENDING).reduce((sum, j) => sum + parseFloat(j.fee || 0), 0);

        // Status counts
        const done = list.filter(j => j.status === STATUS.COMPLETED).length;
        const ints = list.filter(j => j.status === STATUS.INTERNALS).length;
        const fails = list.filter(j => j.status === STATUS.FAILED).length;
        const pend = list.filter(j => j.status === STATUS.PENDING).length;

        // Advanced metrics
        const daysWorked = new Set(list.map(j => j.date)).size;
        const avgJobPay = list.length > 0 ? (totalCash / list.length).toFixed(2) : 0;
        const avgDailyPay = daysWorked > 0 ? (totalCash / daysWorked).toFixed(2) : 0;
        const avgJobsPerDay = daysWorked > 0 ? (list.length / daysWorked).toFixed(1) : 0;

        // Completion streak (consecutive completed jobs)
        const sorted = [...list]
            .filter(j => j.status !== STATUS.PENDING)
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
        
        let streak = 0;
        for (const job of sorted) {
            if (job.status === STATUS.COMPLETED) streak++;
            else break;
        }

        // Type breakdown
        const typeBreakdown = {};
        list.forEach(job => {
            if (!typeBreakdown[job.type]) {
                typeBreakdown[job.type] = {
                    done: 0,
                    fails: 0,
                    ints: 0,
                    pend: 0,
                    rev: 0,
                    count: 0
                };
            }
            const tb = typeBreakdown[job.type];
            tb.count++;
            
            if (job.status === STATUS.COMPLETED) tb.done++;
            else if (job.status === STATUS.FAILED) tb.fails++;
            else if (job.status === STATUS.INTERNALS) tb.ints++;
            else tb.pend++;
            
            tb.rev += parseFloat(job.fee || 0);
        });

        // Weekday analysis
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const byWeekday = {};
        dayNames.forEach(d => byWeekday[d] = { count: 0, rev: 0 });
        
        list.forEach(job => {
            const dayIndex = new Date(job.date + 'T00:00:00').getDay();
            const dayName = dayNames[dayIndex];
            byWeekday[dayName].count++;
            byWeekday[dayName].rev += parseFloat(job.fee || 0);
        });

        return {
            // Rates
            compRate: calculateRate(resolved),
            exclHy: calculateRate(noHybrid),
            
            // Totals
            totalCash,
            vol: list.length,
            
            // Status counts
            done,
            ints,
            fails,
            pend,
            
            // Averages
            avgJobPay,
            avgDailyPay,
            avgJobsPerDay,
            daysWorked,
            
            // Additional metrics
            streak,
            typeBreakdown,
            byWeekday,
            
            // Revenue breakdown
            completedRev,
            failedRev,
            internalRev,
            pendingRev
        };
    },

    /**
     * Get previous period scope for trend comparison
     */
    getPreviousPeriodStats(currentList, viewDate, range) {
        const prevDate = new Date(viewDate);
        
        if (range === 'day') prevDate.setDate(prevDate.getDate() - 1);
        else if (range === 'week') prevDate.setDate(prevDate.getDate() - 7);
        else if (range === 'month') prevDate.setMonth(prevDate.getMonth() - 1);
        else prevDate.setFullYear(prevDate.getFullYear() - 1);

        const { isJobInRange } = JobTrackerUtils;
        const prevList = state.jobs.filter(j => isJobInRange(j, prevDate, range));
        
        return this.calculate(prevList);
    },

    /**
     * Update personal bests
     */
    async updatePersonalBests(list) {
        const bests = {
            bestDayEarnings: 0,
            bestDayDate: '',
            longestStreak: 0,
            mostJobsDay: 0,
            mostJobsDayDate: ''
        };

        // Load existing bests
        const existing = state.getSetting('nx_bests');
        if (existing) {
            Object.assign(bests, JSON.parse(existing));
        }

        // Best single day earnings
        const dailyEarnings = {};
        list.forEach(j => {
            dailyEarnings[j.date] = (dailyEarnings[j.date] || 0) + parseFloat(j.fee || 0);
        });

        Object.entries(dailyEarnings).forEach(([date, earnings]) => {
            if (earnings > bests.bestDayEarnings) {
                bests.bestDayEarnings = earnings;
                bests.bestDayDate = date;
            }
        });

        // Most jobs in a day
        const dailyCount = {};
        list.forEach(j => {
            dailyCount[j.date] = (dailyCount[j.date] || 0) + 1;
        });

        Object.entries(dailyCount).forEach(([date, count]) => {
            if (count > bests.mostJobsDay) {
                bests.mostJobsDay = count;
                bests.mostJobsDayDate = date;
            }
        });

        // Longest streak
        const sorted = [...state.jobs]
            .filter(j => j.status !== STATUS.PENDING && j.completedAt)
            .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));

        let currentStreak = 0;
        let maxStreak = 0;

        for (const job of sorted) {
            if (job.status === STATUS.COMPLETED) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }

        bests.longestStreak = Math.max(bests.longestStreak, maxStreak);

        // Save updated bests
        await state.saveSetting('nx_bests', JSON.stringify(bests));

        return bests;
    },

    /**
     * Calculate projection based on current progress
     */
    getProjection(list, stats, viewDate = state.viewDate, range = state.range) {
        const d = new Date(viewDate || state.viewDate || new Date());
        if (isNaN(d.getTime())) {
            return Number.isFinite(Number(stats?.totalCash)) ? Number(stats.totalCash) : 0;
        }
        const totalCash = Number.isFinite(Number(stats?.totalCash)) ? Number(stats.totalCash) : 0;
        
        if (range === 'day') return totalCash;

        let elapsed, total;

        if (range === 'week') {
            const daysFromSat = (d.getDay() + 1) % 7;
            elapsed = daysFromSat === 0 ? 7 : daysFromSat;
            total = 7;
        } else if (range === 'month') {
            elapsed = d.getDate();
            total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        } else {
            const start = new Date(d.getFullYear(), 0, 1);
            elapsed = Math.ceil((d - start) / 86400000);
            total = 365;
        }

        if (elapsed === 0) return totalCash;
        const projected = (totalCash / elapsed) * total;
        return Number.isFinite(projected) ? projected : totalCash;
    },

    /**
     * Get expenses for current scope
     */
    getExpensesForScope(dates) {
        const dateSet = new Set(dates);
        let total = 0;

        state.expenses.forEach(expense => {
            if (dateSet.has(expense.date)) {
                total += parseFloat(expense.amount || 0);
            }
        });

        return total;
    },

    /**
     * Get goal (revenue targets)
     */
    getGoal() {
        const goalStr = state.getSetting('nx_goal');
        return goalStr ? JSON.parse(goalStr) : { weekly: 0, monthly: 0 };
    },

    /**
     * Save goal
     */
    async saveGoal(type, value) {
        const goal = this.getGoal();
        goal[type] = value;
        await state.saveSetting('nx_goal', JSON.stringify(goal));
    },

    /**
     * Get tax rate
     */
    getTaxRate() {
        return parseFloat(state.getSetting('nx_tax', '0'));
    },

    /**
     * Set tax rate
     */
    async setTaxRate(rate) {
        await state.saveSetting('nx_tax', rate.toString());
    },

    /**
     * Get pay period (weekly Sat-Fri)
     */
    getPayPeriod(date = new Date()) {
        const d = new Date(date);
        const daysUntilFri = (5 - d.getDay() + 7) % 7;
        const payDate = new Date(d);
        payDate.setDate(d.getDate() + daysUntilFri);
        payDate.setHours(0, 0, 0, 0);

        // Paid on Friday for the work week that ended two Fridays earlier.
        const friday = new Date(payDate);
        friday.setDate(payDate.getDate() - 14);
        friday.setHours(0, 0, 0, 0);

        const saturday = new Date(friday);
        saturday.setDate(friday.getDate() - 6);
        saturday.setHours(0, 0, 0, 0);

        // Calculate totals for this pay period
        let total = 0;
        let count = 0;
        state.jobs.forEach(job => {
            const jobDate = new Date(job.date + 'T00:00:00');
            if (jobDate >= saturday && jobDate <= friday) {
                total += parseFloat(job.fee || 0);
                count++;
            }
        });

        const fmt = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        
        return {
            payWeekMon: saturday,
            thisFriday: friday,
            start: saturday,
            end: friday,
            payDate,
            total,
            count,
            label: fmt(saturday) + ' – ' + fmt(friday)
        };
    },

    /**
     * Get pay period history
     */
    getPayPeriodHistory(numPeriods = 12) {
        const periods = [];
        const now = new Date();
        const daysBackToFri = (now.getDay() + 2) % 7;
        const lastPaidFriday = new Date(now);
        lastPaidFriday.setDate(now.getDate() - daysBackToFri);
        lastPaidFriday.setHours(0, 0, 0, 0);

        for (let i = 0; i < numPeriods; i++) {
            const payDate = new Date(lastPaidFriday);
            payDate.setDate(lastPaidFriday.getDate() - (i * 7));
            payDate.setHours(0, 0, 0, 0);

            const friday = new Date(payDate);
            friday.setDate(payDate.getDate() - 14);
            friday.setHours(0, 0, 0, 0);

            const saturday = new Date(friday);
            saturday.setDate(friday.getDate() - 6);
            saturday.setHours(0, 0, 0, 0);

            let total = 0;
            let count = 0;

            state.jobs.forEach(job => {
                const jobDate = new Date(job.date + 'T00:00:00');
                if (jobDate >= saturday && jobDate <= friday) {
                    total += parseFloat(job.fee || 0);
                    count++;
                }
            });

            const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            periods.push({
                start: saturday,
                end: friday,
                mon: saturday,
                total,
                count,
                label: `${fmt(saturday)} – ${fmt(friday)}`,
                payDate,
                payDateLabel: fmt(payDate)
            });
        }

        return periods;
    }
};
