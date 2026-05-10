/** Строка истории из `/api/history` и таблицы `history`. */
export interface HistoryEntry {
    time: string;
    services: Record<string, unknown>;
}
