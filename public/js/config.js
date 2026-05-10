/**
 * База URL для API (`/api/status`, `/api/history`):
 * — Один origin с Worker: оставьте '' (относительные запросы).
 * — Только статика (GitHub Pages, `npm run preview:static`): укажите URL Worker без слэша в конце.
 */
export const WORKER_API_ORIGIN = '';

export const LANG_KEY = 'lang';

/** Значение: '15' | '30' | '60' | 'off' */
export const POLL_STORAGE_KEY = 'poll';

export const DEFAULT_POLL_CHOICE = '15';

const POLL_MS = {
    '15': 15_000,
    '30': 30_000,
    '60': 60_000,
};

export const HISTORY_ROWS = 100;

/** Если ширина контейнера ещё не известна (0), ограничение по числу ячеек активности. */
export const ACTIVITY_FALLBACK_MAX_CELLS = 48;

/**
 * Как долго не запрашивать `/api/history` повторно (меньше обращений к API и D1).
 * История почасовая — раз в несколько десятков минут достаточно; «живой» статус идёт через `/api/status` каждый тик polling.
 * Дополнительно срабатывает выровненный по UTC часу таймер (`polling.js`).
 */
export const HISTORY_CACHE_TTL_MS = 45 * 60 * 1000;

/**
 * Запрос истории через столько миллисекунд после начала календарного UTC-часа (буфер под минутный cron и финализацию часа в Worker).
 */
export const HISTORY_REFRESH_AFTER_UTC_HOUR_MS = 90_000;

export function apiUrl(path) {
    return `${WORKER_API_ORIGIN || ''}${path}`;
}

/** @param {string | null | undefined} raw */
export function normalizePollChoice(raw) {
    if (raw === '15' || raw === '30' || raw === '60' || raw === 'off') {
        return raw;
    }

    return DEFAULT_POLL_CHOICE;
}

export function readStoredPollChoice() {
    try {
        const v = localStorage.getItem(POLL_STORAGE_KEY);

        return normalizePollChoice(v ?? DEFAULT_POLL_CHOICE);
    } catch {
        return DEFAULT_POLL_CHOICE;
    }
}

/** @returns {'en' | 'ru' | null} */
export function readStoredLangChoice() {
    try {
        const v = localStorage.getItem(LANG_KEY);

        if (v === 'en' || v === 'ru') {
            return v;
        }
    } catch {
        /* ignore */
    }

    return null;
}

/** Интервал для активной вкладки: миллисекунды или `null`, если автообновление выключено. */
export function getActivePollIntervalMs() {
    const c = readStoredPollChoice();

    if (c === 'off') {
        return null;
    }

    return POLL_MS[c];
}
