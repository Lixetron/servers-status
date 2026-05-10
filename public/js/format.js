import {getLang} from './i18n.js';

export function esc(s) {
    const d = document.createElement('div');

    d.textContent = s;

    return d.innerHTML;
}

function dateTimeLocale() {
    return getLang() === 'ru'
        ? 'ru-RU'
        : 'en-US';
}

/** ISO из API → локальное время и локаль интерфейса. */
export function formatLocalDateTime(iso) {
    if (!iso) {
        return '';
    }

    const d = new Date(iso);

    if (isNaN(d.getTime())) {
        return String(iso);
    }

    try {
        return new Intl.DateTimeFormat(dateTimeLocale(), {
            dateStyle: 'medium',
            timeStyle: 'medium',
        }).format(d);
    } catch {
        return d.toLocaleString(dateTimeLocale());
    }
}

/** Доля 0–100 → строка процента в локали интерфейса (например `98,5 %`). */
export function formatAvailabilityPercent(value0to100) {
    const v = Number(value0to100);

    if (!Number.isFinite(v)) {
        return '';
    }

    const clamped = Math.min(100, Math.max(0, v));

    try {
        return new Intl.NumberFormat(dateTimeLocale(), {
            style: 'percent',
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        }).format(clamped / 100);
    } catch {
        return `${(Math.round(clamped * 10) / 10).toFixed(1)}%`;
    }
}
