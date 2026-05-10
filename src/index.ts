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

async function getLatestSnapshotTime(env: Env): Promise<string | null> {
    const row = await env.DB.prepare(
        'SELECT time FROM history ORDER BY time DESC LIMIT 1',
    ).first<{time: string}>();

    return row?.time ?? null;
}

function parseServicesColumn(raw: string): Record<string, 'up' | 'down'> {
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
    services: Record<string, 'up' | 'down'>;
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

async function persistSnapshot(env: Env, payload: StatusPayload): Promise<void> {
    await env.DB.prepare('INSERT INTO history (time, services) VALUES (?, ?)')
        .bind(payload.updated, JSON.stringify(payload.services))
        .run();

    await trimHistory(env.DB);
}

async function runScheduled(env: Env): Promise<void> {
    const payload = await probeServers();

    console.log('Status snapshot:', payload);

    await persistSnapshot(env, payload);
}

/**
 * Ensures D1 has a snapshot no older than MAX_SNAPSHOT_AGE_MS.
 * Covers empty DB (dev / cold start) and gaps after redeploy when cron has not fired yet.
 */
async function ensureSnapshotFresh(env: Env): Promise<void> {
    const latest = await getLatestSnapshotTime(env);

    if (!isSnapshotStale(latest)) {
        return;
    }

    await withSnapshotGate(async () => {
        const again = await getLatestSnapshotTime(env);

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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'GET' && path.startsWith('/api/')) {
            await ensureSnapshotFresh(env);

            if (path === '/api/status') {
                const row = await env.DB.prepare(
                    'SELECT time, services FROM history ORDER BY time DESC LIMIT 1',
                ).first<{time: string; services: string}>();

                if (!row) {
                    return Response.json(
                        {
                            updated: null,
                            services: {},
                        },
                        {
                            headers: {
                                'cache-control': 'no-store',
                                'access-control-allow-origin': '*',
                            },
                        },
                    );
                }

                const body: StatusPayload = {
                    updated: row.time,
                    services: parseServicesColumn(row.services),
                };

                return Response.json(body, {
                    headers: {
                        'cache-control': 'no-store',
                        'access-control-allow-origin': '*',
                    },
                });
            }

            if (path === '/api/history') {
                const {results} = await env.DB.prepare(
                    'SELECT time, services FROM history ORDER BY time DESC LIMIT ?',
                )
                    .bind(MAX_HISTORY)
                    .all<{time: string; services: string}>();

                const payload = (results ?? []).map((row) => ({
                    time: row.time,
                    services: parseServicesColumn(row.services),
                }));

                return Response.json(payload, {
                    headers: {
                        'cache-control': 'no-store',
                        'access-control-allow-origin': '*',
                    },
                });
            }

            return new Response('Not Found', { status: 404 });
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
