import type { HistoryEntry } from '../shared';
import { orderedHistoryRowServiceNames, renderActivityBoard } from './activity';
import { apiUrl, HISTORY_CACHE_TTL_MS, HISTORY_FULL_RESYNC_MS, HISTORY_ROWS } from './config';
import { formatAvailabilityPercent, formatLocalDateTime, formatOutageRangesTitle } from './format';
import { downtimeFractionInHour, parseHistoryServiceStatus } from './historyStatus';
import { t } from './i18n';

/** Ответ `/api/status` (поля сервисов — в основном `up` | `down`). */
interface StatusApiResponse {
    updated: string | null;
    services: Record<string, string>;
}

export interface LoadAllOptions {
    refreshHistory?: boolean;
    historyRefresh?: 'full' | 'incremental';
}

let historyCache: HistoryEntry[] | null = null;
let historyCacheAt: number | null = null;
/** Время успешной полной загрузки `/api/history` (для инкрементальных delta-запросов). */
let lastHistoryFullFetchAt: number | null = null;

function mergeHistoryDelta(base: HistoryEntry[], delta: HistoryEntry[]): HistoryEntry[] {
    const map = new Map<string, HistoryEntry>();

    for (let i = 0; i < delta.length; i++) {
        const r = delta[i];

        if (r?.time) {
            map.set(String(r.time), r);
        }
    }

    for (let i = 0; i < base.length; i++) {
        const r = base[i];

        if (r?.time) {
            const k = String(r.time);

            if (!map.has(k)) {
                map.set(k, r);
            }
        }
    }

    const merged = Array.from(map.values()).sort((a, b) =>
        String(b.time).localeCompare(String(a.time)),
    );

    return merged.slice(0, HISTORY_ROWS);
}

async function fetchHistoryFull(): Promise<HistoryEntry[]> {
    const hiRes = await fetch(apiUrl('/api/history'));

    if (!hiRes.ok) {
        return [];
    }

    const j: unknown = await hiRes.json();

    return Array.isArray(j)
        ? (j as HistoryEntry[])
        : [];
}

async function fetchHistoryDelta(sinceIso: string): Promise<HistoryEntry[] | null> {
    const u = `${apiUrl('/api/history/delta')}?since=${encodeURIComponent(sinceIso)}`;
    const dRes = await fetch(u);

    if (!dRes.ok) {
        return null;
    }

    const j: unknown = await dRes.json();

    return Array.isArray(j)
        ? (j as HistoryEntry[])
        : null;
}

function isHistoryCacheFresh(): boolean {
    return (
        Array.isArray(historyCache) &&
        historyCacheAt !== null &&
        Date.now() - historyCacheAt < HISTORY_CACHE_TTL_MS
    );
}

function availabilityPercentFromHistory(serviceName: string, history: HistoryEntry[]): number | null {
    if (!Array.isArray(history) || history.length === 0) {
        return null;
    }

    let total = 0;
    let ups = 0;

    for (let i = 0; i < history.length; i++) {
        const row = history[i];
        const sv = row.services;

        if (!sv || typeof sv !== 'object') {
            continue;
        }

        const parsed = parseHistoryServiceStatus(sv[serviceName]);

        if (parsed.kind === 'up') {
            total++;
            ups++;
        } else if (parsed.kind === 'down') {
            total++;
        } else if (parsed.kind === 'mixed') {
            total++;
            ups += 1 - downtimeFractionInHour(String(row.time || ''), parsed.outages);
        }
    }

    if (total === 0) {
        return null;
    }

    return (100 * ups) / total;
}

