import { JobTrackerConstants }   from './js/constants.js';
import { JobTrackerUtils }        from './js/utils.js';
import { JobTrackerState }        from './js/state.js';
import { JobTrackerCalculations } from './js/calculations.js';
import { JobTrackerJobs }         from './js/jobs.js';
import { JobTrackerModals }       from './js/modals.js';
import { initModules }            from './js/bridge.js';

// -- Globals required by inline onclick handlers ------------------
window.JobTrackerModals = JobTrackerModals;

const { STATUS }                                           = JobTrackerConstants;
const { sanitizeHTML, showToast, getWeekNumber } = JobTrackerUtils;
const state                                                = JobTrackerState;
const { calculate, getPayPeriod, getPayPeriodHistory }     = JobTrackerCalculations;
const jobOps                                               = JobTrackerJobs;

// -- Lab-local state (UI only) -------------------------------------
const lab = {
  motion:   true,
  energy:   0.4,
  density:  'regular',
  idlePack: 'pulse',
  pointer:  { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 }
};

// -- Expose nav helpers to window (used by onclick= attributes) ----
window.labAdjDate  = labAdjDate;
window.labGoToday  = labGoToday;
window.labSetRange = labSetRange;
window.setLabView  = setLabView;
window.labShowAuth = labShowAuth;

// -- Date navigation -----------------------------------------------
function labAdjDate(n) {
  const d = new Date(state.viewDate);
  if      (state.range === 'day')   d.setDate(d.getDate() + n);
  else if (state.range === 'week')  d.setDate(d.getDate() + n * 7);
  else if (state.range === 'month') d.setMonth(d.getMonth() + n);
  else                               d.setFullYear(d.getFullYear() + n);
  state.setViewDate(d);
  render();
}

function labGoToday() {
  state.setViewDate(new Date());
  if (navigator.vibrate) navigator.vibrate(8);
  render();
}

function labSetRange(range, el) {
  state.setRange(range);
  document.querySelectorAll('.range-chip').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  render();
}

function labShowAuth() {
  const isAuth = !!window.supabaseClient?.getStatus?.().isAuthenticated;
  if (isAuth) JobTrackerModals.showProfile();
  else         JobTrackerModals.showSignIn();
}

// -- View switching ------------------------------------------------
function setLabView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll('.nav-chip').forEach(c => c.classList.toggle('active', c.dataset.view === view));
  document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === view));
  if (view === 'stats')   renderStats();
  if (view === 'payweek') renderPayweek();
}

// -- Auth button ---------------------------------------------------
function updateAuthBtn() {
  const btn = document.getElementById('auth-btn');
  if (!btn) return;
  const isAuth = !!window.supabaseClient?.getStatus?.().isAuthenticated;
  if (isAuth) {
    const name = (state.displayName || 'Account').trim();
    btn.textContent = name;
  } else {
    btn.textContent = 'Sign In';
  }
}

// -- Date label ----------------------------------------------------
function updateDateLabel() {
  const el  = document.getElementById('lab-date-label');
  if (!el) return;
  const d   = state.viewDate;
  if (state.range === 'day') {
    el.textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } else if (state.range === 'week') {
    const ref = new Date(d); ref.setHours(0,0,0,0);
    const toSat = (ref.getDay() + 1) % 7;
    const sat   = new Date(ref); sat.setDate(ref.getDate() - toSat);
    const fri   = new Date(sat); fri.setDate(sat.getDate() + 6);
    const fmt   = x => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    el.textContent = `Wk ${getWeekNumber(d)} | ${fmt(sat)} - ${fmt(fri)}`;
  } else if (state.range === 'month') {
    el.textContent = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  } else {
    el.textContent = String(d.getFullYear());
  }
}

// -- KPI strip -----------------------------------------------------
function updateKpi(s) {
  document.getElementById('kpi-pending').textContent = String(s.pend ?? 0);
  document.getElementById('kpi-done').textContent    = String(s.done ?? 0);
  document.getElementById('kpi-rate').textContent    = s.compRate != null ? s.compRate + '%' : '--';
  document.getElementById('kpi-pay').textContent     = 'GBP ' + (s.totalCash ?? 0).toFixed(0);
}

