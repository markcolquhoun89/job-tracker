// ============================================================================
// ORIGINAL APP.JS CODE
// ============================================================================

    let state = {
        jobs: [], // ⚠️ IMPORTANT: Initialize as empty! Jobs are loaded AFTER auth is ready via loadJobsForCurrentAccount()
        types: JSON.parse(localStorage.getItem('nx_types')) || {
            OH: { pay: 44, int: 21, ug: null, countTowardsCompletion: true },
            UG: { pay: 42, int: 21, ug: null, countTowardsCompletion: true },
            HyOH: { pay: 55, int: 21, ug: null, countTowardsCompletion: true },
            HyUG: { pay: 55, int: 21, ug: null, countTowardsCompletion: true },
            RC: { pay: 20, int: null, ug: null, countTowardsCompletion: true },
            BTTW: { pay: 20, int: null, ug: null, countTowardsCompletion: true }
        },
        viewDate: new Date(),
        range: 'day',
        activeTab: 'jobs',
        deletedJobIds: [] // ⚠️ Also initialize as empty, loaded after auth is ready
    };
    
    // Expose state globally for sync engine and bridge
    window.state = state;

    function normalizeTypeConfig(typeData) {
        const pay = parseFloat(typeData?.pay);
        const int = (typeData?.int === '' || typeData?.int == null || isNaN(parseFloat(typeData.int)))
            ? null
            : parseFloat(typeData.int);
        const ug = (typeData?.ug === '' || typeData?.ug == null || isNaN(parseFloat(typeData.ug)))
            ? null
            : parseFloat(typeData.ug);
        const countTowardsCompletion = typeData?.countTowardsCompletion !== false;

        return {
            pay: isNaN(pay) ? 0 : pay,
            int,
            ug,
            countTowardsCompletion
        };
    }

    function normalizeAllTypes() {
        Object.keys(state.types || {}).forEach(typeName => {
            state.types[typeName] = normalizeTypeConfig(state.types[typeName]);
        });
    }

    function getTypeConfig(typeName) {
        const cfg = state.types && state.types[typeName] ? state.types[typeName] : null;
        return cfg ? normalizeTypeConfig(cfg) : null;
    }

    function getActiveUserId() {
        const authStatus = window.supabaseClient?.getStatus?.();
        return authStatus?.isAuthenticated && authStatus?.userId ? authStatus.userId : null;
    }

    function getDeletedJobsStorageKey() {
        const userId = getActiveUserId();
        return userId ? `nx_deleted_job_ids_user_${userId}` : 'nx_deleted_job_ids_anon';
    }

    function getLeaderboardParticipationKey() {
        const userId = getActiveUserId();
        return userId ? `nx_leaderboard_enabled_user_${userId}` : 'nx_leaderboard_enabled_anon';
    }

    normalizeAllTypes();
    const noteTemplates = {
        'Cable Fault': 'Issue: [Describe the cable fault]\nLocation: [Cable location/route]\nResolution: [How the issue was resolved]\nTime: [Duration of repair]',
        'New Install': 'Type: [Type of installation]\nLocation: [Installation site]\nEquipment: [Equipment used]\nCompletion: [Installation status]',
        'Maintenance': 'Task: [Maintenance activity performed]\nEquipment: [Equipment serviced]\nFindings: [Any issues found]\nRecommendations: [Future maintenance needs]',
        'Emergency': 'Urgency: [Level of emergency]\nIssue: [Emergency description]\nResponse: [Immediate actions taken]\nResolution: [Final outcome]',
        'Custom': ''
    };
    // Batch mode state
    let batchMode = false;
    let batchSelected = new Set();
    // Search/filter state
    let searchQuery = '';
    let statusFilter = 'all';
    // Soft-delete state
    let _deletedJob = null;
    let _deleteTimer = null;
    let _pendingDeletions = new Map(); // Track multiple pending deletions: id -> { job, timer }
    let isDeletingInProgress = false; // Block further deletes until current one syncs
    // Wake lock
    let wakeLock = null;
    // --- Utility: relative time ---
    function timeAgo(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        const days = Math.floor(hrs / 24);
        return days + 'd ago';
    }
    // --- Previous period scope for trend comparison ---
    function getPrevScope() {
        const d = new Date(state.viewDate);
        let prev;
        if (state.range === 'day') { prev = new Date(d); prev.setDate(prev.getDate() - 1); }
        else if (state.range === 'week') { prev = new Date(d); prev.setDate(prev.getDate() - 7); }
        else if (state.range === 'month') { prev = new Date(d); prev.setMonth(prev.getMonth() - 1); }
        else { prev = new Date(d); prev.setFullYear(prev.getFullYear() - 1); }
        const origDate = state.viewDate;
        state.viewDate = prev;
        const list = getScope();
        state.viewDate = origDate;
        return list;
    }
    // --- Trend badge HTML ---
    function trendBadge(current, previous) {
        if (previous === 0 && current === 0) return '';
        if (previous === 0) return '<span class="trend-badge up">▲ NEW</span>';
        const pct = ((current - previous) / previous * 100).toFixed(0);
        if (pct > 0) return `<span class="trend-badge up">▲ ${pct}%</span>`;
        if (pct < 0) return `<span class="trend-badge down">▼ ${Math.abs(pct)}%</span>`;
        return '<span class="trend-badge flat">— 0%</span>';
    }
    // --- Personal bests ---
    function updatePersonalBests(list) {
        const bests = JSON.parse(localStorage.getItem('nx_bests') || '{"bestDayEarnings":0,"bestDayDate":"","longestStreak":0,"mostJobsDay":0,"mostJobsDayDate":""}');
        // Best single day earnings
        const daily = {};
        list.forEach(j => { daily[j.date] = (daily[j.date] || 0) + parseFloat(j.fee || 0); });
        Object.entries(daily).forEach(([date, val]) => {
            if (val > bests.bestDayEarnings) { bests.bestDayEarnings = val; bests.bestDayDate = date; }
        });
        // Most jobs in a day
        const dailyCount = {};
        list.forEach(j => { dailyCount[j.date] = (dailyCount[j.date] || 0) + 1; });
        Object.entries(dailyCount).forEach(([date, count]) => {
            if (count > bests.mostJobsDay) { bests.mostJobsDay = count; bests.mostJobsDayDate = date; }
        });
        // Longest streak ever
        const sorted = [...state.jobs].filter(j => j.status !== 'Pending' && j.completedAt).sort((a,b) => (a.completedAt||0)-(b.completedAt||0));
        let streak = 0, maxStreak = 0;
        for (const j of sorted) {
            if (j.status === 'Completed') { streak++; maxStreak = Math.max(maxStreak, streak); }
            else streak = 0;
        }
        bests.longestStreak = Math.max(bests.longestStreak, maxStreak);
        localStorage.setItem('nx_bests', JSON.stringify(bests));
        return bests;
    }
    // --- XP / Level / Rank System ---
    // --- Expenses ---
    function getExpenses() { return JSON.parse(localStorage.getItem('nx_expenses') || '{}'); }
    function saveExpense(date, amount) {
        const exp = getExpenses();
        if (amount > 0) exp[date] = amount; else delete exp[date];
        localStorage.setItem('nx_expenses', JSON.stringify(exp));
    }
    function getExpensesForScope() {
        const exp = getExpenses();
        const list = getScope();
        const dates = new Set(list.map(j => j.date));
        let total = 0;
        dates.forEach(d => { total += parseFloat(exp[d] || 0); });
        return total;
    }
    // --- Revenue Goal ---
    function getGoal() { return JSON.parse(localStorage.getItem('nx_goal') || '{"weekly":0,"monthly":0}'); }
    function saveGoal(type, val) { const g = getGoal(); g[type] = val; localStorage.setItem('nx_goal', JSON.stringify(g)); }
    // --- Tax rate ---
    function getTaxRate() { return parseFloat(localStorage.getItem('nx_tax') || '0'); }
    function setTaxRate(rate) { localStorage.setItem('nx_tax', rate.toString()); }
    // --- Projected earnings ---
    function getProjection(list, s) {
        const d = new Date(state.viewDate);
        if (state.range === 'day') return s.totalCash;
        let elapsed, total;
        if (state.range === 'week') {
            // Sat=day1 .. Fri=day7
            const daysFromSat = (d.getDay() + 1) % 7;
            elapsed = daysFromSat === 0 ? 7 : daysFromSat;
            total = 7;
        } else if (state.range === 'month') {
            elapsed = d.getDate();
            total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        } else {
            const start = new Date(d.getFullYear(), 0, 1);
            elapsed = Math.ceil((d - start) / 86400000);
            total = 365;
        }
        if (elapsed === 0) return s.totalCash;
        return (s.totalCash / elapsed) * total;
    }
    // --- Date picker ---
    function jumpToDate(val) {
        if (!val) return;
        state.viewDate = new Date(val + 'T00:00:00');
        render();
    }
    // --- Wake lock ---
    async function toggleWakeLock() {
        if (wakeLock) {
            wakeLock.release(); wakeLock = null;
            document.getElementById('wake-indicator').style.display = 'none';
            localStorage.removeItem('nx_wakelock');
        } else {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                document.getElementById('wake-indicator').style.display = 'block';
                localStorage.setItem('nx_wakelock', '1');
                wakeLock.addEventListener('release', () => {
                    document.getElementById('wake-indicator').style.display = 'none';
                });
            } catch(e) { /* not supported */ }
        }
    }
    function toggleLeaderboardParticipation() {
        const key = getLeaderboardParticipationKey();
        const isEnabled = localStorage.getItem(key) === '1';
        if (isEnabled) {
            localStorage.setItem(key, '0');
            showRoleChangeNotification('Leaderboard disabled');
        } else {
            localStorage.setItem(key, '1');
            showRoleChangeNotification('Leaderboard enabled');
        }
        render();
    }
    // --- Share report ---
    function shareReport(s, list) {
        const range = state.range.toUpperCase();
        const d = state.viewDate;
        let label = d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
        if (state.range === 'week') label = 'Week ' + getWeek(d);
        if (state.range === 'month') label = d.toLocaleDateString('en-GB', {month:'long', year:'numeric'});
        if (state.range === 'year') label = d.getFullYear().toString();
        const tax = getTaxRate();
        const net = tax > 0 ? s.totalCash * (1 - tax/100) : s.totalCash;
        const text = `📊 Job Tracker — ${range} Report\n` +
            `📅 ${label}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `📋 Jobs: ${s.vol} (✓${s.done} ✕${s.fails} ⚠${s.ints} ⏳${s.pend})\n` +
            `🎯 Completion: ${s.compRate}%\n` +
            `🔥 Streak: ${s.streak}\n` +
            `💰 Revenue: £${s.totalCash.toFixed(2)}\n` +
            (tax > 0 ? `💵 Take-home (${tax}%): £${net.toFixed(2)}\n` : '') +
            `📈 Avg/Job: £${s.avgJobPay}\n` +
            `━━━━━━━━━━━━━━━━━━`;
        if (navigator.share) {
            navigator.share({ title: 'Job Tracker Report', text }).catch(() => {});
        } else {
            navigator.clipboard.writeText(text).then(() => {
                customAlert('Copied', 'Report copied to clipboard.');
            });
        }
    }
    // --- Notes search ---
    function showNotesSearch() {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:12px;">Search Notes</h3>
            <input type="text" id="notes-search-input" class="input-box" placeholder="Search all job notes..." oninput="doNotesSearch(this.value)">
            <div id="notes-search-results" style="max-height:50vh; overflow-y:auto; margin-top:12px;"></div>
        `;
        m.style.display = 'flex';
        setTimeout(() => document.getElementById('notes-search-input').focus(), 100);
    }
    function doNotesSearch(q) {
        const res = document.getElementById('notes-search-results');
        if (!q.trim()) { res.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem;">Type to search...</div>'; return; }
        const ql = q.toLowerCase();
        const matches = state.jobs.filter(j => (j.notes && j.notes.toLowerCase().includes(ql)) || (j.jobID && j.jobID.toLowerCase().includes(ql)));
        if (!matches.length) { res.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem;">No matches found.</div>'; return; }
        res.innerHTML = matches.slice(0, 20).map(j => {
            const d = new Date(j.date + 'T00:00:00').toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'2-digit'});
            return `<div style="padding:10px; border-bottom:1px solid var(--border-t); cursor:pointer;" onclick="closeModal(); state.viewDate = new Date('${j.date}T00:00:00'); state.range='day'; render(); setTimeout(()=>editJob('${j.id}'),300);">
                <div style="display:flex; justify-content:space-between;"><b style="font-size:0.85rem;">${j.type}</b><span style="font-size:0.7rem; color:var(--text-muted);">${d}</span></div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px; white-space:pre-line;">${(j.notes||'').substring(0,100)}${j.notes && j.notes.length > 100 ? '...' : ''}</div>
            </div>`;
        }).join('');
    }
    // --- Batch mode ---
    function toggleBatchMode() {
        batchMode = !batchMode;
        batchSelected.clear();
        const bar = document.getElementById('batch-bar'); if (bar) bar.remove();
        render();
    }
    function toggleBatchSelect(id, e) {
        if (!batchMode) return;
        e.stopPropagation();
        if (batchSelected.has(id)) batchSelected.delete(id); else batchSelected.add(id);
        // Toggle visual
        const tile = document.querySelector(`.job-tile[data-id="${id}"]`);
        if (tile) tile.classList.toggle('batch-selected');
        renderBatchBar();
    }
    function renderBatchBar() {
        let bar = document.getElementById('batch-bar');
        if (!batchMode || batchSelected.size === 0) { if (bar) bar.remove(); return; }
        if (!bar) { bar = document.createElement('div'); bar.id = 'batch-bar'; bar.className = 'batch-bar'; document.body.appendChild(bar); }
        bar.innerHTML = `
            <span style="font-size:0.8rem; font-weight:700;">${batchSelected.size} selected</span>
            <div style="display:flex; gap:6px;">
                <button style="background:var(--success);" onclick="batchSetStatus('Completed')">✓ DONE</button>
                <button style="background:var(--warning);" onclick="batchSetStatus('Internals')">⚠ INT</button>
                <button style="background:var(--danger);" onclick="batchSetStatus('Failed')">✕ FAIL</button>
                <button style="background:var(--danger); opacity:0.6;" onclick="batchDeleteSelected()" ${ isDeletingInProgress ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>🗑 DELETE</button>
                <button style="background:var(--border);" onclick="toggleBatchMode()">CANCEL</button>
            </div>`;
    }
    function batchSetStatus(status) {
        batchSelected.forEach(id => updateJob(id, status));
        batchMode = false; batchSelected.clear();
        const bar = document.getElementById('batch-bar'); if (bar) bar.remove();
        render();
    }
    function batchDeleteSelected() {
        if (batchSelected.size === 0) return;
        if (isDeletingInProgress) {
            showToast('⏳ Waiting for sync to complete...');
            return;
        }
        // Delete each selected job
        const ids = Array.from(batchSelected);
        ids.forEach(id => {
            // Directly call confirmDeleteJob for each
            const j = state.jobs.find(x => x.id === id);
            if (j) {
                _pendingDeletions.set(id, { job: { ...j }, undoable: true });
                state.jobs = state.jobs.filter(x => x.id !== id);
                if (!state.deletedJobIds.includes(id)) {
                    state.deletedJobIds.push(id);
                }
            }
        });
        
        // Mark as deleting and set up timer once for all
        isDeletingInProgress = true;
        save();
        
        const toast = document.getElementById('toast');
        clearTimeout(_deleteTimer);
        toast.innerHTML = `${batchSelected.size} jobs deleted <button class="toast-undo" onclick="undoLastDelete()">UNDO ALL</button>`;
        toast.classList.add('show');
        
        _deleteTimer = setTimeout(() => {
            for (const [key, val] of _pendingDeletions.entries()) {
                val.undoable = false;
            }
            _pendingDeletions.clear();
            _deletedJob = null;
            toast.classList.remove('show');
        }, 5000);
        
        // Exit batch mode
        batchMode = false;
        batchSelected.clear();
        const bar = document.getElementById('batch-bar');
        if (bar) bar.remove();
        render();
    }
    // --- Pay period history ---
    function getPayPeriodHistory() {
        const periods = [];
        const now = new Date();
        // Friday that ends the current Sat–Fri week (yesterday if Sat, today if Fri, etc.)
        const daysBackToFri = (now.getDay() + 2) % 7;
        const thisFriday = new Date(now);
        thisFriday.setDate(now.getDate() - daysBackToFri);
        thisFriday.setHours(0,0,0,0);
        for (let i = 0; i < 12; i++) {
            const fri = new Date(thisFriday);
            fri.setDate(thisFriday.getDate() - (i * 7));
            fri.setHours(0,0,0,0);
            const sat = new Date(fri); sat.setDate(fri.getDate() - 6);
            sat.setHours(0,0,0,0);
            let total = 0, count = 0;
            state.jobs.forEach(j => {
                const jd = new Date(j.date + 'T00:00:00');
                if (jd >= sat && jd <= fri) { total += parseFloat(j.fee || 0); count++; }
            });
            const fmt = d => d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
            periods.push({ mon: sat, sun: fri, fri, total, count, label: `${fmt(sat)} – ${fmt(fri)}`, payDate: fmt(fri) });
        }
        return periods;
    }
    // --- Notification scheduling ---
    function scheduleNotification() {
        if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            sendPendingCount();
        }
    }
    function sendPendingCount() {
        const today = new Date().toISOString().split('T')[0];
        const pending = state.jobs.filter(j => j.date === today && j.status === 'Pending').length;
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CHECK_PENDING', count: pending });
        }
    }
    function requestNotifications() {
        if (!('Notification' in window)) return customAlert('Not Supported', 'Notifications not available on this device.', true);
        Notification.requestPermission().then(p => {
            if (p === 'granted') {
                localStorage.setItem('nx_notif', '1');
                customAlert('Enabled', 'You will receive reminders about pending jobs.');
                sendPendingCount();
            }
        });
    }
    // FTTP Wizard variables
    let currentStep = 1;
    let fttpData = {};
    let currentJobId = null;
    function generateID() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }
    function getScope() {
        const d = new Date(state.viewDate);
        return state.jobs.filter(j => {
            const jd = new Date(j.date + 'T00:00:00'); jd.setHours(0,0,0,0);
            const ref = new Date(d); ref.setHours(0,0,0,0);
            if (state.range === 'day') return jd.getTime() === ref.getTime();
            if (state.range === 'week') {
                // Week runs Sat–Fri
                const daysToSat = (ref.getDay() + 1) % 7;
                const start = new Date(ref); start.setDate(start.getDate() - daysToSat);
                const end = new Date(start); end.setDate(start.getDate() + 6);
                return jd >= start && jd <= end;
            }
            if (state.range === 'month') return jd.getMonth() === ref.getMonth() && jd.getFullYear() === ref.getFullYear();
            return jd.getFullYear() === ref.getFullYear();
        });
    }
    function calculate(list) {
        const completionEligible = list.filter(j => {
            const cfg = getTypeConfig(j.type);
            return cfg ? cfg.countTowardsCompletion !== false : true;
        });

        const res = completionEligible.filter(j => ['Completed', 'Failed', 'Internals'].includes(j.status));
        const noHy = res.filter(j => !j.type.toUpperCase().startsWith('HY'));
        const rate = (arr) => {
            if (!arr.length) return 0;
            const pts = arr.reduce((a, b) => a + (b.status === 'Completed' ? 1 : 0), 0);
            return ((pts / arr.length) * 100).toFixed(1);
        };
        const totalCash = list.reduce((a, b) => a + parseFloat(b.fee || 0), 0);
        const done = list.filter(j=>j.status==='Completed').length;
        const ints = list.filter(j=>j.status==='Internals').length;
        const fails = list.filter(j=>j.status==='Failed').length;
        const pend = list.filter(j=>j.status==='Pending').length;
       
        // Advanced Metrics
        const daysWorked = new Set(list.map(j => j.date)).size;
        const avgJobPay = list.length > 0 ? (totalCash / list.length).toFixed(2) : 0;
        const avgDailyPay = daysWorked > 0 ? (totalCash / daysWorked).toFixed(2) : 0;
        const avgJobsPerDay = daysWorked > 0 ? (list.length / daysWorked).toFixed(1) : 0;
        // Completion streak (consecutive completed, most recently resolved first)
        const sorted = [...list].filter(j => j.status !== 'Pending').sort((a,b) => (b.completedAt || 0) - (a.completedAt || 0));
        let streak = 0;
        for (const j of sorted) {
            if (j.status === 'Completed') streak++;
            else break;
        }

        // Longest streak within current period
        const oldestFirstResolved = [...list]
            .filter(j => j.status !== 'Pending')
            .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
        let runningStreak = 0;
        let longestStreakInRange = 0;
        for (const j of oldestFirstResolved) {
            if (j.status === 'Completed') {
                runningStreak++;
                longestStreakInRange = Math.max(longestStreakInRange, runningStreak);
            } else {
                runningStreak = 0;
            }
        }
        // Status breakdown per job type
        const typeBreakdown = {};
        list.forEach(j => {
            if (!typeBreakdown[j.type]) typeBreakdown[j.type] = { done: 0, fails: 0, ints: 0, pend: 0, rev: 0 };
            if (j.status === 'Completed') typeBreakdown[j.type].done++;
            else if (j.status === 'Failed') typeBreakdown[j.type].fails++;
            else if (j.status === 'Internals') typeBreakdown[j.type].ints++;
            else typeBreakdown[j.type].pend++;
            typeBreakdown[j.type].rev += parseFloat(j.fee || 0);
        });
        // Weekday analysis
        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const byWeekday = {};
        dayNames.forEach(d => byWeekday[d] = { count: 0, rev: 0 });
        list.forEach(j => {
            const wd = dayNames[new Date(j.date + 'T00:00:00').getDay()];
            byWeekday[wd].count++;
            byWeekday[wd].rev += parseFloat(j.fee || 0);
        });
        // Revenue from completed only vs total
        const completedRev = list.filter(j => j.status === 'Completed').reduce((a, b) => a + parseFloat(b.fee || 0), 0);
        const failedRev = list.filter(j => j.status === 'Failed').reduce((a, b) => a + parseFloat(b.fee || 0), 0);
        const internalRev = list.filter(j => j.status === 'Internals').reduce((a, b) => a + parseFloat(b.fee || 0), 0);
        const pendingRev = list.filter(j => j.status === 'Pending').reduce((a, b) => a + parseFloat(b.fee || 0), 0);
        return {
            compRate: rate(res),
            exclHy: rate(noHy),
            totalCash,
            vol: list.length,
            done,
            ints,
            fails,
            pend,
            avgJobPay,
            avgDailyPay,
            avgJobsPerDay,
            daysWorked,
            streak,
            longestStreakInRange,
            eligibleForCompletion: completionEligible.length,
            typeBreakdown,
            byWeekday,
            completedRev,
            failedRev,
            internalRev,
            pendingRev
        };
    }
    function render(softUpdate) {
        const container = document.getElementById('view-container');
        const scrollY = container.scrollTop;
       
        // Get custom order if it exists
        const customOrder = getJobOrder();
       
        let list;
        if (customOrder.length > 0) {
            // Use custom order
            const scope = getScope();
            const idMap = new Map(scope.map(j => [j.id, j]));
            list = customOrder.map(id => idMap.get(id)).filter(j => j); // Filter out any IDs that no longer exist
            // Add any new jobs that aren't in custom order yet (append to end)
            const customIds = new Set(customOrder);
            const newJobs = scope.filter(j => !customIds.has(j.id));
            list = [...list, ...newJobs];
        } else {
            // Default sort: resolved first (earliest completion), then pending
            list = getScope().sort((a, b) => {
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
        if (searchQuery || statusFilter !== 'all') {
            const q = searchQuery.toLowerCase();
            displayList = list.filter(j => {
                if (statusFilter !== 'all' && j.status !== statusFilter) return false;
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
        else if (state.range === 'week') document.getElementById('date-label').innerHTML = "WEEK " + getWeek(d) + todayDot;
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
                            const hasInt = getTypeConfig(j.type)?.int != null;
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
                    <input type="text" placeholder="\ud83d\udd0d Search jobs..." value="${searchQuery}" oninput="searchQuery=this.value; render()">
                    <select onchange="statusFilter=this.value; render()">
                        <option value="all" ${statusFilter==='all'?'selected':''}>All</option>
                        <option value="Pending" ${statusFilter==='Pending'?'selected':''}>Pending</option>
                        <option value="Completed" ${statusFilter==='Completed'?'selected':''}>Done</option>
                        <option value="Failed" ${statusFilter==='Failed'?'selected':''}>Failed</option>
                        <option value="Internals" ${statusFilter==='Internals'?'selected':''}>Internal</option>
                    </select>
                    ${customOrder.length > 0 ? `<button style="background:var(--warning); color:#fff; padding:6px 10px; border-radius:8px; font-size:0.65rem; font-weight:700; cursor:pointer; white-space:nowrap;" onclick="clearJobOrder(); render()">↻ RESET</button>` : ''}
                    <button style="background:${batchMode?'var(--primary)':'var(--border-t)'}; border:1px solid var(--border-t); color:${batchMode?'#fff':'var(--text-muted)'}; padding:6px 10px; border-radius:8px; font-size:0.65rem; font-weight:700; cursor:pointer; white-space:nowrap;" onclick="toggleBatchMode()">${batchMode?'EXIT':'SELECT'}</button>
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
    function getSaturdayDisplayFees(j) {
        const isSat = new Date(j.date + 'T00:00:00').getDay() === 6;
        const storedFee = parseFloat(j.fee || 0);
        if (!isSat || (j.status !== 'Completed' && j.status !== 'Internals') || storedFee <= 0 || j.manualFee === true) return null;

        const typeCfg = getTypeConfig(j.type);
        
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

    function normalizeSaturdayFees() {
        let changed = false;
        state.jobs.forEach(j => {
            const sat = getSaturdayDisplayFees(j);
            if (!sat) return;

            const expectedBase = parseFloat(sat.base.toFixed(2));
            const expectedFinal = parseFloat(sat.final.toFixed(2));
            const currentFee = parseFloat(j.fee || 0);
            const currentBase = j.baseFee != null ? parseFloat(j.baseFee) : NaN;

            if (Math.abs(currentFee - expectedFinal) > 0.009) {
                j.fee = expectedFinal;
                changed = true;
            }
            if (!Number.isFinite(currentBase) || Math.abs(currentBase - expectedBase) > 0.009) {
                j.baseFee = expectedBase;
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem('nx_jobs', JSON.stringify(state.jobs));
        }
    }

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
    // --- Job card HTML builder ---
    function renderJobCard(j, showDate, pulseMap, animate, index) {
        const delay = animate ? (typeof index === 'number' ? `animation: slideIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: ${index * 50}ms;` : `animation: slideIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both;`) : '';
        const batchAttr = batchMode ? `onclick="toggleBatchSelect('${j.id}', event)"` : `onclick="if(!event.target.closest('button')) pressEdit(this, '${j.id}')"`;
        const batchClass = batchSelected.has(j.id) ? ' batch-selected' : '';
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
                                ${j.isUpgraded ? '<span style="color:var(--primary); font-size:0.6rem; vertical-align:middle;">[UG]</span>' : ''}${j.notes ? '<span class="notes-indicator" title="Has notes"></span>' : ''}</b>
                                <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700">${j.status.toUpperCase()}</span>
                                ${elfIcon || candidsIcon ? `<div style="margin-top:4px; font-size:0.8rem;">${elfIcon} ${candidsIcon}</div>` : ''}
                            </div>
                        </div>
                        ${feeHtml}
                    </div>
                    ${j.status === 'Pending' ? `
                    <div class="job-actions">
                        <button class="action-btn done" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Completed')"><span>\u2713</span> FINISH</button>
                        ${(getTypeConfig(j.type)?.int != null) ? `<button class="action-btn int" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Internals')"><span>\u26a0</span> INT</button>` : ''}
                        <button class="action-btn fail" onclick="event.stopPropagation(); quickStatus('${j.id}', 'Failed')"><span>\u2715</span> FAIL</button>
                    </div>` : ''}
                </div>
            </div>`;
    }
    // --- Press-to-edit with pulse animation ---
    function pressEdit(tile, id) {
        if (navigator.vibrate) navigator.vibrate(10);
        // Clear inline animation so the .pressed class animation can take effect
        tile.style.animation = 'none';
        // Force reflow so the browser registers the cleared animation
        void tile.offsetWidth;
        tile.classList.add('pressed');
        let fired = false;
        const done = () => {
            if (fired) return;
            fired = true;
            clearTimeout(fallback);
            tile.classList.remove('pressed');
            editJob(id);
        };
        tile.addEventListener('animationend', function handler() {
            tile.removeEventListener('animationend', handler);
            done();
        });
        // Safety fallback in case animationend doesn't fire
        const fallback = setTimeout(done, 500);
    }
    // --- Analytics Rendering ---
    function renderStats(container, list, s) {
        const byType = {}; list.forEach(j => byType[j.type] = (byType[j.type] || 0) + 1);
        const maxType = Math.max(...Object.values(byType), 1);
        const target = parseInt(localStorage.getItem('nx_target')) || 80;
        const bests = updatePersonalBests(list);
        // Trend comparison with previous period
        const prevList = getPrevScope();
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
            `<button class="btn" style="background:var(--border); color:var(--text-main); margin-bottom:16px;" onclick="shareReport(calculate(getScope().sort(()=>0)), getScope())">\ud83d\udce4 Share Report</button>`;
    }
    function getPayPeriod() {
        // Paid every Friday, 2 weeks in arrears. Pay week runs Sat–Fri.
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysUntilFri = (5 - dayOfWeek + 7) % 7 || 7;
        const thisFriday = new Date(now);
        if (dayOfWeek === 5) {
            thisFriday.setHours(0,0,0,0);
        } else {
            thisFriday.setDate(now.getDate() + daysUntilFri);
            thisFriday.setHours(0,0,0,0);
        }
        // Pay week = Sat–Fri ending 2 Fridays ago
        const payWeekFri = new Date(thisFriday);
        payWeekFri.setDate(thisFriday.getDate() - 14);
        payWeekFri.setHours(0,0,0,0);
        const payWeekSat = new Date(payWeekFri);
        payWeekSat.setDate(payWeekFri.getDate() - 6);
        payWeekSat.setHours(0,0,0,0);
        let total = 0;
        let count = 0;
        state.jobs.forEach(j => {
            const jd = new Date(j.date + 'T00:00:00');
            if (jd >= payWeekSat && jd <= payWeekFri) {
                total += parseFloat(j.fee || 0);
                count++;
            }
        });
        const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        return { total, count, payWeekMon: payWeekSat, payWeekSun: payWeekFri, thisFriday, label: `${fmt(payWeekSat)} – ${fmt(payWeekFri)}` };
    }
    function editTarget() {
        const cur = parseInt(localStorage.getItem('nx_target')) || 80;
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <h3 style="margin-bottom:10px;">Set Completion Target</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:16px;">Rings turn green when you hit this target, amber at 75% of it, and red below.</p>
            <div style="display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:20px;">
                <button class="btn" style="width:44px; height:44px; padding:0; margin:0; font-size:1.4rem; font-weight:900; background:var(--border); color:var(--text-main); border-radius:50%; display:flex; align-items:center; justify-content:center;" onclick="document.getElementById('target-val').textContent = Math.max(1, parseInt(document.getElementById('target-val').textContent) - 1) + ''">−</button>
                <div style="text-align:center;">
                    <b id="target-val" style="font-size:2.4rem; color:var(--primary);">${cur}</b><span style="font-size:1.2rem; color:var(--text-muted);">%</span>
                </div>
                <button class="btn" style="width:44px; height:44px; padding:0; margin:0; font-size:1.4rem; font-weight:900; background:var(--border); color:var(--text-main); border-radius:50%; display:flex; align-items:center; justify-content:center;" onclick="document.getElementById('target-val').textContent = Math.min(100, parseInt(document.getElementById('target-val').textContent) + 1) + ''">+</button>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main); margin:0;" onclick="closeModal()">CANCEL</button>
                <button class="btn" style="background:var(--primary); margin:0;" onclick="localStorage.setItem('nx_target', document.getElementById('target-val').textContent); closeModal(); render();">SAVE</button>
            </div>
        `;
        m.style.display = 'flex';
    }
    function jumpToPayWeek(monStr) {
        const d = new Date(monStr + 'T00:00:00');
        state.viewDate = d;
        state.range = 'week';
        state.activeTab = 'jobs';
        // Update UI buttons
        document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.range-btn').forEach(b => { if (b.textContent === 'WEEK') b.classList.add('active'); });
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.nav-item')[0].classList.add('active');
        document.getElementById('settings-btn').classList.remove('active');
        if (navigator.vibrate) navigator.vibrate(8);
        render();
    }
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
        const prevList = getPrevScope();
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
                const cfg = getTypeConfig(j.job_type || j.type);
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
                    window.supabaseClient.select('profiles', { select: 'id,display_name' }),
                    window.supabaseClient.select('jobs', {
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
                title: 'Appearance',
                icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg>',
                content: `<div class=\"theme-toggle-row\">
                    <div><span>Light Mode</span><br><small>Switch between dark and light themes</small></div>
                    <label class=\"toggle-switch\">
                        <input type=\"checkbox\" ${isLight ? 'checked' : ''} onchange=\"toggleTheme(this.checked)\">
                        <span class=\"toggle-track\"></span>
                    </label>
                </div>
                <div style=\"padding-top:12px;\">
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
                </div>`
            },
            {
                id: 'animation',
                title: 'Background Animation',
                icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><path d=\"M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/></svg>',
                content: `<div class=\"picker-card\" onclick=\"this.classList.toggle('open')\">
                    <div class=\"picker-card-header\"><span>Style</span><span class=\"picker-card-chevron\">▼</span></div>
                    <div class=\"picker-card-body\" onclick=\"event.stopPropagation()\">
                        <div class=\"bg-anim-grid\">
                            ${buildBgAnimOptions()}
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
                            <div style="min-width:0;"><b>${name}</b><br><span style="font-size:0.7rem; color:var(--text-muted)">&pound;${data.pay} · Int: ${data.int == null ? 'N/A' : '&pound;' + data.int} · UG: ${data.ug == null ? 'N/A' : '&pound;' + data.ug} · Completion: ${data.countTowardsCompletion === false ? 'Off' : 'On'}</span></div>
                            <button class=\"btn\" style=\"width:auto; min-width:54px; flex-shrink:0; padding:6px 12px; margin:0; font-size:0.6rem; background:var(--border)\" onclick=\"editTypeModal('${name}')\">EDIT</button>
                        </div>
                    `).join('')}
                </div>
                <button class=\"btn\" style=\"background:var(--primary); color:#fff\" onclick=\"addTypeModal()\">+ CREATE NEW JOB TYPE</button>`
            },
            {
                id: 'team-access',
                title: 'Team & Access',
                icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
                content: `<div style="margin-bottom:16px;">
                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-main);">Display Name</span><br>
                    <small style="font-size:0.7rem; color:var(--text-muted);">Used on leaderboards</small>
                    <input type="text" value="${(window.JobTrackerState && window.JobTrackerState.displayName) || state.displayName}" style="width:100%; padding:8px; margin-top:6px; border:1px solid var(--border-t); border-radius:6px; background:var(--surface-elev); color:var(--text-main);" placeholder="Your name" oninput="setDisplayNameGlobal(this.value);">
                </div>
                <div>
                    <span style="font-size:0.85rem; font-weight:600; color:var(--text-main);">Role</span><br>
                    <small style="font-size:0.7rem; color:var(--text-muted);">Test different team roles</small>
                    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn" data-role-btn="engineer" onclick="setUserRoleGlobal('engineer');" style="background:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'engineer' ? 'var(--primary)' : 'var(--border)'}; color:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'engineer' ? '#fff' : 'var(--text-main)'}; font-weight:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'engineer' ? '700' : '400'}; flex:1; min-width:90px; padding:8px; margin:0; font-size:0.75rem; transition:all 0.2s;">Engineer</button>
                        <button class="btn" data-role-btn="manager" onclick="setUserRoleGlobal('manager');" style="background:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'manager' ? 'var(--primary)' : 'var(--border)'}; color:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'manager' ? '#fff' : 'var(--text-main)'}; font-weight:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'manager' ? '700' : '400'}; flex:1; min-width:90px; padding:8px; margin:0; font-size:0.75rem; transition:all 0.2s;">Manager</button>
                        <button class="btn" data-role-btn="admin" onclick="setUserRoleGlobal('admin');" style="background:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'admin' ? 'var(--primary)' : 'var(--border)'}; color:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'admin' ? '#fff' : 'var(--text-main)'}; font-weight:${(window.JobTrackerState && window.JobTrackerState.userRole) === 'admin' ? '700' : '400'}; flex:1; min-width:90px; padding:8px; margin:0; font-size:0.75rem; transition:all 0.2s;">Admin</button>
                    </div>
                </div>`
            },
            {
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
            },
            {
                id: 'leaderboards',
                title: 'Leaderboards',
                icon: '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6-6 6 6"/><polyline points="3 6 3 20 21 20"/><path d="M7 11v9"/><path d="M12 8v12"/><path d="M17 10v11"/></svg>',
                content: `<div class=\"theme-toggle-row\">
                    <div><span>Participate in Leaderboards</span><br><small>Join period-based rankings (disabled by default)</small></div>
                    <label class=\"toggle-switch\">
                        <input type=\"checkbox\" ${localStorage.getItem(getLeaderboardParticipationKey()) === '1' ? 'checked' : ''} onchange=\"toggleLeaderboardParticipation()\">
                        <span class=\"toggle-track\"></span>
                    </label>
                </div>
                <div style=\"margin-top:16px; padding:12px; background:var(--surface-elev); border-radius:8px; border:1px solid var(--border-t); font-size:0.75rem; color:var(--text-muted);\">
                    <strong style=\"color:var(--text-main);\">📊 What are Leaderboards?</strong><br>
                    <div style=\"margin-top:8px; line-height:1.6;\">
                        Opt-in leaderboard rankings for completion rate, streaks, and completed jobs. Boards follow the current day/week/month/year period. You can toggle this anytime.
                    </div>
                </div>`
            },
            {
                id: 'tools',
                title: 'Tools & Utilities',
                icon: '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" stroke=\"currentColor\" stroke-width=\"2.5\" fill=\"none\"><path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\"/></svg>',
                content: `<div class=\"theme-toggle-row\">
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
            }
        ];
       
        // Apply saved order or use default
        const savedOrder = getPanelOrder('settings');
        const orderedPanels = savedOrder.length > 0
            ? savedOrder.map(id => panels.find(p => p.id === id)).filter(p => p)
            : panels;
       
        container.innerHTML = orderedPanels.map(p => wrapPanel(p.id, p.title, p.content, 'settings', p.icon || '')).join('');
    }
    // --- Core Actions & Modals ---
    function customAlert(title, message, isError = false) {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <h3 style="margin-bottom:10px; color:${isError ? 'var(--danger)' : 'var(--text-main)'}">${title}</h3>
            <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.5; margin-bottom:20px;">${message}</p>
            <button class="btn" style="background:var(--primary)" onclick="closeModal()">OK</button>
        `;
        m.style.display = 'flex';
    }
    function confirmModal(title, message, confirmActionText, confirmActionFn, isDanger = false) {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <h3 style="margin-bottom:10px; color:${isDanger ? 'var(--danger)' : 'var(--text-main)'}">${title}</h3>
            <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.5; margin-bottom:20px;">${message}</p>
            <div style="display:flex; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main); margin:0;" onclick="closeModal()">CANCEL</button>
                <button class="btn" style="background:${isDanger ? 'var(--danger)' : 'var(--primary)'}; margin:0;" onclick="${confirmActionFn}; closeModal()">${confirmActionText}</button>
            </div>
        `;
        m.style.display = 'flex';
    }
    function editJob(id) {
        // Sync modular state to legacy state before using it
        if (window.JobTrackerCompat && typeof window.JobTrackerCompat.syncState === 'function') {
            try {
                window.JobTrackerCompat.syncState();
            } catch (e) {
                console.warn('Could not sync state:', e);
            }
        }
        
        // TEMPORARILY DISABLED - Try modular version with manual fee editing support
        /*
        try {
            if (window.JobTrackerModals && typeof window.JobTrackerModals.editJob === 'function') {
                window.JobTrackerModals.editJob(id);
                return;
            }
        } catch (error) {
            console.error('Error calling JobTrackerModals.editJob:', error);
        }
        */
        
        // Fallback to original implementation - use app state as single source of truth
        const stateToUse = state;
        
        console.log('editJob called with ID:', id);
        console.log('Using state with', stateToUse.jobs.length, 'jobs');
        console.log('Job IDs:', stateToUse.jobs.map(j => j.id).slice(0, 3));
        
        const j = stateToUse.jobs.find(x => x.id === id);
        if (!j) {
            console.error('Job not found', id, 'in state.jobs. Total jobs:', stateToUse.jobs.length);
            console.error('All job IDs:', stateToUse.jobs.map(j => j.id));
            alert(`Job not found. ID: ${id}`);
            return;
        }
        // Determine status color
        let statusColor = 'var(--text-main)';
        let statusLabel = 'PENDING';
        if (j.status === 'Completed') { statusColor = 'var(--success)'; statusLabel = 'DONE'; }
        else if (j.status === 'Internals') { statusColor = 'var(--warning)'; statusLabel = 'INTERNAL'; }
        else if (j.status === 'Failed') { statusColor = 'var(--danger)'; statusLabel = 'FAILED'; }
        const dateObj = new Date(j.date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
        const feeStr = j.fee > 0 ? `£${j.fee.toFixed(2)}` : '—';
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; padding-bottom:12px; border-bottom:2px solid ${statusColor};">
                <div>
                    <h3 style="margin:0; font-weight:900; color:${statusColor};">${j.type}</h3>
                    <span style="font-size:0.8rem; color:var(--text-muted);">${dateStr} · ${statusLabel} · ${feeStr}</span>
                </div>
                ${j.isUpgraded ? '<span style="background:var(--primary); color:#fff; font-size:0.65rem; padding:2px 8px; border-radius:6px; font-weight:700;">UG</span>' : ''}
            </div>
            ${(j.type === 'BTTW' && !j.isUpgraded) ? `<button class="btn" style="background:var(--primary); color:#fff; margin-bottom:10px;" onclick="updateJob('${id}', 'Completed', true)">UPGRADE TO UG RATE</button>` : ''}
            <input type="text" id="edit-jobid-${id}" class="input-box" placeholder="Job ID (Optional)" value="${j.jobID || ''}">
            <div style="display:grid; grid-template-columns:${(getTypeConfig(j.type)?.int != null) ? '1fr 1fr 1fr' : '1fr 1fr'}; gap:8px; margin-bottom:10px;">
                <button class="btn" style="background:var(--success); margin:0; ${j.status === 'Completed' ? 'outline:2px solid #fff; outline-offset:-3px;' : ''}" onclick="updateJob('${id}', 'Completed')">DONE</button>
                ${(getTypeConfig(j.type)?.int != null) ? `<button class="btn" style="background:var(--warning); margin:0; ${j.status === 'Internals' ? 'outline:2px solid #fff; outline-offset:-3px;' : ''}" onclick="updateJob('${id}', 'Internals')">INT</button>` : ''}
                <button class="btn" style="background:var(--danger); margin:0; ${j.status === 'Failed' ? 'outline:2px solid #fff; outline-offset:-3px;' : ''}" onclick="updateJob('${id}', 'Failed')">FAIL</button>
            </div>
            ${j.status !== 'Pending' ? `<button class="btn" style="background:var(--border); color:var(--text-main); margin-top:10px;" onclick="if(confirm('Revert this job to Pending status?')) { const job = state.jobs.find(x => x.id === '${id}'); if(job) { job.status = 'Pending'; job.fee = 0; job.completedAt = null; job.isUpgraded = false; delete job.saturdayPremium; delete job.baseFee; save(); closeModal(); } }">↻ REVERT TO PENDING</button>` : ''}
            ${['OH', 'UG', 'HyOH', 'HyUG'].includes(j.type) || (j.type === 'BTTW' && j.isUpgraded) ? `<button class="btn" style="background:var(--border); color:var(--text-main); margin-top:10px;" onclick="openNotesWizard('${id}')">NOTES ASSISTANT</button>` : ''}
            <textarea id="enotes-${id}" class="input-box" placeholder="Optional notes...">${j.notes || ''}</textarea>
            <button class="btn" style="background:var(--border); color:var(--text-main); margin-top:16px;" onclick="saveNotes('${id}')">SAVE NOTES</button>
            
            ${(j.status === 'Completed' || j.status === 'Internals') && (j.elf || j.candids || j.chargeback || (state.userRole === 'manager' || state.userRole === 'admin')) ? `
                <div style="margin-top:24px; padding-top:16px; border-top:1px solid var(--border-subtle);">
                    <h4 style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">${(state.userRole === 'manager' || state.userRole === 'admin') ? 'MANAGEMENT CONTROLS' : 'JOB FLAGS'}</h4>
                    
                    <div style="background:var(--surface-elev); padding:12px; border-radius:8px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:between; align-items:center; gap:10px;">
                            <div style="flex:1;">
                                <span style="font-size:0.75rem; font-weight:700;">🧝 ELF Flag</span>
                                <div style="font-size:0.65rem; color:var(--text-muted);">${j.elf ? `Added ${j.elfAddedDate ? new Date(j.elfAddedDate).toLocaleDateString('en-GB') : 'recently'}` : 'Not flagged'}</div>
                            </div>
                            ${(state.userRole === 'manager' || state.userRole === 'admin') ? `<button class="btn" style="background:${j.elf ? 'var(--danger)' : 'var(--warning)'}; color:#fff; margin:0; padding:6px 12px; font-size:0.7rem;" onclick="toggleELF('${id}')">${j.elf ? 'REMOVE' : 'ADD'}</button>` : ''}
                        </div>
                    </div>
                    
                    ${(state.userRole === 'manager' || state.userRole === 'admin') ? `
                    <div style="background:var(--surface-elev); padding:12px; border-radius:8px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                            <div style="flex:1;">
                                <span style="font-size:0.75rem; font-weight:700;">📷 Candid</span>
                                <div style="font-size:0.65rem; color:var(--text-muted);">${j.candids ? (j.candidsReason || 'Flagged') : 'Not flagged'}</div>
                            </div>
                            <button class="btn" style="background:${j.candids ? 'var(--danger)' : 'var(--warning)'}; color:#fff; margin:0; padding:6px 12px; font-size:0.7rem;" onclick="editCandid('${id}')">${j.candids ? 'EDIT' : 'ADD'}</button>
                        </div>
                    </div>
                    
                    <div style="background:var(--surface-elev); padding:12px; border-radius:8px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                            <div style="flex:1;">
                                <span style="font-size:0.75rem; font-weight:700;">💸 Chargeback</span>
                                <div style="font-size:0.65rem; color:var(--text-muted);">${j.chargeback ? `£${(j.chargebackAmount || 0).toFixed(2)} - ${j.chargebackReason}` : 'No chargeback'}</div>
                            </div>
                            <button class="btn" style="background:${j.chargeback ? 'var(--danger)' : 'var(--danger)'}; color:#fff; margin:0; padding:6px 12px; font-size:0.7rem;" onclick="${j.chargeback ? `removeChargeback('${id}')` : `addChargebackModal('${id}')`}">${j.chargeback ? 'REMOVE' : 'ADD'}</button>
                        </div>
                    </div>
                    ` : (j.candids || j.chargeback) ? `
                    ${j.candids ? `<div style="background:var(--surface-elev); padding:12px; border-radius:8px; margin-bottom:10px; display:flex; align-items:center; gap:8px;"><span style="font-size:0.75rem; font-weight:700;">📷 Candid Issue</span><span style="font-size:0.7rem; color:var(--text-muted);">${j.candidsReason || 'Flagged'}</span></div>` : ''}
                    ${j.chargeback ? `<div style="background:var(--surface-elev); padding:12px; border-radius:8px; margin-bottom:10px; display:flex; align-items:center; gap:8px;"><span style="font-size:0.75rem; font-weight:700;">💸 Chargeback</span><span style="font-size:0.7rem; color:var(--text-muted);">£${(j.chargebackAmount || 0).toFixed(2)} - ${j.chargebackReason}</span></div>` : ''}
                    ` : ''
                    }
                </div>
            ` : ''}
            
            
            <button class="btn" style="background:var(--border); color:var(--text-main); margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="duplicateJob('${id}')"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> DUPLICATE JOB</button>
            <button class="btn" style="background:transparent; border:1px solid var(--danger); color:var(--danger); margin-top:8px; ${ isDeletingInProgress || (window.syncEngine && window.syncEngine.isSyncing) ? 'opacity:0.5; cursor:not-allowed;' : ''}" ${isDeletingInProgress || (window.syncEngine && window.syncEngine.isSyncing) ? 'disabled' : ''} onclick="${isDeletingInProgress || (window.syncEngine && window.syncEngine.isSyncing) ? '' : `confirmDeleteJob('${id}')`}">🗑️ DELETE RECORD</button>
        `;
        m.style.display = 'flex';
    }
    function openNotesWizard(id) {
        currentJobId = id;
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
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
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Port</label>
                            <div class="btn-group" style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;">
                                ${Array.from({length:12}, (_,i) => `<button class="option-btn" data-value="${i+1}">${i+1}</button>`).join('')}
                            </div>
                        </div>
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Light (dBm)</label>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <button type="button" class="inc" data-target="cbt-light" data-step="-0.1">−</button>
                                <input type="text" id="cbt-light" class="light-input" value="-15.0" style="flex: 1; min-height: 48px;" oninput="validateLight(this)" />
                                <button type="button" class="inc" data-target="cbt-light" data-step="0.1">+</button>
                            </div>
                            <!-- <div class="limit" style="text-align: center; color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem;">-14 to -25 dBm</div> -->
                        </div>
                    </div>
                </div>
                <div class="step" data-step="3">
                    <label>ONT</label>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Manufacturer</label>
                            <div class="btn-group">
                                <button class="option-btn" data-value="Adtran">Adtran</button>
                                <button class="option-btn" data-value="Nokia">Nokia</button>
                                <button class="option-btn" data-value="Zyxel">Zyxel</button>
                                <button class="option-btn" data-value="Other">Other</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Light (dBm)</label>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <button type="button" class="inc" data-target="ont-light" data-step="-0.1">−</button>
                                <input type="text" id="ont-light" class="light-input" value="-15.0" style="flex: 1; min-height: 48px;" oninput="validateLight(this)" />
                                <button type="button" class="inc" data-target="ont-light" data-step="0.1">+</button>
                            </div>
                            <!-- <div class="limit" style="text-align: center; color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem;">-14 to -25 dBm</div> -->
                        </div>
                    </div>
                </div>
                <div class="step" data-step="4">
                    <label>CSP</label>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Type</label>
                            <div class="btn-group">
                                <button class="option-btn" data-value="Internal">Internal</button>
                                <button class="option-btn" data-value="External">External</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Splice Loss (dB)</label>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <button type="button" class="inc" data-target="splice-loss" data-step="-0.01">−</button>
                                <input type="text" id="splice-loss" class="light-input" value="0.03" style="flex: 1; min-height: 48px;" oninput="validateSplice(this)" />
                                <button type="button" class="inc" data-target="splice-loss" data-step="0.01">+</button>
                            </div>
                            <!-- <div class="limit" style="text-align: center; color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem;">0.00 to 0.05 dB</div> -->
                        </div>
                    </div>
                </div>
                <div class="step" data-step="5">
                    <label>Cable</label>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Rip (m)</label>
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
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Drop (m)</label>
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
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Status</label>
                            <div class="btn-group">
                                <button class="option-btn" data-value="Online">Online</button>
                                <button class="option-btn" data-value="Offline">Offline</button>
                                <button class="option-btn" data-value="No Router">No Router</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size: 1rem; color: var(--text-main); font-weight: 600; margin-bottom: 0.5rem; display: block;">Speed (Mbps)</label>
                            <input type="text" id="router-speed" class="light-input" value="500" style="width: 100%; min-height: 48px;" />
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
            <pre id="fttp-output" style="margin-top:2rem;padding:1rem;background:var(--surface-t);border-radius:8px;border:1px solid var(--border-t);white-space:pre-wrap;font-family:monospace;display:none;"></pre>
            <button id="apply-fttp" style="margin-top:1rem;padding:0.5rem 1rem;background:var(--primary);color:white;border:none;border-radius:6px;cursor:pointer;display:none;" onclick="applyFTTPNotes()">Apply to Notes</button>
        `;
        m.style.display = 'flex';
        initFTTPWizard();
    }
    function applyTemplate(id, template) {
        const textarea = document.getElementById(`enotes-${id}`);
        textarea.value = noteTemplates[template];
        closeModal();
    }
    function validateLight(input) {
         let val = parseFloat(input.value);
         if (isNaN(val)) {
             input.style.color = 'var(--text-main)';
         } else {
             // Range -14 to -25
             if (val > -14 || val < -25) {
                 input.style.color = 'var(--danger)';
             } else {
                 input.style.color = 'var(--success)';
             }
         }
    }
   
    function validateSplice(input) {
        let val = parseFloat(input.value);
        if (isNaN(val)) {
             input.style.color = 'var(--text-main)';
        } else {
             // Range 0.00 to 0.05
             if (val < 0 || val > 0.05) {
                 input.style.color = 'var(--danger)';
             } else {
                 input.style.color = 'var(--success)';
             }
        }
    }
    // FTTP Wizard Functions
    function initFTTPWizard() {
        currentStep = 1;
        updateWizardDisplay();
        const job = state.jobs.find(x => x.id === currentJobId);
        let defaultSpan = 'Pole';
        if (job) {
            if (['UG', 'HyUG'].includes(job.type) || (job.type === 'BTTW' && job.isUpgraded)) defaultSpan = 'Pit';
        }
        // Pre-select defaults
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
        document.querySelectorAll('#fttp-wizard .option-btn').forEach(b => b.classList.remove('selected'));
        defaults.forEach(d => {
            let sel = `.step[data-step="${d.step}"] .option-btn[data-value="${d.val}"]`;
            if (d.type) sel += `[data-type="${d.type}"]`;
            const btn = document.querySelector(sel);
            if (btn) btn.classList.add('selected');
        });
       
        // Initial validation visual update
        validateLight(document.getElementById('cbt-light'));
        validateLight(document.getElementById('ont-light'));
        validateSplice(document.getElementById('splice-loss'));
       
        // Show apply button immediately
        const applyBtn = document.getElementById('apply-fttp');
        if (applyBtn) {
            applyBtn.textContent = 'Apply to Notes & Copy to Clipboard';
            applyBtn.style.display = 'none';
        }
       
        const prevBtn = document.getElementById('prev-fttp');
        const nextBtn = document.getElementById('next-fttp');
        if (prevBtn) prevBtn.onclick = prevStep;
        if (nextBtn) nextBtn.onclick = nextStep;
       
        // Option Buttons
        document.querySelectorAll('#fttp-wizard .option-btn').forEach(btn => {
            btn.onclick = function() {
                // Block Live & Proven = Yes if router is not Online
                if (currentStep === 7 && this.getAttribute('data-value') === 'Yes') {
                    const routerSel = document.querySelector('.step[data-step="6"] .option-btn.selected');
                    if (routerSel && routerSel.getAttribute('data-value') !== 'Online') {
                        return; // Can't set live&proven to Yes when router isn't online
                    }
                }
                const siblings = this.parentElement.querySelectorAll('.option-btn');
                siblings.forEach(b => b.classList.remove('selected'));
                this.classList.add('selected');
                // Auto-advance for single-choice steps
                if ([1, 4, 7].includes(currentStep)) {
                    setTimeout(nextStep, 300);
                }
                // Router status logic: if not Online, disable speed and force live&proven to No
                if (currentStep === 6 && this.closest('.step[data-step="6"]')) {
                    const routerVal = this.getAttribute('data-value');
                    const speedInput = document.getElementById('router-speed');
                    if (routerVal !== 'Online') {
                        if (speedInput) { speedInput.value = 'N/A'; speedInput.disabled = true; speedInput.style.opacity = '0.4'; }
                        // Force live & proven to No
                        const lpBtns = document.querySelectorAll('.step[data-step="7"] .option-btn');
                        lpBtns.forEach(b => {
                            b.classList.remove('selected');
                            if (b.getAttribute('data-value') === 'No') b.classList.add('selected');
                        });
                    } else {
                        if (speedInput) { speedInput.value = '500'; speedInput.disabled = false; speedInput.style.opacity = '1'; }
                    }
                }
               
                if (currentStep === 7) generateFTTPNotes();
            };
        });
       
        // Increment Buttons
        document.querySelectorAll('#fttp-wizard .inc').forEach(btn => {
            btn.onclick = function() {
                const target = this.getAttribute('data-target');
                const stepVal = parseFloat(this.getAttribute('data-step'));
                const input = document.getElementById(target);
                if (input) {
                    let val = parseFloat(input.value) || 0;
                    val = val + stepVal;
                   
                    if (Math.abs(stepVal) < 0.1) {
                         val = Math.round(val * 100) / 100;
                         if (val < 0) val = 0;
                         if (val > 0.05 && target === 'splice-loss') val = 0.05;
                         input.value = val.toFixed(2);
                         validateSplice(input);
                    } else {
                         val = Math.round(val * 10) / 10;
                         input.value = val.toFixed(1);
                         validateLight(input);
                    }
                }
            };
        });
    }
    function nextStep() {
        if (currentStep < 7) {
            currentStep++;
            updateWizardDisplay();
            if (currentStep === 7) generateFTTPNotes();
        }
    }
    function prevStep() {
        if (currentStep > 1) {
            currentStep--;
            updateWizardDisplay();
        }
    }
    function updateWizardDisplay() {
        document.querySelectorAll('#fttp-wizard .step').forEach(step => {
            const stepNumber = parseInt(step.getAttribute('data-step'));
            step.classList.toggle('active', stepNumber === currentStep);
        });
        const prevBtn = document.getElementById('prev-fttp');
        const nextBtn = document.getElementById('next-fttp');
        if (prevBtn) prevBtn.style.display = currentStep > 1 ? 'inline-block' : 'none';
        if (nextBtn) nextBtn.style.display = currentStep < 7 ? 'inline-block' : 'none';
    }
    function generateFTTPNotes() {
        // Collect final values directly from DOM elements
        const getBtn = (step, type) => {
            let sel = `.step[data-step="${step}"] .option-btn.selected`;
            if (type) sel = `.step[data-step="${step}"] button[data-type="${type}"].selected`;
            return document.querySelector(sel)?.getAttribute('data-value');
        };
        const span = getBtn(1) || 'Pole';
       
        const cbtPort = getBtn(2) || '8';
        const cbtLight = document.getElementById('cbt-light').value || '-15.0';
       
        const ontMake = getBtn(3) || 'Nokia';
        const ontLight = document.getElementById('ont-light').value || '-15.0';
       
        const cspType = getBtn(4) || 'External';
        const cspLoss = document.getElementById('splice-loss').value || '0.03';
       
        const rip = getBtn(5, 'rip') || '5';
        const drop = getBtn(5, 'drop') || '65';
       
        const routerStatus = getBtn(6) || 'Online';
        const routerSpeed = document.getElementById('router-speed').value || '500';
       
        // If router not online, force N/A speed and No live&proven
        const isOnline = routerStatus === 'Online';
        const effectiveSpeed = isOnline ? routerSpeed : 'N/A';
        const liveProven = isOnline ? (getBtn(7) || 'Yes') : 'No';
        const routerLine = isOnline ? `Router: ${routerStatus}/${effectiveSpeed}Mbps` : `Router: ${routerStatus}`;
        const notes = [
            `FTTP provided`,
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
       
        output.textContent = notes;
        output.style.display = 'block';
        if (applyBtn) {
            applyBtn.textContent = 'Apply to Notes & Copy to Clipboard';
            applyBtn.style.display = 'block';
        }
    }
    function applyFTTPNotes() {
        // Generate notes if not already generated
        const output = document.getElementById('fttp-output');
        if (!output.textContent) {
            generateFTTPNotes();
        }
       
        const textToCopy = output.textContent; // Capture text content
       
        if (textToCopy) {
            // Save notes directly to job data
            const job = state.jobs.find(x => x.id === currentJobId);
            if (job) {
                job.notes = textToCopy;
                save();
               
                // Copy to clipboard with fallback
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(textToCopy).then(() => {
                        closeModal();
                        customAlert("Success", "Applied to job & copied to clipboard!");
                    }).catch(err => {
                        console.error('Clipboard API failed', err);
                        fallbackCopyTextToClipboard(textToCopy);
                    });
                } else {
                    fallbackCopyTextToClipboard(textToCopy);
                }
            } else {
                console.log('Debug: Job not found', { currentJobId });
                customAlert("Error", "Job not found. Please try again.");
            }
        } else {
            customAlert("Error", "No notes to apply. Please complete the wizard.");
        }
    }
    function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
       
        // Ensure it's not visible but part of DOM
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
       
        textArea.focus();
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            if(successful) {
                closeModal();
                customAlert("Success", "Applied to job & copied to clipboard!");
            } else {
                closeModal();
                customAlert("Warning", "Notes applied to job, but clipboard copy failed.");
            }
        } catch (err) {
            console.error('Fallback copy failed', err);
            closeModal();
            customAlert("Warning", "Notes applied to job, but clipboard copy failed.");
        }
       
        document.body.removeChild(textArea);
    }
    // Job Type Management
    function addTypeModal() {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px;">NEW JOB TYPE</h3>
            <input type="text" id="nt-name" class="input-box" placeholder="Type Name (e.g. MDU)">
            <input type="number" id="nt-pay" class="input-box" placeholder="Standard Pay (&pound;)">
            <input type="number" id="nt-int" class="input-box" placeholder="Internal Pay (&pound;) (Optional, blank = no Internals)">
            <input type="number" id="nt-ug" class="input-box" placeholder="Upgrade Pay (&pound;) (Optional, blank = no Upgrades)">
            <div class="theme-toggle-row" style="margin-top:6px;">
                <div><span>Count toward completion rate</span><br><small>Disable for job types that should not affect completion metrics</small></div>
                <label class="toggle-switch">
                    <input type="checkbox" id="nt-count" checked>
                    <span class="toggle-track"></span>
                </label>
            </div>
            <button class="btn" style="background:var(--primary); margin-top:16px;" onclick="saveNewType()">CREATE TYPE</button>
        `;
        m.style.display = 'flex';
    }
    function saveNewType() {
        const name = document.getElementById('nt-name').value.trim();
        const pay = parseFloat(document.getElementById('nt-pay').value);
        const intVal = document.getElementById('nt-int').value.trim();
        const ugVal = document.getElementById('nt-ug').value.trim();
        const countTowardsCompletion = document.getElementById('nt-count').checked;
        const int = intVal === '' ? null : (parseFloat(intVal) || null);
        const ug = ugVal === '' ? null : (parseFloat(ugVal) || null);
        if(!name || isNaN(pay)) return customAlert("Error", "Name and Standard Pay are required.", true);
        if(state.types[name]) return customAlert("Error", "A job type with this name already exists.", true);
        state.types[name] = normalizeTypeConfig({ pay, int, ug, countTowardsCompletion });
        save(); closeModal(); customAlert("Success", `${name} has been created.`);
    }
    function editTypeModal(name) {
        const t = getTypeConfig(name);
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px;">EDIT ${name}</h3>
            <label style="font-size:0.7rem; color:var(--text-muted)">Standard Pay (&pound;)</label>
            <input type="number" id="et-pay" class="input-box" value="${t.pay}">
            <label style="font-size:0.7rem; color:var(--text-muted)">Internal Pay (&pound;)</label>
            <input type="number" id="et-int" class="input-box" value="${t.int == null ? '' : t.int}" placeholder="Leave blank to disable Internals">
            <label style="font-size:0.7rem; color:var(--text-muted)">Upgrade Pay (&pound;)</label>
            <input type="number" id="et-ug" class="input-box" value="${t.ug == null ? '' : t.ug}" placeholder="Leave blank to disable Upgrades">
            <div class="theme-toggle-row" style="margin-top:6px;">
                <div><span>Count toward completion rate</span><br><small>Disable for jobs that should not affect completion metrics</small></div>
                <label class="toggle-switch">
                    <input type="checkbox" id="et-count" ${t.countTowardsCompletion === false ? '' : 'checked'}>
                    <span class="toggle-track"></span>
                </label>
            </div>
            <button class="btn" style="background:var(--primary); margin-top:16px;" onclick="saveEditType('${name}')">SAVE CHANGES</button>
            <button class="btn" style="background:transparent; border:1px solid var(--danger); color:var(--danger); margin-top:8px;" onclick="confirmDeleteType('${name}')">DELETE TYPE</button>
        `;
        m.style.display = 'flex';
    }
    function saveEditType(name) {
        const pay = parseFloat(document.getElementById('et-pay').value);
        const intVal = document.getElementById('et-int').value.trim();
        const ugVal = document.getElementById('et-ug').value.trim();
        const countTowardsCompletion = document.getElementById('et-count').checked;
        const int = intVal === '' ? null : (parseFloat(intVal) || null);
        const ug = ugVal === '' ? null : (parseFloat(ugVal) || null);
        if(isNaN(pay)) return customAlert("Error", "Standard Pay is required.", true);
        state.types[name] = normalizeTypeConfig({ pay, int, ug, countTowardsCompletion });
        save(); closeModal(); customAlert("Success", `${name} configuration updated.`);
    }
    function confirmDeleteType(name) {
        confirmModal("Delete Job Type", `Are you sure you want to delete ${name}? This will not affect past jobs, but you won't be able to log new ones.`, "DELETE", `deleteType('${name}')`, true);
    }
    function deleteType(name) { delete state.types[name]; save(); }
    function updateJob(id, status, upgrade = false) {
        const j = state.jobs.find(x => x.id === id);
        if (!j) return;
        const typeCfg = getTypeConfig(j.type);

        if (status === 'Internals' && (!typeCfg || typeCfg.int == null)) {
            customAlert("Error", `${j.type} does not support Internals.`, true);
            return;
        }

        if (upgrade && (!typeCfg || typeCfg.ug == null)) {
            customAlert("Error", `${j.type} does not support Upgrades.`, true);
            return;
        }

        j.status = status;
        // Track when the job was resolved for ordering
        if (status !== 'Pending') j.completedAt = Date.now();
        else delete j.completedAt;
       
        // Only attempt to read input if it exists (handles update from card vs modal)
        const idInput = document.getElementById(`edit-jobid-${id}`);
        if (idInput) {
            j.jobID = idInput.value.trim() || null;
        }
       
        if (upgrade) j.isUpgraded = true;
        if (!typeCfg) {
            customAlert("Warning", "The pay configuration for this job type no longer exists. Value set to &pound;0.");
            j.fee = 0;
        } else {
            if (status === 'Completed') {
                const basePay = j.isUpgraded && typeCfg.ug != null
                    ? parseFloat(typeCfg.ug)
                    : parseFloat(typeCfg.pay);
                const jobDay = new Date(j.date + 'T00:00:00').getDay();
                const isSaturday = jobDay === 6;
                j.fee = isSaturday ? Math.round(basePay * 1.5 * 100) / 100 : basePay;
                if (isSaturday) { j.saturdayPremium = true; j.baseFee = basePay; }
                else { delete j.saturdayPremium; delete j.baseFee; }
            } else if (status === 'Internals') j.fee = parseFloat(typeCfg.int || 0);
            else j.fee = 0;
        }

        j.user_id = getActiveUserId() || j.user_id || null;
        j.updated_at = new Date().toISOString();
       
        // Reactive background pulse
        if (window.pulseBackground) window.pulseBackground(status);
        // If updating from modal, close it
        if(document.getElementById('modal').style.display === 'flex') {
            closeModal();
        }
        save();
    }
    function saveNotes(id) {
        const j = state.jobs.find(x => x.id === id);
        j.notes = document.getElementById(`enotes-${id}`).value;
        j.jobID = document.getElementById(`edit-jobid-${id}`).value.trim() || null;
        j.user_id = getActiveUserId() || j.user_id || null;
        j.updated_at = new Date().toISOString();
        save(); closeModal();
    }
    function duplicateJob(id) {
        const j = state.jobs.find(x => x.id === id);
        if (!j) return;
        const clone = {
            ...j,
            id: generateID(),
            status: 'Pending',
            fee: getTypeConfig(j.type)?.pay || j.fee,
            completedAt: null,
            isUpgraded: false,
            notes: '',
            jobID: null,
            date: state.viewDate.toISOString().split('T')[0],
            user_id: getActiveUserId() || j.user_id || null,
            updated_at: new Date().toISOString()
        };
        state.jobs.push(clone);
        save(); closeModal();
        customAlert('Duplicated', `Cloned ${j.type} job to today as Pending.`);
    }
    function confirmDeleteJob(id) {
        // Block if sync is currently in progress
        if (window.syncEngine && window.syncEngine.isSyncing) {
            showToast('⏳ Waiting for sync to complete...');
            return;
        }
        
        // Soft-delete with undo using shared toast
        const j = state.jobs.find(x => x.id === id);
        if (!j) return;
        
        // Track this deletion independently
        _deletedJob = { ...j };
        _pendingDeletions.set(id, { job: { ...j }, undoable: true });
        
        state.jobs = state.jobs.filter(x => x.id !== id);
        // Track deletion for sync
        if (!state.deletedJobIds.includes(id)) {
            state.deletedJobIds.push(id);
        }
        
        // Mark deletion as in progress (blocks further deletes until sync completes)
        isDeletingInProgress = true;
        
        save();
        closeModal();
        
        const toast = document.getElementById('toast');
        clearTimeout(_deleteTimer);
        
        const pendingCount = _pendingDeletions.size;
        const undoLabel = pendingCount > 1 ? `${pendingCount} jobs deleted <button class="toast-undo" onclick="undoLastDelete()">UNDO</button>` : `Job deleted <button class="toast-undo" onclick="undoDelete()">UNDO</button>`;
        toast.innerHTML = undoLabel;
        toast.classList.add('show');
        
        // Set timer for this deletion: after 5 seconds, mark as non-undoable
        _deleteTimer = setTimeout(() => {
            // Mark all pending as non-undoable and hide toast
            for (const [key, val] of _pendingDeletions.entries()) {
                val.undoable = false;
            }
            _pendingDeletions.clear();
            _deletedJob = null;
            toast.classList.remove('show');
            // Keep isDeletingInProgress = true until sync completes
        }, 5000);
    }
    
    // Clear deletion-in-progress flag after sync completes
    window.clearDeletionInProgress = function() {
        isDeletingInProgress = false;
        console.log('[App] ✓ Deletion lock cleared, new deletions allowed');
    }
    
    // --- Management Controls (Manager/Admin only) ---
    async function toggleELF(jobId) {
        // Check modular state first, then fallback to legacy state
        let job;
        if (window.JobTrackerState && window.JobTrackerState.jobs && window.JobTrackerState.jobs.length > 0) {
            job = window.JobTrackerState.jobs.find(j => j.id === jobId);
        } else {
            job = state.jobs.find(j => j.id === jobId);
        }
        
        if (!job) {
            console.error('Job not found:', jobId);
            showToast('❌ Job not found');
            return;
        }
        
        // Validate job status
        if (job.status !== 'Completed' && job.status !== 'Internals' && job.status !== 'Pending') {
            console.warn('Cannot flag job with status:', job.status);
            showToast(`❌ Can only flag Completed or Internals jobs (current: ${job.status})`);
            return;
        }
        
        const newState = !job.elf;
        try {
            const result = await window.JobTrackerJobs.setELF(jobId, newState);
            if (result) {
                closeModal();
                render();
                showToast(newState ? '🧝 ELF flag added' : '✓ ELF flag removed');
            } else {
                // Check console for detailed error
                showToast('❌ Could not update ELF flag - check console for details');
            }
        } catch(e) {
            console.error('Error toggling ELF:', e);
            showToast('❌ Error updating flag: ' + e.message);
        }
    }
    
    function editCandid(jobId) {
        // Check modular state first, then fallback to legacy state
        let job;
        if (window.JobTrackerState && window.JobTrackerState.jobs && window.JobTrackerState.jobs.length > 0) {
            job = window.JobTrackerState.jobs.find(j => j.id === jobId);
        } else {
            job = state.jobs.find(j => j.id === jobId);
        }
        
        if (!job) {
            console.error('Job not found:', jobId);
            return;
        }
        
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <button class="close-btn" onclick="editJob('${jobId}')">×</button>
            <h3 style="margin-bottom:16px;">📷 Installation Issue (Candid)</h3>
            <div style="margin-bottom:16px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="candid-enabled" ${job.candids ? 'checked' : ''} style="width:20px; height:20px;">
                    <span style="font-size:0.9rem; font-weight:600;">Flag as Candid</span>
                </label>
            </div>
            <div style="margin-bottom:16px;">
                <label style="font-size:0.85rem; font-weight:600; color:var(--text-main); display:block; margin-bottom:6px;">Issue Details</label>
                <textarea id="candid-reason" class="input-box" placeholder="e.g., Dropwire too low, poor cable dressing..." style="min-height:100px;">${job.candidsReason || ''}</textarea>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main); margin:0;" onclick="editJob('${jobId}')">CANCEL</button>
                <button class="btn" style="background:var(--primary); color:#fff; margin:0;" onclick="saveCandid('${jobId}')">SAVE</button>
            </div>
        `;
    }
    
    async function saveCandid(jobId) {
        try {
            const enabled = document.getElementById('candid-enabled').checked;
            const reason = document.getElementById('candid-reason').value.trim();
            
            const result = await window.JobTrackerJobs.setCandids(jobId, enabled, reason);
            if (result) {
                closeModal();
                render();
                showToast(enabled ? '📷 Candid issue flagged' : '✓ Candid flag removed');
            } else {
                showToast('❌ Could not update Candid flag');
            }
        } catch(e) {
            console.error('Error saving Candid:', e);
            showToast('❌ Error saving');
        }
        
        closeModal();
        render();
        showToast(enabled ? '📷 Candids flag added' : 'Candids flag removed');
    }
    
    function addChargebackModal(jobId) {
        const job = state.jobs.find(j => j.id === jobId);
        if (!job) return;
        
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        // Calculate this week, next week, week after
        const today = new Date();
        const thisWeekMon = new Date(today);
        thisWeekMon.setDate(today.getDate() - (today.getDay() + 6) % 7);
        
        const nextWeekMon = new Date(thisWeekMon);
        nextWeekMon.setDate(thisWeekMon.getDate() + 7);
        
        const weekAfterMon = new Date(thisWeekMon);
        weekAfterMon.setDate(thisWeekMon.getDate() + 14);
        
        const formatWeek = (date) => {
            const fri = new Date(date);
            fri.setDate(date.getDate() + 4);
            return `${date.toLocaleDateString('en-GB', {day:'numeric', month:'short'})} - ${fri.toLocaleDateString('en-GB', {day:'numeric', month:'short'})}`;
        };
        
        modalBody.innerHTML = `
            <button class="close-btn" onclick="editJob('${jobId}')">×</button>
            <h3 style="margin-bottom:16px;">💸 Mark as Chargeback</h3>
            <div style="background:var(--surface-elev); padding:12px; border-radius:8px; margin-bottom:16px;">
                <div style="font-size:0.75rem; color:var(--text-muted);">Job: ${job.type} - ${new Date(job.date + 'T00:00:00').toLocaleDateString('en-GB')}</div>
                <div style="font-size:1.2rem; font-weight:700; margin-top:4px;">£${parseFloat(job.fee).toFixed(2)}</div>
            </div>
            
            <div style="margin-bottom:16px;">
                <label style="font-size:0.85rem; font-weight:600; color:var(--text-main); display:block; margin-bottom:6px;">Reason</label>
                <select id="chargeback-reason" class="input-box">
                    <option value="ELF">Early Life Failure (ELF)</option>
                    <option value="Candids">Installation Issue (Candids)</option>
                    <option value="other">Other</option>
                </select>
            </div>
            
            <div style="margin-bottom:16px;">
                <label style="font-size:0.85rem; font-weight:600; color:var(--text-main); display:block; margin-bottom:6px;">Deduct from week</label>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="radio" name="week" value="${thisWeekMon.toISOString()}" style="width:18px; height:18px;">
                        <span style="font-size:0.85rem;">This week (${formatWeek(thisWeekMon)})</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="radio" name="week" value="${nextWeekMon.toISOString()}" checked style="width:18px; height:18px;">
                        <span style="font-size:0.85rem;">Next week (${formatWeek(nextWeekMon)})</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="radio" name="week" value="${weekAfterMon.toISOString()}" style="width:18px; height:18px;">
                        <span style="font-size:0.85rem;">Week after (${formatWeek(weekAfterMon)})</span>
                    </label>
                </div>
            </div>
            
            <div style="margin-bottom:16px;">
                <label style="font-size:0.85rem; font-weight:600; color:var(--text-main); display:block; margin-bottom:6px;">Amount to deduct</label>
                <input type="number" id="chargeback-amount" class="input-box" value="${parseFloat(job.fee).toFixed(2)}" step="0.01" min="0">
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main); margin:0;" onclick="editJob('${jobId}')">CANCEL</button>
                <button class="btn" style="background:var(--danger); color:#fff; margin:0;" onclick="saveChargeback('${jobId}')">APPLY CHARGEBACK</button>
            </div>
        `;
    }
    
    async function saveChargeback(jobId) {
        const reason = document.getElementById('chargeback-reason').value;
        const amount = parseFloat(document.getElementById('chargeback-amount').value);
        const weekInput = document.querySelector('input[name="week"]:checked');
        const chargebackWeek = weekInput ? weekInput.value : new Date().toISOString();
        
        if (isNaN(amount) || amount <= 0) {
            showToast('Invalid amount', true);
            return;
        }
        
        await window.JobTrackerJobs.addChargeback(jobId, reason, amount, chargebackWeek);
        
        closeModal();
        render();
        showToast(`💸 Chargeback of £${amount.toFixed(2)} scheduled`);
    }
    
    async function removeChargeback(jobId) {
        if (!confirm('Remove this chargeback?')) return;
        
        await window.JobTrackerJobs.removeChargeback(jobId);
        
        closeModal();
        render();
        showToast('Chargeback removed');
    }
    
    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.innerHTML = message;
        toast.style.background = isError ? 'var(--danger)' : '';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function undoLastDelete() {
        // Undo the most recent deletion
        if (_deletedJob && _pendingDeletions.has(_deletedJob.id)) {
            undoDelete();
        }
    }
    function undoDelete() {
        if (_deletedJob) {
            _deletedJob.user_id = getActiveUserId() || _deletedJob.user_id || null;
            _deletedJob.updated_at = new Date().toISOString();
            state.jobs.push(_deletedJob);
            // Remove from deletion tracking on undo
            state.deletedJobIds = state.deletedJobIds.filter(id => id !== _deletedJob.id);
            _pendingDeletions.delete(_deletedJob.id);
            _deletedJob = null;
            save();
        }
        clearTimeout(_deleteTimer);
        const toast = document.getElementById('toast');
        toast.classList.remove('show');
    }
    function toggleAddPopup() {
        const backdrop = document.getElementById('add-popup-backdrop');
        const popup = document.getElementById('add-popup');
        const fab = document.getElementById('fab-btn');
        const isOpen = popup.classList.contains('show');
        if (isOpen) {
            popup.classList.remove('show');
            backdrop.classList.remove('show');
            fab.classList.remove('open');
        } else {
            popup.classList.add('show');
            backdrop.classList.add('show');
            fab.classList.add('open');
            if (navigator.vibrate) navigator.vibrate(8);
        }
    }
    function showSingleAdd() {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px; font-weight:900;">LOG NEW JOB</h3>
            <input type="text" id="new-jobid" class="input-box" placeholder="Job ID (Optional)">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:60vh; overflow-y:auto; padding-right:8px;">
                ${Object.keys(state.types).map(t => `<button class="btn" style="background:var(--border); color:var(--text-main); margin:0;" onclick="addJob('${t}')">${t}</button>`).join('')}
            </div>
        `;
        m.style.display = 'flex';
    }
    function showMultiAdd() {
        // Initialize multi-add counters
        window.tempMultiCounts = {};
        Object.keys(state.types).forEach(t => window.tempMultiCounts[t] = 0);
        renderMultiAddList();
        document.getElementById('modal').style.display = 'flex';
    }
    function renderMultiAddList() {
        const counts = window.tempMultiCounts;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
       
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px;">MULTI ADD</h3>
            <div style="max-height:50vh; overflow-y:auto; margin-bottom:16px; padding-right:8px;">
                ${Object.keys(state.types).map(t => `
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding:8px; background:var(--bg-t); border-radius:8px; border:1px solid var(--border-t);">
                        <b style="font-size:1rem;">${t}</b>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <button class="qa-btn" style="background:var(--border); width:36px; height:36px;" onclick="adjMulti('${t}', -1)">-</button>
                            <span style="font-weight:bold; width:24px; text-align:center;">${counts[t]}</span>
                            <button class="qa-btn" style="background:var(--primary); width:36px; height:36px;" onclick="adjMulti('${t}', 1)">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <button class="btn" style="background:${total > 0 ? 'var(--success)' : 'var(--border)'};" onclick="saveMultiJobs()" ${total === 0 ? 'disabled' : ''}>ADD ${total} JOBS</button>
        `;
    }
    function adjMulti(type, dir) {
        if (!window.tempMultiCounts) return;
        const val = window.tempMultiCounts[type] + dir;
        if (val >= 0) {
            window.tempMultiCounts[type] = val;
            renderMultiAddList();
        }
    }
    function saveMultiJobs() {
        const counts = window.tempMultiCounts;
        const activeUserId = getActiveUserId();
        let added = 0;
        Object.entries(counts).forEach(([type, count]) => {
            for(let i=0; i<count; i++) {
                state.jobs.push({
                    id: generateID(),
                    date: state.viewDate.toISOString().split('T')[0],
                    type,
                    status: 'Pending',
                    fee: 0,
                    notes: '',
                    isUpgraded: false,
                    jobID: null,
                    user_id: activeUserId,
                    updated_at: new Date().toISOString()
                });
                added++;
            }
        });
        if (added > 0) {
            save();
            closeModal();
            customAlert("Success", `Added ${added} new jobs.`);
        }
    }
    function addJob(type) {
        const jobID = document.getElementById('new-jobid').value.trim() || null;
        state.jobs.push({
            id: generateID(),
            date: state.viewDate.toISOString().split('T')[0],
            type,
            status: 'Pending',
            fee: 0,
            notes: '',
            isUpgraded: false,
            jobID,
            user_id: getActiveUserId(),
            updated_at: new Date().toISOString()
        });
        closeModal(); save();
    }
    function getJobsStorageKey() {
        const authStatus = window.supabaseClient?.getStatus?.();
        if (authStatus?.isAuthenticated && authStatus.userId) {
            return `nx_jobs_user_${authStatus.userId}`;
        }
        return 'nx_jobs_anon';
    }
    function loadJobsForCurrentAccount() {
        const key = getJobsStorageKey();
        const deletedKey = getDeletedJobsStorageKey();
        const activeUserId = getActiveUserId();
        const previousAccountKey = localStorage.getItem('nx_last_loaded_user_id');
        
        // If account has changed or this is a fresh login, clear ALL cache
        // ALL unscoped/legacy keys to prevent cross-contamination
        if (previousAccountKey !== activeUserId) {
            console.log(`[App] Account changed: ${previousAccountKey} → ${activeUserId}, AGGRESSIVE cache clear`);
            // Clear all scoped keys for this account
            localStorage.removeItem(key);
            localStorage.removeItem(deletedKey);
            // Clear ALL possible unscoped/legacy keys
            localStorage.removeItem('nx_jobs');
            localStorage.removeItem('nx_jobs_anon');
            localStorage.removeItem('nx_deleted_job_ids');
            localStorage.removeItem('nx_deleted_job_ids_anon');
            // Mark this account as loaded
            localStorage.setItem('nx_last_loaded_user_id', activeUserId || '');
            console.log(`[App] ✓ Cleared all cache keys. Loading fresh from cloud.`);
        }
        
        // Load ONLY from the properly scoped key
        const loadedJobs = JSON.parse(localStorage.getItem(key) || '[]');
        const deletedJobIds = JSON.parse(localStorage.getItem(deletedKey) || '[]');
        
        console.log(`[App] Loaded jobs: ${loadedJobs.length}, deleted: ${deletedJobIds.length}`);
        
        // Load jobs, filter by user AND exclude deleted jobs  
        state.jobs = activeUserId
            ? loadedJobs
                .filter(j => (!j.user_id || j.user_id === activeUserId) && !deletedJobIds.includes(j.id))
                .map(j => ({ ...j, user_id: activeUserId }))
            : loadedJobs.filter(j => !deletedJobIds.includes(j.id));
        
        state.deletedJobIds = deletedJobIds;
        
        // Write state to scoped key (never unscoped at this point)
        localStorage.setItem(getJobsStorageKey(), JSON.stringify(state.jobs));
        localStorage.setItem(getDeletedJobsStorageKey(), JSON.stringify(state.deletedJobIds));
        
        console.log(`[App] Initial state: ${state.jobs.length} jobs, ready for sync`);
        render();
        
        // Pull remote jobs if authenticated (async, after initial render)
        const authStatus = window.supabaseClient?.getStatus?.();
        if (authStatus?.isAuthenticated && window.syncEngine) {
            console.log('[App] Initiating fullSync after account load');
            // Force a full sync (push + pull) to ensure complete cloud sync
            window.syncEngine.fullSync().catch(err => console.warn('Full sync failed:', err));
        }
    }
    function save() { 
        normalizeAllTypes();
        const activeUserId = getActiveUserId();
        if (activeUserId) {
            state.jobs = state.jobs.map(job => ({
                ...job,
                user_id: activeUserId,
                updated_at: job.updated_at || new Date().toISOString()
            }));
        }
        // Always write to BOTH scoped and unscoped keys to maintain compatibility
        localStorage.setItem('nx_jobs', JSON.stringify(state.jobs));
        localStorage.setItem(getJobsStorageKey(), JSON.stringify(state.jobs));
        localStorage.setItem('nx_types', JSON.stringify(state.types)); 
        // Save deletions ONLY to scoped key - consistent per-user tracking
        localStorage.setItem(getDeletedJobsStorageKey(), JSON.stringify(state.deletedJobIds));
        
        // Also save to modular IndexedDB for sync engine
        if (window.JobTrackerDB && window.JobTrackerDB.bulkPut) {
            // Clear the store first to remove deleted jobs
            window.JobTrackerDB.clear('jobs').then(() => {
                window.JobTrackerDB.bulkPut('jobs', state.jobs).catch(err => console.warn('IndexedDB save failed:', err));
            }).catch(err => console.warn('IndexedDB clear failed:', err));
        }
        
        // Debounce sync requests - but check if something is already syncing
        if (window._syncTimeout) clearTimeout(window._syncTimeout);
        
        const authStatus = window.supabaseClient?.getStatus?.();
        if (authStatus?.isAuthenticated && window.syncEngine) {
            // If sync is already in progress, flag it so a new one runs after
            if (window.syncEngine.isSyncing) {
                console.log('[App] Sync already in progress, will reschedule after it completes');
                window.syncEngine.hasPendingChanges = true;
            } else {
                window._syncTimeout = setTimeout(() => {
                    console.log('[App] Triggering sync after save');
                    window.syncEngine.fullSync().catch(err => console.warn('Sync failed:', err));
                }, 1000);
            }
        }
        
        render(); 
    }
    // --- Collapsible Panel System ---
    function getPanelStates(tab) {
        const key = `nx_panels_${tab}`;
        return JSON.parse(localStorage.getItem(key) || '{}');
    }
    function setPanelState(tab, panelId, collapsed) {
        const key = `nx_panels_${tab}`;
        const states = getPanelStates(tab);
        states[panelId] = collapsed;
        localStorage.setItem(key, JSON.stringify(states));
    }
    function getPanelOrder(tab) {
        const key = `nx_panel_order_${tab}`;
        return JSON.parse(localStorage.getItem(key) || '[]');
    }
    function setPanelOrder(tab, order) {
        const key = `nx_panel_order_${tab}`;
        localStorage.setItem(key, JSON.stringify(order));
    }
    function getJobOrder() {
        const key = `nx_job_order_${state.range}_${state.viewDate.toISOString().split('T')[0]}`;
        return JSON.parse(localStorage.getItem(key) || '[]');
    }
    function setJobOrder(order) {
        const key = `nx_job_order_${state.range}_${state.viewDate.toISOString().split('T')[0]}`;
        localStorage.setItem(key, JSON.stringify(order));
    }
    function clearJobOrder() {
        const key = `nx_job_order_${state.range}_${state.viewDate.toISOString().split('T')[0]}`;
        localStorage.removeItem(key);
    }
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
    /* ── Quick-status with undo toast ── */
    let _undoTimer = null;
    function quickStatus(id, status) {
        const j = state.jobs.find(x => x.id === id);
        if (!j) return;
        // Block Internals for types that don't support it
        if (status === 'Internals' && getTypeConfig(j.type)?.int == null) return;
        const prev = { status: j.status, fee: j.fee };
        // Status colour map for flash
        const flashMap = { 'Completed': 'var(--success)', 'Internals': 'var(--warning)', 'Failed': 'var(--danger)' };
        const flashColor = flashMap[status] || 'var(--primary)';
        // Find the card tile and play dramatic flash before updating
        const tile = document.querySelector(`.job-tile[data-id="${id}"]`);
        if (tile) {
            tile.style.setProperty('--flash-color', flashColor);
            tile.style.animation = 'none';
            void tile.offsetWidth;
            tile.classList.add('status-flash');
            let fired = false;
            const finish = () => {
                if (fired) return;
                fired = true;
                clearTimeout(safetyTimeout);
                tile.classList.remove('status-flash');
                finishQuickStatus(id, status, prev, j);
            };
            tile.addEventListener('animationend', function handler() {
                tile.removeEventListener('animationend', handler);
                finish();
            });
            // Safety fallback
            const safetyTimeout = setTimeout(finish, 800);
        } else {
            finishQuickStatus(id, status, prev, j);
        }
    }
    function finishQuickStatus(id, status, prev, j) {
        updateJob(id, status);
        // haptic tap
        if (navigator.vibrate) navigator.vibrate(12);
        const toast = document.getElementById('toast');
        clearTimeout(_undoTimer);
        const label = status === 'Completed' ? 'FINISHED' : status === 'Internals' ? 'INT' : status === 'Failed' ? 'FAILED' : status.toUpperCase();
        toast.innerHTML = `${j.type} → <b>${label}</b> <button class="toast-undo" onclick="undoStatus('${id}',${JSON.stringify(prev).replace(/"/g, '&quot;')})">UNDO</button>`;
        toast.classList.add('show');
        _undoTimer = setTimeout(() => toast.classList.remove('show'), 4000);
    }
    function undoStatus(id, prev) {
        const j = state.jobs.find(x => x.id === id);
        if (!j) return;
        j.status = prev.status;
        j.fee = prev.fee;
        j.updated_at = new Date().toISOString();
        save();
        // Reactive background pulse with the reverted status colour
        if (window.pulseBackground) window.pulseBackground(prev.status);
        const toast = document.getElementById('toast');
        clearTimeout(_undoTimer);
        toast.classList.remove('show');
    }
    /* ── Jump to today ── */
    function goToday() {
        state.viewDate = new Date();
        if (navigator.vibrate) navigator.vibrate(8);
        render();
    }
    function showIdleNotifications() {
        const lastSync = state.lastSyncTime;
        const now = new Date();
        const notifications = [];
        
        // Check for new flags on jobs
        const flaggedJobs = state.jobs.filter(j => {
            const jobUpdated = j.updatedAt ? new Date(j.updatedAt) : new Date(j.createdAt);
            return jobUpdated > lastSync;
        });
        
        const newElfs = flaggedJobs.filter(j => j.elf).length;
        const newCandids = flaggedJobs.filter(j => j.candids).length;
        const newChargebacks = flaggedJobs.filter(j => j.chargeback).length;
        
        if (newElfs > 0) notifications.push(`⚠️ ${newElfs} ELF flag${newElfs > 1 ? 's' : ''} added`);
        if (newCandids > 0) notifications.push(`📷 ${newCandids} Candid${newCandids > 1 ? 's' : ''} added`);
        if (newChargebacks > 0) {
            const chargeTotal = flaggedJobs.filter(j => j.chargeback).reduce((sum, j) => sum + (j.chargebackAmount || 0), 0);
            notifications.push(`💸 ${chargeTotal.toFixed(2)} in chargebacks applied`);
        }
        
        // Only show modal if there are notifications
        if (notifications.length === 0) return;
        
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        const content = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px; text-align:center;">🎮 While You Were Away...</h3>
            <div style="background:var(--surface-elev); padding:16px; border-radius:var(--radius-md); margin-bottom:16px; border:1px solid var(--border-subtle);">
                ${notifications.map(notif => `<div style="padding:8px 0; font-size:0.9rem; color:var(--text-main);">→ ${notif}</div>`).join('')}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn" style="background:var(--border); color:var(--text-main);" onclick="closeModal()">DISMISS</button>
                <button class="btn" style="background:var(--primary); color:#fff;" onclick="closeModal(); state.activeTab = 'jobs'; render();">VIEW JOBS</button>
            </div>
        `;
        
        modalBody.innerHTML = content;
        modal.style.display = 'flex';
    }
    
    function setUserRoleGlobal(role) {
        const authStatus = window.supabaseClient?.getStatus?.();
        if (authStatus?.isAuthenticated) {
            customAlert('Role Managed in Admin', 'Signed-in account roles are server-managed. New users default to Engineer.');
            return;
        }

        if (window.JobTrackerState && typeof window.JobTrackerState.setUserRole === 'function') {
            window.JobTrackerState.setUserRole(role);
        }
        state.userRole = role;
        localStorage.setItem('nx_userRole', role);
        
        // Update button highlighting immediately
        document.querySelectorAll('[data-role-btn]').forEach(btn => {
            const btnRole = btn.getAttribute('data-role-btn');
            const isActive = btnRole === role;
            if (isActive) {
                btn.style.background = 'var(--primary)';
                btn.style.color = '#fff';
                btn.style.fontWeight = '700';
            } else {
                btn.style.background = 'var(--border)';
                btn.style.color = 'var(--text-main)';
                btn.style.fontWeight = '400';
            }
        });
        
        // Show notification toast
        showRoleChangeNotification(role);
        
        render();
    }
    
    function setDisplayNameGlobal(name) {
        if (window.JobTrackerState && typeof window.JobTrackerState.setDisplayName === 'function') {
            window.JobTrackerState.setDisplayName(name);
        }
        state.displayName = name;
        localStorage.setItem('nx_displayName', name);
        render();
    }
    
    function showRoleChangeNotification(role) {
        // Create a temporary toast notification for role change
        const toast = document.createElement('div');
        const roleLabels = { engineer: '👤 Engineer', manager: '👨‍💼 Manager', admin: '🔑 Admin' };
        toast.innerHTML = `
            <div style="position:fixed; bottom:20px; right:20px; background:var(--primary); color:#fff; padding:12px 16px; border-radius:6px; font-size:0.85rem; font-weight:600; z-index:10001; box-shadow:0 4px 12px rgba(0,0,0,0.15); animation:fadeInUp 0.3s ease-out;">
                Role changed to ${roleLabels[role]}
            </div>
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.2s';
            setTimeout(() => toast.remove(), 200);
        }, 2000);
    }
    
    function closeModal() {
        document.getElementById('modal').style.display = 'none';
        document.getElementById('settings-btn').classList.remove('active');
        const modalContent = document.querySelector('#modal .modal-content');
        if (modalContent) modalContent.classList.remove('settings-modal');
    }
    function setRange(r, el) { state.range = r; document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active')); el.classList.add('active'); render(); }
    function nav(t, el) {
        const prev = state.activeTab;
        state.activeTab = t;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        el.classList.add('active');
        document.getElementById('settings-btn').classList.remove('active');
        if (prev !== t) {
            const c = document.getElementById('view-container');
            c.innerHTML = '<div class="skeleton" style="height:80px;margin:12px 0;border-radius:12px;"></div><div class="skeleton" style="height:120px;margin:12px 0;border-radius:12px;"></div><div class="skeleton" style="height:60px;margin:12px 0;border-radius:12px;"></div>';
            setTimeout(() => render(), 80);
        } else { render(); }
    }
    function navSettings() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        const modalContent = document.querySelector('#modal .modal-content');
        if (!modal || !modalBody) return;

        document.getElementById('settings-btn').classList.add('active');
        if (navigator.vibrate) navigator.vibrate(8);

        if (modalContent) modalContent.classList.add('settings-modal');

        modalBody.innerHTML = `
            <h2 style="margin:0 0 16px; font-size:1.1rem; font-weight:700;">Settings</h2>
            <div id="settings-modal-container" class="settings-modal-scroll"></div>
            <div class="settings-modal-actions">
                <button class="btn" onclick="closeModal()">DONE</button>
            </div>
        `;
        modal.style.display = 'flex';

        const container = document.getElementById('settings-modal-container');
        if (container) {
            renderSettings(container);
        }
    }
    function adjDate(n) {
        const d = state.viewDate;
        if (state.range === 'day') d.setDate(d.getDate() + n);
        else if (state.range === 'week') d.setDate(d.getDate() + (n * 7));
        else if (state.range === 'month') d.setMonth(d.getMonth() + n);
        else d.setFullYear(d.getFullYear() + n);
        render();
    }
    // Week is Sat–Fri; week 1 = week containing Jan 1
    function getWeek(d) {
        const ref = new Date(d); ref.setHours(0,0,0,0);
        const daysToSat = (ref.getDay() + 1) % 7;
        const weekStart = new Date(ref); weekStart.setDate(ref.getDate() - daysToSat);
        const jan1 = new Date(ref.getFullYear(), 0, 1);
        const jan1ToSat = (jan1.getDay() + 1) % 7;
        const yearWeekStart = new Date(jan1); yearWeekStart.setDate(jan1.getDate() - jan1ToSat);
        return Math.floor((weekStart - yearWeekStart) / 86400000 / 7) + 1;
    }
   
    function exportCSV() {
        const escField = v => {
            const s = String(v == null ? '' : v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        let csv = "Date,Type,Status,Fee,Upgraded,Notes,JobID\n" + state.jobs.map(j =>
            [j.date, j.type, j.status, j.fee, j.isUpgraded, j.notes || '', j.jobID || ''].map(escField).join(',')
        ).join("\n");
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `job_tracker_export_${state.viewDate.toISOString().split('T')[0]}.csv`; a.click();
        URL.revokeObjectURL(a.href);
    }
    function exportJSON() {
        const backup = { version: 1, date: new Date().toISOString(), jobs: state.jobs, types: state.types, target: localStorage.getItem('nx_target') || '80',
            settings: { accent: localStorage.getItem('nx_accent'), accent_dark: localStorage.getItem('nx_accent_dark'), accent_light: localStorage.getItem('nx_accent_light'),
                gradient: localStorage.getItem('nx_gradient'), theme: localStorage.getItem('nx_theme'),
                goal: localStorage.getItem('nx_goal'), bests: localStorage.getItem('nx_bests') }
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `job_tracker_backup_${new Date().toISOString().split('T')[0]}.json`; a.click();
        URL.revokeObjectURL(a.href);
    }
    function importJSON(e) {
        const reader = new FileReader();
        reader.onload = function() {
            try {
                const data = JSON.parse(reader.result);
                if (!data.jobs || !Array.isArray(data.jobs)) throw new Error('Invalid backup');
                confirmModal('Restore Backup', `This will replace ALL current data with ${data.jobs.length} jobs from backup dated ${data.date ? new Date(data.date).toLocaleDateString() : 'unknown'}. Continue?`, 'RESTORE', `doRestoreJSON('${btoa(reader.result)}')`, true);
            } catch (err) { customAlert('Restore Failed', 'Invalid backup file format.', true); }
            e.target.value = '';
        };
        if (e.target.files[0]) reader.readAsText(e.target.files[0]);
    }
    function doRestoreJSON(b64) {
        try {
            const data = JSON.parse(atob(b64));
            state.jobs = data.jobs; state.types = data.types || state.types;
            if (data.target) localStorage.setItem('nx_target', data.target);
            if (data.settings) {
                Object.entries(data.settings).forEach(([k, v]) => { if (v) localStorage.setItem('nx_' + k, v); });
            }
            save(); customAlert('Restored', `Successfully restored ${data.jobs.length} jobs.`);
        } catch (err) { customAlert('Restore Failed', 'Could not parse backup data.', true); }
    }
   
    function importCSV(e) {
        const reader = new FileReader();
        reader.onload = function() {
            try {
                const text = reader.result;
                // Proper CSV parsing that handles quoted fields with commas/newlines
                function parseCSVLine(line) {
                    const fields = []; let field = '', inQuotes = false;
                    for (let i = 0; i < line.length; i++) {
                        const ch = line[i];
                        if (inQuotes) {
                            if (ch === '"' && line[i+1] === '"') { field += '"'; i++; }
                            else if (ch === '"') { inQuotes = false; }
                            else { field += ch; }
                        } else {
                            if (ch === '"') { inQuotes = true; }
                            else if (ch === ',') { fields.push(field); field = ''; }
                            else { field += ch; }
                        }
                    }
                    fields.push(field);
                    return fields;
                }
                const lines = text.split('\n').slice(1).filter(l => l.trim());
                if (lines.length === 0) { customAlert("Import Failed", "CSV file is empty or has no data rows.", true); e.target.value = ''; return; }
                let count = 0, skipped = 0;
                const activeUserId = getActiveUserId();
                const validStatuses = ['Pending', 'Completed', 'Internals', 'Failed'];
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                lines.forEach(line => {
                    const parts = parseCSVLine(line);
                    if (parts.length < 4 || !parts[0].trim()) { skipped++; return; }
                    const date = parts[0].trim();
                    const type = parts[1].trim();
                    const status = parts[2].trim();
                    const fee = parseFloat(parts[3]);
                    if (!dateRegex.test(date) || isNaN(new Date(date + 'T00:00:00').getTime())) { skipped++; return; }
                    if (!validStatuses.includes(status)) { skipped++; return; }
                    if (isNaN(fee) || fee < 0) { skipped++; return; }
                    const notes = (parts[5] || '').trim();
                    const jobID = (parts[6] || '').trim() || null;
                    const csvUserId = (parts[7] || '').trim() || null;
                    state.jobs.push({
                        id: generateID(), date, type, status, fee,
                        isUpgraded: parts.length >= 5 ? parts[4].trim() === 'true' : false,
                        notes, jobID,
                        user_id: csvUserId || activeUserId,
                        updated_at: new Date().toISOString()
                    });
                    count++;
                });
                save();
                
                // Also save to IndexedDB for modular state
                if (window.JobTrackerDB && state.jobs.length > 0) {
                    window.JobTrackerDB.bulkPut(window.JobTrackerDB.STORES.JOBS, state.jobs).catch(e => {
                        console.warn('Could not save to IndexedDB:', e);
                    });
                }
                
                // Sync to modular state if available
                if (window.JobTrackerState) {
                    window.JobTrackerState.jobs = state.jobs.map(job => ({
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
                        ...job
                    }));
                }
                
                const msg = skipped > 0 ? `Imported ${count} jobs. ${skipped} row${skipped > 1 ? 's' : ''} skipped due to invalid data.` : `Successfully imported ${count} jobs from CSV.`;
                customAlert("Import " + (count > 0 ? "Successful" : "Warning"), msg, count === 0);
                
                // Ask if Saturday jobs need updating
                if (count > 0) {
                    setTimeout(() => {
                        confirmModal(
                            "Update Saturday Jobs?",
                            "Do any imported jobs fall on Saturdays that need the 1.5× rate applied? This will update Saturday jobs (Completed + Internals) to use the correct Saturday rate.",
                            "FIX SATURDAYS",
                            "window.JobTrackerModals.executeSaturdayRecalculation()",
                            false
                        );
                    }, 500);
                }
            } catch (err) { customAlert("Import Failed", "The CSV file format is invalid.", true); }
            e.target.value = '';
        };
        if(e.target.files[0]) reader.readAsText(e.target.files[0]);
    }
   
    function confirmWipe() { confirmModal("Wipe Data", "WARNING: This will permanently delete ALL job history and custom pay configurations. You cannot undo this.", "WIPE SYSTEM", "executeWipe()", true); }
    function executeWipe() { 
        localStorage.clear(); 
        // Also clear IndexedDB if available
        if (window.JobTrackerDB && window.JobTrackerDB.db && window.JobTrackerDB.db.db) {
            try {
                window.JobTrackerDB.db.db.close();
                indexedDB.deleteDatabase('JobTrackerDB');
            } catch (e) {
                console.warn('Could not clear IndexedDB:', e);
            }
        }
        location.reload(); 
    }
    /* ── Theme toggle ── */
    function toggleTheme(isLight) {
        const theme = isLight ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('nx_theme', theme);
        // Re-apply accent for the new theme
        const accentDark = localStorage.getItem('nx_accent_dark');
        const accentLight = localStorage.getItem('nx_accent_light');
        if (accentDark && accentLight) {
            const ac = isLight ? accentLight : accentDark;
            document.documentElement.style.setProperty('--primary', ac);
            localStorage.setItem('nx_accent', ac);
        }
        // Re-apply gradient if set
        const grad = localStorage.getItem('nx_gradient');
        if (grad) document.documentElement.style.setProperty('--primary-grad', grad);
        if (window.updateCanvasTheme) window.updateCanvasTheme(theme);
        if (navigator.vibrate) navigator.vibrate(8);
        render();
    }
    function setAccentColour(dark, light) {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const ac = isLight ? light : dark;
        document.documentElement.style.setProperty('--primary', ac);
        document.documentElement.style.removeProperty('--primary-grad');
        localStorage.setItem('nx_accent', ac);
        localStorage.setItem('nx_accent_dark', dark);
        localStorage.setItem('nx_accent_light', light);
        localStorage.removeItem('nx_gradient');
        if (window.updateCanvasAccent) window.updateCanvasAccent(ac);
        if (navigator.vibrate) navigator.vibrate(8);
        render();
    }
    function setAccentGradient(grad, dark, light) {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const ac = isLight ? light : dark;
        document.documentElement.style.setProperty('--primary', ac);
        document.documentElement.style.setProperty('--primary-grad', grad);
        localStorage.setItem('nx_accent', ac);
        localStorage.setItem('nx_accent_dark', dark);
        localStorage.setItem('nx_accent_light', light);
        localStorage.setItem('nx_gradient', grad);
        if (window.updateCanvasAccent) window.updateCanvasAccent(ac);
        if (navigator.vibrate) navigator.vibrate(8);
        render();
    }
    function pickGradient(i) {
        const g = window._gradients[i];
        if (g) setAccentGradient(g.grad, g.dark, g.light);
    }
    /* ── Dynamic background animation system ── */
    (function initBgCanvas() {
        const canvas = document.getElementById('bg-canvas');
        const ctx = canvas.getContext('2d');
        let w, h, dpr;
        let time = 0;
        let pulseColor = null;
        let pulseIntensity = 0;
        let pulseDecay = 0.012;
        let rafId;
        let currentAnim = localStorage.getItem('nx_bg_anim') || 'waves';
        function hexToRgb(hex) {
            const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
            return { r, g, b };
        }
        function buildHues(hex, mode) {
            const c = hexToRgb(hex);
            if (mode === 'light') {
                return [
                    c,
                    { r: 180, g: 200, b: 220 },
                    { r: Math.round(c.r * 0.7), g: Math.round(c.g * 0.7), b: Math.round(c.b * 0.85) },
                    { r: Math.round(c.r * 0.5 + 60), g: Math.round(c.g * 0.4 + 40), b: Math.round(c.b * 0.6 + 80) },
                ];
            }
            return [
                c,
                { r: 48, g: 54, b: 61 },
                { r: Math.round(c.r * 0.35), g: Math.round(c.g * 0.5), b: Math.round(c.b * 0.65) },
                { r: Math.round(c.r * 0.3 + 30), g: Math.round(c.g * 0.2 + 20), b: Math.round(c.b * 0.4 + 60) },
            ];
        }
        const savedAccent = localStorage.getItem('nx_accent');
        const initTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        let baseHues = buildHues(savedAccent || (initTheme === 'light' ? '#0969da' : '#58a6ff'), initTheme);
        window.updateCanvasTheme = function(theme) {
            const accent = localStorage.getItem('nx_accent') || (theme === 'light' ? '#0969da' : '#58a6ff');
            baseHues = buildHues(accent, theme);
        };
        window.updateCanvasAccent = function(hex) {
            const theme = document.documentElement.getAttribute('data-theme') || 'dark';
            baseHues = buildHues(hex, theme);
        };
        const statusColors = {
            'Completed': { r: 86, g: 211, b: 100 },
            'Internals': { r: 227, g: 179, b: 65 },
            'Failed': { r: 248, g: 81, b: 73 },
            'Pending': { r: 88, g: 166, b: 255 },
        };
        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // Re-seed particles/stars on resize
            if (currentAnim === 'particles') initParticles();
            if (currentAnim === 'constellation') initStars();
        }
        resize();
        window.addEventListener('resize', resize);
        function lerp(a, b, t) { return a + (b - a) * t; }
        function getAccentRgb() { return baseHues[0]; }
        // ── Waves (original) ──
        function drawWaves() {
            const layers = 4;
            for (let l = 0; l < layers; l++) {
                const layerAlpha = 0.18 + l * 0.07;
                const speed = 0.6 + l * 0.3;
                const amp = 40 + l * 25;
                const freq = 0.0015 + l * 0.0005;
                const yBase = h * (0.25 + l * 0.18);
                const phase = l * 1.2;
                const base = baseHues[l % baseHues.length];
                let r = base.r, g = base.g, b = base.b;
                if (pulseColor && pulseIntensity > 0) {
                    const pi = pulseIntensity * (0.65 + 0.35 * Math.sin(time * 8 + l));
                    r = lerp(r, pulseColor.r, pi); g = lerp(g, pulseColor.g, pi); b = lerp(b, pulseColor.b, pi);
                }
                ctx.beginPath(); ctx.moveTo(0, h);
                for (let x = 0; x <= w; x += 3) {
                    const wave1 = Math.sin(x * freq + time * speed + phase) * amp;
                    const wave2 = Math.sin(x * freq * 1.8 + time * speed * 0.7 + phase + 2) * (amp * 0.4);
                    const wave3 = Math.sin(x * freq * 0.5 + time * speed * 1.3 + phase + 4) * (amp * 0.25);
                    ctx.lineTo(x, yBase + wave1 + wave2 + wave3);
                }
                ctx.lineTo(w, h); ctx.closePath();
                const grad = ctx.createLinearGradient(0, yBase - amp, 0, h);
                grad.addColorStop(0, `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${layerAlpha})`);
                grad.addColorStop(0.5, `rgba(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)},${layerAlpha*0.5})`);
                grad.addColorStop(1, `rgba(${Math.round(r*0.2)},${Math.round(g*0.2)},${Math.round(b*0.2)},${layerAlpha*0.15})`);
                ctx.fillStyle = grad; ctx.fill();
            }
        }
        // ── Particles ──
        let particles = [];
        function initParticles() {
            particles = [];
            const count = Math.min(80, Math.floor((w * h) / 12000));
            for (let i = 0; i < count; i++) {
                particles.push({
                    x: Math.random() * w, y: Math.random() * h,
                    vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
                    r: Math.random() * 2.5 + 0.5, phase: Math.random() * Math.PI * 2
                });
            }
        }
        function drawParticles() {
            const ac = getAccentRgb();
            let r = ac.r, g = ac.g, b = ac.b;
            if (pulseColor && pulseIntensity > 0) {
                r = lerp(r, pulseColor.r, pulseIntensity); g = lerp(g, pulseColor.g, pulseIntensity); b = lerp(b, pulseColor.b, pulseIntensity);
            }
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.x += p.vx; p.y += p.vy;
                if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
                if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
                const glow = 0.3 + 0.3 * Math.sin(time * 2 + p.phase);
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${glow})`;
                ctx.fill();
                // Draw connections
                for (let k = i + 1; k < particles.length; k++) {
                    const q = particles[k];
                    const dx = p.x - q.x, dy = p.y - q.y;
                    const dist = dx * dx + dy * dy;
                    if (dist < 14000) {
                        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
                        ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${0.08 * (1 - dist / 14000)})`;
                        ctx.lineWidth = 0.5; ctx.stroke();
                    }
                }
            }
        }
        // ── Matrix Rain ──
        let matrixCols = [];
        function initMatrix() {
            const fontSize = 14;
            const cols = Math.floor(w / fontSize);
            matrixCols = [];
            for (let i = 0; i < cols; i++) {
                matrixCols.push({ y: Math.random() * h / fontSize | 0, speed: 0.3 + Math.random() * 0.7, chars: [] });
                // Pre-fill some chars
                const count = Math.floor(Math.random() * 15) + 5;
                for (let j = 0; j < count; j++) {
                    matrixCols[i].chars.push(String.fromCharCode(0x30A0 + Math.random() * 96));
                }
            }
        }
        let matrixAccum = 0;
        function drawMatrix() {
            const ac = getAccentRgb();
            let r = ac.r, g = ac.g, b = ac.b;
            if (pulseColor && pulseIntensity > 0) {
                r = lerp(r, pulseColor.r, pulseIntensity); g = lerp(g, pulseColor.g, pulseIntensity); b = lerp(b, pulseColor.b, pulseIntensity);
            }
            const fontSize = 14;
            // Dim overlay for trail effect
            ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(240,242,245,0.12)' : 'rgba(13,17,23,0.12)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = fontSize + 'px monospace';
            matrixAccum += 0.12;
            if (matrixAccum >= 1) {
                matrixAccum -= 1;
                for (let i = 0; i < matrixCols.length; i++) {
                    const col = matrixCols[i];
                    const x = i * fontSize;
                    const char = String.fromCharCode(0x30A0 + Math.random() * 96);
                    const a = 0.7 + 0.3 * Math.sin(time * 3 + i);
                    ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
                    ctx.fillText(char, x, col.y * fontSize);
                    // Dimmer trail chars
                    for (let t = 1; t < 6; t++) {
                        const trailY = (col.y - t) * fontSize;
                        if (trailY > 0) {
                            ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a * (0.5 - t * 0.08)})`;
                            ctx.fillText(col.chars[t % col.chars.length], x, trailY);
                        }
                    }
                    col.y += col.speed;
                    if (col.y * fontSize > h + 100) { col.y = 0; col.speed = 0.3 + Math.random() * 0.7; }
                }
            }
        }
        // ── Aurora ──
        function drawAurora() {
            const bands = 5;
            for (let b2 = 0; b2 < bands; b2++) {
                const base = baseHues[b2 % baseHues.length];
                let r = base.r, g = base.g, bl = base.b;
                if (pulseColor && pulseIntensity > 0) {
                    r = lerp(r, pulseColor.r, pulseIntensity); g = lerp(g, pulseColor.g, pulseIntensity); bl = lerp(bl, pulseColor.b, pulseIntensity);
                }
                const yCenter = h * (0.15 + b2 * 0.15);
                const bandHeight = 60 + b2 * 20;
                const alpha = 0.06 + b2 * 0.02;
                ctx.beginPath(); ctx.moveTo(0, yCenter + bandHeight);
                for (let x = 0; x <= w; x += 4) {
                    const wave = Math.sin(x * 0.003 + time * (0.3 + b2 * 0.15) + b2 * 2) * bandHeight;
                    const wobble = Math.sin(x * 0.008 + time * 0.7 + b2) * (bandHeight * 0.3);
                    const shimmer = Math.sin(x * 0.02 + time * 2 + b2 * 3) * 8;
                    ctx.lineTo(x, yCenter + wave + wobble + shimmer);
                }
                ctx.lineTo(w, yCenter + bandHeight); ctx.closePath();
                const grd = ctx.createLinearGradient(0, yCenter - bandHeight, 0, yCenter + bandHeight);
                grd.addColorStop(0, `rgba(${r},${g},${bl},0)`);
                grd.addColorStop(0.3, `rgba(${r},${g},${bl},${alpha})`);
                grd.addColorStop(0.5, `rgba(${r},${g},${bl},${alpha * 1.5})`);
                grd.addColorStop(0.7, `rgba(${r},${g},${bl},${alpha})`);
                grd.addColorStop(1, `rgba(${r},${g},${bl},0)`);
                ctx.fillStyle = grd; ctx.fill();
            }
            // Vertical shimmer columns
            for (let i = 0; i < 12; i++) {
                const x = (w / 12) * i + Math.sin(time * 0.5 + i) * 30;
                const a = 0.02 + 0.02 * Math.sin(time * 1.5 + i * 0.8);
                const ac = baseHues[i % baseHues.length];
                ctx.fillStyle = `rgba(${ac.r},${ac.g},${ac.b},${a})`;
                ctx.fillRect(x - 1, 0, 3, h);
            }
        }
        // ── Constellation / Starfield ──
        let stars = [];
        function initStars() {
            stars = [];
            const count = Math.min(120, Math.floor((w * h) / 8000));
            for (let i = 0; i < count; i++) {
                stars.push({
                    x: Math.random() * w, y: Math.random() * h,
                    r: Math.random() * 1.5 + 0.3,
                    twinkle: Math.random() * Math.PI * 2,
                    speed: Math.random() * 0.3 + 0.05
                });
            }
        }
        function drawConstellation() {
            const ac = getAccentRgb();
            let r = ac.r, g = ac.g, b = ac.b;
            if (pulseColor && pulseIntensity > 0) {
                r = lerp(r, pulseColor.r, pulseIntensity); g = lerp(g, pulseColor.g, pulseIntensity); b = lerp(b, pulseColor.b, pulseIntensity);
            }
            // Draw stars
            for (let i = 0; i < stars.length; i++) {
                const s = stars[i];
                s.twinkle += 0.02;
                s.y += s.speed * 0.15;
                s.x += Math.sin(time + s.twinkle) * 0.08;
                if (s.y > h + 5) { s.y = -5; s.x = Math.random() * w; }
                const alpha = 0.3 + 0.4 * Math.sin(s.twinkle);
                // Star glow
                ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha * 0.15})`;
                ctx.fill();
                // Star core
                ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
                ctx.fill();
            }
            // Constellation lines between close stars
            for (let i = 0; i < stars.length; i++) {
                for (let k = i + 1; k < stars.length; k++) {
                    const dx = stars[i].x - stars[k].x, dy = stars[i].y - stars[k].y;
                    const dist = dx * dx + dy * dy;
                    if (dist < 18000) {
                        const lineAlpha = 0.04 * (1 - dist / 18000);
                        ctx.beginPath(); ctx.moveTo(stars[i].x, stars[i].y); ctx.lineTo(stars[k].x, stars[k].y);
                        ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${lineAlpha})`;
                        ctx.lineWidth = 0.4; ctx.stroke();
                    }
                }
            }
            // Shooting star effect (occasional)
            if (Math.sin(time * 0.7) > 0.995) {
                const sx = Math.random() * w, sy = Math.random() * h * 0.3;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 80, sy + 40);
                ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
                ctx.lineWidth = 1.5; ctx.stroke();
            }
        }
        // ── Main draw loop ──
        let matrixNeedsClear = false;
        function draw() {
            time += 0.003;
            if (pulseIntensity > 0) pulseIntensity = Math.max(0, pulseIntensity - pulseDecay);
            // Matrix uses overlay dimming, all others clear fully
            if (currentAnim === 'matrix') {
                if (matrixNeedsClear) { ctx.clearRect(0, 0, w, h); matrixNeedsClear = false; }
                drawMatrix();
            } else {
                matrixNeedsClear = true;
                ctx.clearRect(0, 0, w, h);
                if (currentAnim === 'waves') drawWaves();
                else if (currentAnim === 'particles') drawParticles();
                else if (currentAnim === 'aurora') drawAurora();
                else if (currentAnim === 'constellation') drawConstellation();
                // 'none' — just stays cleared
            }
            rafId = requestAnimationFrame(draw);
        }
        // Initial setup for particle/star-based anims
        initParticles(); initStars(); initMatrix();
        draw();
        // Expose globally
        window.pulseBackground = function(status) {
            const c = statusColors[status];
            if (c) { pulseColor = c; pulseIntensity = 1; pulseDecay = 0.008; }
        };
        window.setBgAnimation = function(id) {
            currentAnim = id;
            localStorage.setItem('nx_bg_anim', id);
            // Re-init seeds when switching to ensure clean start
            if (id === 'particles') initParticles();
            if (id === 'constellation') initStars();
            if (id === 'matrix') { ctx.clearRect(0, 0, w, h); initMatrix(); }
            if (id === 'none') ctx.clearRect(0, 0, w, h);
            canvas.style.opacity = id === 'none' ? '0' : '0.7';
            if (navigator.vibrate) navigator.vibrate(8);
            render();
        };
        // Hide canvas if set to none on load
        if (currentAnim === 'none') canvas.style.opacity = '0';
        // Pause when tab hidden to save battery
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(rafId); }
            else { draw(); }
        });
    })();
    // Splash screen
    setTimeout(() => { document.getElementById('splash').style.display = 'none'; }, 2500);
    // Panel drag-to-reorder system
    (function() {
        let draggedPanel = null;
        let touchStartY = 0;
        let touchStartX = 0;
        let isDragging = false;
        let dragStartTime = 0;
        let currentTab = null;
        function handlePanelTouch(e, tab, panelId) {
            if (!e.target.closest('.panel-drag-handle')) return;
            e.preventDefault();
            e.stopPropagation();
            touchStartY = e.touches[0].clientY;
            touchStartX = e.touches[0].clientX;
            dragStartTime = Date.now();
            isDragging = false;
            currentTab = tab;
            draggedPanel = e.target.closest('.collapsible-panel');
        }
        window.handlePanelTouch = handlePanelTouch;
        document.addEventListener('touchmove', e => {
            if (!draggedPanel) return;
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            if (!isDragging && dy > 8 && dy > dx * 1.2) {
                isDragging = true;
                draggedPanel.classList.add('dragging');
                if (navigator.vibrate) navigator.vibrate(10);
            }
            if (isDragging) {
                e.preventDefault();
                const touch = e.touches[0];
                const panels = Array.from(draggedPanel.parentElement.querySelectorAll('.collapsible-panel'));
                panels.forEach(p => p.classList.remove('drag-over'));
                const targetPanel = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.collapsible-panel');
                if (targetPanel && targetPanel !== draggedPanel) {
                    targetPanel.classList.add('drag-over');
                }
            }
        }, { passive: false });
        document.addEventListener('touchend', e => {
            if (!draggedPanel || !isDragging) {
                draggedPanel = null;
                isDragging = false;
                return;
            }
            const touch = e.changedTouches[0];
            const targetPanel = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.collapsible-panel');
            draggedPanel.classList.remove('dragging');
            if (targetPanel && targetPanel !== draggedPanel) {
                targetPanel.classList.remove('drag-over');
                const container = draggedPanel.parentElement;
                const panels = Array.from(container.querySelectorAll('.collapsible-panel'));
                const draggedIdx = panels.indexOf(draggedPanel);
                const targetIdx = panels.indexOf(targetPanel);
                if (draggedIdx !== -1 && targetIdx !== -1) {
                    if (draggedIdx < targetIdx) {
                        targetPanel.after(draggedPanel);
                    } else {
                        targetPanel.before(draggedPanel);
                    }
                    const newOrder = Array.from(container.querySelectorAll('.collapsible-panel')).map(p => p.dataset.panelId);
                    setPanelOrder(currentTab, newOrder);
                    if (navigator.vibrate) navigator.vibrate(15);
                }
            }
            draggedPanel = null;
            isDragging = false;
        });
    })();
    // Job card drag-to-reorder system
    (function() {
        let draggedJobWrap = null;
        let touchStartY = 0;
        let touchStartX = 0;
        let isDragging = false;
        let dragStartTime = 0;
        function handleJobTouch(e, jobId) {
            e.preventDefault();
            e.stopPropagation();
            touchStartY = e.touches[0].clientY;
            touchStartX = e.touches[0].clientX;
            dragStartTime = Date.now();
            isDragging = false;
            draggedJobWrap = e.target.closest('.job-tile-wrap');
        }
        window.handleJobTouch = handleJobTouch;
        document.addEventListener('touchmove', e => {
            if (!draggedJobWrap || state.activeTab !== 'jobs') return;
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            if (!isDragging && dy > 8 && dy > dx * 1.2) {
                isDragging = true;
                const tile = draggedJobWrap.querySelector('.job-tile');
                if (tile) tile.classList.add('dragging');
                if (navigator.vibrate) navigator.vibrate(10);
            }
            if (isDragging) {
                e.preventDefault();
                const touch = e.touches[0];
                const container = draggedJobWrap.parentElement;
                const wraps = Array.from(container.querySelectorAll('.job-tile-wrap'));
                wraps.forEach(w => w.classList.remove('drag-over'));
                const targetWrap = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.job-tile-wrap');
                if (targetWrap && targetWrap !== draggedJobWrap) {
                    targetWrap.classList.add('drag-over');
                }
            }
        }, { passive: false });
        document.addEventListener('touchend', e => {
            if (!draggedJobWrap || !isDragging) {
                draggedJobWrap = null;
                isDragging = false;
                return;
            }
            const touch = e.changedTouches[0];
            const targetWrap = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.job-tile-wrap');
            const tile = draggedJobWrap.querySelector('.job-tile');
            if (tile) tile.classList.remove('dragging');
            if (targetWrap && targetWrap !== draggedJobWrap) {
                targetWrap.classList.remove('drag-over');
                const container = draggedJobWrap.parentElement;
                const wraps = Array.from(container.querySelectorAll('.job-tile-wrap'));
                const draggedIdx = wraps.indexOf(draggedJobWrap);
                const targetIdx = wraps.indexOf(targetWrap);
                if (draggedIdx !== -1 && targetIdx !== -1) {
                    if (draggedIdx < targetIdx) {
                        targetWrap.after(draggedJobWrap);
                    } else {
                        targetWrap.before(draggedJobWrap);
                    }
                    const newOrder = Array.from(container.querySelectorAll('.job-tile-wrap')).map(w => w.dataset.jobId);
                    setJobOrder(newOrder);
                    if (navigator.vibrate) navigator.vibrate(15);
                    // Don't call render() - visual reorder is already done
                }
            }
            draggedJobWrap = null;
            isDragging = false;
        });
    })();
    // Pull-to-refresh (pull down at top to go to today)
    (function() {
        let startY = 0, startX = 0, pulling = false, canceled = false;
        const ptr = document.querySelector('.ptr-indicator');
        document.addEventListener('touchstart', e => {
            if (window.scrollY === 0 && state.activeTab === 'jobs') {
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
                pulling = true;
                canceled = false;
            }
        }, { passive: true });
        document.addEventListener('touchmove', e => {
            if (!pulling || canceled) return;
            const dy = e.touches[0].clientY - startY;
            const dx = Math.abs(e.touches[0].clientX - startX);
            // Cancel if horizontal swipe detected
            if (dx > 20 && dx > Math.abs(dy)) {
                canceled = true;
                ptr.style.display = 'none';
                ptr.style.height = '0';
                return;
            }
            if (dy > 10 && dy < 150) {
                ptr.style.display = 'block';
                ptr.style.height = Math.min(dy * 0.5, 50) + 'px';
                ptr.style.opacity = Math.min(dy / 100, 1);
            }
        }, { passive: true });
        document.addEventListener('touchend', () => {
            if (!pulling) return;
            pulling = false;
            const h = parseFloat(ptr.style.height) || 0;
            ptr.style.display = 'none'; ptr.style.height = '0';
            if (h > 30 && !canceled) { goToday(); }
            canceled = false;
        });
    })();
    // Swipe gesture: left/right on viewport to switch tabs
    (function() {
        const tabs = ['jobs', 'stats', 'funds'];
        let sx = 0, sy = 0, swiping = false, locked = false;
        const vp = document.getElementById('view-container');
        vp.addEventListener('touchstart', e => {
            sx = e.touches[0].clientX; sy = e.touches[0].clientY;
            swiping = true; locked = false;
        }, { passive: true });
        vp.addEventListener('touchmove', e => {
            if (!swiping) return;
            const dx = e.touches[0].clientX - sx;
            const dy = Math.abs(e.touches[0].clientY - sy);
            if (!locked && dy > 15) { swiping = false; return; }
            if (Math.abs(dx) > 15) locked = true;
            if (locked) {
                vp.style.transition = 'none';
                vp.style.transform = 'translateX(' + Math.max(-60, Math.min(60, dx * 0.4)) + 'px)';
                vp.style.opacity = Math.max(0.7, 1 - Math.abs(dx) / 500);
            }
        }, { passive: true });
        vp.addEventListener('touchend', e => {
            if (!swiping && !locked) return;
            const dx = e.changedTouches[0].clientX - sx;
            vp.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
            vp.style.transform = ''; vp.style.opacity = '';
            if (locked && Math.abs(dx) > 60) {
                const cur = state.activeTab === 'settings' ? -1 : tabs.indexOf(state.activeTab);
                let next = dx < 0 ? cur + 1 : cur - 1;
                if (next >= 0 && next < tabs.length) {
                    const navItems = document.querySelectorAll('.nav-item:not(.disabled)');
                    nav(tabs[next], navItems[next]);
                    if (navigator.vibrate) navigator.vibrate(5);
                }
            }
            swiping = false; locked = false;
        });
    })();
    // Swipe gesture: left/right on pager area to change date
    (function() {
        let sx = 0;
        const pager = document.querySelector('.pager');
        if (!pager) return;
        pager.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
        pager.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - sx;
            if (Math.abs(dx) > 50) {
                adjDate(dx < 0 ? 1 : -1);
                if (navigator.vibrate) navigator.vibrate(5);
            }
        });
    })();
    
    // --- Authentication Functions ---
    async function showSignUpModal() {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px;">Sign Up</h3>
            <input type="email" id="signup-email" class="input-box" placeholder="Email" style="margin-bottom:8px;">
            <input type="password" id="signup-password" class="input-box" placeholder="Password" style="margin-bottom:8px;">
            <input type="text" id="signup-name" class="input-box" placeholder="Display Name" style="margin-bottom:12px;">
            <button class="btn" style="background:var(--primary); color:#fff; width:100%; margin-bottom:8px;" onclick="handleSignUp()">SIGN UP</button>
            <button class="btn" style="background:var(--border); color:var(--text-main); width:100%;" onclick="showSignInModal()">Already have an account? Sign in</button>
        `;
        m.style.display = 'flex';
    }
    
    async function showSignInModal() {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px;">Sign In</h3>
            <input type="email" id="signin-email" class="input-box" placeholder="Email" style="margin-bottom:8px;">
            <input type="password" id="signin-password" class="input-box" placeholder="Password" style="margin-bottom:12px;">
            <button class="btn" style="background:var(--primary); color:#fff; width:100%; margin-bottom:8px;" onclick="handleSignIn()">SIGN IN</button>
            <button class="btn" style="background:var(--border); color:var(--text-main); width:100%;" onclick="showSignUpModal()">Need an account? Sign up</button>
        `;
        m.style.display = 'flex';
    }
    
    async function applyServerRole(userId) {
        try {
            const profileRows = await window.supabaseClient.select('profiles', {
                select: 'role',
                eq: { id: userId },
                limit: 1
            });

            const serverRole = Array.isArray(profileRows) && profileRows[0]?.role ? profileRows[0].role : 'engineer';
            state.userRole = serverRole;
            localStorage.setItem('nx_userRole', serverRole);
            if (window.JobTrackerState && typeof window.JobTrackerState.setUserRole === 'function') {
                window.JobTrackerState.setUserRole(serverRole);
            }
        } catch (error) {
            console.warn('Could not load profile role, defaulting to engineer:', error);
            state.userRole = 'engineer';
            localStorage.setItem('nx_userRole', 'engineer');
            if (window.JobTrackerState && typeof window.JobTrackerState.setUserRole === 'function') {
                window.JobTrackerState.setUserRole('engineer');
            }
        }
    }

    async function ensureSyncEngineReady() {
        if (!window.supabaseClient || !window.SyncEngine) return;

        if (!window.syncEngine) {
            window.syncEngine = new SyncEngine(
                window.supabaseClient,
                window.JobTrackerDB,
                window.JobTrackerState
            );
        }

        await window.syncEngine.init();
    }

    async function handleSignUp() {
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value.trim();
        const name = document.getElementById('signup-name').value.trim();
        
        if (!email || !password || !name) {
            customAlert('Error', 'Please fill in all fields.');
            return;
        }
        
        try {
            const result = await window.supabaseClient.signUp(email, password, name);
            if (result.success) {
                // Store display name locally
                localStorage.setItem('nx_displayName', name);
                if (result.needsVerification) {
                    customAlert('Verify Email', 'Account created. Check your inbox/spam and click the verification link, then sign in.');
                } else {
                    await applyServerRole(result.user.id);
                    await ensureSyncEngineReady();
                    customAlert('Success', 'Account created! Signed in as ' + name + '.');
                    loadJobsForCurrentAccount();
                }
                closeModal();
                updateAuthUI();
                render();
            } else {
                customAlert('Error', result.error || 'Sign up failed');
            }
        } catch (err) {
            customAlert('Error', 'Sign up failed: ' + err.message);
        }
    }
    
    async function handleSignIn() {
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value.trim();
        
        if (!email || !password) {
            customAlert('Error', 'Please fill in all fields.');
            return;
        }
        
        try {
            const result = await window.supabaseClient.signIn(email, password);
            if (result.success) {
                // Store display name from user metadata if available
                if (result.user?.user_metadata?.display_name) {
                    localStorage.setItem('nx_displayName', result.user.user_metadata.display_name);
                }
                await applyServerRole(result.user.id);
                customAlert('Success', 'Signed in successfully!');
                closeModal();
                localStorage.setItem('nx_active_user_id', result.user.id);
                await ensureSyncEngineReady();
                updateAuthUI();
                loadJobsForCurrentAccount();
            } else {
                customAlert('Error', result.error || 'Sign in failed');
            }
        } catch (err) {
            customAlert('Error', 'Sign in failed: ' + err.message);
        }
    }
    
    async function handleSignOut() {
        if (!confirm('Sign out?')) return;
        try {
            await window.supabaseClient.signOut();
            localStorage.removeItem('nx_active_user_id');
            customAlert('Signed Out', 'You have been signed out.');
            updateAuthUI();
            loadJobsForCurrentAccount();
        } catch (err) {
            customAlert('Error', 'Sign out failed: ' + err.message);
        }
    }
    
    function updateAuthUI() {
        const authBtn = document.getElementById('auth-btn');
        if (!authBtn) return;
        
        const status = window.supabaseClient?.getStatus?.();
        if (status?.isAuthenticated) {
            // Fetch display name from local storage
            const displayName = (localStorage.getItem('nx_displayName') || 'Account').substring(0, 12);
            authBtn.innerHTML = '👤 ' + displayName;
            authBtn.onclick = () => showSignOutModal();
            hideAuthSplash();
            showMainUI();
        } else {
            authBtn.innerHTML = '🔐 Sign In';
            authBtn.onclick = () => showSignInModal();
            showAuthSplash();
            hideMainUI();
        }
    }
    
    function showAuthSplash() {
        const m = document.getElementById('modal');
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align:center; max-width:320px;">
                <div style="font-size:3rem; margin-bottom:24px;">🔐</div>
                <h2 style="font-size:1.5rem; font-weight:700; margin-bottom:8px; color:var(--text-main);">Sign In Required</h2>
                <p style="color:var(--text-muted); margin-bottom:32px; font-size:0.9rem; line-height:1.4;">Create an account or sign in to use Job Tracker.</p>
                <div style="display:flex; gap:12px; flex-direction:column;">
                    <button class="btn" style="background:var(--primary); color:#fff; font-weight:600; padding:12px; border-radius:8px; border:none; cursor:pointer; width:100%;" onclick="showSignUpModal()">Create Account</button>
                    <button class="btn" style="background:var(--surface-elev); color:var(--primary); font-weight:600; padding:12px; border-radius:8px; border:1px solid var(--border-subtle); cursor:pointer; width:100%;" onclick="showSignInModal()">Sign In</button>
                </div>
            </div>
        `;
        m.style.display = 'flex';
    }
    
    function hideAuthSplash() {
        const m = document.getElementById('modal');
        m.style.display = 'none';
    }
    
    function hideMainUI() {
        const navBar = document.querySelector('.nav-bar');
        const viewContainer = document.getElementById('view-container');
        const header = document.querySelector('.header');
        const ptrIndicator = document.querySelector('.ptr-indicator');
        
        if (navBar) navBar.style.visibility = 'hidden';
        if (viewContainer) viewContainer.style.visibility = 'hidden';
        if (header) header.style.visibility = 'hidden';
        if (ptrIndicator) ptrIndicator.style.visibility = 'hidden';
    }
    
    function showMainUI() {
        const navBar = document.querySelector('.nav-bar');
        const viewContainer = document.getElementById('view-container');
        const header = document.querySelector('.header');
        const ptrIndicator = document.querySelector('.ptr-indicator');
        
        if (navBar) navBar.style.visibility = 'visible';
        if (viewContainer) viewContainer.style.visibility = 'visible';
        if (header) header.style.visibility = 'visible';
        if (ptrIndicator) ptrIndicator.style.visibility = 'visible';
    }
    
    function showSignOutModal() {
        const m = document.getElementById('modal');
        const status = window.supabaseClient?.getStatus?.();
        const displayName = localStorage.getItem('nx_displayName') || 'Not set';
        const userRole = (window.JobTrackerState && window.JobTrackerState.userRole) || state.userRole || 'engineer';
        document.getElementById('modal-body').innerHTML = `
            <button class="close-btn" onclick="closeModal()">×</button>
            <h3 style="margin-bottom:16px;">👤 Account</h3>
            <div style="padding:12px; background:var(--surface-elev); border-radius:6px; margin-bottom:16px; font-size:0.85rem; border:1px solid var(--border-t);">
                <div style="margin-bottom:8px;"><span style="color:var(--text-muted); font-size:0.7rem; font-weight:700; text-transform:uppercase;">Display Name</span><br><strong>${displayName}</strong></div>
                <div style="margin-bottom:8px;"><span style="color:var(--text-muted); font-size:0.7rem; font-weight:700; text-transform:uppercase;">Role</span><br><strong style="text-transform:capitalize; color:var(--primary);">${userRole}</strong></div>
                <div><span style="color:var(--text-muted); font-size:0.7rem; font-weight:700; text-transform:uppercase;">Status</span><br><strong>${status?.isOnline ? '🟢 Online' : '🔴 Offline'}</strong></div>
            </div>
            <button class="btn" style="background:var(--danger); color:#fff; width:100%;" onclick="handleSignOut()">SIGN OUT</button>
        `;
        m.style.display = 'flex';
    }
    
    // One-time migration from legacy key
    if (!localStorage.getItem('nx_jobs_anon')) {
        localStorage.setItem('nx_jobs_anon', localStorage.getItem('nx_jobs') || '[]');
    }

    // Update auth UI on page load
    const status = window.supabaseClient?.getStatus?.();
    if (!status?.isAuthenticated) {
        showAuthSplash();
        hideMainUI();
    }
    
    setTimeout(() => {
        const currentStatus = window.supabaseClient?.getStatus?.();
        if (currentStatus?.isAuthenticated) {
            updateAuthUI();
            loadJobsForCurrentAccount();
            showMainUI();
        } else if (!document.getElementById('modal').style.display || document.getElementById('modal').style.display === 'none') {
            // If still not authenticated and modal somehow got hidden, show it again
            showAuthSplash();
            hideMainUI();
        }
    }, 500);
    
    normalizeSaturdayFees();
    
    // Only render if authenticated to avoid UI flicker
    const initialStatus = window.supabaseClient?.getStatus?.();
    if (initialStatus?.isAuthenticated) {
        render();
    }
    // Show idle notifications if there's activity since last sync
    // NOTE: Disabled during testing phase - will enable when login system is added
    // setTimeout(() => showIdleNotifications(), 500);
    // Service Worker registration disabled for cloud deployment stability
    // Wake lock auto-restore
    if (localStorage.getItem('nx_wakelock') === '1') {
        toggleWakeLock();
    }
    // Notification scheduling
    if (localStorage.getItem('nx_notif') === '1' && 'Notification' in window && Notification.permission === 'granted') {
        scheduleNotification();
    }
