import { JobTrackerState } from './js/state.js';
import { JobTrackerCalculations } from './js/calculations.js';
import { JobTrackerJobs } from './js/jobs.js';

/**
 * UI Lab - Modern Mobile-First Interface for JobTracker
 * Connects to main app modules for full functionality
 */
class UILab {
    constructor() {
        this.state = new JobTrackerState();
        this.calculations = new JobTrackerCalculations(this.state);
        this.jobs = new JobTrackerJobs(this.state, this.calculations);

        this.currentView = 'jobs';
        this.currentDate = new Date();
        this.selectedRange = 'week';
        this.batchMode = false;
        this.selectedJobs = new Set();

        this.init();
    }

    init() {
        this.bindElements();
        this.setupEventListeners();
        this.renderCurrentView();
        this.updateDateDisplay();
        this.setupBackgroundCanvas();
        this.startIdleAnimations();
    }

    startIdleAnimations() {
        // Add idle animations to elements
        this.addIdleAnimations();

        // Start periodic updates for dynamic animations
        setInterval(() => {
            this.updateDynamicAnimations();
        }, 1000);
    }

    addIdleAnimations() {
        // Add breathing animation to primary buttons
        document.querySelectorAll('.primary-btn').forEach(btn => {
            btn.classList.add('animate-breathe');
        });

        // Add floating animation to stat values
        document.querySelectorAll('.stat-value').forEach(stat => {
            stat.classList.add('animate-float');
        });

        // Add glow animation to active elements
        document.querySelectorAll('.nav-item.active').forEach(item => {
            item.classList.add('animate-glow');
        });
    }

    updateDynamicAnimations() {
        // Randomly trigger subtle animations on idle elements
        if (Math.random() < 0.1) { // 10% chance every second
            const cards = document.querySelectorAll('.job-card:not(:hover)');
            if (cards.length > 0) {
                const randomCard = cards[Math.floor(Math.random() * cards.length)];
                this.triggerMicroAnimation(randomCard);
            }
        }
    }

    triggerMicroAnimation(element) {
        element.style.animation = 'none';
        element.offsetHeight; // Trigger reflow
        element.style.animation = 'breathe 2s ease-in-out';
    }

    bindElements() {
        // Navigation
        this.header = document.querySelector('.app-header');
        this.dateNav = document.querySelector('.date-nav');
        this.bottomNav = document.querySelector('.bottom-nav');

        // Views
        this.views = {
            jobs: document.getElementById('jobs-view'),
            payweek: document.getElementById('payweek-view'),
            history: document.getElementById('history-view'),
            settings: document.getElementById('settings-view')
        };

        // Modals
        this.modalContainer = document.getElementById('modal-container');
        this.modals = {
            addJob: document.getElementById('add-job-modal'),
            editJob: document.getElementById('edit-job-modal'),
            quickStatus: document.getElementById('quick-status-modal'),
            deleteConfirm: document.getElementById('delete-confirm-modal')
        };

        // Batch mode
        this.batchBar = document.querySelector('.batch-bar');

        // Toast container
        this.toastContainer = document.getElementById('toast-container');
    }

