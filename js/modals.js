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
// supabase client is set globally during bridge initialization
const getSupabase = () => window.supabaseClient;


export const JobTrackerModals = {
    /**
     * Show modal
     */
    showModal(content) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        if (!modal || !modalBody) return;

        // Clear any lockout set by previous auth modal
        delete modal.dataset.nodismiss;
        modalBody.innerHTML = content;
        modal.style.display = 'flex';
    },

    /**
     * Lock the current modal so backdrop clicks and close buttons are ignored.
     * Used for sign-in / sign-up where the app is unusable without auth.
     */
    lockModal() {
        const modal = document.getElementById('modal');
        if (modal) modal.dataset.nodismiss = 'true';
    },

    /**
     * Close modal
     */
    closeModal() {
        const modal = document.getElementById('modal');
        if (!modal) return;
        // Block dismissal when the app requires authentication
        if (modal.dataset.nodismiss === 'true') return;
        modal.style.display = 'none';
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

            // Calculate what the auto fee would be
            const autoFee = jobOps.calculateJobFee(job);
            const currentFee = parseFloat(job.fee || 0);
            const isManual = job.manualFee || false;

            // Determine if this job type supports Internals
            const typeObj = types.find(t => t.code === job.type);
            const supportsInt = !!(typeObj && typeObj.int !== null && typeObj.int !== undefined);
            const statusCols = supportsInt ? 'repeat(4,1fr)' : 'repeat(3,1fr)';

            const statusBtn = (s, label, bg, color = '#fff') => {
                const active = job.status === s;
                const activeStyle = s === STATUS.PENDING
                    ? (active ? 'outline:2px solid var(--primary); outline-offset:-3px;' : '')
                    : (active ? 'outline:2px solid #fff; outline-offset:-3px;' : '');
                return `<button class="btn" id="status-btn-${s}" style="margin:0; padding:14px 4px; font-size:0.8rem; font-weight:800; background:${bg}; color:${color}; ${activeStyle}" onclick="JobTrackerModals.selectStatus('${s}','${jobId}')">${label}</button>`;
            };

            const content = `
                <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
                <h3 style="margin-bottom:16px;">Edit Job</h3>
                
                <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Type</label>
                <select id="edit-type" class="input-box">
                    ${typeOptions}
                </select>

                <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Status</label>
                <input type="hidden" id="edit-status-value" value="${job.status}">
                <div style="display:grid; grid-template-columns:${statusCols}; gap:6px; margin-bottom:12px;">
                    ${statusBtn(STATUS.PENDING, 'PENDING', 'var(--border)', 'var(--text-main)')}
                    ${statusBtn(STATUS.COMPLETED, 'DONE', 'var(--success)')}
                    ${supportsInt ? statusBtn(STATUS.INTERNALS, 'INT', 'var(--warning)') : ''}
                    ${statusBtn(STATUS.FAILED, 'FAIL', 'var(--danger)')}
                </div>

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

            <div style="margin-top:10px;">
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Notes Assistant</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                    ${Object.keys(NOTE_TEMPLATES).filter(name => name !== 'Custom').map(name =>
                        `<button class="btn" style="margin:0; background:var(--border); color:var(--text-main); font-size:0.72rem; padding:10px 6px;" onclick="JobTrackerModals.applyNoteTemplate('${name.replace(/'/g, "\\'")}')">${name}</button>`
                    ).join('')}
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:16px;">
                <button class="btn" style="background:var(--danger);" onclick="JobTrackerModals.deleteJobConfirm('${jobId}')">Delete</button>
                <button class="btn" onclick="JobTrackerModals.saveJobEdit('${jobId}')">Save</button>
            </div>
        `;

            console.log('About to show modal for job:', jobId);
            JobTrackerModals.showModal(content);
            console.log('Modal displayed');
        } catch (error) {
            console.error('Error in editJob:', error);
            console.error('Stack:', error.stack);
            alert('Error opening job editor: ' + error.message);
        }
    },

    /**
     * Update status button highlights and hidden input when user taps a status button
     */
    selectStatus(status, jobId) {
        const el = document.getElementById('edit-status-value');
        if (el) el.value = status;
        const outlineColors = {
            [STATUS.PENDING]: 'var(--primary)',
            [STATUS.COMPLETED]: '#fff',
            [STATUS.INTERNALS]: '#fff',
            [STATUS.FAILED]: '#fff'
        };
        [STATUS.PENDING, STATUS.COMPLETED, STATUS.INTERNALS, STATUS.FAILED].forEach(s => {
            const btn = document.getElementById(`status-btn-${s}`);
            if (!btn) return;
            const isActive = s === status;
            btn.style.outline = isActive ? `2px solid ${outlineColors[s]}` : 'none';
            btn.style.outlineOffset = isActive ? '-3px' : '';
        });
        if (jobId) this.updateFeePreview(jobId);
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
        const status = document.getElementById('edit-status-value').value;
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
     * Insert a notes template into the edit notes field.
     */
    applyNoteTemplate(templateName) {
        const notesField = document.getElementById('edit-notes');
        if (!notesField) return;

        const template = NOTE_TEMPLATES[templateName] || '';
        if (!template) return;

        const current = notesField.value?.trim();
        notesField.value = current ? `${current}\n\n${template}` : template;
        notesField.focus();
    },

    /**
     * Save job edit
     */
    async saveJobEdit(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        
        const type = document.getElementById('edit-type').value;
        const status = document.getElementById('edit-status-value').value;
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
    },

    /**
     * Authentication Modal
     */
    async showSignIn() {
        const content = `
            <h3 style="margin-bottom:8px; text-align:center;">Sign In</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:20px; text-align:center;">Sign in to access your jobs</p>
            <div style="display:grid; gap:12px;">
                <input type="email" id="auth-email" placeholder="Email" autocomplete="email" style="padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--surface-elev); color:var(--text-main); font-size:1rem;">
                <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password" style="padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--surface-elev); color:var(--text-main); font-size:1rem;">
                <button class="btn" style="background:var(--primary); color:#fff; padding:14px; font-size:1rem;" onclick="JobTrackerModals.handleSignIn()">Sign In</button>
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.showSignUp()">Create Account</button>
            </div>
        `;
        JobTrackerModals.showModal(content);
        JobTrackerModals.lockModal();
    },

    /**
     * Sign Up Modal
     */
    async showSignUp() {
        const content = `
            <h3 style="margin-bottom:8px; text-align:center;">Create Account</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:20px; text-align:center;">Fill in your details to get started</p>
            <div style="display:grid; gap:12px;">
                <input type="text" id="auth-displayname" placeholder="Display Name" autocomplete="name" style="padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--surface-elev); color:var(--text-main); font-size:1rem;">
                <input type="email" id="auth-email" placeholder="Email" autocomplete="email" style="padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--surface-elev); color:var(--text-main); font-size:1rem;">
                <input type="password" id="auth-password" placeholder="Password" autocomplete="new-password" style="padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--surface-elev); color:var(--text-main); font-size:1rem;">
                <button class="btn" style="background:var(--primary); color:#fff; padding:14px; font-size:1rem;" onclick="JobTrackerModals.handleSignUp()">Create Account</button>
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.showSignIn()">Back to Sign In</button>
            </div>
        `;
        JobTrackerModals.showModal(content);
        JobTrackerModals.lockModal();
    },

    /**
     * Profile modal for authenticated users
     */
    async showProfile() {
        const { sanitizeHTML } = getUtils();
        const state = getState();
        const session = JSON.parse(localStorage.getItem('nx_supabase_session') || 'null');
        const user = session?.user || {};
        const email = sanitizeHTML(user?.email || 'Unknown');
        const displayName = sanitizeHTML(user?.user_metadata?.display_name || localStorage.getItem('nx_displayName') || 'User');
        const userLevel = sanitizeHTML((state?.userRole || user?.user_metadata?.role || 'engineer').toString());
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:8px;">Profile</h3>
            <p style="margin:0 0 14px 0; color:var(--text-muted); font-size:0.85rem;">Signed in account details</p>
            <div style="display:grid; gap:10px; margin-bottom:16px;">
                <div style="padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-elev);">
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">Display Name</div>
                    <div style="font-weight:700;">${displayName}</div>
                </div>
                <div style="padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-elev);">
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">Email</div>
                    <div style="font-weight:700;">${email}</div>
                </div>
                <div style="padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-elev);">
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">User Level</div>
                    <div style="font-weight:700; text-transform:capitalize;">${userLevel}</div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.closeModal()">Close</button>
                <button class="btn" style="background:var(--danger);" onclick="JobTrackerModals.handleSignOut()">Sign Out</button>
            </div>
        `;
        JobTrackerModals.showModal(content);
    },

    async handleSignOut() {
        const client = getSupabase();
        const { showToast } = getUtils();
        if (!client) {
            this.customAlert('Sign Out Error', 'No active client found.', true);
            return;
        }

        const result = await client.fullLogout();
        if (result?.success) {
            JobTrackerModals.closeModal();
            showToast('Signed out', 1500);
            setTimeout(() => window.location.reload(), 350);
        } else {
            this.customAlert('Sign Out Error', result?.error || 'Unable to sign out', true);
        }
    },

    /**
     * Handle sign-in submission
     */
    async handleSignIn() {
        const email = document.getElementById('auth-email')?.value?.trim();
        const password = document.getElementById('auth-password')?.value;
        
        // Get showToast from utils
        const { showToast } = getUtils();

        if (!email || !password) {
            this.customAlert('Validation', 'Please enter email and password', true);
            return;
        }

        try {
            const client = getSupabase();
            if (!client) {
                console.error('[Modals] Supabase client not available');
                console.log('[Modals] window.supabaseClient:', window.supabaseClient);
                console.log('[Modals] config might not be set. Check SUPABASE_CONFIG in console');
                this.customAlert('Configuration Error', 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment (see README.md).', true);
                return;
            }
            
            console.log('[Modals] Attempting sign in for:', email);
            const result = await client.signIn(email, password);
            
            if (result.success) {
                console.log('[Modals] Sign in successful:', result.user.id);
                // Revoke all other active sessions for shared-device security
                try { await client.signOutOtherSessions(); } catch (_) {}
                JobTrackerModals.closeModal();
                showToast('Signed in! Loading your data...', 2000);
                // Reload to fully reinitialise: sync engine, render, auth button
                setTimeout(() => window.location.reload(), 400);
            } else {
                console.warn('[Modals] Sign in failed:', result.error);
                this.customAlert('Sign In Failed', result.error, true);
            }
        } catch (error) {
            console.error('[Modals] Sign in exception:', error);
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Handle sign-up submission
     */
    async handleSignUp() {
        const displayName = document.getElementById('auth-displayname')?.value?.trim();
        const email = document.getElementById('auth-email')?.value?.trim();
        const password = document.getElementById('auth-password')?.value;
        
        // Get showToast from utils
        const { showToast } = getUtils();

        if (!displayName || !email || !password) {
            this.customAlert('Validation', 'Please fill all fields', true);
            return;
        }

        if (password.length < 6) {
            this.customAlert('Validation', 'Password must be at least 6 characters', true);
            return;
        }

        try {
            const client = getSupabase();
            if (!client) {
                console.error('[Modals] Supabase client not available for signup');
                this.customAlert('Configuration Error', 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment (see README.md).', true);
                return;
            }
            
            console.log('[Modals] Attempting sign up for:', email);
            const result = await client.signUp(email, password, displayName);
            
            if (result.success) {
                console.log('[Modals] Sign up successful:', result.user.id);
                if (result.needsVerification) {
                    this.customAlert('Account Created', 'Check your email to verify your account before signing in.');
                } else {
                    this.customAlert('Success', `Welcome, ${displayName}!`);
                    JobTrackerModals.closeModal();
                    showToast('Loading your jobs...', 2000);
                    // Don't reload - instead update UI in place
                    setTimeout(() => {
                        // Trigger sync to pull remote jobs
                        if (window.syncEngine) {
                            window.syncEngine.fullSync().catch(e => console.error('Sync failed:', e));
                        }
                        // Re-render with authenticated user
                        if (window.appRender) {
                            window.appRender();
                        }
                    }, 500);
                }
            } else {
                console.warn('[Modals] Sign up failed:', result.error);
                this.customAlert('Sign Up Failed', result.error, true);
            }
        } catch (error) {
            console.error('[Modals] Sign up exception:', error);
            this.customAlert('Error', error.message, true);
        }
    }
};

// maintain global reference for inline handlers
if (typeof window !== 'undefined') {
    window.JobTrackerModals = JobTrackerModals;
}

