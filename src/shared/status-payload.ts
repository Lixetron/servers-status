import type { ServiceState } from './service-state';

/** Контракт `/api/status` и строка `live_status` в D1. */
export interface StatusPayload {
    updated: string;
    services: Record<string, ServiceState>;
}