// -- Type badge colours --------------------------------------------
const TYPE_COLORS = {
  OH:    '#f6b93b',  // amber
  UG:    '#74b9ff',  // sky blue
  HyOH:  '#a29bfe',  // lavender
  HyUG:  '#55efc4',  // teal
  RC:    '#b2bec3',  // grey
  BTTW:  '#fd79a8',  // pink-red
};

function typeBadge(type) {
  const color = TYPE_COLORS[type] ?? '#b2bec3';
  return `<span class="type-badge" style="color:${color};border-color:${color}44;background:${color}18;">${sanitizeHTML(type)}</span>`;
}

// -- Empty state ---------------------------------------------------
function emptyCard() {
  return `<div class="empty-state glass">
    <p>No jobs for this period.</p>
    <button class="pill-btn" onclick="document.getElementById('add-job-btn').click()">+ Add Job</button>
  </div>`;
}

// -- Job card template (swipe-based) ------------------------------
function jobCardHTML(job) {
  const s = job.status.toLowerCase().replace(' ', '-');
  const fee = parseFloat(job.fee || 0).toFixed(2);
  const jobID = job.jobID ? `<span class="job-id">${sanitizeHTML(job.jobID)}</span>` : '';
  const notesPreview = job.notes
    ? `<span class="job-notes-preview">${sanitizeHTML(job.notes.slice(0, 72))}${job.notes.length > 72 ? '...' : ''}</span>`
    : '<span class="job-notes-preview empty">No notes yet</span>';
  return `
    <div class="swipe-wrap" data-job-id="${job.id}">
      <div class="action-rail">
        <div class="rail-left">
          <button class="rail-btn done"  data-action="${STATUS.COMPLETED}">Done</button>
          <button class="rail-btn int"   data-action="${STATUS.INTERNALS}">Int</button>
        </div>
        <div class="rail-right">
          <button class="rail-btn fail"  data-action="${STATUS.FAILED}">Fail</button>
        </div>
      </div>
      <article class="job-card status-${s}" data-job-id="${job.id}">
        <div class="job-top">
          ${typeBadge(job.type)}
          <span class="job-status-badge s-${s}">${sanitizeHTML(job.status)}</span>
        </div>
        <div class="job-mid">
          ${jobID}
          ${notesPreview}
        </div>
        <div class="job-bottom">
          <span class="job-date">${job.date}</span>
          <strong class="job-fee">GBP ${fee}</strong>
        </div>
      </article>
    </div>`;
}

// -- Attach swipe + rail gestures to a card wrapper ----------------
async function setStatus(id, newStatus) {
  try {
    await jobOps.updateJobStatus(id, newStatus);
    if (navigator.vibrate) navigator.vibrate(10);
    render();
    showToast(`${newStatus}`);
  } catch (e) {
    JobTrackerModals.customAlert('Error', e.message, true);
  }
}

function attachCardGestures(wrap) {
  const card   = wrap.querySelector('.job-card');
  const jobId  = card.dataset.jobId;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let moved = false;
  let activePointerId = null;
  let axisLock = null;
  let ignoreSwipe = false;

  const resetGesture = () => {
    activePointerId = null;
    axisLock = null;
    ignoreSwipe = false;
    currentX = 0;
    moved = false;
    card.style.setProperty('--drag', '0px');
    wrap.classList.remove('swiping');
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.rail-btn')) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    currentX = 0;
    moved = false;
    axisLock = null;
    ignoreSwipe = e.pointerType === 'touch' && e.clientX < 20;
  });

  card.addEventListener('pointermove', (e) => {
    if (activePointerId !== e.pointerId || ignoreSwipe) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    if (!axisLock) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
      axisLock = Math.abs(deltaX) > Math.abs(deltaY) * 1.2 ? 'x' : 'y';
      if (axisLock === 'x') {
        card.setPointerCapture(e.pointerId);
        wrap.classList.add('swiping');
      }
    }

    if (axisLock !== 'x') return;
    e.preventDefault();
    moved = true;
    currentX = deltaX;
    const clamped = Math.max(-128, Math.min(128, currentX));
    card.style.setProperty('--drag', `${clamped}px`);
  });

  card.addEventListener('pointerup', (e) => {
    if (activePointerId !== e.pointerId) return;
    if (axisLock === 'x') {
      if (currentX > 96) setStatus(jobId, STATUS.COMPLETED);
      else if (currentX < -96) setStatus(jobId, STATUS.FAILED);
    } else if (!moved && !e.target.closest('.rail-btn')) {
      JobTrackerModals.editJob(jobId);
    }
    resetGesture();
  });

  card.addEventListener('pointercancel', resetGesture);

  wrap.querySelectorAll('.rail-btn').forEach(btn => {
    btn.addEventListener('click', () => setStatus(jobId, btn.dataset.action));
  });
}

