import type { StatusPayload } from '../shared';

import { MAX_SNAPSHOT_AGE_MS } from './constants';
import { accumulateHourAndMaybeFinalize } from './history';
import { probeServers } from './probe';

/**
 * Serializes snapshot refreshes so concurrent `/api/status` + `scheduled` never run
 * overlapping probes (which stretched past timeouts and flipped statuses randomly).
 */
let snapshotGate: Promise<void> = Promise.resolve();

export function withSnapshotGate<T>(fn: () => Promise<T>): Promise<T> {
    const previous = snapshotGate;
    let release!: () => void;

    snapshotGate = new Promise<void>((resolve) => {
        release = resolve;
    });

    return previous.then(() => fn()).finally(release);
}

export function isSnapshotStale(latestTimeIso: string | null): boolean {
    if (!latestTimeIso) {
        return true;
    }

    const t = new Date(latestTimeIso).getTime();

    return Number.isNaN(t) || Date.now() - t > MAX_SNAPSHOT_AGE_MS;
}

export async function getLatestLiveProbeTime(env: Env): Promise<string | null> {
    const row = await env.DB.prepare(
        'SELECT updated FROM live_status WHERE id = 1',
    ).first<{ updated: string }>();

    return row?.updated ?? null;
}

async function upsertLiveStatus(env: Env, payload: StatusPayload): Promise<void> {
    await env.DB.prepare(
            'INSERT OR REPLACE INTO live_status (id, updated, services) VALUES (1, ?, ?)',
        )
        .bind(payload.updated, JSON.stringify(payload.services))
        .run();
}

export async function persistProbe(env: Env, payload: StatusPayload): Promise<void> {
    await upsertLiveStatus(env, payload);
    await accumulateHourAndMaybeFinalize(env, payload);
}

export async function runScheduled(env: Env): Promise<void> {
    const payload = await probeServers();

    console.log('Status snapshot:', payload);

    await persistProbe(env, payload);
}

/**
 * Ensures live probe is no older than MAX_SNAPSHOT_AGE_MS.
 * Covers empty DB (dev / cold start) and gaps after redeploy when cron has not fired yet.
 */
export async function ensureSnapshotFresh(env: Env): Promise<void> {
    const latest = await getLatestLiveProbeTime(env);

    if (!isSnapshotStale(latest)) {
        return;
    }

    await withSnapshotGate(async () => {
        const again = await getLatestLiveProbeTime(env);

        if (!isSnapshotStale(again)) {
            return;
        }

        await runScheduled(env);
    });
}
