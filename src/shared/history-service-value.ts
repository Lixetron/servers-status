/** Значение сервиса в почасовой записи (агрегат проб или legacy строка). */
export type HistoryServiceValue =
    | 'up'
    | 'down'
    | { status: 'mixed'; outages: [string, string][] };