// -- Render queue --------------------------------------------------
function renderQueue(list) {
  const stream = document.getElementById('job-stream');
  if (!stream) return;
  const q = (state.searchQuery || '').trim().toLowerCase();
  const filtered = list.filter((job) => {
    if (state.statusFilter !== 'all' && job.status !== state.statusFilter) return false;
    if (!q) return true;
    return (
      job.type.toLowerCase().includes(q) ||
      (job.jobID || '').toLowerCase().includes(q) ||
      (job.notes || '').toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) { stream.innerHTML = emptyCard(); return; }

  // Sort: pending first, then completed/failed/internals
  const sorted = [...filtered].sort((a, b) => {
    const ap = a.status === STATUS.PENDING ? 0 : 1;
    const bp = b.status === STATUS.PENDING ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (b.completedAt || 0) - (a.completedAt || 0);
  });

  stream.innerHTML = sorted.map(jobCardHTML).join('');
  stream.querySelectorAll('.swipe-wrap').forEach(attachCardGestures);
}

// -- Render stats --------------------------------------------------
function renderStats() {
  const el = document.getElementById('stats-body');
  if (!el) return;
  const list = state.getScope();
  const s    = calculate(list);

  if (list.length === 0) {
    el.innerHTML = `<div class="glass stat-card"><p style="color:var(--muted)">No data for this period.</p></div>`;
    return;
  }

  const typeRows = Object.entries(s.typeBreakdown || {}).map(([type, tb]) => `
    <div class="type-row">
      ${typeBadge(type)}
      <span>${tb.count} jobs</span>
      <span style="color:var(--success)">Done ${tb.done}</span>
      <span style="color:var(--danger)">Fail ${tb.fails}</span>
      <span style="color:var(--warning)">Int ${tb.ints}</span>
      <b>GBP ${tb.rev.toFixed(0)}</b>
    </div>`).join('');

  el.innerHTML = `
    <div class="stat-card glass">
      <div class="stat-row"><span>Completion</span><b>${s.compRate}%</b></div>
      <div class="stat-row"><span>Excl. Hybrid</span><b>${s.exclHy}%</b></div>
      <div class="stat-row"><span>Streak</span><b>${s.streak}</b></div>
      <div class="stat-row"><span>Jobs</span><b>${s.vol}</b></div>
      <div class="stat-row"><span>Avg / Job</span><b>GBP ${s.avgJobPay}</b></div>
      <div class="stat-row"><span>Avg / Day</span><b>GBP ${s.avgDailyPay}</b></div>
      <div class="stat-row"><span>Days worked</span><b>${s.daysWorked}</b></div>
    </div>
    <div class="stat-card glass type-breakdown">
      <h3>By Type</h3>
      ${typeRows || '<p style="color:var(--muted)">No breakdown available.</p>'}
    </div>`;
}

// -- Render payweek ------------------------------------------------
function renderPayweek() {
  const current = getPayPeriod();
  const fig     = document.getElementById('pay-figure');
  const det     = document.getElementById('pay-detail');
  if (fig) fig.textContent = `GBP ${current.total.toFixed(2)}`;
  if (det) det.textContent = `${current.label} | ${current.count} job${current.count !== 1 ? 's' : ''}`;

  const history = getPayPeriodHistory(8);
  const bars    = document.getElementById('micro-bars');
  if (!bars || !history.length) return;

  const maxPay = Math.max(...history.map(p => p.total), 1);
  bars.innerHTML = history.map(period => `
    <div class="micro-row">
      <span>${period.payDate}</span>
      <div class="micro-track">
        <div class="micro-fill" style="width:${(period.total / maxPay) * 100}%"></div>
      </div>
      <b>GBP ${period.total.toFixed(0)}</b>
    </div>`).join('');
}

// -- Add job picker ------------------------------------------------
function showAddJobPicker() {
  const types   = state.types;
  const date    = state.viewDate.toISOString().split('T')[0];
  const btnGrid = types.map(t => {
    const color = TYPE_COLORS[t.code] ?? '#b2bec3';
    return `<button class="type-pick-btn" style="border-color:${color};color:${color};"
      onclick="labQuickAdd('${sanitizeHTML(t.code)}')">${sanitizeHTML(t.code)}</button>`;
  }).join('');

  JobTrackerModals.showModal(`
    <button class="close-btn" onclick="JobTrackerModals.closeModal()">x</button>
    <h3 style="margin-bottom:4px">ADD JOB</h3>
    <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:14px">${date}</p>
    <input type="text" id="lab-add-jobid" class="input-box" placeholder="Job ID (optional)" style="margin-bottom:14px">
    <div class="type-pick-grid">${btnGrid}</div>`);
}

window.labQuickAdd = async function labQuickAdd(type) {
  const date  = state.viewDate.toISOString().split('T')[0];
  const jobID = document.getElementById('lab-add-jobid')?.value?.trim() || null;
  try {
    await jobOps.createJob({ type, date, jobID, status: STATUS.PENDING });
    JobTrackerModals.closeModal();
    showToast(`${type} added`);
    render();
  } catch (e) {
    JobTrackerModals.customAlert('Error', e.message, true);
  }
};

// -- Touch scroll bounce -------------------------------------------
function attachScrollBounce() {
  const list   = document.getElementById('job-stream');
  if (!list) return;
  let touchStart = 0;
  list.addEventListener('touchstart',  (e) => { touchStart = e.touches[0].clientY; }, { passive: true });
  list.addEventListener('touchmove',   (e) => {
    const delta   = e.touches[0].clientY - touchStart;
    const atTop   = list.scrollTop <= 0;
    const atBtm   = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    if ((atTop && delta > 0) || (atBtm && delta < 0)) {
      list.style.transform = `translateY(${Math.max(-20, Math.min(20, delta * 0.18))}px)`;
    }
  }, { passive: true });
  list.addEventListener('touchend',    () => { list.style.transform = ''; }, { passive: true });
}

// -- Procedural canvas background ---------------------------------
function startBackground() {
  const canvas = document.getElementById('lab-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, nodes = [], t = 0;

  function densityCount() {
    if (lab.density === 'dense') return 80;
    if (lab.density === 'low')   return 34;
    return 54;
  }

  function resetNodes() {
    nodes = Array.from({ length: densityCount() }, () => ({
      x:  Math.random() * w,
      y:  Math.random() * h,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r:  1 + Math.random() * 2
    }));
  }

  function resize() {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
    resetNodes();
  }

  function draw() {
    t += 0.014;
    lab.energy = Math.max(0.28, lab.energy * 0.996);

    const intensity  = Number(document.getElementById('bg-intensity')?.value ?? 52) / 100;
    const hueShift   = lab.idlePack === 'drift' ? Math.sin(t * 0.6) * 18 : 0;

    ctx.clearRect(0, 0, w, h);

    nodes.forEach(node => {
      node.x += node.vx; node.y += node.vy;
      if (node.x < -20) node.x = w + 20;
      if (node.x > w + 20) node.x = -20;
      if (node.y < -20) node.y = h + 20;
      if (node.y > h + 20) node.y = -20;
      const dx = lab.pointer.x - node.x;
      const dy = lab.pointer.y - node.y;
      if (Math.hypot(dx, dy) < 180) { node.vx -= dx * 0.00002; node.vy -= dy * 0.00002; }
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 130) continue;
        const alpha = (1 - d / 130) * 0.28 * intensity * (1 + lab.energy * 0.35);
        ctx.strokeStyle = `hsla(${210 + hueShift}, 100%, 70%, ${alpha})`;
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    nodes.forEach(node => {
      const wave   = Math.sin((node.x + t * 90) * 0.01) * 0.65;
      const pulse  = lab.idlePack === 'calm' ? 0.7 : (1 + Math.sin(t * 3 + node.x * 0.01) * 0.2);
      const radius = Math.max(0.8, (node.r + wave) * pulse);
      ctx.fillStyle = `hsla(${208 + hueShift}, 100%, 72%, ${0.3 + lab.energy * 0.22})`;
      ctx.beginPath(); ctx.arc(node.x, node.y, radius, 0, Math.PI * 2); ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
}

// -- Main render ---------------------------------------------------
function render() {
  updateAuthBtn();
  updateDateLabel();
  const list = state.getScope();
  const s    = calculate(list);
  updateKpi(s);
  renderQueue(list);
  // Update active panel data too
  const view = document.body.dataset.view;
  if (view === 'stats')   renderStats();
  if (view === 'payweek') renderPayweek();
}

// -- Toolkit controls ---------------------------------------------
function wireToolkit() {
  const motionBtn  = document.getElementById('motion-toggle');
  const accentEl   = document.getElementById('accent');
  const bgEl       = document.getElementById('bg-intensity');
  const densityEl  = document.getElementById('density');
  const idlePackEl = document.getElementById('idle-pack');
  const searchEl   = document.getElementById('queue-search');
  const filterEl   = document.getElementById('queue-filter');

  motionBtn?.addEventListener('click', () => {
    lab.motion = !lab.motion;
    document.body.classList.toggle('motion-on', lab.motion);
    motionBtn.textContent = lab.motion ? 'On' : 'Off';
    showToast(lab.motion ? 'Motion enabled' : 'Motion reduced');
  });

  accentEl?.addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--primary', e.target.value);
  });

  bgEl?.addEventListener('input', (e) => {
    const v    = Number(e.target.value);
    const base = Math.max(5, Math.min(26, Math.round(v / 2.5)));
    document.documentElement.style.setProperty('--surface',   `hsl(216 24% ${base}%)`);
    document.documentElement.style.setProperty('--surface-2', `hsl(216 23% ${Math.max(8, base - 4)}%)`);
  });

  densityEl?.addEventListener('change', (e) => {
    lab.density = e.target.value;
    lab.energy  = Math.min(1.6, lab.energy + 0.2);
    showToast(`Density: ${lab.density}`);
  });

  idlePackEl?.addEventListener('change', (e) => {
    lab.idlePack = e.target.value;
    showToast(`Idle: ${lab.idlePack}`);
  });

  searchEl?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    render();
  });

  filterEl?.addEventListener('change', (e) => {
    state.statusFilter = e.target.value;
    render();
  });

  document.getElementById('add-job-btn')?.addEventListener('click', showAddJobPicker);
}

// -- Pointer tracking for canvas -----------------------------------
window.addEventListener('pointermove', (e) => { lab.pointer.x = e.clientX; lab.pointer.y = e.clientY; });
window.addEventListener('pointerdown', ()  => { lab.energy = Math.min(1.8, lab.energy + 0.22); });

// -- Bootstrap ----------------------------------------------------
(async function boot() {
  // Expose render for modal callbacks
  window.appRender = () => render();

  const isAuth = await initModules();

  updateAuthBtn();

  if (!isAuth) {
    // Show sign-in gate; modals.js will call window.appRender after login
    JobTrackerModals.showSignIn();
  }

  // Subscribe to state changes and re-render
  state.subscribe((event) => {
    if (event.startsWith('job:') || event.startsWith('jobs:')) render();
  });

  wireToolkit();
  attachScrollBounce();
  startBackground();
  render();
})();
