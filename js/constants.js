/**
 * Application Constants
 * Centralized constants to avoid magic numbers and strings
 */

export const JobTrackerConstants = {
    // Status constants
    STATUS: {
        COMPLETED: 'Completed',
        PENDING: 'Pending',
        FAILED: 'Failed',
        INTERNALS: 'Internals'
    },

    // Animation durations (ms)
    ANIMATION: {
        DURATION: 300,
        SLOW: 350,
        FAST: 200,
        DEBOUNCE: 300
    },

    // UI limits
    LIMITS: {
        MAX_SEARCH_RESULTS: 20,
        MAX_NOTES_PREVIEW: 100
    },

    // Saturday premium multiplier
    SATURDAY_MULTIPLIER: 1.5,

    // Default job types
    DEFAULT_TYPES: {
        OH: { pay: 44, int: 21, countTowardsCompletion: true, isUpgradeType: false },
        UG: { pay: 44, int: 21, countTowardsCompletion: true, isUpgradeType: false },
        HyOH: { pay: 55, int: 21, countTowardsCompletion: true, isUpgradeType: false },
        HyUG: { pay: 55, int: 21, countTowardsCompletion: true, isUpgradeType: false },
        Step1: { pay: 29, int: null, countTowardsCompletion: true, isUpgradeType: false },
        BTTW: { pay: 21, int: null, countTowardsCompletion: true, isUpgradeType: true },
        MDU: { pay: 32, int: null, countTowardsCompletion: true, isUpgradeType: false },
        RC: { pay: 20, int: null, countTowardsCompletion: true, isUpgradeType: false }
    },

    // Weekly bonus and points rules
    BONUS_WEEKLY_COMPLETED_TARGET: 18,
    POINTS_WEEKLY_TARGET: 20,
    INTERNAL_POINTS: 0.5,
    POINTS_BY_TYPE: {
        HYUG: 1.4,
        HYOH: 1.3,
        UG: 1,
        OH: 1,
        STEP1: 0.9,
        BTTW: 0.6,
        MDU: 0.8,
        RC: 0.4
    },

    // Note templates
    NOTE_TEMPLATES: {
        'Cable Fault': 'Issue: [Describe the cable fault]\nLocation: [Cable location/route]\nResolution: [How the issue was resolved]\nTime: [Duration of repair]',
        'New Install': 'Type: [Type of installation]\nLocation: [Installation site]\nEquipment: [Equipment used]\nCompletion: [Installation status]',
        'Maintenance': 'Task: [Maintenance activity performed]\nEquipment: [Equipment serviced]\nFindings: [Any issues found]\nRecommendations: [Future maintenance needs]',
        'Emergency': 'Urgency: [Level of emergency]\nIssue: [Emergency description]\nResponse: [Immediate actions taken]\nResolution: [Final outcome]',
        'Custom': ''
    },

    // Date format options
    DATE_FORMAT: {
        SHORT: { day: 'numeric', month: 'short', year: '2-digit' },
        LONG: { day: 'numeric', month: 'short', year: 'numeric' },
        MONTH_YEAR: { month: 'long', year: 'numeric' }
    },

    // Color schemes
    COLORS: {
        PRIMARY: '#58a6ff',
        SUCCESS: '#3fb950',
        WARNING: '#d29922',
        DANGER: '#f85149'
    },

    // View ranges
    RANGES: {
        DAY: 'day',
        WEEK: 'week',
        MONTH: 'month',
        YEAR: 'year'
    },

    // LocalStorage keys (for backward compatibility)
    LS_KEYS: {
        JOBS: 'nx_jobs',
        TYPES: 'nx_types',
        THEME: 'nx_theme',
        ACCENT: 'nx_accent',
        ACCENT_DARK: 'nx_accent_dark',
        ACCENT_LIGHT: 'nx_accent_light',
        GRADIENT: 'nx_gradient',
        TARGET: 'nx_target',
        TAX: 'nx_tax',
        GOAL: 'nx_goal',
        BESTS: 'nx_bests',
        EXPENSES: 'nx_expenses',
        BG_ANIM: 'nx_bg_anim',
        NOTIF: 'nx_notif',
        WAKELOCK: 'nx_wakelock',
        PANEL_ORDER: 'nx_panel_order',
        JOB_ORDER: 'nx_job_order',
        MIGRATED: 'nx_migrated_to_db'
    }
};
