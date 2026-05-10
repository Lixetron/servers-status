interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

/** Cloudflare Workers: глобальный кэш по умолчанию (см. `caches.default` в рантайме). */
interface CacheStorage {
  readonly default: Cache;
}
