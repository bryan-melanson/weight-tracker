"""SQLite persistence for settings and daily entries.

A thin repository: callers pass already-validated patches and get plain dicts
back. No business logic and no HTTP concerns live here.
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from . import config

SCHEMA_VERSION = 3

_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    unit                    TEXT    NOT NULL,
    default_calorie_target  INTEGER NOT NULL,
    goal_weight_kg          REAL,
    goal_date               TEXT,
    -- One optional target per weekday; NULL means "use the default".
    calorie_target_mon      INTEGER,
    calorie_target_tue      INTEGER,
    calorie_target_wed      INTEGER,
    calorie_target_thu      INTEGER,
    calorie_target_fri      INTEGER,
    calorie_target_sat      INTEGER,
    calorie_target_sun      INTEGER
);
CREATE TABLE IF NOT EXISTS entries (
    date            TEXT PRIMARY KEY,
    weight_kg       REAL,
    calories        INTEGER,
    calories_burned INTEGER,
    calorie_target  INTEGER,
    note            TEXT,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_date_idx ON entries (date);
"""

_SETTINGS_COLUMNS = (
    "unit",
    "default_calorie_target",
    "goal_weight_kg",
    "goal_date",
    *config.WEEKDAY_TARGET_FIELDS,
)
_ENTRY_COLUMNS = ("weight_kg", "calories", "calories_burned", "calorie_target", "note")

# Columns added after the first release. A database written by an older
# version is missing them, so each is added on open if it is not there yet.
# Every one must be nullable: existing rows have no value to backfill.
_ADDED_COLUMNS = (
    ("entries", "calories_burned", "INTEGER"),
    *(("settings", field, "INTEGER") for field in config.WEEKDAY_TARGET_FIELDS),
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    """Data access for the tracker. One instance owns one SQLite connection."""

    def __init__(self, db_path: Path | str = config.DEFAULT_DB_PATH):
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: the threading HTTP server dispatches each
        # request on its own thread, and every write below is a short
        # serialized transaction guarded by SQLite's own locking.
        self._conn = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(_SCHEMA)
        self._add_missing_columns()
        self._conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        self._seed_settings()

    def _add_missing_columns(self) -> None:
        for table, column, declaration in _ADDED_COLUMNS:
            present = {row["name"] for row in self._conn.execute(f"PRAGMA table_info({table})")}
            if column not in present:
                self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

    def _seed_settings(self) -> None:
        """Write the defaults once. An existing row is left exactly as it is."""
        columns = ", ".join(_SETTINGS_COLUMNS)
        placeholders = ", ".join(["?"] * len(_SETTINGS_COLUMNS))
        self._conn.execute(
            f"INSERT OR IGNORE INTO settings (id, {columns}) VALUES (1, {placeholders})",
            tuple(config.DEFAULT_SETTINGS[column] for column in _SETTINGS_COLUMNS),
        )

    def close(self) -> None:
        self._conn.close()

    # -- settings ---------------------------------------------------------

    def get_settings(self) -> dict:
        row = self._conn.execute(
            f"SELECT {', '.join(_SETTINGS_COLUMNS)} FROM settings WHERE id = 1"
        ).fetchone()
        return dict(row)

    def update_settings(self, patch: dict) -> dict:
        columns = [column for column in _SETTINGS_COLUMNS if column in patch]
        if columns:
            assignments = ", ".join(f"{column} = ?" for column in columns)
            values = tuple(patch[column] for column in columns)
            self._conn.execute(f"UPDATE settings SET {assignments} WHERE id = 1", values)
        return self.get_settings()

    # -- entries ----------------------------------------------------------

    def get_entry(self, date: str) -> dict | None:
        row = self._conn.execute("SELECT * FROM entries WHERE date = ?", (date,)).fetchone()
        return dict(row) if row else None

    def list_entries(self, date_from: str | None = None, date_to: str | None = None) -> tuple[dict, ...]:
        clauses, values = [], []
        if date_from:
            clauses.append("date >= ?")
            values.append(date_from)
        if date_to:
            clauses.append("date <= ?")
            values.append(date_to)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self._conn.execute(f"SELECT * FROM entries{where} ORDER BY date ASC", tuple(values))
        return tuple(dict(row) for row in rows)

    def upsert_entry(self, date: str, patch: dict) -> dict:
        """Create or merge a day's entry. Fields absent from the patch are kept."""
        columns = [column for column in _ENTRY_COLUMNS if column in patch]
        placeholders = ", ".join(["?"] * len(columns))
        insert_columns = ", ".join(["date", *columns, "updated_at"])
        values = (date, *(patch[column] for column in columns), _now())
        updates = ", ".join([*(f"{column} = excluded.{column}" for column in columns), "updated_at = excluded.updated_at"])
        self._conn.execute(
            f"INSERT INTO entries ({insert_columns}) VALUES (?, {placeholders + ', ' if columns else ''}?)"
            f" ON CONFLICT(date) DO UPDATE SET {updates}",
            values,
        )
        return self.get_entry(date)

    def delete_entry(self, date: str) -> bool:
        cursor = self._conn.execute("DELETE FROM entries WHERE date = ?", (date,))
        return cursor.rowcount > 0
