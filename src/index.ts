const SERVERS: { name: string; url: string }[] = [
    {
        name: 'lixetron.top',
        url: 'https://reload.pl.lixetron.top',
    },
    {
        name: 'byl04ka.duckdns.org',
        url: 'https://bubblegum.byl04ka.duckdns.org',
    },
];

const MAX_HISTORY = 1000;
/** HTTP-triggered refresh if cron has not run recently (e.g. right after deploy). */
const MAX_SNAPSHOT_AGE_MS = 2 * 60 * 1000;

/** Edge Cache API TTL (seconds). Короче для статуса, дольше для тяжёлой истории. */
const CACHE_STATUS_SEC = 30;
/** Edge Cache API для `/api/history`: браузер всё равно с max-age=0 ходит на сеть, но общий edge-кэш CF реже бьёт в D1. */
const CACHE_HISTORY_SEC = 600;

/** Per-request probe budget; parallel probes use this each (not stacked serially). */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Serializes snapshot refreshes so concurrent `/api/status` + `scheduled` never run
 * overlapping probes (which stretched past timeouts and flipped statuses randomly).
 */
let snapshotGate: Promise<void> = Promise.resolve();

function withSnapshotGate<T>(fn: () => Promise<T>): Promise<T> {
    const previous = snapshotGate;
    let release!: () => void;

    snapshotGate = new Promise<void>((resolve) => {
        release = resolve;
    });

    return previous.then(() => fn()).finally(release);
}

function isSnapshotStale(latestTimeIso: string | null): boolean {
    if (!latestTimeIso) {
        return true;
    }

    const t = new Date(latestTimeIso).getTime();

    return Number.isNaN(t) || Date.now() - t > MAX_SNAPSHOT_AGE_MS;
}

async function getLatestLiveProbeTime(env: Env): Promise<string | null> {
    const row = await env.DB.prepare(
        'SELECT updated FROM live_status WHERE id = 1',
    ).first<{updated: string}>();

    return row?.updated ?? null;
}

function parseLiveServicesColumn(raw: string): Record<string, 'up' | 'down'> {
    try {
        const parsed = JSON.parse(raw) as unknown;

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, 'up' | 'down'>;
        }
    } catch {
        /* ignore */
    }

    return {};
}

function parseHistoryRowServices(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw) as unknown;

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        /* ignore */
    }

    return {};
}

async function drainResponseBody(res: Response): Promise<void> {
    try {
        await res.body?.cancel();
    } catch {
        /* ignore */
    }
}

