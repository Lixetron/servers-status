-- Живой снимок для /api/status (обновляется каждую минуту по cron).
CREATE TABLE IF NOT EXISTS live_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    updated TEXT NOT NULL,
    services TEXT NOT NULL
);

-- Накопление минутных проб внутри текущего календарного часа (UTC), одна строка.
CREATE TABLE IF NOT EXISTS hour_progress (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hour_start TEXT NOT NULL,
    payload TEXT NOT NULL
);
