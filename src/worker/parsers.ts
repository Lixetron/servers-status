export function parseLiveServicesColumn(raw: string): Record<string, 'up' | 'down'> {
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

export function parseHistoryRowServices(raw: string): Record<string, unknown> {
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