    setupEventListeners() {
        // Navigation
        document.getElementById('prev-date').addEventListener('click', (e) => {
            this.triggerButtonAnimation(e.target);
            this.navigateDate(-1);
        });
        document.getElementById('next-date').addEventListener('click', (e) => {
            this.triggerButtonAnimation(e.target);
            this.navigateDate(1);
        });

        // Range selector
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.triggerButtonAnimation(e.target);
                this.setRange(e.target.dataset.range);
            });
        });

        // Bottom navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.triggerRippleAnimation(e);
                this.switchView(e.currentTarget.dataset.view);
            });
        });

        // Header actions
        document.getElementById('add-job-btn').addEventListener('click', (e) => {
            this.triggerButtonAnimation(e.target);
            this.showAddJobModal();
        });
        document.getElementById('batch-mode-btn').addEventListener('click', (e) => {
            this.triggerButtonAnimation(e.target);
            this.toggleBatchMode();
        });

        // Modal interactions
        this.setupModalListeners();

        // Settings
        this.setupSettingsListeners();

        // Enhanced interactions
        this.setupEnhancedInteractions();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    setupEnhancedInteractions() {
        // Job cards
        document.addEventListener('click', (e) => {
            const card = e.target.closest('.job-card');
            if (card && !e.target.closest('.job-actions')) {
                this.triggerCardClickAnimation(card);
            }
        });

        // Action buttons
        document.addEventListener('click', (e) => {
            if (e.target.matches('.action-btn, .primary-btn, .secondary-btn')) {
                this.triggerButtonAnimation(e.target);
            }
        });

        // Input focus/blur
        document.addEventListener('focusin', (e) => {
            if (e.target.matches('input, textarea, select')) {
                this.triggerInputFocusAnimation(e.target);
            }
        });

        document.addEventListener('focusout', (e) => {
            if (e.target.matches('input, textarea, select')) {
                this.triggerInputBlurAnimation(e.target);
            }
        });

        // Hover effects for enhanced feedback
        document.addEventListener('mouseenter', (e) => {
            if (e.target.matches('.job-card, .stat-card, .nav-item')) {
                this.triggerHoverAnimation(e.target);
            }
        });

        document.addEventListener('mouseleave', (e) => {
            if (e.target.matches('.job-card, .stat-card, .nav-item')) {
                this.triggerHoverEndAnimation(e.target);
            }
        });
    }

    // Animation trigger methods
    triggerRippleAnimation(e) {
        const element = e.currentTarget;
        const rect = element.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        element.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }

    triggerButtonAnimation(element) {
        element.classList.add('animate-bounce');
        setTimeout(() => element.classList.remove('animate-bounce'), 300);

        // React to button interactions
        if (this.backgroundSystem) {
            this.backgroundSystem.boostEnergy();
        }
    }

    triggerCardClickAnimation(card) {
        card.classList.add('animate-scale');
        setTimeout(() => card.classList.remove('animate-scale'), 200);

        // React to card interactions
        if (this.backgroundSystem) {
            this.backgroundSystem.addBurst(
                Math.random() * window.innerWidth,
                Math.random() * window.innerHeight * 0.6,
                0.3
            );
        }
    }

    triggerInputFocusAnimation(input) {
        input.parentElement.classList.add('input-focus');
    }

    triggerInputBlurAnimation(input) {
        input.parentElement.classList.remove('input-focus');
    }

    triggerHoverAnimation(element) {
        element.classList.add('animate-lift');
    }

    triggerHoverEndAnimation(element) {
        element.classList.remove('animate-lift');
    }

    triggerFormSubmitAnimation(form) {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.classList.add('animate-pulse');
            setTimeout(() => submitBtn.classList.remove('animate-pulse'), 500);
        }
    }

    triggerModalCloseAnimation() {
        const modal = document.querySelector('.modal-content');
        if (modal) {
            modal.classList.add('animate-slide-out');
        }
    }

    // Toast notification system
    showToast(message, type = 'success', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = this.getToastIcon(type);
        const messageSpan = document.createElement('span');
        messageSpan.className = 'toast-message';
        messageSpan.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '×';
        closeBtn.addEventListener('click', () => this.hideToast(toast));

        toast.appendChild(icon);
        toast.appendChild(messageSpan);
        toast.appendChild(closeBtn);

        this.toastContainer.appendChild(toast);

        // Auto-hide after duration
        setTimeout(() => this.hideToast(toast), duration);
    }

    getToastIcon(type) {
        const icon = document.createElement('span');
        icon.className = 'toast-icon';

        switch (type) {
            case 'success':
                icon.innerHTML = '✓';
                icon.style.color = 'var(--success)';
                break;
            case 'error':
                icon.innerHTML = '✕';
                icon.style.color = 'var(--danger)';
                break;
            case 'warning':
                icon.innerHTML = '⚠';
                icon.style.color = 'var(--warning)';
                break;
            default:
                icon.innerHTML = 'ℹ';
                icon.style.color = 'var(--accent-primary)';
        }

        return icon;
    }

    hideToast(toast) {
        toast.style.animation = 'fadeOut 0.3s ease-out forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    setupModalListeners() {
        // Close modals
        document.addEventListener('click', (e) => {
            if (e.target === this.modalContainer) {
                this.hideModal();
            }
        });

        // Form submissions
        document.getElementById('add-job-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addJob(new FormData(e.target));
        });

        document.getElementById('edit-job-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.editJob(new FormData(e.target));
        });

        // Status options
        document.querySelectorAll('.status-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const status = e.currentTarget.dataset.status;
                this.updateJobStatus(status);
            });
        });

        // Delete confirmation
        document.getElementById('confirm-delete-btn').addEventListener('click', () => {
            this.deleteSelectedJobs();
        });
    }

    setupSettingsListeners() {
        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('change', (e) => {
                this.setTheme(e.target.checked ? 'dark' : 'light');
            });
        }

        // Export data
        document.getElementById('export-data-btn').addEventListener('click', () => {
            this.exportData();
        });

        // Clear data
        document.getElementById('clear-data-btn').addEventListener('click', () => {
            this.showClearDataConfirm();
        });
    }

    // Navigation Methods
    switchView(viewName) {
        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        // Hide all views
        Object.values(this.views).forEach(view => view.classList.remove('active'));

        // Show selected view
        this.views[viewName].classList.add('active');
        this.currentView = viewName;

        // Render view content
        this.renderCurrentView();

        // Exit batch mode when switching views
        if (this.batchMode) {
            this.toggleBatchMode();
        }

        // React to navigation changes
        if (this.backgroundSystem) {
            this.backgroundSystem.reactToEvent('navigation');
        }
    }

    navigateDate(direction) {
        const increment = this.selectedRange === 'week' ? 7 :
                         this.selectedRange === 'month' ? 30 : 1;
        this.currentDate.setDate(this.currentDate.getDate() + (direction * increment));
        this.updateDateDisplay();
        this.renderCurrentView();
    }

    setRange(range) {
        this.selectedRange = range;
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === range);
        });
        this.updateDateDisplay();
        this.renderCurrentView();
    }

    updateDateDisplay() {
        const dateLabel = document.getElementById('date-label');
        const startDate = new Date(this.currentDate);

        let displayText;
        if (this.selectedRange === 'day') {
            displayText = startDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });
        } else if (this.selectedRange === 'week') {
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            displayText = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        } else { // month
            displayText = startDate.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric'
            });
        }

        dateLabel.textContent = displayText;
    }

    // View Rendering
    renderCurrentView() {
        switch (this.currentView) {
            case 'jobs':
                this.renderJobsView();
                break;
            case 'payweek':
                this.renderPayweekView();
                break;
            case 'history':
                this.renderHistoryView();
                break;
            case 'settings':
                this.renderSettingsView();
                break;
        }
    }

    renderJobsView() {
        const jobsList = document.querySelector('.jobs-list');
        const statsSummary = document.querySelector('.stats-summary');

        // Get jobs for current period
        const jobs = this.getJobsForPeriod();

        // Render stats
        this.renderStatsSummary(statsSummary);

        // Render jobs list
        jobsList.innerHTML = jobs.length ? jobs.map(job =>
            this.createJobCard(job)
        ).join('') : '<div class="empty-state">No jobs found for this period</div>';
    }

    renderPayweekView() {
        const payweekStats = document.querySelector('.payweek-stats');
        const calculations = this.calculations.getPayweekCalculations(this.currentDate);

        payweekStats.innerHTML = `
            <div class="stat-large">
                <div class="stat-value">$${calculations.totalEarnings.toFixed(2)}</div>
                <div class="stat-label">Total Earnings</div>
            </div>
            <div class="stat-large">
                <div class="stat-value">${calculations.completedJobs}</div>
                <div class="stat-label">Completed Jobs</div>
            </div>
        `;
    }

    renderHistoryView() {
        const historyList = document.querySelector('.history-list');
        const history = this.getJobHistory();

        historyList.innerHTML = history.length ? history.map(period =>
            this.createHistoryItem(period)
        ).join('') : '<div class="empty-state">No job history available</div>';
    }

    renderSettingsView() {
        // Settings are mostly static, but we can update dynamic values here
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.checked = document.body.classList.contains('dark-theme');
        }
    }

    renderStatsSummary(container) {
        const stats = this.calculations.getPeriodStats(this.currentDate, this.selectedRange);

        container.innerHTML = `
            <div class="stat-card">
                <div class="stat-value">${stats.totalJobs}</div>
                <div class="stat-label">Total Jobs</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.completedJobs}</div>
                <div class="stat-label">Completed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">$${stats.totalEarnings.toFixed(2)}</div>
                <div class="stat-label">Earnings</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">$${stats.averageJob.toFixed(2)}</div>
                <div class="stat-label">Average</div>
            </div>
        `;
    }

    // Job Management
    getJobsForPeriod() {
        return this.jobs.getJobsInPeriod(this.currentDate, this.selectedRange);
    }

    createJobCard(job) {
        const statusClass = this.getStatusClass(job.status);
        const statusIcon = this.getStatusIcon(job.status);

        return `
            <div class="job-card" data-job-id="${job.id}" ${this.batchMode ? 'data-batch-selectable="true"' : ''}>
                <div class="job-icon ${statusClass}">${statusIcon}</div>
                <div class="job-content">
                    <div class="job-title">${this.escapeHtml(job.address || 'No Address')}</div>
                    <div class="job-meta">
                        <span>${job.date ? new Date(job.date).toLocaleDateString() : 'No Date'}</span>
                        <span>${job.time || 'No Time'}</span>
                        ${job.notes ? `<span>📝</span>` : ''}
                    </div>
                </div>
                <div class="job-price">$${job.price ? job.price.toFixed(2) : '0.00'}</div>
            </div>
        `;
    }

    createHistoryItem(period) {
        return `
            <div class="history-item">
                <div class="history-period">${period.period}</div>
                <div class="history-stats">
                    <span>${period.jobs} jobs</span>
                    <span>$${period.earnings.toFixed(2)}</span>
                    <span>${period.avgJob.toFixed(2)} avg</span>
                </div>
            </div>
        `;
    }

    // Modal Management
    showModal(modalType, data = {}) {
        // Hide all modals
        Object.values(this.modals).forEach(modal => modal.classList.add('hidden'));

        // Show selected modal
        const modal = this.modals[modalType];
        if (modal) {
            modal.classList.remove('hidden');
            this.modalContainer.classList.remove('hidden');

            // Populate modal data
            this.populateModal(modalType, data);
        }
    }

    hideModal() {
        this.modalContainer.classList.add('hidden');
        // Clear forms
        document.querySelectorAll('.modal form').forEach(form => form.reset());
    }

    populateModal(modalType, data) {
        switch (modalType) {
            case 'editJob':
                const form = document.getElementById('edit-job-form');
                form.jobId.value = data.id;
                form.address.value = data.address || '';
                form.price.value = data.price || '';
                form.date.value = data.date || '';
                form.time.value = data.time || '';
                form.notes.value = data.notes || '';
                break;
        }
    }

    showAddJobModal() {
        this.showModal('addJob');
    }

    showEditJobModal(jobId) {
        const job = this.jobs.getJob(jobId);
        if (job) {
            this.showModal('editJob', job);
        }
    }

    showQuickStatusModal(jobId) {
        this.currentJobId = jobId;
        this.showModal('quickStatus');
    }

    // Job Operations
    addJob(formData) {
        const jobData = {
            address: formData.get('address'),
            price: parseFloat(formData.get('price')) || 0,
            date: formData.get('date'),
            time: formData.get('time'),
            notes: formData.get('notes'),
            status: 'pending'
        };

        if (this.jobs.addJob(jobData)) {
            this.hideModal();
            this.renderCurrentView();
            this.showToast('Job added successfully', 'success');

            // React to job addition
            if (this.backgroundSystem) {
                this.backgroundSystem.reactToEvent('jobAdded');
            }
        } else {
            this.showToast('Failed to add job', 'error');
        }
    }

    editJob(formData) {
        const jobId = formData.get('jobId');
        const jobData = {
            address: formData.get('address'),
            price: parseFloat(formData.get('price')) || 0,
            date: formData.get('date'),
            time: formData.get('time'),
            notes: formData.get('notes')
        };

        if (this.jobs.updateJob(jobId, jobData)) {
            this.hideModal();
            this.renderCurrentView();
            this.showToast('Job updated successfully', 'success');
        } else {
            this.showToast('Failed to update job', 'error');
        }
    }

    updateJobStatus(status) {
        if (this.currentJobId) {
            if (this.jobs.updateJobStatus(this.currentJobId, status)) {
                this.hideModal();
                this.renderCurrentView();
                this.showToast(`Job marked as ${status}`, 'success');
            } else {
                this.showToast('Failed to update job status', 'error');
            }
        }
    }

    deleteSelectedJobs() {
        const jobIds = Array.from(this.selectedJobs);
        let successCount = 0;

        jobIds.forEach(jobId => {
            if (this.jobs.deleteJob(jobId)) {
                successCount++;
            }
        });

        this.hideModal();
        this.toggleBatchMode(); // Exit batch mode
        this.renderCurrentView();

        if (successCount > 0) {
            this.showToast(`${successCount} job(s) deleted`, 'success');
        } else {
            this.showToast('Failed to delete jobs', 'error');
        }
    }

    // Batch Mode
    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        this.selectedJobs.clear();

        const batchBtn = document.getElementById('batch-mode-btn');
        batchBtn.textContent = this.batchMode ? 'Cancel' : 'Select';

        this.batchBar.classList.toggle('hidden', !this.batchMode);
        this.updateBatchUI();

        // Re-render jobs view to show selection state
        if (this.currentView === 'jobs') {
            this.renderJobsView();
        }

        // React to batch mode toggle
        if (this.backgroundSystem) {
            this.backgroundSystem.reactToEvent('batchMode');
        }
    }

    updateBatchUI() {
        const count = this.selectedJobs.size;
        document.getElementById('batch-count').textContent = `${count} selected`;

        // Enable/disable action buttons
        document.querySelectorAll('.batch-btn').forEach(btn => {
            btn.disabled = count === 0;
        });
    }

    // Utility Methods
    getStatusClass(status) {
        const classes = {
            completed: 'completed',
            pending: 'pending',
            failed: 'failed',
            internals: 'internals'
        };
        return classes[status] || 'pending';
    }

    getStatusIcon(status) {
        const icons = {
            completed: '✓',
            pending: '⏳',
            failed: '✗',
            internals: '🏠'
        };
        return icons[status] || '⏳';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        this.toastContainer.appendChild(toast);

        // Auto remove after 3 seconds
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    handleKeyboard(e) {
        // Escape key closes modals
        if (e.key === 'Escape') {
            this.hideModal();
        }

        // Ctrl/Cmd + A in batch mode selects all
        if (this.batchMode && (e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            this.selectAllJobs();
        }
    }

    selectAllJobs() {
        const jobCards = document.querySelectorAll('.job-card[data-batch-selectable]');
        jobCards.forEach(card => {
            const jobId = card.dataset.jobId;
            this.selectedJobs.add(jobId);
            card.classList.add('batch-selected');
        });
        this.updateBatchUI();
    }

    // Settings Methods
    setTheme(theme) {
        document.body.classList.toggle('dark-theme', theme === 'dark');
        localStorage.setItem('ui-lab-theme', theme);
    }

    exportData() {
        const data = {
            jobs: this.state.getAllJobs(),
            settings: this.state.getSettings(),
            exportDate: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `jobtracker-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();

        URL.revokeObjectURL(url);
        this.showToast('Data exported successfully', 'success');
    }

    showClearDataConfirm() {
        if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            this.state.clearAllData();
            this.renderCurrentView();
            this.showToast('All data cleared', 'success');
        }
    }

    // Advanced Procedural Background Animation
    setupBackgroundCanvas() {
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let animationId;
        let mouseX = 0;
        let mouseY = 0;
        let lastInteraction = Date.now();
        let interactionIntensity = 0;

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };

        // Particle system with multiple types
        class Particle {
            constructor(x, y, type = 'normal') {
                this.x = x || Math.random() * canvas.width;
                this.y = y || Math.random() * canvas.height;
                this.type = type;
                this.baseX = this.x;
                this.baseY = this.y;
                this.size = Math.random() * 3 + 1;
                this.speedX = (Math.random() - 0.5) * 0.5;
                this.speedY = (Math.random() - 0.5) * 0.5;
                this.opacity = Math.random() * 0.6 + 0.2;
                this.hue = Math.random() * 60 + 200; // Blue to cyan range
                this.saturation = 70 + Math.random() * 30;
                this.lightness = 50 + Math.random() * 20;
                this.energy = Math.random();
                this.connections = [];
                this.trail = [];
                this.maxTrailLength = 10;
                this.lastUpdate = Date.now();
            }

            update(mouseX, mouseY, interactionIntensity) {
                const now = Date.now();
                const deltaTime = (now - this.lastUpdate) / 16.67; // Normalize to ~60fps
                this.lastUpdate = now;

                // Mouse attraction/repulsion based on particle type
                const dx = mouseX - this.x;
                const dy = mouseY - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const maxDistance = 150;

                if (distance < maxDistance) {
                    const force = (maxDistance - distance) / maxDistance;
                    const angle = Math.atan2(dy, dx);

                    if (this.type === 'attractor') {
                        // Attract to mouse
                        this.speedX += Math.cos(angle) * force * 0.02 * deltaTime;
                        this.speedY += Math.sin(angle) * force * 0.02 * deltaTime;
                    } else if (this.type === 'repulsor') {
                        // Repulse from mouse
                        this.speedX -= Math.cos(angle) * force * 0.03 * deltaTime;
                        this.speedY -= Math.sin(angle) * force * 0.03 * deltaTime;
                    }

                    // Boost energy when near mouse
                    this.energy = Math.min(1, this.energy + force * 0.1);
                }

                // Interaction intensity affects all particles
                this.energy = Math.min(1, this.energy + interactionIntensity * 0.05);

                // Apply speed with damping
                this.x += this.speedX * deltaTime;
                this.y += this.speedY * deltaTime;

                this.speedX *= 0.98;
                this.speedY *= 0.98;

                // Boundary wrapping with energy boost
                if (this.x < 0) {
                    this.x = canvas.width;
                    this.energy += 0.1;
                }
                if (this.x > canvas.width) {
                    this.x = 0;
                    this.energy += 0.1;
                }
                if (this.y < 0) {
                    this.y = canvas.height;
                    this.energy += 0.1;
                }
                if (this.y > canvas.height) {
                    this.y = 0;
                    this.energy += 0.1;
                }

                // Update trail
                this.trail.push({ x: this.x, y: this.y, opacity: this.opacity });
                if (this.trail.length > this.maxTrailLength) {
                    this.trail.shift();
                }

                // Procedural color evolution
                this.hue += (Math.sin(now * 0.001 + this.energy * 10) * 0.5 + 0.5) * 0.1;
                this.saturation = 70 + Math.sin(now * 0.002 + this.energy * 5) * 20;
                this.lightness = 50 + Math.sin(now * 0.0015 + this.energy * 8) * 15;

                // Energy decay
                this.energy *= 0.995;
            }

            draw(ctx) {
                // Draw trail
                ctx.strokeStyle = `hsla(${this.hue}, ${this.saturation}%, ${this.lightness}%, 0.1)`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = 1; i < this.trail.length; i++) {
                    const point = this.trail[i];
                    const prevPoint = this.trail[i - 1];
                    ctx.moveTo(prevPoint.x, prevPoint.y);
                    ctx.lineTo(point.x, point.y);
                }
                ctx.stroke();

                // Draw particle with energy-based effects
                const energySize = this.size * (1 + this.energy * 0.5);
                const energyOpacity = this.opacity * (0.5 + this.energy * 0.5);

                // Outer glow
                if (this.energy > 0.3) {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, energySize * 2, 0, Math.PI * 2);
                    ctx.fillStyle = `hsla(${this.hue}, ${this.saturation}%, ${this.lightness}%, ${energyOpacity * 0.1})`;
                    ctx.fill();
                }

                // Main particle
                ctx.beginPath();
                ctx.arc(this.x, this.y, energySize, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${this.hue}, ${this.saturation}%, ${this.lightness}%, ${energyOpacity})`;
                ctx.fill();

                // Inner core for high energy particles
                if (this.energy > 0.7) {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, energySize * 0.3, 0, Math.PI * 2);
                    ctx.fillStyle = `hsla(${this.hue + 30}, 100%, 80%, ${energyOpacity * 0.8})`;
                    ctx.fill();
                }
            }
        }

        // Connection lines between nearby particles
        class Connection {
            constructor(p1, p2) {
                this.p1 = p1;
                this.p2 = p2;
                this.distance = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
                this.maxDistance = 120;
                this.opacity = 0;
            }

            update() {
                this.distance = Math.sqrt((this.p1.x - this.p2.x) ** 2 + (this.p1.y - this.p2.y) ** 2);
                this.opacity = Math.max(0, 1 - this.distance / this.maxDistance) * 0.3;
            }

            draw(ctx) {
                if (this.opacity > 0.01) {
                    ctx.strokeStyle = `hsla(${(this.p1.hue + this.p2.hue) / 2}, 60%, 60%, ${this.opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.beginPath();
                    ctx.moveTo(this.p1.x, this.p1.y);
                    ctx.lineTo(this.p2.x, this.p2.y);
                    ctx.stroke();
                }
            }
        }

        // Reactive burst effect
        class Burst {
            constructor(x, y, intensity = 1) {
                this.x = x;
                this.y = y;
                this.intensity = intensity;
                this.particles = [];
                this.lifetime = 60; // frames
                this.age = 0;

                // Create burst particles
                for (let i = 0; i < 8 + intensity * 12; i++) {
                    const angle = (Math.PI * 2 * i) / (8 + intensity * 12);
                    const speed = 2 + Math.random() * 3 * intensity;
                    const particle = new Particle(x, y, 'burst');
                    particle.speedX = Math.cos(angle) * speed;
                    particle.speedY = Math.sin(angle) * speed;
                    particle.energy = 0.8 + Math.random() * 0.2;
                    particle.size = 1 + Math.random() * 2;
                    this.particles.push(particle);
                }
            }

            update() {
                this.age++;
                this.particles.forEach(p => {
                    p.speedX *= 0.95;
                    p.speedY *= 0.95;
                    p.energy *= 0.98;
                    p.update(this.x, this.y, 0);
                });
                return this.age < this.lifetime;
            }

            draw(ctx) {
                this.particles.forEach(p => p.draw(ctx));
            }
        }

        const particles = [];
        const connections = [];
        const bursts = [];
        const particleCount = 40;

        const initParticles = () => {
            particles.length = 0;
            for (let i = 0; i < particleCount; i++) {
                const type = Math.random() < 0.1 ? 'attractor' :
                           Math.random() < 0.1 ? 'repulsor' : 'normal';
                particles.push(new Particle(null, null, type));
            }
        };

        const updateConnections = () => {
            connections.length = 0;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const p1 = particles[i];
                    const p2 = particles[j];
                    const distance = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
                    if (distance < 120) {
                        connections.push(new Connection(p1, p2));
                    }
                }
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Update interaction intensity decay
            interactionIntensity *= 0.95;

            // Update particles
            particles.forEach(particle => {
                particle.update(mouseX, mouseY, interactionIntensity);
            });

            // Update connections
            updateConnections();
            connections.forEach(connection => connection.update());

            // Update bursts
            bursts.forEach((burst, index) => {
                if (!burst.update()) {
                    bursts.splice(index, 1);
                }
            });

            // Draw connections first (behind particles)
            connections.forEach(connection => connection.draw(ctx));

            // Draw particles
            particles.forEach(particle => particle.draw(ctx));

            // Draw bursts
            bursts.forEach(burst => burst.draw(ctx));

            animationId = requestAnimationFrame(animate);
        };

        // Mouse/touch tracking
        const updateMousePosition = (e) => {
            const rect = canvas.getBoundingClientRect();
            mouseX = e.clientX - rect.left;
            mouseY = e.clientY - rect.top;
            interactionIntensity = Math.min(1, interactionIntensity + 0.3);
            lastInteraction = Date.now();
        };

        canvas.addEventListener('mousemove', updateMousePosition);
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            updateMousePosition(touch);
        });

        // Click/tap reactions
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            bursts.push(new Burst(x, y, 0.5 + Math.random() * 0.5));
            interactionIntensity = Math.min(1, interactionIntensity + 0.5);
        });

        // React to app interactions
        this.reactToAppEvents = (eventType, data) => {
            switch (eventType) {
                case 'jobAdded':
                    bursts.push(new Burst(canvas.width / 2, canvas.height / 2, 0.8));
                    interactionIntensity = Math.min(1, interactionIntensity + 0.4);
                    break;
                case 'navigation':
                    // Create wave of energy across particles
                    particles.forEach(p => p.energy = Math.min(1, p.energy + 0.3));
                    break;
                case 'batchMode':
                    // Create intense burst in bottom area
                    bursts.push(new Burst(canvas.width / 2, canvas.height * 0.8, 1));
                    interactionIntensity = Math.min(1, interactionIntensity + 0.6);
                    break;
            }
        };

        resizeCanvas();
        initParticles();
        animate();

        window.addEventListener('resize', () => {
            resizeCanvas();
            initParticles();
        });

        // Store reference for app event reactions
        this.backgroundSystem = {
            reactToEvent: this.reactToAppEvents,
            addBurst: (x, y, intensity) => bursts.push(new Burst(x, y, intensity)),
            boostEnergy: () => particles.forEach(p => p.energy = Math.min(1, p.energy + 0.2))
        };
    }

    // Data Methods
    getJobHistory() {
        // This would integrate with the main app's history functionality
        // For now, return mock data
        return [
            { period: 'This Week', jobs: 12, earnings: 480.00, avgJob: 40.00 },
            { period: 'Last Week', jobs: 15, earnings: 525.00, avgJob: 35.00 },
            { period: 'This Month', jobs: 45, earnings: 1620.00, avgJob: 36.00 }
        ];
    }
}

// Initialize the UI Lab when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.uiLab = new UILab();
});

// Handle job card clicks (delegated)
document.addEventListener('click', (e) => {
    const jobCard = e.target.closest('.job-card');
    if (!jobCard) return;

    const jobId = jobCard.dataset.jobId;

    if (window.uiLab.batchMode) {
        // Batch selection
        if (window.uiLab.selectedJobs.has(jobId)) {
            window.uiLab.selectedJobs.delete(jobId);
            jobCard.classList.remove('batch-selected');
        } else {
            window.uiLab.selectedJobs.add(jobId);
            jobCard.classList.add('batch-selected');
        }
        window.uiLab.updateBatchUI();
    } else {
        // Quick status modal
        window.uiLab.showQuickStatusModal(jobId);
    }
});

// Handle batch actions
document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('batch-btn')) return;

    const action = e.target.dataset.action;
    const jobIds = Array.from(window.uiLab.selectedJobs);

    switch (action) {
        case 'status':
            // Apply status to all selected jobs
            const status = e.target.dataset.status;
            jobIds.forEach(jobId => {
                window.uiLab.jobs.updateJobStatus(jobId, status);
            });
            window.uiLab.showToast(`${jobIds.length} jobs updated`, 'success');
            break;

        case 'delete':
            window.uiLab.showModal('deleteConfirm');
            return; // Don't exit batch mode yet

        case 'cancel':
            window.uiLab.toggleBatchMode();
            return;
    }

    window.uiLab.toggleBatchMode();
    window.uiLab.renderCurrentView();
});