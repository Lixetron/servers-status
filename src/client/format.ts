import { getLang } from './i18n';

export function esc(s: string): string {
    const d = document.createElement('div');

    d.textContent = s;

    return d.innerHTML;
}

function dateTimeLocale(): string {
    return getLang() === 'ru'
        ? 'ru-RU'
        : 'en-US';
}

/** ISO из API → локальное время и локаль интерфейса. */
export function formatLocalDateTime(iso: string): string {
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

/** Интервалы простоя для подсказки: каждая строка «с … по …». */
export function formatOutageRangesTitle(outages: [string, string][]): string {
    if (!Array.isArray(outages) || outages.length === 0) {
        return '';
    }

    const lines: string[] = [];

    for (let i = 0; i < outages.length; i++) {
        const a = outages[i][0];
        const b = outages[i][1];

        lines.push(`${formatLocalDateTime(a)} — ${formatLocalDateTime(b)}`);
    }

    return lines.join('\n');
}

/** Доля 0–100 → строка процента в локали интерфейса (например `98,5 %`). */
export function formatAvailabilityPercent(value0to100: number): string {
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