export async function loadAll(options: LoadAllOptions = {}): Promise<void> {
    const overallDiv = document.getElementById('overall');
    const servicesDiv = document.getElementById('services');
    const updatedDiv = document.getElementById('updated');
    const historyBody = document.getElementById('history-body');
    const historyTable = document.getElementById('history-table');
    const historyEmpty = document.getElementById('history-empty');
    const activityEmpty = document.getElementById('activity-empty');

    if (
        !overallDiv ||
        !servicesDiv ||
        !updatedDiv ||
        !historyBody ||
        !historyTable ||
        !historyEmpty
    ) {
        return;
    }

    const refreshHistory = options.refreshHistory === true || !isHistoryCacheFresh();

    try {
        let data: StatusApiResponse;
        let history: HistoryEntry[];

        if (refreshHistory) {
            const stRes = await fetch(apiUrl('/api/status'), { cache: 'no-store' });

            data = (await stRes.json()) as StatusApiResponse;

            const newestKnown =
                options.historyRefresh !== 'full' &&
                Array.isArray(historyCache) &&
                historyCache.length > 0 &&
                historyCache[0]?.time
                    ? String(historyCache[0].time)
                    : null;

            const needsFullResync =
                options.historyRefresh === 'full' ||
                lastHistoryFullFetchAt === null ||
                Date.now() - lastHistoryFullFetchAt >= HISTORY_FULL_RESYNC_MS;

            if (needsFullResync || !newestKnown) {
                history = await fetchHistoryFull();
                lastHistoryFullFetchAt = Date.now();
            } else {
                const delta = await fetchHistoryDelta(newestKnown);

                if (delta !== null) {
                    history = mergeHistoryDelta(historyCache ?? [], delta);
                } else {
                    history = await fetchHistoryFull();
                    lastHistoryFullFetchAt = Date.now();
                }
            }

            historyCache = Array.isArray(history)
                ? history
                : [];
            historyCacheAt = Date.now();
        } else {
            const stRes = await fetch(apiUrl('/api/status'), { cache: 'no-store' });

            data = (await stRes.json()) as StatusApiResponse;
            history = Array.isArray(historyCache)
                ? historyCache
                : [];
        }

        servicesDiv.innerHTML = '';

        if (!data.services || Object.keys(data.services).length === 0) {
            overallDiv.textContent = t('overallNoChecks');
            overallDiv.removeAttribute('data-i18n');
            overallDiv.className = 'overall';

            updatedDiv.textContent = '';
        } else {
            let allUp = true;

            for (const [name, status] of Object.entries(data.services)) {
                if (status !== 'up') {
                    allUp = false;
                }

                const el = document.createElement('div');

                el.className = 'service';

                const label = status === 'up'
                    ? t('statusUp')
                    : t('statusDown');

                const main = document.createElement('div');

                main.className = 'service-main';

                const titleEl = document.createElement('div');

                titleEl.textContent = name;

                main.appendChild(titleEl);

                const pct = availabilityPercentFromHistory(name, history);

                if (pct !== null) {
                    const pctStr = formatAvailabilityPercent(pct);
                    const meta = document.createElement('div');

                    meta.className = 'service-availability';
                    meta.textContent = t('availability').replace('{percent}', pctStr);
                    meta.title = t('availabilityHint');
                    main.appendChild(meta);
                }

                const statusEl = document.createElement('div');

                statusEl.className = `status ${status}`;
                statusEl.textContent = label;

                el.appendChild(main);
                el.appendChild(statusEl);

                servicesDiv.appendChild(el);
            }

            overallDiv.textContent = allUp
                ? t('overallAllUp')
                : t('overallSomeDown');
            overallDiv.removeAttribute('data-i18n');
            overallDiv.className = `overall ${allUp
                ? 'up'
                : 'down'}`;

            updatedDiv.textContent = data.updated
                ? `${t('lastUpdated')} ${formatLocalDateTime(data.updated)}`
                : '';
        }

        renderActivityBoard(Array.isArray(history)
            ? history
            : [], data.services || {});

        if (!Array.isArray(history) || history.length === 0) {
            historyEmpty.textContent = t('historyEmpty');
            historyEmpty.setAttribute('data-i18n', 'historyEmpty');
            historyEmpty.hidden = false;

            historyTable.hidden = true;
        } else {
            historyEmpty.hidden = true;

            historyTable.hidden = false;

            historyBody.innerHTML = '';

            const slice = history.slice(0, HISTORY_ROWS);

            for (const row of slice) {
                const tr = document.createElement('tr');
                const tdTime = document.createElement('td');

                tdTime.className = 'svc-cell';
                tdTime.textContent = formatLocalDateTime(row.time || '');

                const tdSvc = document.createElement('td');
                tdSvc.className = 'history-services-cell';

                const rowServices = row.services || {};
                const names = orderedHistoryRowServiceNames(data.services || {}, rowServices);

                for (let i = 0; i < names.length; i++) {
                    if (i > 0) {
                        tdSvc.appendChild(document.createTextNode('\n'));
                    }

                    const name = names[i];
                    const st = rowServices[name];
                    const entry = document.createElement('span');
                    entry.className = 'history-svc-entry';

                    const nm = document.createElement('span');
                    nm.className = 'history-svc-name';
                    nm.textContent = name;

                    const sep = document.createElement('span');
                    sep.className = 'history-svc-sep';
                    sep.textContent = ': ';

                    const stEl = document.createElement('span');
                    const ps = parseHistoryServiceStatus(st);

                    if (ps.kind === 'up') {
                        stEl.className = 'history-status up';
                        stEl.textContent = t('statusUp');
                    } else if (ps.kind === 'down') {
                        stEl.className = 'history-status down';
                        stEl.textContent = t('statusDown');
                    } else if (ps.kind === 'mixed') {
                        stEl.className = 'history-status mixed';
                        stEl.textContent = t('statusMixed');
                        stEl.title = formatOutageRangesTitle(ps.outages);
                    } else {
                        stEl.className = 'history-status unknown';
                        stEl.textContent = typeof st === 'string'
                            ? st
                            : JSON.stringify(st);
                    }

                    entry.appendChild(nm);
                    entry.appendChild(sep);
                    entry.appendChild(stEl);

                    tdSvc.appendChild(entry);
                }

                tr.appendChild(tdTime);
                tr.appendChild(tdSvc);

                historyBody.appendChild(tr);
            }
        }

        document.dispatchEvent(new CustomEvent('servers-status:refresh'));
    } catch {
        document.getElementById('overall')!.textContent = t('errorStatus');
        document.getElementById('overall')!.removeAttribute('data-i18n');

        historyEmpty.textContent = t('errorHistory');
        historyEmpty.setAttribute('data-i18n', 'errorHistory');

        if (activityEmpty) {
            activityEmpty.textContent = t('errorHistory');
            activityEmpty.setAttribute('data-i18n', 'errorHistory');
            activityEmpty.hidden = false;
        }

        const ab = document.getElementById('activity-board');
        const leg = document.getElementById('activity-legend');

        if (ab) {
            ab.innerHTML = '';
            ab.hidden = true;
        }

        if (leg) {
            leg.hidden = true;
        }
    }
}
