/**
 * Расшифровка значения сервиса в строке истории API:
 * строка up|down (старый и простой час) или объект mixed с интервалами простоя.
 *
 * @param {unknown} raw
 * @returns {{kind: 'up'} | {kind: 'down'} | {kind: 'mixed'; outages: [string, string][]} | {kind: 'unknown'}}
 */
export function parseHistoryServiceStatus(raw) {
    if (raw === 'up') {
        return {kind: 'up'};
    }

    if (raw === 'down') {
        return {kind: 'down'};
    }

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = /** @type {{status?: unknown; outages?: unknown}} */ (raw);

        if (o.status === 'mixed' && Array.isArray(o.outages)) {
            /** @type {[string, string][]} */
            const outages = [];

            for (let i = 0; i < o.outages.length; i++) {
                const seg = o.outages[i];

                if (Array.isArray(seg) && seg.length >= 2) {
                    outages.push([String(seg[0]), String(seg[1])]);
                }
            }

            return {kind: 'mixed', outages};
        }
    }

    return {kind: 'unknown'};
}

/**
 * Доля времени внутри часа (по метке часа из строки истории), когда сервис был недоступен.
 *
 * @param {string} hourStartIso — начало часа в истории (UTC).
 * @param {[string, string][]} outages
 */
export function downtimeFractionInHour(hourStartIso, outages) {
    const h0 = new Date(hourStartIso).getTime();

    if (Number.isNaN(h0)) {
        return 0;
    }

    const hourMs = 3600000;
    const hEnd = h0 + hourMs;
    let downMs = 0;

    for (let i = 0; i < outages.length; i++) {
        const a = new Date(outages[i][0]).getTime();
        const b = new Date(outages[i][1]).getTime();

        if (Number.isNaN(a) || Number.isNaN(b)) {
            continue;
        }

        const start = Math.max(a, h0);
        const end = Math.min(b, hEnd - 1);

        if (end < start) {
            continue;
        }

        const span = end >= start ? end - start + 60000 : 60000;

        downMs += span;
    }

    return Math.min(1, downMs / hourMs);
}
