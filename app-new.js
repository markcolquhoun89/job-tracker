/**
 * Job Tracker - Main Application File (Refactored)
 * 
 * This file integrates all the modular components and provides
 * the glue code for UI interactions.
 * 
 * Modules are loaded in index.html in this order:
 * 1. constants.js
 * 2. utils.js
 * 3. database.js
 * 4. state.js
 * 5. calculations.js
 * 6. jobs.js
 * 7. modals.js
 * 8. app.js (this file)
 */

// Import module references
const { STATUS, RANGES, NOTE_TEMPLATES, SATURDAY_MULTIPLIER } = window.JobTrackerConstants;
const { generateID, timeAgo, debounce, sanitizeHTML, isSaturday, formatDate, getWeekNumber, showToast } = window.JobTrackerUtils;
const { db, STORES } = window.JobTrackerDB;
const state = window.JobTrackerState;
const { calculate, updatePersonalBests, getProjection, getExpensesForScope, getGoal, saveGoal, getTaxRate, setTaxRate, getPayPeriodHistory, getPreviousPeriodStats } = window.JobTrackerCalculations;
const jobOps = window.JobTrackerJobs;
const { customAlert, confirmModal, editJob: editJobModal, showSaturdayRecalculationDialog, showDataManagement } = window.JobTrackerModals;

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

// This will be implemented in a subsequent file due to size
// For now, including a placeholder that loads from the backup

// ... (render function continues in app-render.js)
