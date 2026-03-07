/**
 * Job Tracker - Main Application File (Refactored)
 * 
 * This file integrates all the modular components and provides
 * the glue code for UI interactions.
 * 
 * Uses ES module imports rather than global window variables.
 */

import { JobTrackerConstants } from './js/constants.js';
import { JobTrackerUtils } from './js/utils.js';
import { supabaseClient } from './js/supabase-client.js';

// Basic authentication handler
function showSignInModal() {
    JobTrackerModals.showSignIn();
}

import { JobTrackerDB } from './js/database.js';
import { JobTrackerState } from './js/state.js';
import { JobTrackerCalculations } from './js/calculations.js';
import { JobTrackerJobs } from './js/jobs.js';
import { JobTrackerModals } from './js/modals.js';
import { supabaseClient } from './js/supabase-client.js';
import { initModules, whenModulesReady } from './js/bridge.js';

// Locals for convenience
const { STATUS, RANGES, NOTE_TEMPLATES, SATURDAY_MULTIPLIER } = JobTrackerConstants;
const { generateID, timeAgo, debounce, sanitizeHTML, isSaturday, formatDate, getWeekNumber, showToast } = JobTrackerUtils;
const { db, STORES } = JobTrackerDB;
const state = JobTrackerState;
const { calculate, updatePersonalBests, getProjection, getExpensesForScope, getGoal, saveGoal, getTaxRate, setTaxRate, getPayPeriodHistory, getPreviousPeriodStats } = JobTrackerCalculations;
const jobOps = JobTrackerJobs;
const { customAlert, confirmModal, editJob: editJobModal, showSaturdayRecalculationDialog, showDataManagement } = JobTrackerModals;

// ===========================
// Application Initialization
// ===========================


(async function initializeApp() {
    console.log('Initializing Job Tracker...');
    
    // Initialize database
    await db.init();
    console.log('Database initialized');
    
    // Initialize state
    await state.init();
    console.log('State initialized');
    
    // Subscribe to state changes for reactive updates
    state.subscribe((event, data) => {
        console.log('State event:', event);
        // Auto re-render on data changes
        if (event.startsWith('job:') || event.startsWith('jobs:')) {
            render(true);
        }
    });
    
    // Initial render
    render();
    
    // Initialize background animations
    initBackgroundAnimation();
    
    // Setup service worker
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    
    // Restore wake lock if it was active
    const wakelock = state.getSetting('nx_wakelock');
    if (wakelock === '1') {
        toggleWakeLock();
    }
    
    // Setup notifications if enabled
    const notif = state.getSetting('nx_notif');
    if (notif === '1' && 'Notification' in window && Notification.permission === 'granted') {
        scheduleNotification();
    }
    
    console.log('Job Tracker initialized successfully');
})();

// ===========================
// Navigation Functions
// ===========================

function setRange(range, el) {
    state.setRange(range);
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    render();
}

function nav(tab, el) {
    const prev = state.activeTab;
    state.setActiveTab(tab);
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('settings-btn').classList.remove('active');
    
    if (prev !== tab) {
        const container = document.getElementById('view-container');
        container.innerHTML = `
            <div class="skeleton" style="height:80px;margin:12px 0;border-radius:12px;"></div>
            <div class="skeleton" style="height:120px;margin:12px 0;border-radius:12px;"></div>
            <div class="skeleton" style="height:60px;margin:12px 0;border-radius:12px;"></div>
        `;
        setTimeout(() => render(), 80);
    } else {
        render();
    }
}

function navSettings() {
    const prev = state.activeTab;
    state.setActiveTab('settings');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('settings-btn').classList.add('active');
    
    if (navigator.vibrate) navigator.vibrate(8);
    
    if (prev !== 'settings') {
        const container = document.getElementById('view-container');
        container.innerHTML = `
            <div class="skeleton" style="height:100px;margin:12px 0;border-radius:12px;"></div>
            <div class="skeleton" style="height:80px;margin:12px 0;border-radius:12px;"></div>
        `;
        setTimeout(() => render(), 80);
    } else {
        render();
    }
}

function adjDate(n) {
    const d = new Date(state.viewDate);
    
    if (state.range === 'day') d.setDate(d.getDate() + n);
    else if (state.range === 'week') d.setDate(d.getDate() + (n * 7));
    else if (state.range === 'month') d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
    
    state.setViewDate(d);
    render();
}

function goToday() {
    state.setViewDate(new Date());
    if (navigator.vibrate) navigator.vibrate(8);
    render();
}

function jumpToDate(val) {
    if (!val) return;
    state.setViewDate(new Date(val + 'T00:00:00'));
    render();
}

// ===========================
// Job Operations (UI Bindings)
// ===========================

async function quickStatus(jobId, status) {
    try {
        await jobOps.updateJobStatus(jobId, status);
        
        // Visual feedback
        const tile = document.querySelector(`.job-tile[data-id="${jobId}"]`);
        if (tile) {
            const colorMap = {
                'Completed': 'var(--success)',
                'Internals': 'var(--warning)',
                'Failed': 'var(--danger)'
            };
            tile.style.setProperty('--flash-color', colorMap[status]);
            tile.classList.add('status-flash');
            
            setTimeout(() => {
                tile.classList.remove('status-flash');
            }, 650);
        }
        
        if (navigator.vibrate) navigator.vibrate(10);
        
        // Re-render after animation
        setTimeout(() => render(true), 300);
    } catch (error) {
        customAlert('Error', error.message, true);
    }
}

function editJob(jobId) {
    editJobModal(jobId);
}

// ==============
// Add Job Functions
// ===========================

let addPopupOpen = false;

function toggleAddPopup() {
    addPopupOpen = !addPopupOpen;
    const backdrop = document.getElementById('add-popup-backdrop');
    const popup = document.getElementById('add-popup');
    const fab = document.getElementById('fab-btn');
    
    if (addPopupOpen) {
        backdrop.classList.add('show');
        popup.classList.add('show');
        fab.classList.add('open');
    } else {
        backdrop.classList.remove('show');
        popup.classList.remove('show');
        fab.classList.remove('open');
    }
    
    if (navigator.vibrate) navigator.vibrate(8);
}

function showSingleAdd() {
    const types = state.types;
    const today = new Date().toISOString().split('T')[0];
    
    const typeOptions = types.map(t => 
        `<option value="${t.code}">${t.code} - £${t.pay}${t.int ? ` (Int: £${t.int})` : ''}</option>`
    ).join('');
    
    const content = `
        <button class="close-btn" onclick="window.JobTrackerModals.closeModal()">×</button>
        <h3 style="margin-bottom:16px;">Add Job</h3>
        
        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Type</label>
        <select id="add-type" class="input-box">
            ${typeOptions}
        </select>

        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Date</label>
        <input type="date" id="add-date" class="input-box" value="${today}">

        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Job ID (Optional)</label>
        <input type="text" id="add-jobid" class="input-box" placeholder="e.g., WO12345">

        <button class="btn" onclick="saveNewJob()">Add Job</button>
    `;
    
    window.JobTrackerModals.showModal(content);
}

async function saveNewJob() {
    const type = document.getElementById('add-type').value;
    const date = document.getElementById('add-date').value;
    const jobID = document.getElementById('add-jobid').value;
    
    try {
        await jobOps.createJob({
            type,
            date,
            jobID,
            status: STATUS.PENDING
        });
        
        window.JobTrackerModals.closeModal();
        showToast('Job added successfully');
        render(true);
    } catch (error) {
        customAlert('Error', error.message, true);
    }
}

function showMultiAdd() {
    const types = state.types;
    const today = new Date().toISOString().split('T')[0];
    
    const typeOptions = types.map(t => 
        `<option value="${t.code}">${t.code} - £${t.pay}${t.int ? ` (Int: £${t.int})` : ''}</option>`
    ).join('');
    
    const content = `
        <button class="close-btn" onclick="window.JobTrackerModals.closeModal()">×</button>
        <h3 style="margin-bottom:16px;">Add Multiple Jobs</h3>
        
        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Type</label>
        <select id="bulk-type" class="input-box">
            ${typeOptions}
        </select>

        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Date</label>
        <input type="date" id="bulk-date" class="input-box" value="${today}">

        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Quantity</label>
        <input type="number" id="bulk-quantity" class="input-box" value="1" min="1" max="20">

        <button class="btn" onclick="saveBulkJobs()">Add Jobs</button>
    `;
    
    window.JobTrackerModals.showModal(content);
}

async function saveBulkJobs() {
    const type = document.getElementById('bulk-type').value;
    const date = document.getElementById('bulk-date').value;
    const quantity = parseInt(document.getElementById('bulk-quantity').value);
    
    if (quantity < 1 || quantity > 20) {
        customAlert('Invalid Quantity', 'Please enter a number between 1 and 20', true);
        return;
    }
    
    try {
        const jobs = [];
        for (let i = 0; i < quantity; i++) {
            const job = await jobOps.createJob({
                type,
                date,
                status: STATUS.PENDING
            });
            jobs.push(job);
        }
        
        window.JobTrackerModals.closeModal();
        showToast(`Added ${quantity} job${quantity !== 1 ? 's' : ''} successfully`);
        render(true);
    } catch (error) {
        customAlert('Error', error.message, true);
    }
}

// ===========================
// Wake Lock
// ===========================

async function toggleWakeLock() {
    if (state.wakeLock) {
        state.wakeLock.release();
        state.wakeLock = null;
        document.getElementById('wake-indicator').style.display = 'none';
        await state.saveSetting('nx_wakelock', '0');
    } else {
        try {
            state.wakeLock = await navigator.wakeLock.request('screen');
            document.getElementById('wake-indicator').style.display = 'block';
            await state.saveSetting('nx_wakelock', '1');
            
            state.wakeLock.addEventListener('release', () => {
                document.getElementById('wake-indicator').style.display = 'none';
            });
        } catch (e) {
            customAlert('Not Supported', 'Wake lock is not supported on this device');
        }
    }
}

// ===========================
// Notifications
// ===========================

function scheduleNotification() {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
        sendPendingCount();
    }
}

function sendPendingCount() {
    const today = new Date().toISOString().split('T')[0];
    const pending = state.jobs.filter(j => j.date === today && j.status === STATUS.PENDING).length;
    
    if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'CHECK_PENDING',
            count: pending
        });
    }
}

async function requestNotifications() {
    if (!('Notification' in window)) {
        customAlert('Not Supported', 'Notifications not available on this device.', true);
        return;
    }
    
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        await state.saveSetting('nx_notif', '1');
        customAlert('Enabled', 'You will receive reminders about pending jobs.');
        sendPendingCount();
    }
}

// ===========================
// Batch Mode
// ===========================

function toggleBatchMode() {
    state.toggleBatchMode();
    const bar = document.getElementById('batch-bar');
    if (bar) bar.remove();
    render();
}

function toggleBatchSelect(jobId, e) {
    if (!state.batchMode) return;
    e.stopPropagation();
    
    state.toggleBatchSelect(jobId);
    
    const tile = document.querySelector(`.job-tile[data-id="${jobId}"]`);
    if (tile) tile.classList.toggle('batch-selected');
    
    renderBatchBar();
}

function renderBatchBar() {
    let bar = document.getElementById('batch-bar');
    
    if (!state.batchMode || state.batchSelected.size === 0) {
        if (bar) bar.remove();
        return;
    }
    
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'batch-bar';
        bar.className = 'batch-bar';
        document.body.appendChild(bar);
    }
    
    bar.innerHTML = `
        <span style="font-size:0.8rem; font-weight:700;">${state.batchSelected.size} selected</span>
        <div style="display:flex; gap:6px;">
            <button style="background:var(--success);" onclick="batchSetStatus('${STATUS.COMPLETED}')">✓ DONE</button>
            <button style="background:var(--warning);" onclick="batchSetStatus('${STATUS.INTERNALS}')">⚠ INT</button>
            <button style="background:var(--danger);" onclick="batchSetStatus('${STATUS.FAILED}')">✕ FAIL</button>
            <button style="background:var(--border);" onclick="toggleBatchMode()">CANCEL</button>
        </div>
    `;
}

