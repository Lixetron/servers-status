import type { StatusPayload } from '../shared';
import { PROBE_TIMEOUT_MS } from './constants';
import SERVERS_CONFIG from './servers.json';

type HttpServer = { name: string; url: string };

const SERVERS: HttpServer[] = SERVERS_CONFIG as HttpServer[];

async function drainResponseBody(res: Response): Promise<void> {
    try {
        await res.body?.cancel();
    } catch {
        /* ignore */
    }
}

/** HEAD first (cheap); GET fallback when HEAD is missing or non-OK (common on small hosts). */
async function probeUrl(url: string): Promise<boolean> {
    const baseInit: RequestInit = {
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

export async function probeServers(): Promise<StatusPayload> {
    const now = new Date().toISOString();
    const outcomes = await Promise.all(
        SERVERS.map(async (s) => {
            const ok = await probeUrl(s.url);

            return [s.name,
                ok
                    ? 'up'
                    : 'down',
            ] as const;
        }),
    );

    const results = Object.fromEntries(outcomes) as Record<string, 'up' | 'down'>;

    return {
        updated: now,
        services: results,
    };
}
