/** Хранение и выдача истории: не больше последних N почасовых записей. */
export const MAX_HISTORY = 100;
/** Строк за один запрос `/api/history/delta` (новых часов за раз столько не будет). */
export const MAX_HISTORY_DELTA = 64;
/** HTTP-triggered refresh if cron has not run recently (e.g. right after deploy). */
export const MAX_SNAPSHOT_AGE_MS = 2 * 60 * 1000;

/** Edge Cache API для `/api/history`: браузер всё равно с max-age=0 ходит на сеть, но общий edge-кэш CF реже бьёт в D1. */
export const CACHE_HISTORY_SEC = 600;

/** Per-request probe budget; parallel probes use this each (not stacked serially). */
export const PROBE_TIMEOUT_MS = 8000;
