/** Результат разбора поля сервиса в строке истории на клиенте. */
export type ParsedHistoryStatus =
    | { kind: 'up' }
    | { kind: 'down' }
    | { kind: 'mixed'; outages: [string, string][] }
    | { kind: 'unknown' };
