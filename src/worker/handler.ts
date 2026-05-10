import type { StatusPayload } from '../shared';

import { CACHE_HISTORY_SEC, MAX_HISTORY, MAX_HISTORY_DELTA } from './constants';
import { parseHistoryRowServices, parseLiveServicesColumn } from './parsers';
import { jsonApiResponse, jsonLiveStatusResponse, noStoreHtml, stableApiCacheKey } from './responses';
import { ensureSnapshotFresh } from './snapshot';

export async function handleFetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path.startsWith('/api/')) {
        /** Только история — тяжёлая; `/api/status` намеренно не кэшируем (poll чаще, чем был TTL Cache API). */
        if (path === '/api/history') {
            const cacheKey = stableApiCacheKey(request, path);
            const cached = await caches.default.match(cacheKey);

            if (cached) {
                return cached;
            }
        }

        await ensureSnapshotFresh(env);

        if (path === '/api/history/delta') {
            const since = url.searchParams.get('since');

            if (!since || Number.isNaN(Date.parse(since))) {
                return new Response(JSON.stringify({ error: 'invalid_since' }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store',
                        'access-control-allow-origin': '*',
                    },
                });
            }

            const { results } = await env.DB.prepare(
                    'SELECT time, services FROM history WHERE time > ? ORDER BY time DESC LIMIT ?',
                )
                .bind(since, MAX_HISTORY_DELTA)
                .all<{ time: string; services: string }>();

            const payload = (results ?? []).map((row) => ({
                time: row.time,
                services: parseHistoryRowServices(row.services),
            }));

            return jsonApiResponse(payload, 0);
        }

        if (path === '/api/status') {
            const row = await env.DB.prepare(
                'SELECT updated, services FROM live_status WHERE id = 1',
            ).first<{ updated: string; services: string }>();

            if (!row) {
                return jsonLiveStatusResponse({
                    updated: null,
                    services: {},
                });
            }

            const body: StatusPayload = {
                updated: row.updated,
                services: parseLiveServicesColumn(row.services),
            };

            return jsonLiveStatusResponse(body);
        }

        if (path === '/api/history') {
            const { results } = await env.DB.prepare(
                    'SELECT time, services FROM history ORDER BY time DESC LIMIT ?',
                )
                .bind(MAX_HISTORY)
                .all<{ time: string; services: string }>();

            const payload = (results ?? []).map((row) => ({
                time: row.time,
                services: parseHistoryRowServices(row.services),
            }));

            const res = jsonApiResponse(payload, CACHE_HISTORY_SEC);

            ctx.waitUntil(caches.default.put(stableApiCacheKey(request, path), res.clone()));

            return res;
        }

        return new Response('Not Found', { status: 404 });
    }

    if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
        await ensureSnapshotFresh(env);

        const res = await env.ASSETS.fetch(request);

        return noStoreHtml(res);
    }

    return env.ASSETS.fetch(request);
}
