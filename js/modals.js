/**
 * Modal UI Module
 * Handles all modal dialogs and popups
 */

import { JobTrackerConstants } from './constants.js';
import { JobTrackerState } from './state.js';
import { JobTrackerJobs } from './jobs.js';
import { JobTrackerUtils } from './utils.js';

const { STATUS } = JobTrackerConstants;
// accessor helpers
const getState = () => JobTrackerState;
const getJobOps = () => JobTrackerJobs;
const getUtils = () => JobTrackerUtils;
// supabase client is set globally during bridge initialization
const getSupabase = () => window.supabaseClient;

let notesWizardJobId = null;
let notesWizardStep = 1;


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
     * Edit an existing job type from settings.
     */
    editType(typeCode) {
        const state = getState();
        const { sanitizeHTML } = getUtils();
        const type = state.getType(typeCode);
        if (!type) {
            this.customAlert('Type Not Found', `Could not find type ${typeCode}`, true);
            return;
        }

        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:14px;">Edit Type: ${sanitizeHTML(type.code)}</h3>

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:4px; display:block;">Code</label>
            <input id="type-code" class="input-box" value="${sanitizeHTML(type.code)}" disabled>

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin:10px 0 4px; display:block;">Completed Pay (£)</label>
            <input id="type-pay" class="input-box" type="number" step="0.01" min="0" value="${Number(type.pay || 0)}">

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin:10px 0 4px; display:block;">Internals Pay (£)</label>
            <input id="type-int" class="input-box" type="number" step="0.01" min="0" value="${type.int == null ? '' : Number(type.int)}" placeholder="Leave empty for N/A">

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin:10px 0 4px; display:block;">Upgrade Pay (£)</label>
            <input id="type-upgrade" class="input-box" type="number" step="0.01" min="0" value="${type.upgradePay == null ? '' : Number(type.upgradePay)}" placeholder="Optional">

            <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:0.8rem; color:var(--text-main);">
                <input id="type-completion" type="checkbox" ${type.countTowardsCompletion === false ? '' : 'checked'}>
                Counts toward completion metrics
            </label>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px;">
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.closeModal()">Cancel</button>
                <button class="btn" onclick="JobTrackerModals.saveTypeFromModal(false)">Save</button>
            </div>
        `;
        this.showModal(content);
    },

    /**
     * Create a new job type from settings.
     */
    addType() {
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:14px;">Create Job Type</h3>

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:4px; display:block;">Code</label>
            <input id="type-code" class="input-box" maxlength="12" placeholder="e.g. OH2">

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin:10px 0 4px; display:block;">Completed Pay (£)</label>
            <input id="type-pay" class="input-box" type="number" step="0.01" min="0" value="0">

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin:10px 0 4px; display:block;">Internals Pay (£)</label>
            <input id="type-int" class="input-box" type="number" step="0.01" min="0" placeholder="Leave empty for N/A">

            <label style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin:10px 0 4px; display:block;">Upgrade Pay (£)</label>
            <input id="type-upgrade" class="input-box" type="number" step="0.01" min="0" placeholder="Optional">

            <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:0.8rem; color:var(--text-main);">
                <input id="type-completion" type="checkbox" checked>
                Counts toward completion metrics
            </label>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px;">
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.closeModal()">Cancel</button>
                <button class="btn" onclick="JobTrackerModals.saveTypeFromModal(true)">Create</button>
            </div>
        `;
        this.showModal(content);
    },

    /**
     * Save the type form from add/edit type modal.
     */
    async saveTypeFromModal(isCreate) {
        const state = getState();
        const { showToast } = getUtils();

        const code = (document.getElementById('type-code')?.value || '').trim();
        const pay = parseFloat(document.getElementById('type-pay')?.value || '0');
        const intRaw = (document.getElementById('type-int')?.value || '').trim();
        const upgradeRaw = (document.getElementById('type-upgrade')?.value || '').trim();
        const countTowardsCompletion = !!document.getElementById('type-completion')?.checked;

        if (!code) {
            this.customAlert('Validation', 'Type code is required', true);
            return;
        }
        if (!Number.isFinite(pay) || pay < 0) {
            this.customAlert('Validation', 'Completed pay must be a valid non-negative number', true);
            return;
        }

        const intVal = intRaw === '' ? null : parseFloat(intRaw);
        if (intVal !== null && (!Number.isFinite(intVal) || intVal < 0)) {
            this.customAlert('Validation', 'Internals pay must be blank or a valid non-negative number', true);
            return;
        }

        const upgradeVal = upgradeRaw === '' ? null : parseFloat(upgradeRaw);
        if (upgradeVal !== null && (!Number.isFinite(upgradeVal) || upgradeVal < 0)) {
            this.customAlert('Validation', 'Upgrade pay must be blank or a valid non-negative number', true);
            return;
        }

        if (isCreate && state.getType(code)) {
            this.customAlert('Validation', `Type ${code} already exists`, true);
            return;
        }

        try {
            await state.saveType({
                code,
                pay,
                int: intVal,
                upgradePay: upgradeVal,
                countTowardsCompletion
            });
            this.closeModal();
            showToast(isCreate ? 'Type created' : 'Type updated');
            if (window.render) window.render(true);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Notes search tool from settings.
     */
    showNotesSearch() {
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:8px;">Search Notes</h3>
            <p style="margin:0 0 10px 0; color:var(--text-muted); font-size:0.8rem;">Find jobs by note text</p>
            <input id="notes-search-query" class="input-box" placeholder="Type keyword..." oninput="JobTrackerModals.runNotesSearch()">
            <div id="notes-search-results" style="margin-top:10px; max-height:55vh; overflow-y:auto;"></div>
        `;
        this.showModal(content);
        this.runNotesSearch();
    },

    runNotesSearch() {
        const state = getState();
        const { sanitizeHTML } = getUtils();
        const q = (document.getElementById('notes-search-query')?.value || '').trim().toLowerCase();
        const out = document.getElementById('notes-search-results');
        if (!out) return;

        const hits = state.jobs
            .filter(j => (j.notes || '').toLowerCase().includes(q))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, 100);

        if (hits.length === 0) {
            out.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; padding:8px;">No matching notes</div>';
            return;
        }

        out.innerHTML = hits.map(j => `
            <div style="padding:10px; border:1px solid var(--border-subtle); border-radius:8px; margin-bottom:8px; background:var(--surface-elev); cursor:pointer;" onclick="window.JobTrackerModals.closeModal(); window.state.viewDate=new Date('${j.date}T00:00:00'); window.state.range='day'; if(window.render) window.render(); setTimeout(()=>window.JobTrackerModals.editJob('${j.id}'),120);">
                <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px;">
                    <b>${sanitizeHTML(j.type || 'JOB')}</b>
                    <span style="font-size:0.72rem; color:var(--text-muted);">${sanitizeHTML(j.date || '')}</span>
                </div>
                <div style="font-size:0.78rem; color:var(--text-main); line-height:1.4; white-space:pre-wrap;">${sanitizeHTML((j.notes || '').slice(0, 180))}${(j.notes || '').length > 180 ? '...' : ''}</div>
            </div>
        `).join('');
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
            const role = (state.userRole || '').toLowerCase();
            const canManageFlags = role === 'admin' || role === 'manager';

            // Determine if this job type supports Internals
            const typeObj = types.find(t => t.code === job.type);
            const supportsInt = !!(typeObj && typeObj.int !== null && typeObj.int !== undefined);
            const statusCols = supportsInt ? 'repeat(4,1fr)' : 'repeat(3,1fr)';
            const supportsNotesWizard = ['OH', 'UG', 'HyOH', 'HyUG'].includes(job.type) || (job.type === 'BTTW' && job.isUpgraded);

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
                ${supportsNotesWizard ? `<button class="btn" style="margin:0 0 8px 0; background:var(--border); color:var(--text-main);" onclick="JobTrackerModals.openNotesWizard('${jobId}')">NOTES ASSISTANT</button>` : ''}
            </div>

            ${canManageFlags ? `
            <div style="margin-top:12px; padding:12px; border:1px solid var(--border-subtle); border-radius:8px; background:var(--surface-elev);">
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; margin-bottom:8px;">Admin Flags</div>

                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
                    <div style="font-size:0.8rem; color:var(--text-main);">ELF ${job.elf ? '🧝' : ''}</div>
                    <button class="btn" style="margin:0; padding:8px 10px; font-size:0.75rem; background:${job.elf ? 'var(--danger)' : 'var(--warning)'};" onclick="JobTrackerModals.toggleELF('${jobId}')">${job.elf ? 'REMOVE' : 'ADD'}</button>
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="font-size:0.8rem; color:var(--text-main);">Candid ${job.candids ? '📷' : ''}</div>
                    <button class="btn" style="margin:0; padding:8px 10px; font-size:0.75rem; background:${job.candids ? 'var(--danger)' : 'var(--warning)'};" onclick="JobTrackerModals.editCandid('${jobId}')">${job.candids ? 'EDIT/REMOVE' : 'ADD'}</button>
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px;">
                    <div style="font-size:0.8rem; color:var(--text-main);">Chargeback ${job.chargeback ? '💸' : ''}</div>
                    <button class="btn" style="margin:0; padding:8px 10px; font-size:0.75rem; background:${job.chargeback ? 'var(--danger)' : 'var(--warning)'};" onclick="JobTrackerModals.editChargeback('${jobId}')">${job.chargeback ? 'EDIT/REMOVE' : 'ADD'}</button>
                </div>

                ${job.candids ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:8px;">Reason: ${sanitizeHTML(job.candidsReason || 'Flagged')}</div>` : ''}
                ${job.chargeback ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">Chargeback: £${Number(job.chargebackAmount || 0).toFixed(2)} (${sanitizeHTML(job.chargebackReason || 'other')})</div>` : ''}
            </div>
            ` : ''}

            ${job.status !== STATUS.PENDING ? `<button class="btn" style="background:var(--border); color:var(--text-main); margin-top:12px;" onclick="JobTrackerModals.revertToPending('${jobId}')">↺ Revert To Pending</button>` : ''}

            <button class="btn" style="background:var(--border); color:var(--text-main); margin-top:8px;" onclick="JobTrackerModals.duplicateJob('${jobId}')">Duplicate Job</button>

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
     * Open the original guided FTTP notes assistant modal.
     */
    openNotesWizard(jobId) {
        notesWizardJobId = jobId;
        const content = `
            <button class="close-btn" onclick="JobTrackerModals.closeModal()">×</button>
            <h3 style="margin-bottom:16px;">FTTP Notes Generator</h3>
            <div id="fttp-wizard">
                <div class="step" data-step="1">
                    <label>Span</label>
                    <div class="btn-group">
                        <button class="option-btn" data-value="Pole">Pole</button>
                        <button class="option-btn" data-value="Pit">Pit</button>
                    </div>
                </div>
                <div class="step" data-step="2">
                    <label>CBT</label>
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Port</label>
                            <div class="btn-group" style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;">
                                ${Array.from({ length: 12 }, (_, i) => `<button class="option-btn" data-value="${i + 1}">${i + 1}</button>`).join('')}
                            </div>
                        </div>
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Light (dBm)</label>
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <button type="button" class="inc" data-target="cbt-light" data-step="-0.1">-</button>
                                <input type="text" id="cbt-light" class="light-input" value="-15.0" style="flex:1; min-height:48px;" oninput="JobTrackerModals.validateLight(this)">
                                <button type="button" class="inc" data-target="cbt-light" data-step="0.1">+</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="step" data-step="3">
                    <label>ONT</label>
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Manufacturer</label>
                            <div class="btn-group">
                                <button class="option-btn" data-value="Adtran">Adtran</button>
                                <button class="option-btn" data-value="Nokia">Nokia</button>
                                <button class="option-btn" data-value="Zyxel">Zyxel</button>
                                <button class="option-btn" data-value="Other">Other</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Light (dBm)</label>
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <button type="button" class="inc" data-target="ont-light" data-step="-0.1">-</button>
                                <input type="text" id="ont-light" class="light-input" value="-15.0" style="flex:1; min-height:48px;" oninput="JobTrackerModals.validateLight(this)">
                                <button type="button" class="inc" data-target="ont-light" data-step="0.1">+</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="step" data-step="4">
                    <label>CSP</label>
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Type</label>
                            <div class="btn-group">
                                <button class="option-btn" data-value="Internal">Internal</button>
                                <button class="option-btn" data-value="External">External</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Splice Loss (dB)</label>
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <button type="button" class="inc" data-target="splice-loss" data-step="-0.01">-</button>
                                <input type="text" id="splice-loss" class="light-input" value="0.03" style="flex:1; min-height:48px;" oninput="JobTrackerModals.validateSplice(this)">
                                <button type="button" class="inc" data-target="splice-loss" data-step="0.01">+</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="step" data-step="5">
                    <label>Cable</label>
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Rip (m)</label>
                            <div class="btn-group" style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;">
                                <button class="option-btn" data-value="0" data-type="rip">0m</button>
                                <button class="option-btn" data-value="5" data-type="rip">5m</button>
                                <button class="option-btn" data-value="10" data-type="rip">10m</button>
                                <button class="option-btn" data-value="15" data-type="rip">15m</button>
                                <button class="option-btn" data-value="20" data-type="rip">20m</button>
                                <button class="option-btn" data-value="30" data-type="rip">30m</button>
                                <button class="option-btn" data-value="40" data-type="rip">40m</button>
                                <button class="option-btn" data-value="50" data-type="rip">50m</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Drop (m)</label>
                            <div class="btn-group" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.5rem;">
                                <button class="option-btn" data-value="35" data-type="drop">35m</button>
                                <button class="option-btn" data-value="65" data-type="drop">65m</button>
                                <button class="option-btn" data-value="105" data-type="drop">105m</button>
                                <button class="option-btn" data-value="160+" data-type="drop">160m+</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="step" data-step="6">
                    <label>Router</label>
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Status</label>
                            <div class="btn-group">
                                <button class="option-btn" data-value="Online">Online</button>
                                <button class="option-btn" data-value="Offline">Offline</button>
                                <button class="option-btn" data-value="No Router">No Router</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size:1rem; color:var(--text-main); font-weight:600; margin-bottom:0.5rem; display:block;">Speed (Mbps)</label>
                            <input type="text" id="router-speed" class="light-input" value="500" style="width:100%; min-height:48px;">
                        </div>
                    </div>
                </div>
                <div class="step" data-step="7">
                    <label>Live & Proven</label>
                    <div class="btn-group">
                        <button class="option-btn" data-value="Yes">Yes</button>
                        <button class="option-btn" data-value="No">No</button>
                    </div>
                </div>
                <div class="nav-btns">
                    <button id="prev-fttp" class="nav-btn">Back</button>
                    <button id="next-fttp" class="nav-btn">Next</button>
                </div>
            </div>
            <pre id="fttp-output" style="margin-top:2rem; padding:1rem; background:var(--surface-t); border-radius:8px; border:1px solid var(--border-t); white-space:pre-wrap; font-family:monospace; display:none;"></pre>
            <button id="apply-fttp" style="margin-top:1rem; padding:0.5rem 1rem; background:var(--primary); color:white; border:none; border-radius:6px; cursor:pointer; display:none;" onclick="JobTrackerModals.applyFTTPNotes()">Apply to Notes</button>
        `;

        this.showModal(content);
        this.initFTTPWizard();
    },

    validateLight(input) {
        const val = parseFloat(input.value);
        if (Number.isNaN(val)) {
            input.style.color = 'var(--text-main)';
            return;
        }
        input.style.color = (val > -14 || val < -25) ? 'var(--danger)' : 'var(--success)';
    },

    validateSplice(input) {
        const val = parseFloat(input.value);
        if (Number.isNaN(val)) {
            input.style.color = 'var(--text-main)';
            return;
        }
        input.style.color = (val < 0 || val > 0.05) ? 'var(--danger)' : 'var(--success)';
    },

    initFTTPWizard() {
        notesWizardStep = 1;
        this.updateFTTPWizardDisplay();

        const state = getState();
        const job = state.getJob(notesWizardJobId);
        const defaultSpan = (job && (['UG', 'HyUG'].includes(job.type) || (job.type === 'BTTW' && job.isUpgraded))) ? 'Pit' : 'Pole';

        const defaults = [
            { step: 1, val: defaultSpan },
            { step: 2, val: '8' },
            { step: 3, val: 'Nokia' },
            { step: 4, val: 'External' },
            { step: 5, val: '5', type: 'rip' },
            { step: 5, val: '65', type: 'drop' },
            { step: 6, val: 'Online' },
            { step: 7, val: 'Yes' }
        ];

        document.querySelectorAll('#fttp-wizard .option-btn').forEach(btn => {
            btn.classList.remove('selected');
            btn.onclick = () => {
                const stepContainer = btn.closest('.step');
                if (!stepContainer) return;
                const stepNum = parseInt(stepContainer.getAttribute('data-step'), 10);

                if (stepNum === 7 && btn.getAttribute('data-value') === 'Yes') {
                    const routerSel = document.querySelector('.step[data-step="6"] .option-btn.selected');
                    if (routerSel && routerSel.getAttribute('data-value') !== 'Online') return;
                }

                const siblings = btn.parentElement.querySelectorAll('.option-btn');
                siblings.forEach(s => s.classList.remove('selected'));
                btn.classList.add('selected');

                if ([1, 4, 7].includes(stepNum)) {
                    setTimeout(() => JobTrackerModals.nextFTTPWizardStep(), 300);
                }

                if (stepNum === 6) {
                    const routerVal = btn.getAttribute('data-value');
                    const speedInput = document.getElementById('router-speed');
                    if (routerVal !== 'Online') {
                        if (speedInput) {
                            speedInput.value = 'N/A';
                            speedInput.disabled = true;
                            speedInput.style.opacity = '0.4';
                        }
                        const lpBtns = document.querySelectorAll('.step[data-step="7"] .option-btn');
                        lpBtns.forEach(lp => {
                            lp.classList.remove('selected');
                            if (lp.getAttribute('data-value') === 'No') lp.classList.add('selected');
                        });
                    } else if (speedInput) {
                        speedInput.value = '500';
                        speedInput.disabled = false;
                        speedInput.style.opacity = '1';
                    }
                }

                if (stepNum === 7) JobTrackerModals.generateFTTPNotes();
            };
        });

        defaults.forEach(d => {
            let selector = `.step[data-step="${d.step}"] .option-btn[data-value="${d.val}"]`;
            if (d.type) selector += `[data-type="${d.type}"]`;
            const btn = document.querySelector(selector);
            if (btn) btn.classList.add('selected');
        });

        const cbtLight = document.getElementById('cbt-light');
        const ontLight = document.getElementById('ont-light');
        const spliceLoss = document.getElementById('splice-loss');
        if (cbtLight) this.validateLight(cbtLight);
        if (ontLight) this.validateLight(ontLight);
        if (spliceLoss) this.validateSplice(spliceLoss);

        document.querySelectorAll('#fttp-wizard .inc').forEach(btn => {
            btn.onclick = () => {
                const target = btn.getAttribute('data-target');
                const delta = parseFloat(btn.getAttribute('data-step'));
                const input = document.getElementById(target);
                if (!input) return;
                let val = parseFloat(input.value) || 0;
                val += delta;

                if (Math.abs(delta) < 0.1) {
                    val = Math.round(val * 100) / 100;
                    if (val < 0) val = 0;
                    if (target === 'splice-loss' && val > 0.05) val = 0.05;
                    input.value = val.toFixed(2);
                    JobTrackerModals.validateSplice(input);
                } else {
                    val = Math.round(val * 10) / 10;
                    input.value = val.toFixed(1);
                    JobTrackerModals.validateLight(input);
                }
            };
        });

        const prevBtn = document.getElementById('prev-fttp');
        const nextBtn = document.getElementById('next-fttp');
        if (prevBtn) prevBtn.onclick = () => this.prevFTTPWizardStep();
        if (nextBtn) nextBtn.onclick = () => this.nextFTTPWizardStep();
    },

    updateFTTPWizardDisplay() {
        document.querySelectorAll('#fttp-wizard .step').forEach(step => {
            const stepNumber = parseInt(step.getAttribute('data-step'), 10);
            step.classList.toggle('active', stepNumber === notesWizardStep);
        });

        const prevBtn = document.getElementById('prev-fttp');
        const nextBtn = document.getElementById('next-fttp');
        if (prevBtn) prevBtn.style.display = notesWizardStep > 1 ? 'inline-block' : 'none';
        if (nextBtn) nextBtn.style.display = notesWizardStep < 7 ? 'inline-block' : 'none';
    },

    nextFTTPWizardStep() {
        if (notesWizardStep < 7) {
            notesWizardStep += 1;
            this.updateFTTPWizardDisplay();
            if (notesWizardStep === 7) this.generateFTTPNotes();
        }
    },

    prevFTTPWizardStep() {
        if (notesWizardStep > 1) {
            notesWizardStep -= 1;
            this.updateFTTPWizardDisplay();
        }
    },

    getFTTPSelectedValue(step, type = '') {
        let selector = `.step[data-step="${step}"] .option-btn.selected`;
        if (type) selector = `.step[data-step="${step}"] button[data-type="${type}"].selected`;
        return document.querySelector(selector)?.getAttribute('data-value');
    },

    generateFTTPNotes() {
        const span = this.getFTTPSelectedValue(1) || 'Pole';
        const cbtPort = this.getFTTPSelectedValue(2) || '8';
        const cbtLight = document.getElementById('cbt-light')?.value || '-15.0';
        const ontMake = this.getFTTPSelectedValue(3) || 'Nokia';
        const ontLight = document.getElementById('ont-light')?.value || '-15.0';
        const cspType = this.getFTTPSelectedValue(4) || 'External';
        const cspLoss = document.getElementById('splice-loss')?.value || '0.03';
        const rip = this.getFTTPSelectedValue(5, 'rip') || '5';
        const drop = this.getFTTPSelectedValue(5, 'drop') || '65';
        const routerStatus = this.getFTTPSelectedValue(6) || 'Online';
        const routerSpeed = document.getElementById('router-speed')?.value || '500';

        const isOnline = routerStatus === 'Online';
        const effectiveSpeed = isOnline ? routerSpeed : 'N/A';
        const liveProven = isOnline ? (this.getFTTPSelectedValue(7) || 'Yes') : 'No';
        const routerLine = isOnline ? `Router: ${routerStatus}/${effectiveSpeed}Mbps` : `Router: ${routerStatus}`;

        const notes = [
            'FTTP provided',
            `Span: ${span} to Premises`,
            `CBT: Port${cbtPort} / ${cbtLight}dBm`,
            `ONT: ${ontMake} / ${ontLight}dBm`,
            `CSP: ${cspType} / ${cspLoss}dB`,
            `Cable: Rip ${rip}m / Drop ${drop}m`,
            routerLine,
            `Live & proven: ${liveProven}`
        ].join('\n');

        const output = document.getElementById('fttp-output');
        const applyBtn = document.getElementById('apply-fttp');
        if (!output || !applyBtn) return;

        output.textContent = notes;
        output.style.display = 'block';
        applyBtn.textContent = 'Apply to Notes & Copy to Clipboard';
        applyBtn.style.display = 'block';
    },

    async applyFTTPNotes() {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();

        const output = document.getElementById('fttp-output');
        if (!output) return;
        if (!output.textContent) this.generateFTTPNotes();

        const textToApply = output.textContent || '';
        if (!textToApply) {
            this.customAlert('Error', 'No notes to apply. Please complete the wizard.', true);
            return;
        }

        const job = state.getJob(notesWizardJobId);
        if (!job) {
            this.customAlert('Error', 'Job not found. Please reopen the editor and try again.', true);
            return;
        }

        try {
            await jobOps.updateJob(notesWizardJobId, { notes: textToApply });

            let copied = false;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(textToApply);
                    copied = true;
                }
            } catch (_) {
                copied = false;
            }

            if (!copied) {
                const textArea = document.createElement('textarea');
                textArea.value = textToApply;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    copied = document.execCommand('copy');
                } catch (_) {
                    copied = false;
                }
                document.body.removeChild(textArea);
            }

            this.closeModal();
            if (copied) showToast('Applied to job and copied to clipboard');
            else showToast('Applied to job (clipboard copy failed)');

            setTimeout(() => this.editJob(notesWizardJobId), 100);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Toggle ELF flag for admin/manager users.
     */
    async toggleELF(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        const job = state.getJob(jobId);
        if (!job) return;

        try {
            const next = !job.elf;
            const ok = await jobOps.setELF(jobId, next);
            if (!ok) throw new Error('Unable to update ELF flag');
            showToast(next ? 'ELF flag added' : 'ELF flag removed');
            await this.editJob(jobId);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Add, update, or remove Candid flag for admin/manager users.
     */
    async editCandid(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        const job = state.getJob(jobId);
        if (!job) return;

        try {
            if (job.candids) {
                const remove = window.confirm('Remove Candid flag? Click Cancel to edit reason.');
                if (remove) {
                    const ok = await jobOps.setCandids(jobId, false, '');
                    if (!ok) throw new Error('Unable to remove Candid flag');
                    showToast('Candid flag removed');
                    await this.editJob(jobId);
                    return;
                }
            }

            const reason = window.prompt('Enter Candid reason:', job.candidsReason || '');
            if (reason === null) return;

            const ok = await jobOps.setCandids(jobId, true, reason.trim() || 'Flagged');
            if (!ok) throw new Error('Unable to save Candid flag');
            showToast('Candid flag saved');
            await this.editJob(jobId);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Add/update/remove chargeback details for admin/manager users.
     */
    async editChargeback(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        const job = state.getJob(jobId);
        if (!job) return;

        try {
            if (job.chargeback) {
                const remove = window.confirm('Remove current chargeback? Click Cancel to edit it instead.');
                if (remove) {
                    const ok = await jobOps.removeChargeback(jobId);
                    if (!ok) throw new Error('Unable to remove chargeback');
                    showToast('Chargeback removed');
                    await this.editJob(jobId);
                    return;
                }
            }

            const reasonInput = window.prompt(
                'Chargeback reason (ELF, Candids, other):',
                (job.chargebackReason || (job.candids ? 'Candids' : (job.elf ? 'ELF' : 'other')))
            );
            if (reasonInput === null) return;

            const amountInput = window.prompt('Chargeback amount (£):', String(job.chargebackAmount || job.fee || 0));
            if (amountInput === null) return;
            const amount = parseFloat(amountInput);
            if (!Number.isFinite(amount) || amount < 0) {
                this.customAlert('Validation', 'Please enter a valid non-negative amount', true);
                return;
            }

            const weekDefault = new Date().toISOString().split('T')[0];
            const weekInput = window.prompt('Week date for deduction (YYYY-MM-DD):', weekDefault);
            if (weekInput === null) return;
            const weekDate = new Date(`${weekInput}T00:00:00`);
            if (Number.isNaN(weekDate.getTime())) {
                this.customAlert('Validation', 'Invalid date format. Use YYYY-MM-DD', true);
                return;
            }

            const reasonRaw = (reasonInput || '').trim().toLowerCase();
            const normalizedReason = reasonRaw === 'elf'
                ? 'ELF'
                : (reasonRaw === 'candids' ? 'Candids' : 'other');
            const ok = await jobOps.addChargeback(jobId, normalizedReason, amount, weekDate.toDateString());
            if (!ok) throw new Error('Unable to save chargeback');

            showToast('Chargeback saved');
            await this.editJob(jobId);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Revert a completed/failed/internal job back to pending.
     */
    async revertToPending(jobId) {
        const state = getState();
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        const job = state.getJob(jobId);
        if (!job) return;

        const confirmed = window.confirm('Revert this job to Pending status?');
        if (!confirmed) return;

        try {
            await jobOps.updateJob(jobId, {
                status: STATUS.PENDING,
                fee: 0,
                completedAt: null,
                manualFee: false,
                isUpgraded: false,
                saturdayPremium: false,
                baseFee: null
            });
            showToast('Job reverted to pending');
            await this.editJob(jobId);
        } catch (error) {
            this.customAlert('Error', error.message, true);
        }
    },

    /**
     * Duplicate job for quick repeat entry.
     */
    async duplicateJob(jobId) {
        const jobOps = getJobOps();
        const { showToast } = getUtils();
        try {
            await jobOps.cloneJob(jobId);
            this.closeModal();
            showToast('Job duplicated');
            if (window.render) window.render(true);
        } catch (error) {
            this.customAlert('Error', error.message, true);
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
                    try { await client.signOutOtherSessions(); } catch (_) {}
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