async function batchSetStatus(status) {
    try {
        const jobIds = Array.from(state.batchSelected);
        await jobOps.batchUpdateStatus(jobIds, status);
        
        state.batchMode = false;
        state.batchSelected.clear();
        
        const bar = document.getElementById('batch-bar');
        if (bar) bar.remove();
        
        showToast(`Updated ${jobIds.length} job${jobIds.length !== 1 ? 's' : ''}`);
        render(true);
    } catch (error) {
        customAlert('Error', error.message, true);
    }
}

// ===========================
// Background Animation
// ===========================

function initBackgroundAnimation() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const bgAnim = state.getSetting('nx_bg_anim', 'particles');
    
    if (bgAnim === 'none') {
        canvas.style.display = 'none';
        return;
    }
    
    // Simple particle animation
    const particles = [];
    const particleCount = 50;
    
    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            radius: Math.random() * 2 + 1
        });
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const isDark = !document.documentElement.hasAttribute('data-theme') || 
                      document.documentElement.getAttribute('data-theme') !== 'light';
        ctx.fillStyle = isDark ? 'rgba(88, 166, 255, 0.1)' : 'rgba(9, 105, 218, 0.15)';
        
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        });
        
        requestAnimationFrame(animate);
    }
    
    if (bgAnim === 'particles') {
        animate();
    }
}

// ===========================
// Utility Functions
// ===========================

function getWeek(d) {
    return getWeekNumber(d);
}