/** HEAD first (cheap); GET fallback when HEAD is missing or non-OK (common on small hosts). */
async function probeUrl(url: string): Promise<boolean> {
    const baseInit = {
        redirect: 'follow',
        headers: {
            accept: '*/*',
            'user-agent': 'servers-status-probe/1',
        },
    };

    try {
        let res = await fetch(url, {
            ...baseInit,
            method: 'HEAD',
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        await drainResponseBody(res);

        if (res.ok) {
            return true;
        }

        res = await fetch(url, {
            ...baseInit,
            method: 'GET',
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        await drainResponseBody(res);

        return res.ok;
    } catch {
        try {
            const res = await fetch(url, {
                ...baseInit,
                method: 'GET',
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });

            await drainResponseBody(res);

            return res.ok;
        } catch {
            return false;
        }
    }
}

export interface StatusPayload {
    updated: string;
    services: Record<string, 'up' | 'down'>;
}

export interface HistoryEntry {
    time: string;
    services: Record<string, unknown>;
}

type HistoryServiceValue =
    | 'up'
    | 'down'
    | {
          status: 'mixed';
          outages: [string, string][];
      };

interface HourProgressPayload {
    services: Record<string, Array<{t: string; st: 'up' | 'down'}>>;
}

function floorHourUtcIso(iso: string): string {
    const d = new Date(iso);

    d.setUTCMinutes(0, 0, 0);

    return d.toISOString();
}

function aggregateSamples(samples: Array<{t: string; st: 'up' | 'down'}>): HistoryServiceValue {
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

    return {status: 'mixed', outages};
}

async function trimHistory(db: D1Database): Promise<void> {
    await db
        .prepare(
            `DELETE FROM history WHERE id IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY time DESC) AS rn
                    FROM history
                ) WHERE rn > ?
            )`,
        )
        .bind(MAX_HISTORY)
        .run();
}

async function probeServers(): Promise<StatusPayload> {
    const now = new Date().toISOString();
    const outcomes = await Promise.all(
        SERVERS.map(async (s) => {
            const ok = await probeUrl(s.url);

            return [s.name, ok ? 'up' : 'down'] as const;
        }),
    );

    const results = Object.fromEntries(outcomes) as Record<string, 'up' | 'down'>;

    return {
        updated: now,
        services: results,
    };
}

async function upsertLiveStatus(env: Env, payload: StatusPayload): Promise<void> {
    await env.DB.prepare(
        'INSERT OR REPLACE INTO live_status (id, updated, services) VALUES (1, ?, ?)',
    )
        .bind(payload.updated, JSON.stringify(payload.services))
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

async function accumulateHourAndMaybeFinalize(env: Env, payload: StatusPayload): Promise<void> {
    const hourStart = floorHourUtcIso(payload.updated);
    const row = await env.DB.prepare(
        'SELECT hour_start, payload FROM hour_progress WHERE id = 1',
    ).first<{hour_start: string; payload: string}>();

    if (row && row.hour_start < hourStart) {
        await finalizeHourProgress(env, row.hour_start, row.payload);
        await env.DB.prepare('DELETE FROM hour_progress WHERE id = 1').run();
    }

    let progress: HourProgressPayload;

    if (row && row.hour_start === hourStart) {
        progress = JSON.parse(row.payload) as HourProgressPayload;
    } else {
        progress = {services: {}};
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

async function persistProbe(env: Env, payload: StatusPayload): Promise<void> {
    await upsertLiveStatus(env, payload);
    await accumulateHourAndMaybeFinalize(env, payload);
}

async function runScheduled(env: Env): Promise<void> {
    const payload = await probeServers();

    console.log('Status snapshot:', payload);

    await persistProbe(env, payload);
}

/**
 * Ensures live probe is no older than MAX_SNAPSHOT_AGE_MS.
 * Covers empty DB (dev / cold start) and gaps after redeploy when cron has not fired yet.
 */
async function ensureSnapshotFresh(env: Env): Promise<void> {
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

function noStoreHtml(res: Response): Response {
    const headers = new Headers(res.headers);

    headers.set('cache-control', 'no-store');

    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
    });
}

/** Ключ без query string — один URL для Cache API при любых `?t=` на клиенте. */
function stableApiCacheKey(request: Request, pathname: string): Request {
    const u = new URL(request.url);

    return new Request(`${u.origin}${pathname}`, {
        method: 'GET',
        headers: request.headers,
    });
}

function jsonApiResponse(data: unknown, edgeCacheSeconds: number): Response {
    /** max-age=0: браузер не держит ответ и ходит на сеть при каждом poll; s-maxage: общий edge-кэш Cloudflare (меньше D1). */
    return new Response(JSON.stringify(data), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=0, s-maxage=${edgeCacheSeconds}, must-revalidate`,
            'access-control-allow-origin': '*',
        },
    });
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'GET' && path.startsWith('/api/')) {
            if (path === '/api/status' || path === '/api/history') {
                const cacheKey = stableApiCacheKey(request, path);
                const cached = await caches.default.match(cacheKey);

                if (cached) {
                    return cached;
                }
            }

            await ensureSnapshotFresh(env);

            if (path === '/api/status') {
                const row = await env.DB.prepare(
                    'SELECT updated, services FROM live_status WHERE id = 1',
                ).first<{updated: string; services: string}>();

                if (!row) {
                    return jsonApiResponse(
                        {
                            updated: null,
                            services: {},
                        },
                        Math.min(10, CACHE_STATUS_SEC),
                    );
                }

                const body: StatusPayload = {
                    updated: row.updated,
                    services: parseLiveServicesColumn(row.services),
                };

                const res = jsonApiResponse(body, CACHE_STATUS_SEC);

                ctx.waitUntil(caches.default.put(stableApiCacheKey(request, path), res.clone()));

                return res;
            }

            if (path === '/api/history') {
                const {results} = await env.DB.prepare(
                    'SELECT time, services FROM history ORDER BY time DESC LIMIT ?',
                )
                    .bind(MAX_HISTORY)
                    .all<{time: string; services: string}>();

                const payload = (results ?? []).map((row) => ({
                    time: row.time,
                    services: parseHistoryRowServices(row.services),
                }));

                const res = jsonApiResponse(payload, CACHE_HISTORY_SEC);

                ctx.waitUntil(caches.default.put(stableApiCacheKey(request, path), res.clone()));

                return res;
            }

            return new Response('Not Found', {status: 404});
        }

        if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
            await ensureSnapshotFresh(env);

            const res = await env.ASSETS.fetch(request);

            return noStoreHtml(res);
        }

        return env.ASSETS.fetch(request);
    },

    async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
        await withSnapshotGate(() => runScheduled(env));
    },
};
