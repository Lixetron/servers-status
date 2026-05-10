/** Ключ без query string — один URL для Cache API при любых `?t=` на клиенте. */
export function stableApiCacheKey(request: Request, pathname: string): Request {
    const u = new URL(request.url);

    return new Request(`${u.origin}${pathname}`, {
        method: 'GET',
        headers: request.headers,
    });
}

export function noStoreHtml(res: Response): Response {
    const headers = new Headers(res.headers);

    headers.set('cache-control', 'no-store');

    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
    });
}

export function jsonApiResponse(data: unknown, edgeCacheSeconds: number): Response {
    /** max-age=0: браузер не держит ответ и ходит на сеть при каждом poll; s-maxage: общий edge-кэш Cloudflare (меньше D1). */
    return new Response(JSON.stringify(data), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=0, s-maxage=${edgeCacheSeconds}, must-revalidate`,
            'access-control-allow-origin': '*',
        },
    });
}

/** Живой статус: без Worker Cache API и без HTTP-кэша — каждый poll отдаёт свежий снимок из D1. */
export function jsonLiveStatusResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
        },
    });
}
