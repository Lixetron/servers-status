import {ACTIVITY_MAX_CELLS} from './config.js';
import {formatLocalDateTime} from './format.js';
import {t} from './i18n.js';

/**
 * Совпадает с порядком карточек статуса (ключи из `/api/status`), затем любые прочие имена из истории — по алфавиту.
 *
 * @param {Record<string, unknown> | null | undefined} currentServices
 * @param {Record<string, true>} nameSet
 */
function orderedActivityServiceNames(currentServices, nameSet) {
    const ordered = [];
    const seen = new Set();

    if (currentServices && typeof currentServices === 'object') {
        for (const k of Object.keys(currentServices)) {
            if (Object.prototype.hasOwnProperty.call(nameSet, k)) {
                ordered.push(k);
                seen.add(k);
            }
        }
    }

    const extra = Object.keys(nameSet)
        .filter((k) => !seen.has(k))
        .sort();

    return ordered.concat(extra);
}

export function renderActivityBoard(historyNewestFirst, currentServices) {
    const board = document.getElementById('activity-board');
    const emptyEl = document.getElementById('activity-empty');
    const legend = document.getElementById('activity-legend');

    if (!board || !emptyEl) {
        return;
    }

    board.innerHTML = '';

    if (!Array.isArray(historyNewestFirst) || historyNewestFirst.length === 0) {
        emptyEl.textContent = t('historyEmpty');
        emptyEl.setAttribute('data-i18n', 'historyEmpty');
        emptyEl.hidden = false;

        board.hidden = true;

        if (legend) {
            legend.hidden = true;
        }

        return;
    }

    const chron = historyNewestFirst.slice().reverse();
    const slice = chron.slice(Math.max(0, chron.length - ACTIVITY_MAX_CELLS));
    const nameSet = {};

    if (currentServices && typeof currentServices === 'object') {
        for (const ck in currentServices) {
            if (Object.prototype.hasOwnProperty.call(currentServices, ck)) {
                nameSet[ck] = true;
            }
        }
    }

    for (let si = 0; si < slice.length; si++) {
        const sv = slice[si].services || {};

        for (const nk in sv) {
            if (Object.prototype.hasOwnProperty.call(sv, nk)) {
                nameSet[nk] = true;
            }
        }
    }
    const names = orderedActivityServiceNames(currentServices, nameSet);

    if (names.length === 0) {
        emptyEl.textContent = t('historyEmpty');
        emptyEl.setAttribute('data-i18n', 'historyEmpty');
        emptyEl.hidden = false;

        board.hidden = true;

        if (legend) {
            legend.hidden = true;
        }

        return;
    }

    emptyEl.hidden = true;

    board.hidden = false;

    if (legend) {
        legend.hidden = false;
    }

    const upLabel = t('legendUp');
    const downLabel = t('legendDown');
    const unkLabel = t('legendUnknown');

    for (let ri = 0; ri < names.length; ri++) {
        const svcName = names[ri];
        const row = document.createElement('div');

        row.className = 'activity-row';

        const label = document.createElement('div');

        label.className = 'activity-name';
        label.textContent = svcName;
        label.title = svcName;

        const scroll = document.createElement('div');

        scroll.className = 'activity-scroll';
        scroll.setAttribute('role', 'group');
        scroll.setAttribute('aria-label', `${svcName} — ${t('activityTitle')}`);

        const cells = document.createElement('div');

        cells.className = 'activity-cells';

        for (let ci = 0; ci < slice.length; ci++) {
            const entry = slice[ci];
            const st = (entry.services && entry.services[svcName]) || '';
            let cls = 'unknown';
            let tip = unkLabel;

            if (st === 'up') {
                cls = 'up';
                tip = upLabel;
            } else if (st === 'down') {
                cls = 'down';
                tip = downLabel;
            }

            const when = formatLocalDateTime(entry.time || '');
            const cell = document.createElement('span');

            cell.className = `activity-cell ${cls}`;
            cell.tabIndex = 0;
            cell.title = when ? `${when} — ${tip}` : tip;
            cell.setAttribute('role', 'img');
            cell.setAttribute('aria-label', `${svcName}, ${when || ''}, ${tip}`);
            cells.appendChild(cell);
        }

        scroll.appendChild(cells);

        row.appendChild(label);
        row.appendChild(scroll);

        board.appendChild(row);
    }
}
