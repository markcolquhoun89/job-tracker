/**
 * Application Constants
 * Centralized constants to avoid magic numbers and strings
 */

window.JobTrackerConstants = {
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
        OH: { pay: 44, int: 21 },
        UG: { pay: 42, int: 21 },
        HyOH: { pay: 55, int: 21 },
        HyUG: { pay: 55, int: 21 },
        RC: { pay: 20, int: null },
        BTTW: { pay: 20, int: null }
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
