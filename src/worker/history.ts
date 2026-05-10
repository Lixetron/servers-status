import type { HistoryServiceValue, StatusPayload } from '../shared';
import { MAX_HISTORY } from './constants';

interface HourProgressPayload {
    services: Record<string, Array<{ t: string; st: 'up' | 'down' }>>;
}

export function floorHourUtcIso(iso: string): string {
    const d = new Date(iso);

    d.setUTCMinutes(0, 0, 0);

    return d.toISOString();
}

export function aggregateSamples(samples: Array<{ t: string; st: 'up' | 'down' }>): HistoryServiceValue {
    if (samples.length === 0) {
        return 'up';
    }

    const sorted = [...samples].sort((a, b) => a.t.localeCompare(b.t));
    const allUp = sorted.every((s) => s.st === 'up');
    const allDown = sorted.every((s) => s.st === 'down');

    if (allUp) {
        return 'up';
    }

    if (allDown) {
        return 'down';
    }

    const outages: [string, string][] = [];
    let blockStart: string | null = null;
    let lastDown: string | null = null;

    for (const s of sorted) {
        if (s.st === 'down') {
            if (blockStart === null) {
                blockStart = s.t;
            }

            lastDown = s.t;
        } else if (blockStart !== null && lastDown !== null) {
            outages.push([blockStart, lastDown]);
            blockStart = null;
            lastDown = null;
        }
    }

    if (blockStart !== null && lastDown !== null) {
        outages.push([blockStart, lastDown]);
    }

    return {
        status: 'mixed',
        outages,
    };
}

async function trimHistory(db: D1Database): Promise<void> {
    /** Без ROW_NUMBER(): оконная функция заставляет читать все строки и раздувает rows read в D1. */
    const excess = await db
        .prepare(
            `SELECT 1 AS ok
             FROM history
             ORDER BY time ASC
             LIMIT 1 OFFSET ?`,
        )
        .bind(MAX_HISTORY)
        .first<{ ok: number }>();

    if (!excess) {
        return;
    }

    await db
        .prepare(
            `DELETE
             FROM history
             WHERE id IN (
                   SELECT id
                   FROM (
                     SELECT id
                     FROM history
                     ORDER BY time DESC
                     LIMIT -1 OFFSET ?
                   )
                 )`,
        )
        .bind(MAX_HISTORY)
        .run();
}

async function finalizeHourProgress(env: Env, hourStart: string, payloadJson: string): Promise<void> {
    let payload: HourProgressPayload;

    try {
        payload = JSON.parse(payloadJson) as HourProgressPayload;
    } catch {
        return;
    }

    const servicesOut: Record<string, HistoryServiceValue> = {};

    for (const [name, samples] of Object.entries(payload.services ?? {})) {
        if (!Array.isArray(samples) || samples.length === 0) {
            continue;
        }

        servicesOut[name] = aggregateSamples(samples);
    }

    if (Object.keys(servicesOut).length === 0) {
        return;
    }

    await env.DB.prepare('INSERT INTO history (time, services) VALUES (?, ?)')
        .bind(hourStart, JSON.stringify(servicesOut))
        .run();

    await trimHistory(env.DB);
}

export async function accumulateHourAndMaybeFinalize(env: Env, payload: StatusPayload): Promise<void> {
    const hourStart = floorHourUtcIso(payload.updated);
    const row = await env.DB.prepare(
        'SELECT hour_start, payload FROM hour_progress WHERE id = 1',
    ).first<{ hour_start: string; payload: string }>();

    if (row && row.hour_start < hourStart) {
        await finalizeHourProgress(env, row.hour_start, row.payload);
        await env.DB.prepare('DELETE FROM hour_progress WHERE id = 1').run();
    }

    let progress: HourProgressPayload;

    if (row && row.hour_start === hourStart) {
        progress = JSON.parse(row.payload) as HourProgressPayload;
    } else {
        progress = { services: {} };
    }

    for (const [name, st] of Object.entries(payload.services)) {
        if (!progress.services[name]) {
            progress.services[name] = [];
        }

        progress.services[name].push({
            t: payload.updated,
            st,
        });
    }

    await env.DB.prepare(
            'INSERT OR REPLACE INTO hour_progress (id, hour_start, payload) VALUES (1, ?, ?)',
        )
        .bind(hourStart, JSON.stringify(progress))
        .run();
}
