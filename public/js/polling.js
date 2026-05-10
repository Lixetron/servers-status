import {
    getActivePollIntervalMs,
    normalizePollChoice,
    POLL_STORAGE_KEY,
    readStoredPollChoice,
} from './config.js';
import {t} from './i18n.js';

let pollTimer = null;
/** @type {(() => Promise<void>) | null} */
let pollingLoadFn = null;

function effectivePollIntervalMs() {
    const base = getActivePollIntervalMs();

    if (base === null) {
        return null;
    }

    if (typeof document !== 'undefined' && document.hidden) {
        return Math.max(base * 2, 60_000);
    }

    return base;
}

function armTimer() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);

        pollTimer = null;
    }

    const ms = effectivePollIntervalMs();

    if (ms === null || pollingLoadFn === null) {
        return;
    }

    pollTimer = window.setInterval(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return;
        }

        void pollingLoadFn();
    }, ms);
}

export function updateLiveLabel() {
    const el = document.getElementById('live-label');
    const bar = document.getElementById('live-bar');

    if (!el || !bar) {
        return;
    }

    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const paused = !offline && readStoredPollChoice() === 'off';

    bar.classList.toggle('live-bar--offline', offline);
    bar.classList.toggle('live-bar--paused', paused);

    if (offline) {
        el.textContent = t('liveOffline');
    } else if (paused) {
        el.textContent = t('liveUpdatesOff');
    } else {
        const ms = getActivePollIntervalMs();

        el.textContent = t('liveUpdates').replace(
            '{seconds}',
            String(ms !== null ? Math.round(ms / 1000) : ''),
        );
    }
}

export function syncPollSelectFromStorage() {
    const sel = document.getElementById('poll-select');

    if (sel) {
        sel.value = readStoredPollChoice();
    }
}

/** @param {string} value */
export function setPollIntervalChoice(value) {
    const v = normalizePollChoice(value);

    try {
        localStorage.setItem(POLL_STORAGE_KEY, v);
    } catch {
        /* ignore */
    }

    syncPollSelectFromStorage();
    armTimer();
    updateLiveLabel();
}

export function startLivePolling(loadFn) {
    pollingLoadFn = loadFn;

    function tickGuard() {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return;
        }

        void loadFn();
    }

    document.addEventListener('visibilitychange', () => {
        armTimer();

        if (!document.hidden && navigator.onLine !== false) {
            void loadFn();
        }
    });

    window.addEventListener('online', () => {
        updateLiveLabel();

        void loadFn();

        armTimer();
    });

    window.addEventListener('offline', () => {
        updateLiveLabel();
    });

    document.addEventListener('servers-status:refresh', () => {
        const dot = document.querySelector('.live-dot');

        if (!dot) {
            return;
        }

        dot.classList.remove('live-dot--flash');

        void dot.offsetWidth;

        dot.classList.add('live-dot--flash');

        const onEnd = () => {
            dot.removeEventListener('animationend', onEnd);

            dot.classList.remove('live-dot--flash');
        };

        dot.addEventListener('animationend', onEnd);
    });

    syncPollSelectFromStorage();

    updateLiveLabel();

    armTimer();
}
