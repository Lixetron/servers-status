-- Снимки проверок: time — ISO8601, services — JSON-объект имя → up|down
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    services TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_time ON history (time DESC);
