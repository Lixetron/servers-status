import {apiUrl, HISTORY_ROWS} from './config.js';
import {renderActivityBoard} from './activity.js';
import {formatAvailabilityPercent, formatLocalDateTime} from './format.js';
import {t} from './i18n.js';

/**
 * Доступность по истории: доля проверок со статусом `up` среди явных `up`/`down`.
 *
 * @param {string} serviceName
 * @param {unknown} history
 * @returns {number | null}
 */
function availabilityPercentFromHistory(serviceName, history) {
    if (!Array.isArray(history) || history.length === 0) {
        return null;
    }

    let total = 0;
    let ups = 0;

    for (let i = 0; i < history.length; i++) {
        const row = history[i];
        const sv = row && row.services;

        if (!sv || typeof sv !== 'object') {
            continue;
        }

        const st = sv[serviceName];

        if (st === 'up') {
            total++;
            ups++;
        } else if (st === 'down') {
            total++;
        }
    }

    if (total === 0) {
        return null;
    }

    return (100 * ups) / total;
}

export async function loadAll() {
    const overallDiv = document.getElementById('overall');
    const servicesDiv = document.getElementById('services');
    const updatedDiv = document.getElementById('updated');
    const historyBody = document.getElementById('history-body');
    const historyTable = document.getElementById('history-table');
    const historyEmpty = document.getElementById('history-empty');
    const activityEmpty = document.getElementById('activity-empty');

    try {
        const qs = `?t=${Date.now()}`;
        const [stRes, hiRes] = await Promise.all([
            fetch(apiUrl(`/api/status${qs}`)),
            fetch(apiUrl(`/api/history${qs}`)),
        ]);
        const data = await stRes.json();
        const history = await hiRes.json();

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

                const label = status === 'up' ? t('statusUp') : t('statusDown');

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

            overallDiv.textContent = allUp ? t('overallAllUp') : t('overallSomeDown');
            overallDiv.removeAttribute('data-i18n');
            overallDiv.className = `overall ${allUp ? 'up' : 'down'}`;

            updatedDiv.textContent = data.updated
                ? `${t('lastUpdated')} ${formatLocalDateTime(data.updated)}`
                : '';
        }

        renderActivityBoard(Array.isArray(history) ? history : [], data.services || {});

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

                const entries = Object.entries(row.services || {});

                for (const kv of entries) {
                    const idx = entries.indexOf(kv);
                    const name = kv[0];
                    const st = kv[1];

                    if (idx > 0) {
                        const dot = document.createElement('span');

                        dot.className = 'history-svc-dot';
                        dot.textContent = ' · ';
                        tdSvc.appendChild(dot);
                    }

                    const entry = document.createElement('span');
                    entry.className = 'history-svc-entry';

                    const nm = document.createElement('span');
                    nm.className = 'history-svc-name';
                    nm.textContent = name;

                    const sep = document.createElement('span');
                    sep.className = 'history-svc-sep';
                    sep.textContent = ': ';

                    const stEl = document.createElement('span');

                    if (st === 'up') {
                        stEl.className = 'history-status up';
                        stEl.textContent = t('statusUp');
                    } else if (st === 'down') {
                        stEl.className = 'history-status down';
                        stEl.textContent = t('statusDown');
                    } else {
                        stEl.className = 'history-status unknown';
                        stEl.textContent = String(st);
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
        document.getElementById('overall').textContent = t('errorStatus');
        document.getElementById('overall').removeAttribute('data-i18n');

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