// Export data as CSV
function exportCSV() {
    const escField = v => {
        const s = String(v == null ? '' : v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? 
               '"' + s.replace(/"/g, '""') + '"' : s;
    };
    
    let csv = "Date,Type,Status,Fee,JobID,Notes,ManualFee\n" + 
        state.jobs.map(j => [
            j.date,
            j.type,
            j.status,
            j.fee,
            j.jobID || '',
            j.notes || '',
            j.manualFee ? 'Yes' : 'No'
        ].map(escField).join(',')
    ).join("\n");
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `job_tracker_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// Share report
function shareReport(stats, list) {
    const range = state.range.toUpperCase();
    const d = state.viewDate;
    
    let label = formatDate(d, 'LONG');
    if (state.range === 'week') label = 'Week ' + getWeek(d);
    if (state.range === 'month') label = formatDate(d, 'MONTH_YEAR');
    if (state.range === 'year') label = d.getFullYear().toString();
    
    const tax = getTaxRate();
    const net = tax > 0 ? stats.totalCash * (1 - tax / 100) : stats.totalCash;
    
    const text = `📊 Job Tracker — ${range} Report\n` +
        `📅 ${label}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📋 Jobs: ${stats.vol} (✓${stats.done} ✕${stats.fails} ⚠${stats.ints} ⏳${stats.pend})\n` +
        `🎯 Completion: ${stats.compRate}%\n` +
        `🔥 Streak: ${stats.streak}\n` +
        `💰 Revenue: £${stats.totalCash.toFixed(2)}\n` +
        (tax > 0 ? `💵 Take-home (${tax}%): £${net.toFixed(2)}\n` : '') +
        `📈 Avg/Job: £${stats.avgJobPay}\n` +
        `━━━━━━━━━━━━━━━━━━`;
    
    if (navigator.share) {
        navigator.share({ title: 'Job Tracker Report', text }).catch(() => {});
    } else {
        navigator.clipboard.writeText(text).then(() => {
            customAlert('Copied', 'Report copied to clipboard.');
        });
    }
}

// ===========================
// Main Render Function
// ===========================

/**
 * Main render function - handles all UI updates
 * @param {boolean} softUpdate - Whether this is a soft update (data change) or full render
 */
function render(softUpdate) {
    const container = document.getElementById('view-container');
    const scrollY = container.scrollTop;
   
    // Get custom order if it exists
    const customOrder = jobOps.getJobOrder();
   
    let list;
    if (customOrder.length > 0) {
        // Use custom order
        const scope = state.getScope();
        const idMap = new Map(scope.map(j => [j.id, j]));
        list = customOrder.map(id => idMap.get(id)).filter(j => j); // Filter out any IDs that no longer exist
        // Add any new jobs that aren't in custom order yet (append to end)
        const customIds = new Set(customOrder);
        const newJobs = scope.filter(j => !customIds.has(j.id));
        list = [...list, ...newJobs];
    } else {
        // Default sort: resolved first (earliest completion), then pending
        list = state.getScope().sort((a, b) => {
            const ap = a.status === 'Pending' ? 1 : 0;
            const bp = b.status === 'Pending' ? 1 : 0;
            if (ap !== bp) return ap - bp;
            if (ap === 0) return (a.completedAt || 0) - (b.completedAt || 0);
            return 0;
        });
    }
   
    const s = calculate(list);
    // Apply search/filter for display
    let displayList = list;
    if (state.searchQuery || state.statusFilter !== 'all') {
        const q = state.searchQuery.toLowerCase();
        displayList = list.filter(j => {
            if (state.statusFilter !== 'all' && j.status !== state.statusFilter) return false;
            if (q && !(j.type.toLowerCase().includes(q) || (j.jobID || '').toLowerCase().includes(q) || (j.notes || '').toLowerCase().includes(q))) return false;
            return true;
        });
    }
    // Update personal bests
    updatePersonalBests(list);
    const d = state.viewDate;
    const today = new Date(); today.setHours(0,0,0,0);
    const viewD = new Date(d); viewD.setHours(0,0,0,0);
    const isToday = (state.range === 'day' && viewD.getTime() === today.getTime());
    const todayDot = isToday ? '<span class="today-dot"></span>' : '';
   
    if (state.range === 'day') document.getElementById('date-label').innerHTML = d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) + todayDot;
    else if (state.range === 'week') {
        const ref = new Date(d); ref.setHours(0,0,0,0);
        const daysToSat = (ref.getDay() + 1) % 7;
        const sat = new Date(ref); sat.setDate(ref.getDate() - daysToSat);
        const fri = new Date(sat); fri.setDate(sat.getDate() + 6);
        const satStr = sat.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
        const friStr = fri.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
        document.getElementById('date-label').innerHTML = "WEEK " + getWeek(d) + " <span style='font-size:0.7rem; color:var(--text-muted); font-weight:400;'>(" + satStr + " – " + friStr + ")</span>" + todayDot;
    }
    else if (state.range === 'month') document.getElementById('date-label').innerHTML = d.toLocaleDateString('en-GB', {month:'long', year:'numeric'}) + todayDot;
    else document.getElementById('date-label').innerHTML = d.getFullYear().toString() + todayDot;
    const showDate = state.range !== 'day';
    if (state.activeTab === 'jobs') {
        const pulseMap = { 'Completed': 'var(--success)', 'Internals': 'var(--warning)', 'Failed': 'var(--danger)', 'Pending': 'var(--primary)' };
        // On soft updates (data change), try to update cards in-place
        if (softUpdate && container.querySelector('#drag-container')) {
            // Update stats panels in-place
            const target = parseInt(localStorage.getItem('nx_target')) || 80;
            const rc1 = s.compRate >= target ? 'var(--success)' : s.compRate >= target * 0.75 ? 'var(--warning)' : 'var(--danger)';
            const rc2 = s.exclHy >= target ? 'var(--success)' : s.exclHy >= target * 0.75 ? 'var(--warning)' : 'var(--danger)';
            const mAll = container.querySelector('[data-meter="all"]');
            const mExhy = container.querySelector('[data-meter="exhy"]');
            const fAll = container.querySelector('[data-fill="all"]');
            const fExhy = container.querySelector('[data-fill="exhy"]');
            if (mAll) { mAll.textContent = s.compRate + '%'; mAll.style.color = rc1; }
            if (fAll) { fAll.style.width = Math.min(s.compRate, 100) + '%'; fAll.style.background = rc1; }
            if (mExhy) { mExhy.textContent = s.exclHy + '%'; mExhy.style.color = rc2; }
            if (fExhy) { fExhy.style.width = Math.min(s.exclHy, 100) + '%'; fExhy.style.background = rc2; }
            const banner = container.querySelector('.summary-banner');
            if (banner && list.length > 0) {
                const items = banner.querySelectorAll('.summary-item b');
                if (items.length >= 4) { items[0].textContent = s.vol; items[1].textContent = s.done; items[2].textContent = s.pend; items[3].innerHTML = '\u00A3' + s.totalCash.toFixed(0); }
            } else if (!banner && list.length > 0) {
                // Banner needs to appear (was empty, now has jobs)
                const statGrid = container.querySelector('.stat-grid');
                if (statGrid) {
                    const bannerDiv = document.createElement('div');
                    bannerDiv.className = 'summary-banner';
                    bannerDiv.innerHTML = `
                        <div class="summary-item"><small style="font-size:0.6rem;">JOBS</small><b>${s.vol}</b></div>
                        <div class="summary-item"><small style="font-size:0.6rem;">DONE</small><b style="color:var(--success)">${s.done}</b></div>
                        <div class="summary-item"><small style="font-size:0.6rem;">PENDING</small><b style="color:var(--warning)">${s.pend}</b></div>
                        <div class="summary-item"><small style="font-size:0.6rem;">EARNED</small><b>&pound;${s.totalCash.toFixed(0)}</b></div>`;
                    statGrid.after(bannerDiv);
                }
            } else if (banner && list.length === 0) {
                banner.remove();
            }
            // Reconcile job cards
            const dragContainer = container.querySelector('#drag-container');
            // Clear empty state if jobs now exist
            if (list.length > 0) {
                const emptyState = dragContainer.querySelector('[style*="text-align:center"]');
                if (emptyState && !emptyState.classList.contains('job-tile')) emptyState.remove();
            }
            const existingTiles = dragContainer.querySelectorAll('.job-tile');
            const existingIds = new Set();
            existingTiles.forEach(t => existingIds.add(t.dataset.id));
            const newIds = new Set(list.map(j => j.id));
            // Remove cards no longer in list
            existingTiles.forEach(t => {
                if (!newIds.has(t.dataset.id)) {
                    t.style.transition = 'opacity 0.3s, transform 0.3s';
                    t.style.opacity = '0';
                    t.style.transform = 'scale(0.95)';
                    setTimeout(() => t.remove(), 300);
                }
            });
            // Update existing cards or add new ones
            list.forEach((j, i) => {
                const existing = dragContainer.querySelector(`.job-tile[data-id="${j.id}"]`);
                if (existing) {
                    // Update in-place: status class, border, fee, status text, actions
                    existing.className = `job-tile ${j.status.toLowerCase()}`;
                    existing.style.transform = ''; // Reset any swipe transform
                    existing.style.setProperty('--pulse-color', pulseMap[j.status] || 'var(--primary)');
                    const header = existing.querySelector('.job-card-header');
                    if (header) {
                        const statusSpan = header.querySelector('span[style*="font-weight:700"]');
                        if (statusSpan) statusSpan.textContent = j.status.toUpperCase();
                        const feeB = header.querySelectorAll('b');
                        const satFee = getSaturdayDisplayFees(j);
                        if (feeB.length >= 2) {
                            if (satFee) {
                                const newFee = document.createElement('b');
                                newFee.className = 'fee-amount sat-premium';
                                newFee.dataset.base = satFee.base.toFixed(2);
                                newFee.dataset.final = satFee.final.toFixed(2);
                                newFee.style.cssText = 'font-size:1.1rem; color:var(--text-main); pointer-events:none;';
                                newFee.textContent = '\u00A3' + satFee.base.toFixed(2);
                                feeB[1].replaceWith(newFee);
                                setTimeout(runSaturdayFeeAnimations, 30);
                            } else {
                                feeB[1].innerHTML = '\u00A3' + parseFloat(j.fee).toFixed(2);
                            }
                        }
                    }
                    // Toggle action buttons
                    const actions = existing.querySelector('.job-actions');
                    if (j.status === 'Pending' && !actions) {
                        const div = document.createElement('div');
                        div.className = 'job-actions';
                        const hasInt = state.getTypeConfig(j.type)?.int != null;
                        div.innerHTML = `
                            <button class="action-btn done" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Completed')"><span>\u2713</span> FINISH</button>
                            ${hasInt ? `<button class="action-btn int" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Internals')"><span>\u26a0</span> INT</button>` : ''}
                            <button class="action-btn fail" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Failed')"><span>\u2715</span> FAIL</button>`;
                        existing.appendChild(div);
                    } else if (j.status !== 'Pending' && actions) {
                        actions.style.transition = 'opacity 0.2s';
                        actions.style.opacity = '0';
                        setTimeout(() => actions.remove(), 200);
                    }
                } else {
                    // New card — add with entrance animation
                    const html = renderJobCard(j, showDate, pulseMap, true);
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    const newTile = temp.firstElementChild;
                    dragContainer.appendChild(newTile);
                }
            });
            // Reorder DOM nodes to match sorted list
            list.forEach(j => {
                const wrap = dragContainer.querySelector(`.job-tile-wrap[data-job-id="${j.id}"]`);
                if (wrap) dragContainer.appendChild(wrap);
            });
            // Show empty state if no jobs remain
            if (list.length === 0 && !dragContainer.querySelector('[style*="text-align:center"]')) {
                setTimeout(() => {
                    if (dragContainer.querySelectorAll('.job-tile').length === 0) {
                        dragContainer.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                            <div style="margin-bottom:12px; opacity:0.3;"><svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div>
                            <div style="font-size:0.9rem; font-weight:700; margin-bottom:6px;">No jobs logged</div>
                            <div style="font-size:0.75rem;">Tap the <span style="color:var(--primary); font-weight:800;">+</span> button below to add your first job</div>
                        </div>`;
                    }
                }, 350);
            }
            container.scrollTop = scrollY;
            return;
        }
        // Full render (tab switch / date change / first load)
        const target = parseInt(localStorage.getItem('nx_target')) || 80;
        const rateColor1 = s.compRate >= target ? 'var(--success)' : s.compRate >= target * 0.75 ? 'var(--warning)' : 'var(--danger)';
        const rateColor2 = s.exclHy >= target ? 'var(--success)' : s.exclHy >= target * 0.75 ? 'var(--warning)' : 'var(--danger)';
        // Empty states per context
        const emptyJobs = `<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
            <div style="margin-bottom:12px; opacity:0.3;"><svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div>
            <div style="font-size:0.9rem; font-weight:700; margin-bottom:6px;">No jobs logged</div>
            <div style="font-size:0.75rem;">Tap the <span style="color:var(--primary); font-weight:800;">+</span> button below to add your first job</div>
        </div>`;
        container.innerHTML = `
            <div class="panel comp-rates-panel" style="margin-bottom:10px; padding:14px 16px;">
                <div class="comp-meter comp-meter-compact">
                    <div class="comp-meter-row">
                        <div class="comp-meter-pct" data-meter="all" style="color:${rateColor1}">${s.compRate}%</div>
                        <div class="comp-meter-info">
                            <div class="comp-meter-label">Completion Rate (eligible job types)</div>
                            <div class="comp-meter-track"><div class="comp-meter-fill" data-fill="all" style="width:${Math.min(s.compRate,100)}%; background:${rateColor1};"></div><div class="comp-meter-target" style="left:${target}%;"></div></div>
                        </div>
                    </div>
                    <div class="comp-meter-row">
                        <div class="comp-meter-pct" data-meter="exhy" style="color:${rateColor2}">${s.exclHy}%</div>
                            <div class="comp-meter-label">Excl. Hybrids</div>
                        </div>
                    </div>
            ${list.length > 0 ? `
            <div class="summary-banner">
                <div class="summary-item"><small style="font-size:0.6rem;">JOBS</small><b>${s.vol}</b></div>
                <div class="summary-item"><small style="font-size:0.6rem;">PENDING</small><b style="color:var(--warning)">${s.pend}</b></div>
                <div class="summary-item"><small style="font-size:0.6rem;">EARNED</small><b>&pound;${s.totalCash.toFixed(0)}</b></div>
            </div>` : ''}
            ${list.length > 0 ? `<div class="search-bar">
                <input type="text" placeholder="\ud83d\udd0d Search jobs..." value="${state.searchQuery}" oninput="state.searchQuery=this.value; render()">
                <select onchange="state.statusFilter=this.value; render()">
                    <option value="all" ${state.statusFilter==='all'?'selected':''}>All</option>
                    <option value="Pending" ${state.statusFilter==='Pending'?'selected':''}>Pending</option>
                    <option value="Completed" ${state.statusFilter==='Completed'?'selected':''}>Done</option>
                    <option value="Failed" ${state.statusFilter==='Failed'?'selected':''}>Failed</option>
                    <option value="Internals" ${state.statusFilter==='Internals'?'selected':''}>Internal</option>
                </select>
                ${customOrder.length > 0 ? `<button style="background:var(--warning); color:#fff; padding:6px 10px; border-radius:8px; font-size:0.65rem; font-weight:700; cursor:pointer; white-space:nowrap;" onclick="clearJobOrder(); render()">↻ RESET</button>` : ''}
                <button style="background:${state.batchMode?'var(--primary)':'var(--border-t)'}; border:1px solid var(--border-t); color:${state.batchMode?'#fff':'var(--text-muted)'}; padding:6px 10px; border-radius:8px; font-size:0.65rem; font-weight:700; cursor:pointer; white-space:nowrap;" onclick="toggleBatchMode()">${state.batchMode?'EXIT':'SELECT'}</button>
            </div>` : ''}
            <div id="drag-container">
                ${displayList.map((j, i) => renderJobCard(j, showDate, pulseMap, true, i)).join('') || emptyJobs}
            </div>
        `;
        setTimeout(runSaturdayFeeAnimations, 50);
    } else if (state.activeTab === 'stats') {
        if (list.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                <div style="margin-bottom:16px; opacity:0.4;"><svg viewBox="0 0 24 24" width="56" height="56" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
                <h3 style="color:var(--text-main); margin-bottom:8px;">No Analytics Yet</h3>
                <p style="font-size:0.8rem;">Complete some jobs to see your performance stats, streaks, and trends.</p>
            </div>`;
        } else { renderStats(container, list, s); }
    } else if (state.activeTab === 'funds') {
        if (list.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                <div style="margin-bottom:16px; opacity:0.4;"><svg viewBox="0 0 24 24" width="56" height="56" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg></div>
                <h3 style="color:var(--text-main); margin-bottom:8px;">No Earnings Yet</h3>
                <p style="font-size:0.8rem;">Log and complete jobs to track your revenue, projections, and financial insights.</p>
            </div>`;
        } else { renderFunds(container, list, s); }
    } else if (state.activeTab === 'leaderboards') {
        renderLeaderboard(container, list, s);
    } else {
        renderSettings(container);
    }
}

/**
 * Render a job card HTML
 * @param {Object} j - Job object
 * @param {boolean} showDate - Whether to show date
 * @param {Object} pulseMap - Color mapping for status
 * @param {boolean} animate - Whether to animate
 * @param {number} index - Animation index
 * @returns {string} HTML string
 */
function renderJobCard(j, showDate, pulseMap, animate, index) {
    const delay = animate ? (typeof index === 'number' ? `animation: slideIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: ${index * 50}ms;` : `animation: slideIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both;`) : '';
    const batchAttr = state.batchMode ? `onclick="toggleBatchSelect('${j.id}', event)"` : `onclick="if(!event.target.closest('button')) pressEdit(this, '${j.id}')")`;
    const batchClass = state.batchSelected.has(j.id) ? ' batch-selected' : '';
    const satFee = getSaturdayDisplayFees(j);
    const feeHtml = satFee
        ? `<b class="fee-amount sat-premium" data-base="${satFee.base.toFixed(2)}" data-final="${satFee.final.toFixed(2)}" style="font-size:1.1rem; color:var(--text-main); pointer-events:none;">&pound;${satFee.base.toFixed(2)}</b>`
        : `<b style="font-size:1.1rem; color:var(--text-main); pointer-events:none;">&pound;${parseFloat(j.fee).toFixed(2)}</b>`;
    
    // Show ELF and Candid icons for all roles
    const candidsIcon = j.candids ? '📷' : '';
    const elfIcon = j.elf ? '🧝' : '';
    
    return `
        <div class="job-tile-wrap" data-job-id="${j.id}">
            <div class="job-tile ${j.status.toLowerCase()}${batchClass}" data-id="${j.id}" style="--pulse-color:${pulseMap[j.status] || 'var(--primary)'}; ${delay}" ${batchAttr}>
                ${showDate ? `<span class="date-badge">${new Date(j.date + 'T00:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short'})}</span>` : ''}
                <div class="job-card-header">
                    <div style="display:flex; align-items:center;">
                        <div class="job-drag-handle" ontouchstart="handleJobTouch(event, '${j.id}')">&#8942;&#8942;</div>
                        <div style="pointer-events:none;">
                            <b style="font-size:1.1rem; display:block;">${j.type}${j.jobID ? ` <span style="font-size:0.7rem; color:var(--text-muted)">#${j.jobID}</span>` : ''}
                            ${j.isUpgraded ? '<span style="color:var(--primary); font-size:0.6rem; vertical-align:middle;">[UPGRADED]</span>' : ''}${j.notes ? '<span class="notes-indicator" title="Has notes"></span>' : ''}</b>
                            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700">${j.status.toUpperCase()}</span>
                            ${elfIcon || candidsIcon ? `<div style="margin-top:4px; font-size:0.8rem;">${elfIcon} ${candidsIcon}</div>` : ''}
                        </div>
                    </div>
                    ${feeHtml}
                </div>
                ${j.status === 'Pending' ? `
                <div class="job-actions">
                    <button class="action-btn done" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Completed')"><span>\u2713</span> FINISH</button>
                    ${(state.getTypeConfig(j.type)?.int != null) ? `<button class="action-btn int" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Internals')"><span>\u26a0</span> INT</button>` : ''}
                    <button class="action-btn fail" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Failed')"><span>\u2715</span> FAIL</button>
                </div>` : ''}
            </div>
        </div>`;
}

/**
 * Render stats tab
 * @param {HTMLElement} container - Container element
 * @param {Array} list - Job list
 * @param {Object} s - Stats object
 */
function renderStats(container, list, s) {
    const byType = {}; list.forEach(j => byType[j.type] = (byType[j.type] || 0) + 1);
    const maxType = Math.max(...Object.values(byType), 1);
    const target = parseInt(localStorage.getItem('nx_target')) || 80;
    const bests = updatePersonalBests(list);
    // Trend comparison with previous period
    const prevList = state.getPrevScope();
    const prevS = calculate(prevList);
    const trendIcon = (delta) => delta > 0 ? '<svg viewBox="0 0 24 24" width="10" height="10" stroke="var(--success)" stroke-width="2.5" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>' : delta < 0 ? '<svg viewBox="0 0 24 24" width="10" height="10" stroke="var(--danger)" stroke-width="2.5" fill="none"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/></svg>' : '<svg viewBox="0 0 24 24" width="10" height="10" stroke="var(--text-muted)" stroke-width="2" fill="none"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    const trendColor = (delta) => delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-muted)';
    // Consistency score: std dev of daily volumes, lower is more consistent
    const dailyCounts = {};
    list.forEach(j => dailyCounts[j.date] = (dailyCounts[j.date] || 0) + 1);
    const dcVals = Object.values(dailyCounts);
    const dcMean = dcVals.length > 0 ? dcVals.reduce((a,b) => a+b, 0) / dcVals.length : 0;
    const dcStdDev = dcVals.length > 1 ? Math.sqrt(dcVals.reduce((a,b) => a + Math.pow(b - dcMean, 2), 0) / dcVals.length) : 0;
    const consistencyScore = dcMean > 0 ? Math.max(0, Math.min(100, Math.round(100 - (dcStdDev / dcMean) * 50))) : 0;
    // Perfect days in this scope
    const dayMap = {};
    list.forEach(j => { if (!dayMap[j.date]) dayMap[j.date] = { done:0, fail:0, total:0 }; dayMap[j.date].total++; if (j.status==='Completed') dayMap[j.date].done++; if (j.status==='Failed') dayMap[j.date].fail++; });
    const perfectDays = Object.values(dayMap).filter(d => d.total >= 3 && d.done === d.total).length;
    // Productivity score (jobs per day relative to target of 8)
    const prodScore = Math.min(100, Math.round((parseFloat(s.avgJobsPerDay) / 8) * 100));
    // Best streak in current scope
    const scopeSorted = [...list].filter(j => j.status !== 'Pending').sort((a,b) => (a.completedAt||0)-(b.completedAt||0));
    let scopeBestStreak = 0, tempStreak = 0;
    for (const j of scopeSorted) {
        if (j.status === 'Completed') { tempStreak++; if (tempStreak > scopeBestStreak) scopeBestStreak = tempStreak; }
        else tempStreak = 0;
    }
    // Momentum: compare key metrics to previous period
    const volDelta = s.vol - prevS.vol;
    const rateDelta = parseFloat(s.compRate) - parseFloat(prevS.compRate);
    const cashDelta = s.totalCash - prevS.totalCash;
    const rc1 = s.compRate >= target ? 'var(--success)' : s.compRate >= target*0.75 ? 'var(--warning)' : 'var(--danger)';
    const rc2 = s.exclHy >= target ? 'var(--success)' : s.exclHy >= target*0.75 ? 'var(--warning)' : 'var(--danger)';
   
    // Build panel contents
    const panels = [
        {
            id: 'completion',
            title: 'Completion Metrics',
            content: `<div class="comp-meter" style="margin-bottom:16px;">
                <div class="comp-meter-row">
                    <div class="comp-meter-pct" style="color:${rc1}; font-size:2.4rem;">${s.compRate}%</div>
                    <div class="comp-meter-info">
                        <div style="display:flex; justify-content:space-between; align-items:center;"><span class="comp-meter-label">Completion Rate</span><span style="font-size:0.6rem; color:var(--text-muted); font-weight:600;">${s.done} of ${s.done + s.fails + s.ints} resolved</span></div>
                        <div class="comp-meter-track" style="height:12px;"><div class="comp-meter-fill" style="width:${Math.min(s.compRate,100)}%; background:${rc1};"></div><div class="comp-meter-target" style="left:${target}%;"></div></div>
                    </div>
                </div>
                <div style="height:1px; background:var(--border-t); margin:8px 0;"></div>
                <div class="comp-meter-row">
                    <div class="comp-meter-pct" style="color:${rc2}; font-size:2.4rem;">${s.exclHy}%</div>
                    <div class="comp-meter-info">
                        <div style="display:flex; justify-content:space-between; align-items:center;"><span class="comp-meter-label">Excl. Hybrids</span><span style="font-size:0.6rem; color:var(--text-muted); font-weight:600;">Without HyOH / HyUG</span></div>
                        <div class="comp-meter-track" style="height:12px;"><div class="comp-meter-fill" style="width:${Math.min(s.exclHy,100)}%; background:${rc2};"></div><div class="comp-meter-target" style="left:${target}%;"></div></div>
                    </div>
                </div>
                <span class="comp-meter-tag" onclick="editTarget()" style="margin-top:8px;">\u270e TARGET ${target}%</span>
            </div>
            <div class="metric-row"><span>Total Volume</span><b class="count-up" style="font-size:1.3rem;">${s.vol}</b></div>
            <div class="metric-row"><span>Avg Jobs per Workday</span><b class="count-up" style="font-size:1.3rem;">${s.avgJobsPerDay}</b></div>
            <div class="metric-row"><span>Total Earnings</span><b class="count-up" style="font-size:1.3rem; color:var(--success);">&pound;${s.totalCash.toFixed(0)}</b></div>`
        },
        {
            id: 'status-grid',
            title: 'Status Summary',
            content: `<div class="stat-grid" style="margin:-8px;">
                <div class="panel" style="margin-bottom:0; padding:14px"><small style="font-size:0.65rem;">Done</small><b class="count-up" style="color:var(--success); font-size:1.8rem;">${s.done}</b></div>
                <div class="panel" style="margin-bottom:0; padding:14px"><small style="font-size:0.65rem;">Failed</small><b class="count-up" style="color:var(--danger); font-size:1.8rem;">${s.fails}</b></div>
                <div class="panel" style="margin-bottom:0; padding:14px"><small style="font-size:0.65rem;">Internal</small><b class="count-up" style="color:var(--warning); font-size:1.8rem;">${s.ints}</b></div>
                <div class="panel" style="margin-bottom:0; padding:14px"><small style="font-size:0.65rem;">Pending</small><b class="count-up" style="color:var(--text-muted); font-size:1.8rem;">${s.pend}</b></div>
            </div>`
        },
        {
            id: 'momentum',
            title: 'Momentum vs Previous Period',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
            content: `<div class="metric-row"><span>Volume</span><b>${trendIcon(volDelta)} <span style="color:${trendColor(volDelta)}">${volDelta > 0 ? '+' : ''}${volDelta} jobs</span></b></div>
            <div class="metric-row"><span>Completion Rate</span><b>${trendIcon(rateDelta)} <span style="color:${trendColor(rateDelta)}">${rateDelta > 0 ? '+' : ''}${rateDelta.toFixed(1)}%</span></b></div>
            <div class="metric-row"><span>Earnings</span><b>${trendIcon(cashDelta)} <span style="color:${trendColor(cashDelta)}">${cashDelta >= 0 ? '+' : ''}&pound;${cashDelta.toFixed(0)}</span></b></div>`
        },
        {
            id: 'performance',
            title: 'Performance Indicators',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
            content: `<div class="metric-row"><span>Consistency</span><b class="count-up" style="color:${consistencyScore >= 75 ? 'var(--success)' : consistencyScore >= 50 ? 'var(--warning)' : 'var(--danger)'}">${consistencyScore}<span style="font-size:0.6rem; color:var(--text-muted)">/100</span></b></div>
            <div class="metric-row"><span>Productivity</span><b class="count-up" style="color:${prodScore >= 80 ? 'var(--success)' : prodScore >= 50 ? 'var(--warning)' : 'var(--text-muted)'}">${prodScore}% <span style="font-size:0.6rem; color:var(--text-muted)">of 8/day</span></b></div>
            <div class="metric-row"><span>Perfect Days</span><b class="count-up" style="color:${perfectDays > 0 ? 'var(--primary)' : 'var(--text-muted)'}">${perfectDays}</b></div>
            <div class="metric-row"><span>Resolution Rate</span><b class="count-up">${s.vol > 0 ? (((s.done + s.fails + s.ints) / s.vol) * 100).toFixed(0) : 0}% <span style="font-size:0.6rem; color:var(--text-muted)">resolved</span></b></div>
            <div class="metric-row"><span>Fail Rate</span><b class="count-up" style="color:${s.fails > 0 ? 'var(--danger)' : 'var(--success)'}">${s.vol > 0 ? ((s.fails / s.vol) * 100).toFixed(1) : 0}%</b></div>
            <div class="metric-row"><span>Internal Rate</span><b class="count-up" style="color:var(--warning)">${s.vol > 0 ? ((s.ints / s.vol) * 100).toFixed(1) : 0}%</b></div>`
        },
        {
            id: 'volume-chart',
            title: 'Volume by Job Type',
            content: `<div class="chart-container">
                ${Object.keys(byType).length ? Object.entries(byType).map(([t, count]) => `
                    <div class="bar-wrapper"><span class="bar-val count-up">${count}</span><div class="bar" style="height:${(count/maxType)*100}%; background:linear-gradient(to top, var(--border-t), var(--primary)); border-radius:4px 4px 0 0;"></div><span class="bar-label">${t}</span></div>
                `).join('') : '<div style="color:var(--text-muted); font-size:0.7rem;">NO DATA</div>'}
            </div>`
        },
        {
            id: 'streaks',
            title: 'Streak Analytics',
            content: `<div class="metric-row"><span>Current Streak</span><b class="count-up" style="color:var(--primary)">${s.streak} <span style="font-size:0.6rem; color:var(--text-muted)">jobs</span></b></div>
            <div class="metric-row"><span>Best (Period)</span><b class="count-up" style="color:var(--primary)">${scopeBestStreak} <span style="font-size:0.6rem; color:var(--text-muted)">jobs</span></b></div>
            <div class="metric-row"><span>Best (All-Time)</span><b class="count-up" style="color:var(--primary);">${bests.longestStreak} <span style="font-size:0.6rem; color:var(--text-muted)">jobs</span></b></div>
            <div class="metric-row"><span>Best Day Earnings</span><b class="count-up" style="color:var(--success);">&pound;${bests.bestDayEarnings.toFixed(0)} <span style="font-size:0.6rem; color:var(--text-muted)">${bests.bestDayDate ? new Date(bests.bestDayDate+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : ''}</span></b></div>
            <div class="metric-row"><span>Most Jobs in a Day</span><b class="count-up">${bests.mostJobsDay} <span style="font-size:0.6rem; color:var(--text-muted)">${bests.mostJobsDayDate ? new Date(bests.mostJobsDayDate+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : ''}</span></b></div>`
        },
        {
            id: 'weekday',
            title: 'Weekday Activity',
            content: `<div style="display:flex; justify-content:space-between; gap:4px; padding:10px 0;">
                ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => {
                    const wd = s.byWeekday[d];
                    const maxWd = Math.max(...Object.values(s.byWeekday).map(w => w.count), 1);
                    const pct = (wd.count / maxWd) * 100;
                    const opacity = wd.count > 0 ? Math.max(0.25, pct / 100) : 0.08;
                    return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
                        <span style="font-size:0.65rem; font-weight:800; color:var(--text-main);">${wd.count}</span>
                        <div style="width:100%; height:40px; border-radius:4px; background:var(--primary); opacity:${opacity};"></div>
                        <span style="font-size:0.55rem; font-weight:700; color:var(--text-muted);">${d}</span>
                    </div>`;
                }).join('')}
            </div>`
        }
    ];
   
    if (Object.keys(s.typeBreakdown).length) {
        panels.push({
            id: 'type-breakdown',
            title: 'Breakdown by Job Type',
            content: `<div style="overflow-x:auto; margin-top:8px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.7rem;">
                    <thead><tr style="border-bottom:2px solid var(--border-t); text-align:left;">
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700;">Type</th>
                        <th style="padding:6px 4px; color:var(--success); font-weight:700; text-align:center;">\u2713</th>
                        <th style="padding:6px 4px; color:var(--danger); font-weight:700; text-align:center;">\u2715</th>
                        <th style="padding:6px 4px; color:var(--warning); font-weight:700; text-align:center;">INT</th>
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700; text-align:right;">Rate</th>
                    </tr></thead>
                    <tbody>${Object.entries(s.typeBreakdown).map(([type, d]) => {
                        const total = d.done + d.fails + d.ints;
                        const pts = d.done;
                        const r = total > 0 ? ((pts / total) * 100).toFixed(0) : '\u2014';
                        const rc = r !== '\u2014' ? (parseFloat(r) >= target ? 'var(--success)' : parseFloat(r) >= target*0.75 ? 'var(--warning)' : 'var(--danger)') : 'var(--text-muted)';
                        return `<tr style="border-bottom:1px solid var(--border-t);">
                            <td style="padding:8px 4px; font-weight:700;">${type}</td>
                            <td style="padding:8px 4px; text-align:center; color:var(--success);">${d.done}</td>
                            <td style="padding:8px 4px; text-align:center; color:var(--danger);">${d.fails}</td>
                            <td style="padding:8px 4px; text-align:center; color:var(--warning);">${d.ints}</td>
                            <td style="padding:8px 4px; text-align:right; font-weight:800; color:${rc};">${r}%</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`
        });
    }
   
    // Apply saved order or use default
    const savedOrder = getPanelOrder('stats');
    const orderedPanels = savedOrder.length > 0
        ? savedOrder.map(id => panels.find(p => p.id === id)).filter(p => p)
        : panels;
   
    container.innerHTML = orderedPanels.map(p => wrapPanel(p.id, p.title, p.content, 'stats', p.icon || '')).join('') +
        `<button class="btn" style="background:var(--border); color:var(--text-main); margin-bottom:16px;" onclick="shareReport(calculate(state.getScope().sort(()=>0)), state.getScope())">\ud83d\udce4 Share Report</button>`;
}

/**
 * Render funds tab
 * @param {HTMLElement} container - Container element
 * @param {Array} list - Job list
 * @param {Object} s - Stats object
 */
function renderFunds(container, list, s) {
    const daily = {}; const typeRev = {};
    list.forEach(j => {
        daily[j.date] = (daily[j.date] || 0) + parseFloat(j.fee);
        typeRev[j.type] = (typeRev[j.type] || 0) + parseFloat(j.fee);
    });
    const maxD = Math.max(...Object.values(daily), 1);
   
    let bestDay = { date: 'N/A', val: 0 };
    Object.entries(daily).forEach(([d, v]) => { if(v > bestDay.val) bestDay = {date: d, val: v}; });
    const pp = getPayPeriod();
    const payMonISO = pp.payWeekMon.toISOString().split('T')[0];
    const payFriStr = pp.thisFriday.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    // Trends
    const prevList = state.getPrevScope();
    const prevS = calculate(prevList);
    const earningsDelta = s.totalCash - prevS.totalCash;
    const trendIcon = (delta) => delta > 0 ? '<svg viewBox="0 0 24 24" width="10" height="10" stroke="var(--success)" stroke-width="2.5" fill="none"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>' : delta < 0 ? '<svg viewBox="0 0 24 24" width="10" height="10" stroke="var(--danger)" stroke-width="2.5" fill="none"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/></svg>' : '<svg viewBox="0 0 24 24" width="10" height="10" stroke="var(--text-muted)" stroke-width="2" fill="none"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    const trendColor = (delta) => delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-muted)';
    // Goals
    const goal = getGoal();
    const activeGoal = state.range === 'week' ? goal.weekly : state.range === 'month' ? goal.monthly : 0;
    const goalPct = activeGoal > 0 ? Math.min(100, (s.totalCash / activeGoal) * 100) : 0;
    // Projection
    const projected = getProjection(list, s);
    // Pay period history
    const ppHistory = getPayPeriodHistory();
    // Earnings milestones (all-time)
    const allTimeEarnings = state.jobs.reduce((a, b) => a + parseFloat(b.fee || 0), 0);
    const milestones = [
        { amount: 1000, label: '£1,000' },
        { amount: 2500, label: '£2,500' },
        { amount: 5000, label: '£5,000' },
        { amount: 10000, label: '£10,000' },
        { amount: 15000, label: '£15,000' },
        { amount: 20000, label: '£20,000' },
        { amount: 30000, label: '£30,000' },
    ];
    const nextMilestone = milestones.find(m => allTimeEarnings < m.amount);
    const milestonePct = nextMilestone ? Math.min(100, (allTimeEarnings / nextMilestone.amount) * 100) : 100;
    // Earnings velocity (£/workday based on pace)
    const velocity = s.daysWorked > 0 ? (s.totalCash / s.daysWorked) : 0;
    // Best & worst earning days of the week
    const wdRevEntries = Object.entries(s.byWeekday).filter(([,w]) => w.count > 0);
    const bestWeekday = wdRevEntries.length > 0 ? wdRevEntries.reduce((a,b) => (a[1].rev / Math.max(a[1].count,1)) > (b[1].rev / Math.max(b[1].count,1)) ? a : b) : null;
    // Best week in scope
    const weeklyTotals = {};
    list.forEach(j => {
        const jd = new Date(j.date + 'T00:00:00');
        const daysToSat = (jd.getDay() + 1) % 7;
        const wkStart = new Date(jd); wkStart.setDate(jd.getDate() - daysToSat);
        const wkKey = wkStart.toISOString().split('T')[0];
        weeklyTotals[wkKey] = (weeklyTotals[wkKey] || 0) + parseFloat(j.fee || 0);
    });
    let bestWeek = { key: null, val: 0 };
    Object.entries(weeklyTotals).forEach(([k, v]) => { if (v > bestWeek.val) bestWeek = { key: k, val: v }; });
    // Completed revenue as % of total
    const completedPct = s.totalCash > 0 ? ((s.completedRev / s.totalCash) * 100).toFixed(0) : 0;
    // Cumulative daily running total
    const sortedDays = Object.entries(daily).sort((a,b) => a[0].localeCompare(b[0]));
    let runningTotal = 0;
    const cumulative = sortedDays.map(([date, val]) => { runningTotal += val; return { date, val: runningTotal }; });
    const maxCum = cumulative.length > 0 ? cumulative[cumulative.length - 1].val : 1;
    // Calculate chargebacks
    const chargebacksTotal = list.filter(j => j.chargeback).reduce((sum, j) => sum + (j.chargebackAmount || 0), 0);
    const chargesElfCount = list.filter(j => j.chargeback && j.chargebackReason === 'ELF').length;
    const chargesCandidsCount = list.filter(j => j.chargeback && j.chargebackReason === 'Candids').length;
    const netEarnings = s.totalCash - chargebacksTotal;
    // Build panel contents
    const panels = [
        {
            id: 'total-revenue',
            title: 'Total Period Revenue',
            content: `<b class="count-up" style="font-size:2.2rem; color:var(--text-main)">&pound;${s.totalCash.toFixed(2)}</b>
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                ${trendIcon(earningsDelta)} <span style="font-size:0.65rem; font-weight:700; color:${trendColor(earningsDelta)}">${earningsDelta >= 0 ? '+' : ''}&pound;${earningsDelta.toFixed(0)} vs prev</span>
            </div>`
        },
        // Chargebacks panel (all roles, but detailed breakdown only for manager/admin)
        (chargebacksTotal > 0) ? {
            id: 'chargebacks',
            title: '💸 Chargebacks & Deductions',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
            content: `<div style="margin:8px 0;">
                <div class="metric-row"><span>Total Chargebacks</span><b class="count-up" style="color:var(--danger);">-&pound;${chargebacksTotal.toFixed(2)}</b></div>
                <div class="metric-row"><span>Net Earnings</span><b class="count-up" style="color:var(--success);">&pound;${netEarnings.toFixed(2)}</b></div>
            </div>
            ${(state.userRole === 'manager' || state.userRole === 'admin') ? `<div style="font-size:0.75rem; color:var(--text-muted); margin:12px 0;">
                <div>ELF charges: ${chargesElfCount}</div>
                <div>Candids charges: ${chargesCandidsCount}</div>
            </div>` : ''}`
        } : null,
        {
            id: 'milestones',
            title: 'Earnings Milestones (All-Time)',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
            content: `<div style="margin:8px 0 4px;">
                ${milestones.map(m => {
                    const reached = allTimeEarnings >= m.amount;
                    return '<div class="milestone-marker ' + (reached ? 'reached' : '') + '">' +
                        '<div class="ms-icon"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><circle cx="12" cy="12" r="10"/>' + (reached ? '<polyline points="9 12 11 14 15 10"/>' : '<path d="M12 8v4l3 3"/>') + '</svg></div>' +
                        '<div style="flex:1"><div class="ms-label">' + m.label + '</div>' +
                        (reached ? '<div class="ms-sublabel">Reached!</div>' : '<div class="ms-sublabel">&pound;' + (m.amount - allTimeEarnings).toFixed(0) + ' to go</div>') +
                        '</div></div>';
                }).join('')}
            </div>
            ${nextMilestone ? '<div style="margin-top:8px;"><div class="xp-bar-outer" style="height:8px;"><div class="xp-bar-fill" style="width:' + milestonePct + '%; background:linear-gradient(90deg, var(--success), var(--primary));"></div></div><div style="display:flex; justify-content:space-between; font-size:0.55rem; color:var(--text-muted); font-weight:700; margin-top:3px;"><span>&pound;' + allTimeEarnings.toFixed(0) + '</span><span>' + nextMilestone.label + '</span></div></div>' : '<div style="font-size:0.65rem; font-weight:700; color:var(--success); margin-top:4px;">All milestones reached!</div>'}`
        },
        {
            id: 'insights',
            title: 'Financial Insights',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
            content: `<div class="metric-row"><span>Avg Daily Earnings</span><b class="count-up">&pound;${s.avgDailyPay}</b></div>
            <div class="metric-row"><span>Avg Pay per Job</span><b class="count-up">&pound;${s.avgJobPay}</b></div>
            <div class="metric-row"><span>Earnings Velocity</span><b class="count-up" style="color:var(--primary)">&pound;${velocity.toFixed(2)}<span style="font-size:0.55rem; color:var(--text-muted)">/workday</span></b></div>
            <div class="metric-row"><span>Highest Earning Day</span><b class="count-up">&pound;${bestDay.val.toFixed(2)} <span style="font-size:0.6rem; color:var(--text-muted)">(${bestDay.date !== 'N/A' ? new Date(bestDay.date + 'T00:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short'}) : 'N/A'})</span></b></div>
            ${bestWeek.key ? `<div class="metric-row"><span>Best Week</span><b class="count-up">&pound;${bestWeek.val.toFixed(0)} <span style="font-size:0.55rem; color:var(--text-muted)">w/c ${new Date(bestWeek.key+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span></b></div>` : ''}
            ${bestWeekday ? `<div class="metric-row"><span>Best Earning Day</span><b class="count-up">${bestWeekday[0]} <span style="font-size:0.55rem; color:var(--text-muted)">&pound;${(bestWeekday[1].rev / bestWeekday[1].count).toFixed(0)} avg</span></b></div>` : ''}
            <div class="metric-row"><span>Completed Revenue %</span><b class="count-up" style="color:var(--success)">${completedPct}%</b></div>
            <div class="metric-row"><span>Earnings vs Prev</span><b>${trendIcon(earningsDelta)} <span style="color:${trendColor(earningsDelta)}">${earningsDelta >= 0 ? '+' : ''}&pound;${earningsDelta.toFixed(0)}</span></b></div>
            <div class="metric-row"><span>Volume vs Prev</span><b>${trendIcon(s.vol - prevS.vol)} <span style="color:${trendColor(s.vol - prevS.vol)}">${s.vol - prevS.vol >= 0 ? '+' : ''}${s.vol - prevS.vol} jobs</span></b></div>
            <div class="metric-row"><span>Avg Pay vs Prev</span><b>${trendIcon(parseFloat(s.avgJobPay) - parseFloat(prevS.avgJobPay))} <span style="color:${trendColor(parseFloat(s.avgJobPay) - parseFloat(prevS.avgJobPay))}">${parseFloat(s.avgJobPay) - parseFloat(prevS.avgJobPay) >= 0 ? '+' : ''}&pound;${(parseFloat(s.avgJobPay) - parseFloat(prevS.avgJobPay)).toFixed(2)}</span></b></div>`
        },
        {
            id: 'daily-earnings',
            title: 'Daily Earnings Tracker',
            content: `<div class="chart-container">
                ${Object.keys(daily).length ? Object.entries(daily).sort().map(([date, val]) => `
                    <div class="bar-wrapper"><span class="bar-val count-up" style="font-size:0.6rem">&pound;${val.toFixed(0)}</span><div class="bar" style="height:${(val/maxD)*100}%; background:linear-gradient(to top, color-mix(in srgb, var(--primary) 30%, transparent), var(--primary));"></div><span class="bar-label">${date.split('-')[2]}</span></div>
                `).join('') : '<div style="color:var(--text-muted); font-size:0.7rem;">NO DATA</div>'}
            </div>`
        },
        {
            id: 'revenue-status',
            title: 'Revenue by Status',
            content: `${s.totalCash > 0 ? `<div style="display:flex; height:20px; border-radius:6px; overflow:hidden; margin:10px 0 14px;">
                ${s.completedRev > 0 ? `<div style="flex:${s.completedRev}; background:var(--success);" title="Completed: \u00a3${s.completedRev.toFixed(2)}"></div>` : ''}
                ${s.internalRev > 0 ? `<div style="flex:${s.internalRev}; background:var(--warning);" title="Internal: \u00a3${s.internalRev.toFixed(2)}"></div>` : ''}
            </div>` : ''}
            <div class="metric-row"><span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--success); margin-right:6px;"></span>Completed</span><b class="count-up">&pound;${s.completedRev.toFixed(2)}</b></div>
            <div class="metric-row"><span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--warning); margin-right:6px;"></span>Internal</span><b class="count-up">&pound;${s.internalRev.toFixed(2)}</b></div>`
        },
        {
            id: 'pay-history',
            title: 'Pay Period History',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
            content: `<div style="max-height:200px; overflow-y:auto;">
                ${ppHistory.map((p, i) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-t); cursor:pointer;${i===0?' font-weight:700;':''}" onclick="jumpToPayWeek('${p.mon.toISOString().split('T')[0]}')">
                        <div><span style="font-size:0.75rem;">${p.label}</span><br><span style="font-size:0.6rem; color:var(--text-muted);">Pay: ${p.payDate}</span></div>
                        <b style="font-size:0.85rem; color:${p.total > 0 ? 'var(--success)' : 'var(--text-muted)'};">&pound;${p.total.toFixed(0)}</b>
                    </div>
                `).join('')}
            </div>`
        }
    ];
    // Conditional panels
    if (cumulative.length > 1) {
        panels.push({
            id: 'cumulative',
            title: 'Cumulative Earnings',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>',
            content: `<div class="chart-container">
                ${cumulative.map(c => `
                    <div class="bar-wrapper"><span class="bar-val count-up" style="font-size:0.5rem">&pound;${c.val.toFixed(0)}</span><div class="bar" style="height:${(c.val/maxCum)*100}%; background:linear-gradient(to top, color-mix(in srgb, var(--success) 30%, transparent), var(--success)); border-radius:4px 4px 0 0;"></div><span class="bar-label">${c.date.split('-')[2]}</span></div>
                `).join('')}
            </div>`
        });
    }
    if (state.range === 'week' || state.range === 'month') {
        panels.push({
            id: 'revenue-goal',
            title: 'Revenue Goal',
            icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>',
            content: `${activeGoal > 0 ? `<div class="goal-bar"><div class="goal-fill" style="width:${goalPct}%;"></div></div>
            <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted); font-weight:700; margin-bottom:8px;">
                <span>&pound;${s.totalCash.toFixed(0)} / &pound;${activeGoal}</span>
                <span style="color:${goalPct >= 100 ? 'var(--success)' : 'var(--text-muted)'}">${goalPct.toFixed(0)}%</span>
            </div>` : ''}
            <div class="metric-row"><span>${state.range === 'week' ? 'Weekly' : 'Monthly'} Target</span><div style="display:flex; align-items:center; gap:6px;"><span style="font-size:0.8rem;">&pound;</span><input type="number" class="expense-input" value="${activeGoal}" min="0" step="10" onchange="saveGoal('${state.range === 'week' ? 'weekly' : 'monthly'}', parseFloat(this.value)||0); render()"></div></div>`
        });
    }
    if (state.range !== 'day') {
        panels.push({
            id: 'projected',
            title: `Projected ${state.range.charAt(0).toUpperCase() + state.range.slice(1)} Earnings`,
 icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
            content: `<b class="count-up" style="font-size:1.4rem; color:var(--primary);">&pound;${projected.toFixed(2)}</b>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">Based on current pace</div>`
        });
    }
    if (Object.keys(typeRev).length) {
        panels.push({
            id: 'period-earnings',
            title: `${state.range === 'year' ? 'Monthly' : state.range === 'month' ? 'Weekly' : 'Weekday'} Earnings`,
            content: `<div style="display:flex; justify-content:space-between; gap:4px; padding:10px 0;">
                ${(() => {
                    let buckets = [];
                    if (state.range === 'year') {
                        const monthly = {};
                        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        list.forEach(j => { const m = j.date.substring(0, 7); monthly[m] = (monthly[m] || 0) + parseFloat(j.fee || 0); });
                        const yr = state.viewDate.getFullYear();
                        for (let i = 0; i < 12; i++) {
                            const key = yr + '-' + String(i + 1).padStart(2, '0');
                            buckets.push({ label: monthNames[i], val: monthly[key] || 0 });
                        }
                    } else if (state.range === 'month') {
                        const weekly = {};
                        list.forEach(j => {
                            const jd = new Date(j.date + 'T00:00:00');
                            const weekNum = Math.ceil(jd.getDate() / 7);
                            weekly[weekNum] = (weekly[weekNum] || 0) + parseFloat(j.fee || 0);
                        });
                        for (let w = 1; w <= 5; w++) {
                            buckets.push({ label: 'W' + w, val: weekly[w] || 0 });
                        }
                    } else {
                        const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
                        dayNames.forEach(d => {
                            const wd = s.byWeekday[d];
                            buckets.push({ label: d, val: wd.rev });
                        });
                    }
                    const maxB = Math.max(...buckets.map(b => b.val), 1);
                    return buckets.map(b => {
                        const opacity = b.val > 0 ? Math.max(0.25, b.val / maxB) : 0.08;
                        return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
                            <span style="font-size:0.55rem; font-weight:800; color:var(--text-main);">&pound;${b.val.toFixed(0)}</span>
                            <div style="width:100%; height:40px; border-radius:4px; background:var(--primary); opacity:${opacity};"></div>
                            <span style="font-size:0.55rem; font-weight:700; color:var(--text-muted);">${b.label}</span>
                        </div>`;
                    }).join('');
                })()}
            </div>`
        });
        panels.push({
            id: 'type-revenue',
            title: 'Revenue by Job Type',
            content: `<div style="overflow-x:auto; margin-top:8px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.7rem;">
                    <thead><tr style="border-bottom:2px solid var(--border-t); text-align:left;">
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700;">Type</th>
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700; text-align:center;">Jobs</th>
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700; text-align:right;">Revenue</th>
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700; text-align:right;">Avg</th>
                        <th style="padding:6px 4px; color:var(--text-muted); font-weight:700; text-align:right;">Share</th>
                    </tr></thead>
                    <tbody>${Object.entries(typeRev).sort((a,b) => b[1] - a[1]).map(([type, rev]) => {
                        const typeJobs = list.filter(j => j.type === type).length;
                        const share = s.totalCash > 0 ? ((rev / s.totalCash) * 100).toFixed(0) : 0;
                        return `<tr style="border-bottom:1px solid var(--border-t);">
                            <td style="padding:8px 4px; font-weight:700;">${type}</td>
                            <td style="padding:8px 4px; text-align:center;">${typeJobs}</td>
                            <td style="padding:8px 4px; text-align:right; font-weight:700;">&pound;${rev.toFixed(2)}</td>
                            <td style="padding:8px 4px; text-align:right; color:var(--text-muted);">&pound;${(rev / typeJobs).toFixed(2)}</td>
                            <td style="padding:8px 4px; text-align:right;">
                                <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
                                    <div style="width:40px; height:6px; border-radius:3px; background:var(--border-t); overflow:hidden;"><div style="height:100%; width:${share}%; background:var(--primary); border-radius:3px;"></div></div>
                                    <span style="font-size:0.65rem; font-weight:700;">${share}%</span>
                                </div>
                            </td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`
        });
    }
    // Apply saved order or use default
    // Filter out null panels (conditional panels that didn't meet criteria)
    const validPanels = panels.filter(p => p);
    const savedOrder = getPanelOrder('funds');
    const orderedPanels = savedOrder.length > 0
        ? savedOrder.map(id => validPanels.find(p => p.id === id)).filter(p => p)
        : validPanels;
    container.innerHTML =`
        <div class="pay-card" onclick="jumpToPayWeek('${payMonISO}')">
            <div class="pay-label">Expected This Friday \u00b7 ${payFriStr}</div>
            <div class="pay-amount">&pound;${pp.total.toFixed(2)}</div>
            <div class="pay-meta">${pp.count} job${pp.count !== 1 ? 's' : ''} \u00b7 ${pp.label}</div>
            <div class="pay-arrow">\u2192</div>
        </div>` + orderedPanels.map(p => wrapPanel(p.id, p.title, p.content, 'funds', p.icon || '')).join('');
}

