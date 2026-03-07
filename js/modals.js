/**
 * Modal UI Module
 * Handles all modal dialogs and popups
 */

import { JobTrackerConstants } from './constants.js';
import { JobTrackerState } from './state.js';
import { JobTrackerJobs } from './jobs.js';
import { JobTrackerUtils } from './utils.js';

const { STATUS, NOTE_TEMPLATES } = JobTrackerConstants;
// accessor helpers
const getState = () => JobTrackerState;
const getJobOps = () => JobTrackerJobs;
const getUtils = () => JobTrackerUtils;

export const JobTrackerModals = {
    /**
     * Show modal
     */
    showModal(content) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        if (!modal || !modalBody) return;

        modalBody.innerHTML = content;
        modal.style.display = 'flex';
    },

    /**
     * Close modal
     */
    closeModal() {
        const modal = document.getElementById('modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    /**
     * Custom alert
     */
    customAlert(title, message, isError = false) {
        const { sanitizeHTML } = getUtils();
        
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:16px; color:${isError ? 'var(--danger)' : 'var(--text-main)'};">${sanitizeHTML(title)}</h3>
            <p style="color:var(--text-muted); line-height:1.6; margin-bottom:20px;">${sanitizeHTML(message)}</p>
            <button class="btn" onclick="JobTrackerModals.closeModal()">OK</button>
        `;
        // don't rely on `this`; callers may extract the function.
        JobTrackerModals.showModal(content);
    },

    /**
     * Confirmation modal
     */
    confirmModal(title, message, confirmActionText, confirmActionCb, isDanger = false) {
        const { sanitizeHTML } = getUtils();
        
        const buttonStyle = isDanger ? 'background:var(--danger);' : '';
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:16px;">${sanitizeHTML(title)}</h3>
            <p style="color:var(--text-muted); line-height:1.6; margin-bottom:20px;">${sanitizeHTML(message)}</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.closeModal()">Cancel</button>
                <button class="btn" style="${buttonStyle}" onclick="JobTrackerModals.handleConfirm()">${sanitizeHTML(confirmActionText)}</button>
            </div>
        `;
        
        JobTrackerModals.confirmCallback = confirmActionCb;
        JobTrackerModals.showModal(content);
    },

    /**
     * Handle confirm action
     */
    handleConfirm() {
        if (this.confirmCallback) {
            this.confirmCallback();
            this.confirmCallback = null;
        }
        this.closeModal();
    },

    /**
     * Edit job modal with manual fee option
     */
    async editJob(jobId) {
        try {
            const state = getState();
            const jobOps = getJobOps();
            const { sanitizeHTML } = getUtils();
            
            if (!state) {
                console.error('State not available');
                return;
            }
            
            const job = state.getJob(jobId);
            if (!job) {
                console.error('Job not found:', jobId);
                return;
            }

            const types = state.types;
            const typeOptions = types.map(t => 
                `<option value="${t.code}" ${job.type === t.code ? 'selected' : ''}>${t.code}</option>`
            ).join('');

            const statusOptions = Object.values(STATUS).map(s =>
                `<option value="${s}" ${job.status === s ? 'selected' : ''}>${s}</option>`
            ).join('');

            // Calculate what the auto fee would be
            const autoFee = jobOps.calculateJobFee(job);
            const currentFee = parseFloat(job.fee || 0);
            const isManual = job.manualFee || false;

            const content = `
                <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
                <h3 style="margin-bottom:16px;">Edit Job</h3>
                
                <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Type</label>
                <select id="edit-type" class="input-box">
                    ${typeOptions}
                </select>

                <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Status</label>
                <select id="edit-status" class="input-box" onchange="JobTrackerModals.updateFeePreview('${jobId}')"
                    ${statusOptions}
            </select>

            <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Date</label>
            <input type="date" id="edit-date" class="input-box" value="${job.date}" onchange="JobTrackerModals.updateFeePreview('${jobId}')">

            <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Job ID (Optional)</label>
            <input type="text" id="edit-jobid" class="input-box" value="${sanitizeHTML(job.jobID || '')}" placeholder="e.g., WO12345">

            <div style="margin-top:20px; padding:16px; background:var(--surface-elev); border-radius:var(--radius-md); border:1px solid var(--border-subtle);">
                <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px; display:block;">
                    Fee
                    <span style="font-size:0.65rem; font-weight:600; text-transform:none; color:var(--text-subtle); margin-left:6px;">(£)</span>
                </label>
                
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <input type="number" id="edit-fee" class="input-box" style="flex:1; margin:0;" 
                           value="${currentFee.toFixed(2)}" step="0.01" min="0"
                           ${!isManual ? 'disabled' : ''}>
                    
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:var(--text-muted); cursor:pointer; white-space:nowrap;">
                        <input type="checkbox" id="manual-fee-toggle" 
                               onchange="JobTrackerModals.toggleManualFee('${jobId}')"
                               ${isManual ? 'checked' : ''}>
                        Manual
                    </label>
                </div>

                <div id="fee-info" style="font-size:0.7rem; color:var(--text-muted); line-height:1.5;">
                    ${isManual ? 
                        `<span style="color:var(--warning);">⚠ Manual fee set</span>` :
                        `<span>Auto: £${autoFee.toFixed(2)}${job.date && JobTrackerUtils.isSaturday(job.date) && job.status === STATUS.COMPLETED ? ' (Sat 1.5×)' : ''}</span>`
                    }
                </div>
            </div>

            <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block; margin-top:12px;">Notes</label>
            <textarea id="edit-notes" class="input-box" rows="4" placeholder="Add notes...">${sanitizeHTML(job.notes || '')}</textarea>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:16px;">
                <button class="btn" style="background:var(--danger);" onclick="JobTrackerModals.deleteJobConfirm('${jobId}')">Delete</button>
                <button class="btn" onclick="JobTrackerModals.saveJobEdit('${jobId}')">Save</button>
            </div>
        `;

            console.log('About to show modal for job:', jobId);
            this.showModal(content);
            console.log('Modal displayed');
        } catch (error) {
            console.error('Error in editJob:', error);
            console.error('Stack:', error.stack);
            alert('Error opening job editor: ' + error.message);
        }
    },

    /**
     * Toggle manual fee mode
     */
    toggleManualFee(jobId) {
        const isManual = document.getElementById('manual-fee-toggle').checked;
        const feeInput = document.getElementById('edit-fee');
        const feeInfo = document.getElementById('fee-info');

        feeInput.disabled = !isManual;

        if (isManual) {
            feeInfo.innerHTML = '<span style="color:var(--warning);">⚠ Manual fee enabled - auto-calculation disabled</span>';
        } else {
            this.updateFeePreview(jobId);
        }
    },

    /**
     * Update fee preview when status or date changes
     */
    updateFeePreview(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const job = state.getJob(jobId);
        if (!job) return;

        const type = document.getElementById('edit-type').value;
        const status = document.getElementById('edit-status').value;
        const date = document.getElementById('edit-date').value;
        const isManual = document.getElementById('manual-fee-toggle').checked;

        if (!isManual) {
            // Calculate what the fee would be
            const tempJob = { ...job, type, status, date };
            const autoFee = jobOps.calculateJobFee(tempJob);
            
            const feeInput = document.getElementById('edit-fee');
            const feeInfo = document.getElementById('fee-info');
            
            feeInput.value = autoFee.toFixed(2);
            
            const isSat = JobTrackerUtils.isSaturday(date);
            feeInfo.innerHTML = `<span>Auto: £${autoFee.toFixed(2)}${isSat && status === STATUS.COMPLETED ? ' (Sat 1.5×)' : ''}</span>`;
        }
    },

    /**
     * Save job edit
     */
    async saveJobEdit(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        
        const type = document.getElementById('edit-type').value;
        const status = document.getElementById('edit-status').value;
        const date = document.getElementById('edit-date').value;
        const jobID = document.getElementById('edit-jobid').value;
        const notes = document.getElementById('edit-notes').value;
        const isManual = document.getElementById('manual-fee-toggle').checked;
        const fee = parseFloat(document.getElementById('edit-fee').value);

        try {
            const updates = {
                type,
                status,
                date,
                jobID,
                notes
            };

            if (isManual) {
                await jobOps.setManualFee(jobId, fee);
                // Then update other fields
                await jobOps.updateJob(jobId, updates);
            } else {
                // Reset to auto if it was manual before
                const job = state.getJob(jobId);
                if (job.manualFee) {
                    await jobOps.resetToAutoFee(jobId);
                }
                await jobOps.updateJob(jobId, updates);
            }

            this.closeModal();
            showToast('Job updated successfully');
            
            // Trigger re-render
            if (window.render) window.render(true);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Delete job confirmation
     */
    deleteJobConfirm(jobId) {
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        
        this.confirmModal(
            'Delete Job',
            'Are you sure you want to delete this job? This action cannot be undone.',
            'Delete',
            async () => {
                await jobOps.deleteJob(jobId);
                showToast('Job deleted');
                if (window.render) window.render(true);
            },
            true
        );
    },

    /**
     * Show Saturday fee recalculation dialog
     */
    showSaturdayRecalculationDialog() {
        const state = getState();
        
        // Count how many Saturday jobs would be affected
        const saturdayJobs = state.jobs.filter(job => 
            JobTrackerUtils.isSaturday(job.date) && 
            (job.status === STATUS.COMPLETED || job.status === STATUS.INTERNALS) && 
            !job.manualFee
        );

        let affectedCount = 0;
        saturdayJobs.forEach(job => {
            const typeData = state.getType(job.type);
            if (!typeData) return;

            // Use Internal rate for Internals, completed rate for Completed
            const baseFee = job.status === STATUS.INTERNALS 
                ? (typeData.int || 0) 
                : (typeData.pay || 0);
            
            if (baseFee <= 0) return;
            
            const currentFee = parseFloat(job.fee || 0);
            
            // Check if needs updating
            if (Math.abs(currentFee - baseFee) < 0.01) {
                affectedCount++;
            }
        });

        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:16px;">Saturday Job Fix</h3>
            <p style="color:var(--text-muted); line-height:1.6; margin-bottom:16px;">
                This will correct older Saturday jobs (Completed + Internals) to the proper Saturday rate.
            </p>
            <div style="background:var(--surface-elev); padding:16px; border-radius:var(--radius-md); margin-bottom:20px; border:1px solid var(--border-subtle);">
                <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:8px;">Jobs to update:</div>
                <div style="font-size:1.8rem; font-weight:800; color:var(--primary);">${affectedCount}</div>
            </div>
            ${affectedCount === 0 ? 
                '<p style="color:var(--success); font-size:0.85rem; text-align:center; margin-bottom:16px;">✓ All Saturday jobs already have the premium applied!</p>' :
                '<p style="color:var(--warning); font-size:0.85rem; margin-bottom:16px;">This updates past Saturday jobs only. Manual fees are not changed.</p>'
            }
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.closeModal()">Cancel</button>
                <button class="btn" onclick="JobTrackerModals.executeSaturdayRecalculation()" ${affectedCount === 0 ? 'disabled' : ''}>Fix Jobs</button>
            </div>
        `;

        this.showModal(content);
    },

    /**
     * Execute Saturday fee recalculation
     */
    async executeSaturdayRecalculation() {
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        
        try {
            const result = await jobOps.recalculateSaturdayFees();
            
            this.closeModal();
            
            if (result.updated > 0) {
                showToast(`✓ Updated ${result.updated} Saturday job${result.updated !== 1 ? 's' : ''}`);
                if (window.render) window.render(true);
            } else {
                showToast('No jobs needed updating');
            }
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Show data export/import dialog
     */
    showDataManagement() {
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:16px;">Data Management</h3>
            
            <div style="margin-bottom:24px;">
                <h4 style="font-size:0.85rem; font-weight:700; margin-bottom:12px; color:var(--text-main);">Export Data</h4>
                <p style="font-size:0.75rem; color:var(--text-muted); line-height:1.5; margin-bottom:12px;">
                    Download all your data as a JSON file for backup or transfer.
                </p>
                <button class="btn" onclick="JobTrackerModals.exportData()">
                    <span style="margin-right:6px;">⬇</span> Export Backup
                </button>
            </div>

            <div style="margin-bottom:24px;">
                <h4 style="font-size:0.85rem; font-weight:700; margin-bottom:12px; color:var(--text-main);">Import Data</h4>
                <p style="font-size:0.75rem; color:var(--text-muted); line-height:1.5; margin-bottom:12px;">
                    Import data from a previously exported backup file.
                </p>
                <button class="btn" style="background:var(--warning);" onclick="JobTrackerModals.importData()">
                    <span style="margin-right:6px;">⬆</span> Import Backup
                </button>
            </div>

            <div style="padding:16px; background:var(--primary-dim); border-radius:var(--radius-md); border:1px solid var(--primary);">
                <p style="font-size:0.7rem; color:var(--text-main); line-height:1.5;">
                    <strong>Note:</strong> Your data is automatically stored in your browser's IndexedDB. Backups are recommended for safekeeping.
                </p>
            </div>
        `;

        this.showModal(content);
    },

    /**
     * Export data
     */
    async exportData() {
        const state = getState();
        const { showToast } = getUtils();
        
        try {
            const data = await state.exportAll();
            const filename = `job-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
            await JobTrackerUtils.exportDataAsFile(data, filename);
            
            showToast('✓ Data exported successfully');
            this.closeModal();
        } catch (error) {
            this.customAlert('Export Error', error.message, true);
        }
    },

    /**
     * Import data
     */
    async importData() {
        const state = getState();
        const { showToast } = getUtils();
        
        try {
            const data = await JobTrackerUtils.importDataFromFile();
            
            this.confirmModal(
                'Import Data',
                'This will replace all your current data with the backup. Are you sure?',
                'Import',
                async () => {
                    const result = await state.importAll(data);
                    if (result) {
                        showToast('✓ Data imported successfully');
                        if (window.render) window.render();
                    } else {
                        this.customAlert('Import Error', 'Failed to import data', true);
                    }
                },
                true
            );
        } catch (error) {
            this.customAlert('Import Error', error.message, true);
        }
    }
};

// maintain global reference for inline handlers
if (typeof window !== 'undefined') {
    window.JobTrackerModals = JobTrackerModals;
}

