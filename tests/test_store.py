import sqlite3

import pytest

from tracker import config
from tracker.store import Store


class TestSettings:
    def test_defaults_on_fresh_db(self, store):
        s = store.get_settings()
        assert s["unit"] == "lb"
        assert s["default_calorie_target"] == 2000
        assert s["goal_weight_kg"] is None
        assert s["goal_date"] is None

    def test_weekday_targets_default_to_none(self, store):
        settings = store.get_settings()
        for day in config.WEEKDAYS:
            assert settings[f"calorie_target_{day}"] is None

    def test_update_sets_one_weekday_without_touching_the_others(self, store):
        updated = store.update_settings({"calorie_target_mon": 1800})
        assert updated["calorie_target_mon"] == 1800
        assert updated["calorie_target_tue"] is None
        assert updated["default_calorie_target"] == 2000

    def test_weekday_targets_survive_reopen(self, tmp_path):
        path = tmp_path / "week.db"
        a = Store(path)
        a.update_settings({f"calorie_target_{day}": 1700 + index for index, day in enumerate(config.WEEKDAYS)})
        a.close()
        b = Store(path)
        try:
            assert b.get_settings()["calorie_target_sun"] == 1706
        finally:
            b.close()

    def test_update_merges_patch(self, store):
        store.update_settings({"unit": "kg"})
        updated = store.update_settings({"goal_weight_kg": 75.0})
        assert updated["unit"] == "kg"
        assert updated["goal_weight_kg"] == 75.0

    def test_update_can_clear_goal(self, store):
        store.update_settings({"goal_weight_kg": 75.0})
        assert store.update_settings({"goal_weight_kg": None})["goal_weight_kg"] is None

    def test_empty_patch_is_noop(self, store):
        assert store.update_settings({}) == store.get_settings()

    def test_settings_survive_reopen(self, tmp_path):
        path = tmp_path / "p.db"
        a = Store(path)
        a.update_settings({"default_calorie_target": 1800})
        a.close()
        b = Store(path)
        assert b.get_settings()["default_calorie_target"] == 1800
        b.close()


class TestMigration:
    """A database written before a column existed must gain it on open."""

    def test_adds_weekday_targets_to_an_older_database(self, tmp_path):
        path = tmp_path / "v2.db"
        legacy = sqlite3.connect(path)
        legacy.executescript(
            """
            CREATE TABLE settings (
                id                      INTEGER PRIMARY KEY CHECK (id = 1),
                unit                    TEXT    NOT NULL,
                default_calorie_target  INTEGER NOT NULL,
                goal_weight_kg          REAL,
                goal_date               TEXT
            );
            INSERT INTO settings (id, unit, default_calorie_target) VALUES (1, 'kg', 1900);
            """
        )
        legacy.commit()
        legacy.close()

        store = Store(path)
        try:
            settings = store.get_settings()
            assert settings["default_calorie_target"] == 1900, "the existing target must survive"
            assert settings["unit"] == "kg", "an older choice of unit is not overwritten by the new default"
            assert settings["calorie_target_mon"] is None
            assert store.update_settings({"calorie_target_mon": 1750})["calorie_target_mon"] == 1750
        finally:
            store.close()

    def test_adds_calories_burned_to_an_older_database(self, tmp_path):
        path = tmp_path / "v1.db"
        legacy = sqlite3.connect(path)
        legacy.executescript(
            """
            CREATE TABLE entries (
                date            TEXT PRIMARY KEY,
                weight_kg       REAL,
                calories        INTEGER,
                calorie_target  INTEGER,
                note            TEXT,
                updated_at      TEXT NOT NULL
            );
            INSERT INTO entries (date, calories, updated_at) VALUES ('2026-10-01', 2100, '2026-10-01T00:00:00');
            """
        )
        legacy.commit()
        legacy.close()

        store = Store(path)
        try:
            entry = store.get_entry("2026-10-01")
            assert entry["calories"] == 2100
            assert entry["calories_burned"] is None
            assert store.upsert_entry("2026-10-01", {"calories_burned": 300})["calories_burned"] == 300
        finally:
            store.close()


class TestEntries:
    def test_upsert_creates_entry(self, store):
        e = store.upsert_entry("2026-10-01", {"weight_kg": 80.0, "calories": 2100})
        assert e["date"] == "2026-10-01"
        assert e["weight_kg"] == 80.0
        assert e["calories"] == 2100
        assert e["calorie_target"] is None
        assert e["updated_at"]

    def test_upsert_records_calories_burned(self, store):
        e = store.upsert_entry("2026-10-01", {"calories": 2100, "calories_burned": 450})
        assert e["calories_burned"] == 450

    def test_calories_burned_defaults_to_none(self, store):
        assert store.upsert_entry("2026-10-01", {"calories": 2100})["calories_burned"] is None

    def test_upsert_merges_into_existing_day(self, store):
        store.upsert_entry("2026-10-01", {"weight_kg": 80.0})
        merged = store.upsert_entry("2026-10-01", {"calories": 2100})
        assert merged["weight_kg"] == 80.0
        assert merged["calories"] == 2100
        assert len(store.list_entries()) == 1

    def test_upsert_can_clear_a_field(self, store):
        store.upsert_entry("2026-10-01", {"weight_kg": 80.0, "calories": 2100})
        cleared = store.upsert_entry("2026-10-01", {"calories": None})
        assert cleared["calories"] is None
        assert cleared["weight_kg"] == 80.0

    def test_get_entry_missing_returns_none(self, store):
        assert store.get_entry("2026-10-01") is None

    def test_list_is_sorted_by_date(self, store):
        for d in ("2026-10-03", "2026-10-01", "2026-10-02"):
            store.upsert_entry(d, {"calories": 2000})
        assert [e["date"] for e in store.list_entries()] == ["2026-10-01", "2026-10-02", "2026-10-03"]

    def test_list_filters_by_inclusive_range(self, store):
        for d in ("2026-10-01", "2026-10-05", "2026-10-09"):
            store.upsert_entry(d, {"calories": 2000})
        got = store.list_entries(date_from="2026-10-05", date_to="2026-10-09")
        assert [e["date"] for e in got] == ["2026-10-05", "2026-10-09"]

    def test_delete_returns_true_then_false(self, store):
        store.upsert_entry("2026-10-01", {"calories": 2000})
        assert store.delete_entry("2026-10-01") is True
        assert store.delete_entry("2026-10-01") is False
        assert store.list_entries() == ()

    def test_list_returns_immutable_tuple(self, store):
        store.upsert_entry("2026-10-01", {"calories": 2000})
        assert isinstance(store.list_entries(), tuple)

    def test_upsert_with_empty_patch_creates_blank_day(self, store):
        e = store.upsert_entry("2026-10-01", {})
        assert e["weight_kg"] is None and e["calories"] is None
