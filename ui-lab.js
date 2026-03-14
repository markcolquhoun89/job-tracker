import { JobTrackerState } from './js/state.js';
import { JobTrackerCalculations } from './js/calculations.js';

const ModernUI = {
    state: {
        currentView: 'view-queue',
        statusFilter: 'all',
        selectedJobId: null
    },

    async init() {
        // Load actual app state
        await JobTrackerState.loadState();
        setInterval(() => JobTrackerState.saveState(), 30000);

        // Bind Elements
        this.cacheDOM();
        this.bindEvents();

        // Initial Render
        this.refreshData();
    },

    cacheDOM() {
        this.dom = {
            views: document.querySelectorAll('.view'),
            navItems: document.querySelectorAll('.nav-item'),
            title: document.getElementById('header-title'),
            addBtn: document.getElementById('btn-add'),
            
            queueList: document.getElementById('queue-list'),
            payweekList: document.getElementById('payweek-list'),
            historyList: document.getElementById('history-list'),
            
            filterStatus: document.getElementById('filter-status'),
            
            statTotal: document.getElementById('stat-week-total'),
            statCount: document.getElementById('stat-week-count'),
            
            modalContainer: document.getElementById('modal-container'),
            actionSheet: document.getElementById('job-action-sheet'),
            sheetJobTitle: document.getElementById('sheet-job-title'),
            backdrop: document.querySelector('.modal-backdrop'),
            btnCancelSheet: document.getElementById('btn-close-sheet')
        };
    },

    bindEvents() {
        // Navigation Switching
        this.dom.navItems.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = btn.getAttribute('data-target');
                this.switchView(target);
            });
        });

        // Queue Filter
        this.dom.filterStatus.addEventListener('change', (e) => {
            this.state.statusFilter = e.target.value;
            this.renderQueue();
        });

        // Add Job Button (Mock action for now)
        this.dom.addBtn.addEventListener('click', () => {
            alert('Add New Job logic triggered (Will open native form)');
        });

        // Modal triggers
        this.dom.backdrop.addEventListener('click', () => this.closeActionSheet());
        this.dom.btnCancelSheet.addEventListener('click', () => this.closeActionSheet());

        // Action Sheet Actions
        document.querySelectorAll('.sheet-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleJobAction(btn.getAttribute('data-action')));
        });
    },

    refreshData() {
        JobTrackerCalculations.recalculate();
        this.renderQueue();
        this.renderPayweek();
        this.renderHistory();
    },

    switchView(viewId) {
        this.state.currentView = viewId;
        
        // Update Nav UI
        this.dom.navItems.forEach(n => n.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[data-target="${viewId}"]`);
        if (activeNav) activeNav.classList.add('active');

        // Update Title
        if (activeNav) {
            this.dom.title.textContent = activeNav.querySelector('.label').textContent;
        }

        // Toggle Views
        this.dom.views.forEach(v => {
            v.classList.toggle('active', v.id === viewId);
        });

        // Refresh specific view if needed
        if (viewId === 'view-queue') this.renderQueue();
        if (viewId === 'view-payweek') this.renderPayweek();
    },

    // --- Rendering Logic ---

    renderQueue() {
        const scope = JobTrackerState.getScope() || [];
        
        // Apply filter
        let filtered = scope;
        if (this.state.statusFilter !== 'all') {
            if (this.state.statusFilter === 'active') {
                filtered = scope.filter(j => !['Complete', 'Paid', 'Archived'].includes(j.status));
            } else if (this.state.statusFilter === 'complete') {
                filtered = scope.filter(j => j.status === 'Complete');
            } else if (this.state.statusFilter === 'paid') {
                filtered = scope.filter(j => j.status === 'Paid');
            }
        }

        if (filtered.length === 0) {
            this.dom.queueList.innerHTML = `<div class="empty-state">No jobs found in this view.</div>`;
            return;
        }

        this.dom.queueList.innerHTML = filtered.map(job => this.createJobCardHTML(job)).join('');
        this.bindCardEvents(this.dom.queueList);
    },

    renderPayweek() {
        const stats = JobTrackerCalculations.stats || {};
        this.dom.statTotal.textContent = `£${(stats.totalWeekG || 0).toFixed(2)}`;
        this.dom.statCount.textContent = `${stats.numberOfJobsWeek || 0}`;

        const periods = JobTrackerCalculations.calculatedPeriods || [];
        const currentPeriodKey = JobTrackerCalculations.helpers.formatDate(JobTrackerCalculations.date);
        
        const currentPeriod = periods.find(p => p.mon === currentPeriodKey);
        
        if (!currentPeriod || !currentPeriod.jobs || currentPeriod.jobs.length === 0) {
            this.dom.payweekList.innerHTML = `<div class="empty-state">No jobs in the current payweek.</div>`;
            return;
        }

        this.dom.payweekList.innerHTML = currentPeriod.jobs.map(job => this.createJobCardHTML(job)).join('');
        this.bindCardEvents(this.dom.payweekList);
    },

    renderHistory() {
        const periods = JobTrackerCalculations.calculatedPeriods || [];
        if (periods.length <= 1) { // Assuming index 0 is current
            // Might have no history
        } else {
            // Future implementation for history list
        }
    },

    // --- Presentation Formats ---

    createJobCardHTML(job) {
        const title = job.address || job.name || 'Unnamed Job';
        const price = (job.price || 0).toFixed(2);
        
        let statusClass = 'status-active';
        if (job.status === 'Complete') statusClass = 'status-complete';
        if (job.status === 'Paid') statusClass = 'status-paid';

        // High density card layout
        return `
            <div class="job-card" data-id="${job.id}">
                <div class="job-address">${this.escapeStr(title)}</div>
                <div class="job-price">£${price}</div>
                <div class="job-details">
                    <span class="job-pill ${statusClass}">${job.status || 'Draft'}</span>
                    <span>${this.escapeStr(job.jobType || job.reference || '')}</span>
                </div>
                <div class="job-date">${this.formatShortDate(job.timestamp)}</div>
            </div>
        `;
    },

    bindCardEvents(container) {
        container.querySelectorAll('.job-card').forEach(card => {
            card.addEventListener('click', () => {
                const jobId = card.getAttribute('data-id');
                const title = card.querySelector('.job-address').textContent;
                this.openActionSheet(jobId, title);
            });
        });
    },

    // --- Action Sheet ---

    openActionSheet(jobId, title) {
        this.state.selectedJobId = jobId;
        this.dom.sheetJobTitle.textContent = title;
        this.dom.modalContainer.classList.remove('hidden');
    },

    closeActionSheet() {
        this.dom.modalContainer.classList.add('hidden');
        this.state.selectedJobId = null;
    },

    handleJobAction(action) {
        if (!this.state.selectedJobId) return;
        
        // This is where we'd bind to real app actions
        // e.g., JobTrackerJobs.editStatus(this.state.selectedJobId, 'Complete');
        
        alert(`Action: [${action}] on job ${this.state.selectedJobId}`);
        this.closeActionSheet();
    },

    // --- Utilities ---

    escapeStr(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[char] || char));
    },

    formatShortDate(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
};

// Application Boot
document.addEventListener('DOMContentLoaded', () => ModernUI.init());