/**
 * Render leaderboard tab
 * @param {HTMLElement} container - Container element
 * @param {Array} list - Job list
 * @param {Object} s - Stats object
 */
function renderLeaderboard(container, list, s) {
    const participationKey = getLeaderboardParticipationKey();
    const isEnabled = localStorage.getItem(participationKey) === '1';

    if (!isEnabled) {
        container.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
            <div style="margin-bottom:16px; opacity:0.4;"><svg viewBox="0 0 24 24" width="56" height="56" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6-6 6 6"/><polyline points="3 6 3 20 21 20"/><path d="M7 11v9"/><path d="M12 8v12"/><path d="M17 10v11"/></svg></div>
            <h3 style="color:var(--text-main); margin-bottom:8px;">Leaderboards Disabled</h3>
            <p style="font-size:0.8rem;">Enable leaderboard participation in settings to join leaderboard rankings.</p>
            <button class="btn" style="background:var(--primary); color:#fff; margin-top:16px;" onclick="navSettings()">Enable in Settings</button>
        </div>`;
        return;
    }

    container.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--text-muted);">Loading leaderboard data...</div>`;

    const activeUserId = getActiveUserId();
    const refDate = new Date(state.viewDate);
    let startDate = new Date(refDate);
    let endDate = new Date(refDate);

    if (state.range === 'day') {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
    } else if (state.range === 'week') {
        const daysToSat = (refDate.getDay() + 1) % 7;
        startDate.setDate(refDate.getDate() - daysToSat);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
    } else if (state.range === 'month') {
        startDate = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
        endDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
        startDate = new Date(refDate.getFullYear(), 0, 1);
        endDate = new Date(refDate.getFullYear(), 11, 31, 23, 59, 59, 999);
    }

    const inRange = (jobDateStr) => {
        const jobDate = new Date(jobDateStr + 'T00:00:00');
        return jobDate >= startDate && jobDate <= endDate;
    };

    const computeCurrentStreak = (jobs) => {
        const toTime = (value) => {
            if (!value) return 0;
            if (typeof value === 'number') return value;
            const parsed = new Date(value).getTime();
            return isNaN(parsed) ? 0 : parsed;
        };
        const resolved = [...jobs]
            .filter(j => j.status !== 'Pending')
            .sort((a, b) => toTime(b.completed_at || b.completedAt) - toTime(a.completed_at || a.completedAt));
        let streak = 0;
        for (const j of resolved) {
            if (j.status === 'Completed') streak++;
            else break;
        }
        return streak;
    };

    const computeLongestStreak = (jobs) => {
        const toTime = (value) => {
            if (!value) return 0;
            if (typeof value === 'number') return value;
            const parsed = new Date(value).getTime();
            return isNaN(parsed) ? 0 : parsed;
        };
        const resolved = [...jobs]
            .filter(j => j.status !== 'Pending')
            .sort((a, b) => toTime(a.completed_at || a.completedAt) - toTime(b.completed_at || b.completedAt));
        let run = 0;
        let maxRun = 0;
        for (const j of resolved) {
            if (j.status === 'Completed') {
                run++;
                maxRun = Math.max(maxRun, run);
            } else {
                run = 0;
            }
        }
        return maxRun;
    };

    const completionRate = (jobs) => {
        const resolved = jobs.filter(j => {
            if (!['Completed', 'Failed', 'Internals'].includes(j.status)) return false;
            const cfg = state.getTypeConfig(j.job_type || j.type);
            return cfg ? cfg.countTowardsCompletion !== false : true;
        });
        if (resolved.length === 0) return 0;
        const completed = resolved.filter(j => j.status === 'Completed').length;
        return parseFloat(((completed / resolved.length) * 100).toFixed(1));
    };

    const renderMetricBoard = (title, key, rows, formatValue) => {
        if (!rows.length) {
            return `<div class="panel"><h4 style="margin:0 0 10px 0;">${title}</h4><div style="color:var(--text-muted); font-size:0.8rem;">No data for this period.</div></div>`;
        }

        return `<div class="panel" style="padding:0; overflow:hidden;">
            <div style="padding:12px 12px 8px; font-weight:700;">${title}</div>
            <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border-t); text-align:left;">
                        <th style="padding:8px; color:var(--text-muted);">Rank</th>
                        <th style="padding:8px; color:var(--text-muted);">Name</th>
                        <th style="padding:8px; color:var(--text-muted); text-align:right;">Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row, index) => {
                        const rank = index + 1;
                        return `<tr style="border-bottom:1px solid var(--border-t); background:${row.user_id === activeUserId ? 'var(--primary-dim)' : 'transparent'};">
                            <td style="padding:8px; font-weight:700; color:var(--text-muted);">${rank}</td>
                            <td style="padding:8px; font-weight:700; color:${row.user_id === activeUserId ? 'var(--primary)' : 'var(--text-main)'};">${row.display_name}${row.user_id === activeUserId ? ' (You)' : ''}</td>
                            <td style="padding:8px; text-align:right; font-weight:700;">${formatValue(row[key])}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    };

    (async () => {
        try {
            const [profiles, jobs] = await Promise.all([
                supabaseClient.select('profiles', { select: 'id,display_name' }),
                supabaseClient.select('jobs', {
                    select: 'id,user_id,job_type,date,status,completed_at,updated_at'
                })
            ]);

            const profileMap = new Map((Array.isArray(profiles) ? profiles : []).map(p => [p.id, p.display_name || 'Anonymous']));
            const allJobs = Array.isArray(jobs) ? jobs : [];

            if (!allJobs.length) {
                container.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                    <h3 style="color:var(--text-main); margin-bottom:8px;">No leaderboard data yet</h3>
                    <p style="font-size:0.8rem;">Once jobs are logged, leaderboard metrics will appear here.</p>
                </div>`;
                return;
            }

            const byUser = new Map();
            allJobs.forEach(job => {
                if (!job.user_id) return;
                if (!byUser.has(job.user_id)) byUser.set(job.user_id, []);
                byUser.get(job.user_id).push(job);
            });

            const metrics = [];
            byUser.forEach((userJobs, userId) => {
                const periodJobs = userJobs.filter(j => inRange(j.date));
                const completedPeriod = periodJobs.filter(j => j.status === 'Completed').length;

                metrics.push({
                    user_id: userId,
                    display_name: profileMap.get(userId) || (userId === activeUserId ? (localStorage.getItem('nx_displayName') || 'You') : 'Anonymous'),
                    completion_rate: completionRate(periodJobs),
                    current_streak: computeCurrentStreak(periodJobs),
                    longest_streak_all_time: computeLongestStreak(userJobs),
                    completed_jobs: completedPeriod
                });
            });

            const withPeriodData = metrics.filter(m => m.completed_jobs > 0 || m.completion_rate > 0 || m.current_streak > 0);
            const completionRows = [...withPeriodData].sort((a, b) => b.completion_rate - a.completion_rate || b.completed_jobs - a.completed_jobs);
            const currentStreakRows = [...withPeriodData].sort((a, b) => b.current_streak - a.current_streak || b.completion_rate - a.completion_rate);
            const longestRows = [...metrics].sort((a, b) => b.longest_streak_all_time - a.longest_streak_all_time || b.completion_rate - a.completion_rate);
            const completedRows = [...withPeriodData].sort((a, b) => b.completed_jobs - a.completed_jobs || b.completion_rate - a.completion_rate);

            const currentUser = completionRows.find(r => r.user_id === activeUserId) || metrics.find(r => r.user_id === activeUserId);

            container.innerHTML = `
                <div class="panel" style="margin-bottom:12px; background:linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, transparent), color-mix(in srgb, var(--primary) 5%, transparent)); border:1px solid var(--border-t);">
                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">Your Completion Rate (${state.range.toUpperCase()})</div>
                    <div style="margin-top:4px; font-size:1.8rem; font-weight:800; color:var(--primary);">${currentUser ? currentUser.completion_rate.toFixed(1) + '%' : '—'}</div>
                </div>
                <div style="display:grid; gap:12px;">
                    ${renderMetricBoard('Completion Rate', 'completion_rate', completionRows, value => `${value.toFixed(1)}%`)}
                    ${renderMetricBoard('Current Streak', 'current_streak', currentStreakRows, value => `${value}`)}
                    ${renderMetricBoard('Longest Streak (All Time)', 'longest_streak_all_time', longestRows, value => `${value}`)}
                    ${renderMetricBoard('Completed Jobs', 'completed_jobs', completedRows, value => `${value}`)}
                </div>
            `;
        } catch (error) {
            console.warn('Leaderboard load failed:', error);
            container.innerHTML = `<div style="text-align:center; padding:50px 20px; color:var(--text-muted);">
                <h3 style="color:var(--text-main); margin-bottom:8px;">Leaderboard unavailable</h3>
                <p style="font-size:0.8rem;">Could not load leaderboard data right now.</p>
            </div>`;
        }
    })();
}

/**
 * Render settings tab
 * @param {HTMLElement} container - Container element
 */
function renderSettings(container) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const currentAccent = localStorage.getItem('nx_accent') || '#58a6ff';
    const currentGrad = localStorage.getItem('nx_gradient') || '';
    const colours = [
        { dark: '#58a6ff', light: '#0969da', label: 'Blue' },
        { dark: '#7ee787', light: '#1a7f37', label: 'Green' },
        { dark: '#ffa657', light: '#bc4c00', label: 'Orange' },
        { dark: '#ffd54f', light: '#f57f17', label: 'Gold' },
        { dark: '#78909c', light: '#37474f', label: 'Gunmetal' },
        { dark: '#b0bec5', light: '#546e7a', label: 'Slate' },
        { dark: '#a1887f', light: '#5d4037', label: 'Mocha' },
        { dark: '#ff7b72', light: '#cf222e', label: 'Red' },
    ];
    const gradients = [
        { grad: 'linear-gradient(135deg, #4facfe, #00f2fe)', dark: '#4facfe', light: '#0277bd', label: 'Ocean' },
        { grad: 'linear-gradient(135deg, #43e97b, #38f9d7)', dark: '#43e97b', light: '#00897b', label: 'Mint' },
        { grad: 'linear-gradient(135deg, #f7971e, #ffd200)', dark: '#f7971e', light: '#e65100', label: 'Furnace' },
        { grad: 'linear-gradient(135deg, #2c3e50, #4ca1af)', dark: '#4ca1af', light: '#2c3e50', label: 'Titanium' },
        { grad: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', dark: '#2c5364', light: '#1b3a4b', label: 'Abyss' },
        { grad: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)', dark: '#0f3460', light: '#0a2647', label: 'Midnight' },
        { grad: 'linear-gradient(135deg, #1d2b3a, #c33764)', dark: '#c33764', light: '#9b2d50', label: 'Ember' },
        { grad: 'linear-gradient(135deg, #141e30, #243b55)', dark: '#4a6fa5', light: '#2d4a7a', label: 'Steel' },
    ];
    window._gradients = gradients;
   
    const panels = [
        {
            id: 'appearance',
            title: 'Appearance & Display',
            icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg>',
            content: `<div class=\"theme-toggle-row\">
                <div><span>Light Mode</span><br><small>Switch between dark and light themes</small></div>
                <label class=\"toggle-switch\">
                    <input type=\"checkbox\" ${isLight ? 'checked' : ''} onchange=\"toggleTheme(this.checked)\">
                    <span class=\"toggle-track\"></span>
                </label>
            </div>
            
            <div style=\"margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle);\">
                <span style=\"font-size:0.85rem; font-weight:600; color:var(--text-main);\">Display Name</span><br>
                <small style=\"font-size:0.7rem; color:var(--text-muted);\">Your name on leaderboards</small>
                <input type="text" value="${state.displayName}" style="width:100%; padding:8px; margin-top:6px; border:1px solid var(--border-t); border-radius:6px; background:var(--surface-elev); color:var(--text-main); font-size:0.85rem;" placeholder="Your name" oninput="setDisplayNameGlobal(this.value);">
            </div>
            
            <div style=\"padding-top:16px; margin-top:16px; border-top:1px solid var(--border-subtle);\">
                <span style=\"font-size:0.85rem; font-weight:600; color:var(--text-main);\">Accent Colour</span><br>
                <small style=\"font-size:0.7rem; color:var(--text-muted);\">Choose the base colour across the app</small>
                <div class=\"picker-card\" onclick=\"this.classList.toggle('open')\">
                    <div class=\"picker-card-header\"><span>Solids</span><span class=\"picker-card-chevron\">▼</span></div>
                    <div class=\"picker-card-body\" onclick=\"event.stopPropagation()\">
                        <div class=\"colour-picker\">
                            ${colours.map(c => {
                                const isActive = !currentGrad && (currentAccent === c.dark || currentAccent === c.light);
                                return `<div class=\"colour-swatch ${isActive ? 'active' : ''}\" style=\"background:${isLight ? c.light : c.dark}; color:${isLight ? c.light : c.dark};\" onclick=\"setAccentColour('${c.dark}', '${c.light}')\" title=\"${c.label}\"></div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
                <div class=\"picker-card\" onclick=\"this.classList.toggle('open')\">
                    <div class=\"picker-card-header\"><span>Gradients</span><span class=\"picker-card-chevron\">▼</span></div>
                    <div class=\"picker-card-body\" onclick=\"event.stopPropagation()\">
                        <div class=\"colour-picker gradients\">
                            ${gradients.map((g, i) => {
                                const isActive = currentGrad === g.grad;
                                return `<div class=\"colour-swatch grad ${isActive ? 'active' : ''}\" style=\"background:${g.grad};\" onclick=\"pickGradient(${i})\" title=\"${g.label}\"></div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>
            
            <div style=\"padding-top:16px; margin-top:16px; border-top:1px solid var(--border-subtle);\">
                <span style=\"font-size:0.85rem; font-weight:600; color:var(--text-main);\">Background Animation</span><br>
                <small style=\"font-size:0.7rem; color:var(--text-muted);\">Choose an animated background style</small>
                <div class=\"picker-card\" onclick=\"this.classList.toggle('open')\">
                    <div class=\"picker-card-header\"><span>Style</span><span class=\"picker-card-chevron\">▼</span></div>
                    <div class=\"picker-card-body\" onclick=\"event.stopPropagation()\">
                        <div class=\"bg-anim-grid\">
                            ${buildBgAnimOptions()}
                        </div>
                    </div>
                </div>
            </div>`
        },
        {
            id: 'job-types',
            title: 'Job Type Configuration',
            icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/></svg>',
            content: `<div style=\"max-height:250px; overflow-y:auto; margin-bottom:12px; padding-right:10px;\">
                ${Object.entries(state.types).map(([name, data]) => `
                    <div style=\"display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid var(--border-t); gap:12px;\">
                        <div style="min-width:0;"><b>${name}</b><br><span style="font-size:0.7rem; color:var(--text-muted)">&pound;${data.pay} · Int: ${data.int == null ? 'N/A' : '&pound;' + data.int} · Upgrade: ${data.upgradePay == null ? 'N/A' : '&pound;' + data.upgradePay} · Completion: ${data.countTowardsCompletion === false ? 'Off' : 'On'}</span></div>
                        <button class=\"btn\" style=\"width:auto; min-width:54px; flex-shrink:0; padding:6px 12px; margin:0; font-size:0.6rem; background:var(--border)\" onclick=\"editTypeModal('${name}')\">EDIT</button>
                    </div>
                `).join('')}
            </div>
            <button class=\"btn\" style=\"background:var(--primary); color:#fff\" onclick=\"addTypeModal()\">+ CREATE NEW JOB TYPE</button>`
        },
        {
            id: 'features',
            title: 'Features & Tools',
            icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\"/></svg>',
            content: `<div class=\"theme-toggle-row\">
                <div><span>Leaderboards</span><br><small>Participate in period-based rankings</small></div>
                <label class=\"toggle-switch\">
                    <input type=\"checkbox\" ${localStorage.getItem(getLeaderboardParticipationKey()) === '1' ? 'checked' : ''} onchange=\"toggleLeaderboardParticipation()\">
                    <span class=\"toggle-track\"></span>
                </label>
            </div>
            <div class=\"theme-toggle-row\">
                <div><span>Wake Lock</span><br><small>Keep screen on while using app</small></div>
                <label class=\"toggle-switch\">
                    <input type=\"checkbox\" ${localStorage.getItem('nx_wakelock') === '1' ? 'checked' : ''} onchange=\"toggleWakeLock()\">
                    <span class=\"toggle-track\"></span>
                </label>
            </div>
            <div class=\"theme-toggle-row\">
                <div><span>Notifications</span><br><small>Get pending job count reminders</small></div>
                <label class=\"toggle-switch\">
                    <input type=\"checkbox\" ${localStorage.getItem('nx_notif') === '1' ? 'checked' : ''} onchange=\"requestNotifications()\">
                    <span class=\"toggle-track\"></span>
                </label>
            </div>
            <button class=\"btn\" style=\"background:var(--border); color:var(--text-main); margin-top:12px; display:flex; align-items:center; justify-content:center; gap:6px;\" onclick=\"showNotesSearch()\"><svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/></svg> SEARCH NOTES</button>`
        },
        {
            id: 'data',
            title: 'Data Management',
            icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/><path d=\"M21 12c0 1.66-4 3-9 3s-9-1.34-9-3\"/><path d=\"M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5\"/></svg>',
            content: `<button class=\"btn\" style=\"background:var(--border); color:var(--text-main)\" onclick=\"exportCSV()\">EXPORT DATABASE (CSV)</button>
            <div class=\"btn\" style=\"background:var(--border); color:var(--text-main); position:relative; overflow:hidden; text-align:center;\">
                IMPORT CSV
                <input type=\"file\" onchange=\"importCSV(event)\" style=\"position:absolute; top:0; right:0; bottom:0; left:0; opacity:0; cursor:pointer;\">
            </div>
            <button class=\"btn\" style=\"background:var(--primary); color:#fff; margin-top:10px;\" onclick=\"window.JobTrackerModals.showDataManagement()\">
                <span style=\"margin-right:6px;\">💾</span> ADVANCED DATA TOOLS
            </button>
            <button class=\"btn\" style=\"background:var(--danger); margin-top:24px;\" onclick=\"confirmWipe()\">WIPE DATA</button>`
        }
    ];
   
    // Apply saved order or use default
    const savedOrder = getPanelOrder('settings');
    const orderedPanels = savedOrder.length > 0
        ? savedOrder.map(id => panels.find(p => p.id === id)).filter(p => p)
        : panels;
   
    container.innerHTML = orderedPanels.map(p => wrapPanel(p.id, p.title, p.content, 'settings', p.icon || '')).join('');
}

// ===========================
// Supporting Functions
// ===========================

/**
 * Get Saturday display fees for a job
 * @param {Object} j - Job object
 * @returns {Object|null} Fee object or null
 */
function getSaturdayDisplayFees(j) {
    const isSat = new Date(j.date + 'T00:00:00').getDay() === 6;
    const storedFee = parseFloat(j.fee || 0);
    if (!isSat || (j.status !== 'Completed' && j.status !== 'Internals') || storedFee <= 0 || j.manualFee === true) return null;

    const typeCfg = state.getTypeConfig(j.type);
    
    // Use Internal rate for Internals, completed rate for Completed
    const configuredBase = j.status === 'Internals' 
        ? (typeCfg && typeCfg.int != null ? parseFloat(typeCfg.int) : NaN)
        : (typeCfg && typeCfg.pay != null ? parseFloat(typeCfg.pay) : NaN);
    
    const storedBase = j.baseFee != null ? parseFloat(j.baseFee) : NaN;

    let base = Number.isFinite(configuredBase) && configuredBase > 0
        ? configuredBase
        : (Number.isFinite(storedBase) && storedBase > 0 ? storedBase : storedFee / 1.5);

    let final = Number.isFinite(configuredBase) && configuredBase > 0
        ? configuredBase * 1.5
        : storedFee;

    if (!Number.isFinite(base) || base <= 0) return null;
    if (!Number.isFinite(final) || final <= 0) final = storedFee;

    return { base, final };
}

/**
 * Run Saturday fee animations
 */
function runSaturdayFeeAnimations() {
    const container = document.getElementById('drag-container');
    if (!container) return;
    const els = container.querySelectorAll('.fee-amount.sat-premium:not(.sat-done)');
    els.forEach((el, i) => {
        const base = el.dataset.base;
        const final = el.dataset.final;
        if (base == null || final == null) return;
        el.textContent = '\u00A3' + base;
        setTimeout(() => {
            el.textContent = '\u00A3' + final;
            el.classList.add('sat-done');
        }, 350 + (i * 80));
    });
}

/**
 * Wrap panel with collapsible functionality
 * @param {string} panelId - Panel ID
 * @param {string} title - Panel title
 * @param {string} content - Panel content
 * @param {string} tab - Tab name
 * @param {string} icon - Icon HTML
 * @returns {string} HTML string
 */
function wrapPanel(panelId, title, content, tab, icon = '') {
    const states = getPanelStates(tab);
    const collapsed = states[panelId] || false;
    return `<div class="panel collapsible-panel ${collapsed ? 'collapsed' : ''}" data-panel-id="${panelId}" draggable="true">
        <div class="panel-header" ontouchstart="handlePanelTouch(event, '${tab}', '${panelId}')" onclick="event.target.classList.contains('panel-title') && togglePanel('${tab}', '${panelId}')">
            <div class="panel-drag-handle">&#8942;&#8942;</div>
            <div class="panel-title">${icon ? icon + ' ' : ''}${title}</div>
            <div class="panel-toggle" onclick="event.stopPropagation(); togglePanel('${tab}', '${panelId}');"><span class="panel-toggle-icon">${collapsed ? '\u25BC' : '\u25B2'}</span></div>
        </div>
        <div class="panel-content" style="${collapsed ? 'max-height:0;opacity:0;' : ''}">${content}</div>
    </div>`;
}

/**
 * Get panel states for a tab
 * @param {string} tab - Tab name
 * @returns {Object} States object
 */
function getPanelStates(tab) {
    const key = `nx_panels_${tab}`;
    return JSON.parse(localStorage.getItem(key) || '{}');
}

/**
 * Set panel state
 * @param {string} tab - Tab name
 * @param {string} panelId - Panel ID
 * @param {boolean} collapsed - Collapsed state
 */
function setPanelState(tab, panelId, collapsed) {
    const key = `nx_panels_${tab}`;
    const states = getPanelStates(tab);
    states[panelId] = collapsed;
    localStorage.setItem(key, JSON.stringify(states));
}

/**
 * Get panel order for a tab
 * @param {string} tab - Tab name
 * @returns {Array} Order array
 */
function getPanelOrder(tab) {
    const key = `nx_panel_order_${tab}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
}

/**
 * Set panel order for a tab
 * @param {string} tab - Tab name
 * @param {Array} order - Order array
 */
function setPanelOrder(tab, order) {
    const key = `nx_panel_order_${tab}`;
    localStorage.setItem(key, JSON.stringify(order));
}

/**
 * Get job order for current scope
 * @returns {Array} Job order array
 */
function getJobOrder() {
    const key = `nx_job_order_${state.range}_${state.viewDate.toISOString().split('T')[0]}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
}

/**
 * Clear job order for current scope
 */
function clearJobOrder() {
    const key = `nx_job_order_${state.range}_${state.viewDate.toISOString().split('T')[0]}`;
    localStorage.removeItem(key);
}

/**
 * Toggle panel collapse
 * @param {string} tab - Tab name
 * @param {string} panelId - Panel ID
 */
function togglePanel(tab, panelId) {
    const states = getPanelStates(tab);
    const collapsed = !states[panelId];
    setPanelState(tab, panelId, collapsed);
    const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
    if (!panel) return;
    const content = panel.querySelector('.panel-content');
    const icon = panel.querySelector('.panel-toggle-icon');
    if (collapsed) {
        content.style.maxHeight = '0';
        content.style.opacity = '0';
        panel.classList.add('collapsed');
        if (icon) icon.textContent = '\u25BC';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        content.style.opacity = '1';
        panel.classList.remove('collapsed');
        if (icon) icon.textContent = '\u25B2';
        requestAnimationFrame(() => {
            content.style.maxHeight = 'none';
        });
    }
    if (navigator.vibrate) navigator.vibrate(5);
}

/**
 * Build background animation options
 * @returns {string} HTML string
 */
function buildBgAnimOptions() {
    var anims = [
        { id: 'waves', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>', label: 'Waves' },
        { id: 'particles', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="5" cy="6" r="1"/><circle cx="19" cy="6" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="18" cy="18" r="1"/><path d="M12 12L5 6"/><path d="M12 12l7-6"/><path d="M12 12l-6 6"/><path d="M12 12l6 6"/></svg>', label: 'Particles' },
        { id: 'matrix', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="14" y1="4" x2="10" y2="20"/></svg>', label: 'Matrix' },
        { id: 'aurora', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9c3-4 7-4 10 0s7 4 10 0"/><path d="M2 15c3-4 7-4 10 0s7 4 10 0"/></svg>', label: 'Aurora' },
        { id: 'constellation', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', label: 'Stars' },
        { id: 'none', icon: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>', label: 'None' }
    ];
    var current = localStorage.getItem('nx_bg_anim') || 'waves';
    return anims.map(function(a) {
        return '<div class="bg-anim-option ' + (current === a.id ? 'active' : '') + '" onclick="setBgAnimation(\'' + a.id + '\')"><span class="bg-anim-icon">' + a.icon + '</span><span class="bg-anim-label">' + a.label + '</span></div>';
    }).join('');
}

// ===========================
// Placeholder for missing functions (to be implemented)
// ===========================

function handlePanelTouch() { /* TODO */ }
function handleJobTouch() { /* TODO */ }
function pressEdit() { /* TODO */ }
// `toggleBatchSelect` is implemented earlier in the file; remove the
// duplicate empty stub to avoid redeclaration errors.
function getLeaderboardParticipationKey() { return 'nx_leaderboard_enabled'; }
function getActiveUserId() { return 'user123'; } // Placeholder
function editTarget() { /* TODO */ }
function jumpToPayWeek() { /* TODO */ }
function toggleTheme() { /* TODO */ }
function setDisplayNameGlobal() { /* TODO */ }
function setAccentColour() { /* TODO */ }
function pickGradient() { /* TODO */ }
function setBgAnimation() { /* TODO */ }
function editTypeModal() { /* TODO */ }
function addTypeModal() { /* TODO */ }
function toggleLeaderboardParticipation() { /* TODO */ }
// wake lock and notification handlers are defined earlier; stubs removed to
// avoid 'already declared' errors
function showNotesSearch() { /* TODO */ }
function importCSV() { /* TODO */ }
function confirmWipe() { /* TODO */ }

// expose globals for inline handlers (compatibility with existing HTML)
Object.assign(window, {
    setRange,
    nav,
    navSettings,
    adjDate,
    goToday,
    jumpToDate,
    showSignInModal,
    toggleAddPopup,
    showSingleAdd,
    showMultiAdd,
    saveNewJob,
    saveBulkJobs,
    toggleBatchMode,
    clearJobOrder,
    quickStatus,
    pressEdit,
    toggleBatchSelect,
    editTarget,
    shareReport,
    jumpToPayWeek,
    showNotesSearch,
    importCSV,
    confirmWipe,
    // the modal close helper lives in the modals module
    closeModal: JobTrackerModals.closeModal
});

// ===========================
// End of Render Functions
// ===========================
