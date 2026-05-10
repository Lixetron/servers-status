import {ACTIVITY_FALLBACK_MAX_CELLS} from './config.js';
import {formatLocalDateTime, formatOutageRangesTitle} from './format.js';
import {parseHistoryServiceStatus} from './historyStatus.js';
import {t} from './i18n.js';

/** Совпадает с `.activity-cell` и `gap` в `styles.scss`. */
const CELL_PX = 11;
const CELL_GAP_PX = 4;
/** Совпадает с `gap` между `.activity-name` и `.activity-scroll`. */
const ROW_GAP_PX = 12;
/** Совпадает с `flex: 0 0 min(42%, 180px)` у `.activity-name`. */
const LABEL_FRAC = 0.42;
const LABEL_MAX_PX = 180;

/** @type {{history: unknown[]; services: Record<string, unknown>} | null} */
let activityResizePayload = null;

/** @type {ResizeObserver | null} */
let activityResizeObserver = null;

let activityResizeObserverInstalled = false;

/** Число ячеек в последней отрисовке (для ResizeObserver). */
let lastRenderedCellBudget = -1;

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

/**
 * Сколько квадратиков помещается по ширине полосы (без горизонтального скролла).
 *
 * @param {number} scrollPx
 */
function cellsFromScrollWidth(scrollPx) {
    if (!Number.isFinite(scrollPx) || scrollPx <= 0) {
        return ACTIVITY_FALLBACK_MAX_CELLS;
    }

    const n = Math.floor((scrollPx + CELL_GAP_PX) / (CELL_PX + CELL_GAP_PX));

    return Math.max(1, n);
}

function getMaxActivityCells() {
    const prevScroll = document.querySelector('#activity-board .activity-scroll');

    if (prevScroll && prevScroll.clientWidth > 0) {
        return cellsFromScrollWidth(prevScroll.clientWidth);
    }

    const wrap = document.getElementById('activity-wrap');

    if (wrap && wrap.clientWidth > 0) {
        const w = wrap.clientWidth;
        const labelW = Math.min(w * LABEL_FRAC, LABEL_MAX_PX);
        const scrollW = w - labelW - ROW_GAP_PX;

        return cellsFromScrollWidth(scrollW);
    }

    return ACTIVITY_FALLBACK_MAX_CELLS;
}

function ensureActivityResizeObserver() {
    if (activityResizeObserverInstalled || typeof ResizeObserver === 'undefined') {
        return;
    }

    const wrap = document.getElementById('activity-wrap');

    if (!wrap) {
        return;
    }

    activityResizeObserverInstalled = true;

    activityResizeObserver = new ResizeObserver(() => {
        if (!activityResizePayload) {
            return;
        }

        const next = getMaxActivityCells();

        if (next === lastRenderedCellBudget) {
            return;
        }

        internalRenderActivityBoard();
    });

    activityResizeObserver.observe(wrap);
}

function internalRenderActivityBoard() {
    const board = document.getElementById('activity-board');
    const emptyEl = document.getElementById('activity-empty');
    const legend = document.getElementById('activity-legend');

    const payload = activityResizePayload;

    if (!board || !emptyEl || !payload) {
        return;
    }

    const historyNewestFirst = payload.history;
    const currentServices = payload.services;

    const maxCells = getMaxActivityCells();

    board.innerHTML = '';

    if (!Array.isArray(historyNewestFirst) || historyNewestFirst.length === 0) {
        emptyEl.textContent = t('historyEmpty');
        emptyEl.setAttribute('data-i18n', 'historyEmpty');
        emptyEl.hidden = false;

        board.hidden = true;

        if (legend) {
            legend.hidden = true;
        }

        lastRenderedCellBudget = -1;

        return;
    }

    const chron = historyNewestFirst.slice().reverse();
    const slice = chron.slice(Math.max(0, chron.length - maxCells));
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

        lastRenderedCellBudget = -1;

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
    const mixedLabel = t('legendMixed');

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
            const raw = entry.services && entry.services[svcName];
            const parsed = parseHistoryServiceStatus(raw);
            let cls = 'unknown';
            let tip = unkLabel;
            let detailLine = '';

            if (parsed.kind === 'up') {
                cls = 'up';
                tip = upLabel;
            } else if (parsed.kind === 'down') {
                cls = 'down';
                tip = downLabel;
            } else if (parsed.kind === 'mixed') {
                cls = 'mixed';
                tip = mixedLabel;
                detailLine = formatOutageRangesTitle(parsed.outages);
            }

            const when = formatLocalDateTime(entry.time || '');
            const cell = document.createElement('span');

            cell.className = `activity-cell ${cls}`;
            cell.tabIndex = 0;

            if (parsed.kind === 'mixed' && detailLine) {
                cell.title = when
                    ? `${when}\n${tip}\n${detailLine}`
                    : `${tip}\n${detailLine}`;
                cell.setAttribute(
                    'aria-label',
                    `${svcName}, ${when || ''}, ${tip}. ${detailLine.replace(/\n/g, '; ')}`,
                );
            } else {
                cell.title = when ? `${when} — ${tip}` : tip;
                cell.setAttribute('aria-label', `${svcName}, ${when || ''}, ${tip}`);
            }

            cell.setAttribute('role', 'img');
            cells.appendChild(cell);
        }

        scroll.appendChild(cells);

        row.appendChild(label);
        row.appendChild(scroll);

        board.appendChild(row);
    }

    lastRenderedCellBudget = maxCells;
}

export function renderActivityBoard(historyNewestFirst, currentServices) {
    activityResizePayload = {
        history: historyNewestFirst,
        services: currentServices,
    };

    internalRenderActivityBoard();
    ensureActivityResizeObserver();
}
