/**
 * Job Operations Module
 * CRUD operations and business logic for jobs
 */

import { JobTrackerConstants } from './constants.js';
import { JobTrackerUtils } from './utils.js';
import { JobTrackerState } from './state.js';

const { STATUS, SATURDAY_MULTIPLIER } = JobTrackerConstants;
const { generateID, isSaturday, calculateSaturdayFee, shouldApplySaturdayPremium, validateJob } = JobTrackerUtils;
const state = JobTrackerState;

export const JobTrackerJobs = {
    /**
     * Create a new job
     */
    async createJob(jobData) {
        const job = {
            id: generateID(),
            type: jobData.type,
            date: jobData.date,
            status: jobData.status || STATUS.PENDING,
            jobID: jobData.jobID || '',
            notes: jobData.notes || '',
            fee: 0,
            baseFee: null,
            manualFee: false,
            
            // Flags (manager/admin only)
            elf: false,
            candids: false,
            candidsReason: '',
            
            // Chargebacks (manager/admin only)
            chargeback: false,
            chargebackReason: null, // 'ELF', 'Candids', 'other'
            chargebackAmount: null,
            chargebackWeek: null, // date of week to deduct from
            chargebackAddedBy: null,
            chargebackAddedDate: null,
            
            createdAt: new Date().toISOString(),
            completedAt: null,
            ...jobData
        };

        // Validate job
        const validation = validateJob(job);
        if (!validation.valid) {
            throw new Error(validation.errors.join(', '));
        }

        // Calculate fee if not manually set
        if (!job.manualFee) {
            job.fee = this.calculateJobFee(job);
        }

        await state.saveJob(job);
        return job;
    },

    /**
     * Update an existing job
     */
    async updateJob(jobId, updates) {
        const job = state.getJob(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        const updatedJob = {
            ...job,
            ...updates,
            updatedAt: Date.now()
        };

        // If status changed to completed/failed/internals, set completedAt
        if (updates.status && updates.status !== STATUS.PENDING && !job.completedAt) {
            updatedJob.completedAt = Date.now();
        }

        // Recalculate fee unless it's a manual fee or fee was explicitly provided in updates
        if (!updatedJob.manualFee && !updates.hasOwnProperty('fee')) {
            updatedJob.fee = this.calculateJobFee(updatedJob);
        }

        // Validate updated job
        const validation = validateJob(updatedJob);
        if (!validation.valid) {
            throw new Error(validation.errors.join(', '));
        }

        await state.saveJob(updatedJob);
        return updatedJob;
    },

    /**
     * Delete a job
     */
    async deleteJob(jobId) {
        return await state.deleteJob(jobId);
    },

    /**
     * Update job status (common operation)
     */
    async updateJobStatus(jobId, status) {
        return await this.updateJob(jobId, { status });
    },

    /**
     * Set manual fee for a job
     */
    async setManualFee(jobId, fee) {
        const job = state.getJob(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        const updates = {
            fee: parseFloat(fee),
            manualFee: true
        };

        // Store the base fee if it's a Saturday job for reference
        if (isSaturday(job.date) && job.status === STATUS.COMPLETED) {
            updates.baseFee = parseFloat(fee) / SATURDAY_MULTIPLIER;
        }

        return await this.updateJob(jobId, updates);
    },

    /**
     * Reset to automatic fee calculation
     */
    async resetToAutoFee(jobId) {
        const job = state.getJob(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        const autoFee = this.calculateJobFee(job);
        
        return await this.updateJob(jobId, {
            fee: autoFee,
            manualFee: false,
            baseFee: null
        });
    },

    /**
     * Calculate fee for a job based on type and status
     */
    calculateJobFee(job) {
        const typeData = state.getType(job.type);
        if (!typeData) return 0;

        let baseFee = 0;

        if (job.status === STATUS.COMPLETED) {
            baseFee = typeData.pay || 0;
        } else if (job.status === STATUS.INTERNALS) {
            baseFee = typeData.int || 0;
        } else {
            return 0; // Pending and Failed jobs have no fee
        }

        // Apply Saturday premium if applicable
        if (isSaturday(job.date) && job.status === STATUS.COMPLETED && baseFee > 0) {
            return calculateSaturdayFee(baseFee);
        }

        return baseFee;
    },

    /**
     * Recalculate Saturday fees for all applicable jobs
     * This is for retroactive application of the Saturday premium
     */
    async recalculateSaturdayFees() {
        const jobsToUpdate = [];
        
        state.jobs.forEach(job => {
            // Only update jobs that:
            // 1. Are on Saturdays
            // 2. Are completed or internals
            // 3. Don't have manual fees
            // 4. Don't already have the Saturday premium applied
            if (isSaturday(job.date) && 
                (job.status === STATUS.COMPLETED || job.status === STATUS.INTERNALS) && 
                !job.manualFee) {
                
                const typeData = state.getType(job.type);
                if (!typeData) return;

                // Use Internal rate for Internals, completed rate for Completed
                const baseFee = job.status === STATUS.INTERNALS 
                    ? (typeData.int || 0) 
                    : (typeData.pay || 0);
                
                if (baseFee <= 0) return;
                
                const saturdayFee = calculateSaturdayFee(baseFee);
                
                // Check if fee needs updating (not already set to Saturday rate)
                const currentFee = parseFloat(job.fee || 0);
                const expectedBaseFee = baseFee;
                const expectedSaturdayFee = saturdayFee;

                // If current fee is close to base fee, it needs updating
                if (Math.abs(currentFee - expectedBaseFee) < 0.01) {
                    jobsToUpdate.push({
                        ...job,
                        fee: expectedSaturdayFee,
                        baseFee: expectedBaseFee,
                        updatedAt: Date.now()
                    });
                }
            }
        });

        if (jobsToUpdate.length > 0) {
            await state.bulkUpdateJobs(jobsToUpdate);
            return {
                success: true,
                updated: jobsToUpdate.length,
                jobs: jobsToUpdate
            };
        }

        return {
            success: true,
            updated: 0,
            jobs: []
        };
    },

    /**
     * Batch update job statuses
     */
    async batchUpdateStatus(jobIds, status) {
        const jobs = jobIds.map(id => {
            const job = state.getJob(id);
            if (!job) return null;

            const updatedJob = {
                ...job,
                status,
                completedAt: status !== STATUS.PENDING && !job.completedAt ? Date.now() : job.completedAt,
                updatedAt: Date.now()
            };

            // Recalculate fee unless manual
            if (!updatedJob.manualFee) {
                updatedJob.fee = this.calculateJobFee(updatedJob);
            }

            return updatedJob;
        }).filter(j => j !== null);

        if (jobs.length > 0) {
            await state.bulkUpdateJobs(jobs);
        }

        return jobs;
    },

    /**
     * Get jobs for current view scope
     */
    getJobsInScope(viewDate, range) {
        const { isJobInRange } = window.JobTrackerUtils;
        return state.jobs.filter(job => isJobInRange(job, viewDate, range));
    },

    /**
     * Get jobs by status
     */
    getJobsByStatus(status) {
        return state.jobs.filter(job => job.status === status);
    },

    /**
     * Get jobs by date
     */
    getJobsByDate(date) {
        return state.jobs.filter(job => job.date === date);
    },

    /**
     * Get jobs by type
     */
    getJobsByType(type) {
        return state.jobs.filter(job => job.type === type);
    },

    /**
     * Search jobs by query
     */
    searchJobs(query) {
        const q = query.toLowerCase();
        return state.jobs.filter(job => 
            job.type.toLowerCase().includes(q) ||
            (job.jobID && job.jobID.toLowerCase().includes(q)) ||
            (job.notes && job.notes.toLowerCase().includes(q))
        );
    },

    /**
     * Get custom job order for a date
     */
    getJobOrder(date = null) {
        const orderKey = date ? `nx_job_order_${date}` : 'nx_job_order';
        const orderStr = state.getSetting(orderKey);
        return orderStr ? JSON.parse(orderStr) : [];
    },

    /**
     * Save custom job order
     */
    async saveJobOrder(jobIds, date = null) {
        const orderKey = date ? `nx_job_order_${date}` : 'nx_job_order';
        await state.saveSetting(orderKey, JSON.stringify(jobIds));
    },

    /**
     * Clone a job (for creating similar jobs quickly)
     */
    async cloneJob(jobId) {
        const original = state.getJob(jobId);
        if (!original) {
            throw new Error('Job not found');
        }

        const cloned = {
            ...original,
            id: generateID(),
            status: STATUS.PENDING,
            createdAt: Date.now(),
            completedAt: null,
            updatedAt: null,
            manualFee: false
        };

        // Recalculate fee for cloned job
        cloned.fee = this.calculateJobFee(cloned);

        await state.saveJob(cloned);
        return cloned;
    },

    /**
     * Get job statistics summary
     */
    getJobSummary() {
        const total = state.jobs.length;
        const completed = state.jobs.filter(j => j.status === STATUS.COMPLETED).length;
        const pending = state.jobs.filter(j => j.status === STATUS.PENDING).length;
        const failed = state.jobs.filter(j => j.status === STATUS.FAILED).length;
        const internals = state.jobs.filter(j => j.status === STATUS.INTERNALS).length;

        const totalRevenue = state.jobs.reduce((sum, j) => sum + parseFloat(j.fee || 0), 0);

        return {
            total,
            completed,
            pending,
            failed,
            internals,
            totalRevenue,
            completionRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0
        };
    },

    /**
     * Add/update ELF flag on a job
     */
    async setELF(jobId, flagged = true) {
        try {
            let job = state.getJob(jobId);
            
            // If not found in modular state, try legacy app.js state
            if (!job && window.state && window.state.jobs) {
                job = window.state.jobs.find(j => j.id === jobId);
                // Sync to modular state if we found it in legacy state
                if (job) {
                    const index = state.jobs.findIndex(j => j.id === jobId);
                    if (index < 0) {
                        state.jobs.push(job);
                    }
                }
            }
            
            console.log('setELF - Job lookup:', { jobId, found: !!job, status: job?.status });
            
            if (!job) {
                console.error('setELF - Job not found in either state:', jobId);
                return false;
            }
            
            // Allow ELF flag on Completed, Internals, or any job really (remove strict status check)
            // The business rule can be enforced in UI, not in the data layer
            if (job.status === STATUS.PENDING || job.status === STATUS.FAILED) {
                console.warn('setELF - Cannot flag pending/failed job:', jobId, job.status);
                return false;
            }
            
            job.elf = flagged;
            if (flagged) {
                job.elfAddedBy = state.displayName || 'Unknown';
                job.elfAddedDate = new Date().toISOString();
            } else {
                delete job.elfAddedBy;
                delete job.elfAddedDate;
            }
            
            await state.saveJob(job);
            console.log('setELF - Success:', { jobId, flagged });
            return true;
        } catch (e) {
            console.error('setELF - Exception:', e);
            return false;
        }
    },

    /**
     * Add/update Candid flag on a job
     */
    async setCandids(jobId, flagged = true, reason = '') {
        try {
            let job = state.getJob(jobId);
            
            // If not found in modular state, try legacy app.js state
            if (!job && window.state && window.state.jobs) {
                job = window.state.jobs.find(j => j.id === jobId);
                // Sync to modular state if we found it in legacy state
                if (job) {
                    const index = state.jobs.findIndex(j => j.id === jobId);
                    if (index < 0) {
                        state.jobs.push(job);
                    }
                }
            }
            
            console.log('setCandids - Job lookup:', { jobId, found: !!job, status: job?.status });
            
            if (!job) {
                console.error('setCandids - Job not found in either state:', jobId);
                return false;
            }
            
            // Allow Candid flag on any job except pending/failed (same as ELF)
            if (job.status === STATUS.PENDING || job.status === STATUS.FAILED) {
                console.warn('setCandids - Cannot flag pending/failed job:', jobId, job.status);
                return false;
            }
            
            job.candids = flagged;
            job.candidsReason = reason || '';
            if (flagged) {
                job.candidsAddedBy = state.displayName || 'Unknown';
                job.candidsAddedDate = new Date().toISOString();
            } else {
                delete job.candidsAddedBy;
                delete job.candidsAddedDate;
                job.candidsReason = '';
            }
            
            await state.saveJob(job);
            console.log('setCandids - Success:', { jobId, flagged, reason });
            return true;
        } catch (e) {
            console.error('setCandids - Exception:', e);
            return false;
        }
    },

    /**
     * Add chargeback to a job
     */
    async addChargeback(jobId, reason, amount, chargebackWeek) {
        const job = state.getJob(jobId);
        if (!job) return false;
        
        job.chargeback = true;
        job.chargebackReason = reason; // 'ELF', 'Candids', 'other'
        job.chargebackAmount = parseFloat(amount) || job.fee;
        job.chargebackWeek = chargebackWeek || new Date().toDateString();
        job.chargebackAddedBy = state.displayName;
        job.chargebackAddedDate = new Date().toISOString();
        
        await state.saveJob(job);
        state.addNotification('chargeback', `Chargeback of £${job.chargebackAmount.toFixed(2)} scheduled for ${chargebackWeek}`);
        return true;
    },

    /**
     * Remove chargeback from a job
     */
    async removeChargeback(jobId) {
        const job = state.getJob(jobId);
        if (!job) return false;
        
        job.chargeback = false;
        job.chargebackReason = null;
        job.chargebackAmount = null;
        job.chargebackWeek = null;
        
        await state.saveJob(job);
        return true;
    },

    /**
     * Get chargebacks for a specific week
     */
    getChargebacksForWeek(weekDate) {
        const weekStr = new Date(weekDate).toDateString();
        return state.jobs.filter(j => j.chargeback && j.chargebackWeek === weekStr);
    },

    /**
     * Calculate total chargebacks across all weeks
     */
    getTotalChargebacks() {
        return state.jobs
            .filter(j => j.chargeback)
            .reduce((sum, j) => sum + parseFloat(j.chargebackAmount || 0), 0);
    }
};
