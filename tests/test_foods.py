"""The food log: validation, the calories rule, storage and CSV.

A day's foods live on its entry, and whenever a day has any its calories are
their total. tests/js/foods.test.js runs the same cases against the browser
port; both round-trip tests/fixtures/food-log.csv byte for byte, which is what
keeps an export from one backend importable into the other.
"""

import sqlite3
from pathlib import Path

import pytest

from tracker import config
from tracker.api import dispatch
from tracker.store import Store
from tracker.validation import ValidationError, food_kcal, food_total, validate_entry_patch, validate_foods

FIXTURE = Path(__file__).parent / "fixtures" / "food-log.csv"


def item(**overrides):
    return {"name": "Bananas, raw", "portion": "medium", "quantity": 1, "unit_kcal": 105, "unit_grams": 118, **overrides}


class TestValidateFoods:
    def test_normalizes_key_order_and_defaults(self):
        assert validate_foods([{"unit_kcal": 300, "quantity": 2, "name": " Oats "}]) == [
            {"name": "Oats", "portion": "", "quantity": 2, "unit_kcal": 300, "unit_grams": None}
        ]

    def test_accepts_json_text(self):
        assert validate_foods('[{"name":"Oats","quantity":1,"unit_kcal":300}]')[0]["name"] == "Oats"

    def test_whole_floats_become_ints(self):
        food = validate_foods([item(quantity=2.0, unit_kcal=105.0)])[0]
        assert food["quantity"] == 2 and isinstance(food["quantity"], int)

    @pytest.mark.parametrize(
        ("value", "message"),
        [
            ("not json", "JSON list"),
            ({"name": "x"}, "must be a list"),
            ([1], "Food 1 must be an object"),
            ([item(colour="red")], "unknown field"),
            ([{"name": "x", "quantity": 1}], "missing 'unit_kcal'"),
            ([item(name="  ")], "name is required"),
            ([item(name="x" * (config.MAX_FOOD_NAME_LENGTH + 1))], "characters or fewer"),
            ([item(name="tab\there")], "control characters"),
            ([item(quantity="1")], "quantity must be a number"),
            ([item(quantity=True)], "quantity must be a number"),
            ([item(quantity=0)], "quantity must be between"),
            ([item(unit_kcal=-1)], "calories must be between"),
            ([item(unit_grams=0)], "grams must be above"),
            ([item(quantity=1000, unit_kcal=900)], "more than 20,000 kcal"),
            ([item(unit_kcal=5000)] * 5, "The day's foods come to more than"),
            ([item()] * (config.MAX_FOODS_PER_DAY + 1), "at most"),
        ],
    )
    def test_rejects(self, value, message):
        with pytest.raises(ValidationError, match=message) as caught:
            validate_foods(value)
        assert caught.value.field == "foods"

    def test_names_the_offending_item(self):
        with pytest.raises(ValidationError, match="Food 2 quantity"):
            validate_foods([item(), item(quantity=-1)])

    def test_blank_clears(self):
        assert validate_entry_patch({"foods": ""}) == {"foods": None}
        assert validate_entry_patch({"foods": None}) == {"foods": None}


class TestKcal:
    def test_multiplies_quantity_by_one_portion(self):
        assert food_kcal(item(quantity=1.5, unit_kcal=105.02)) == 158

    def test_rounds_half_up_not_to_even(self):
        # round() would give 2 for 2.5: the browser's Math.floor(x + 0.5) gives 3.
        assert food_kcal(item(quantity=1, unit_kcal=2.5)) == 3
        assert food_kcal(item(quantity=1, unit_kcal=0.5)) == 1

    def test_total_sums_rounded_items(self):
        assert food_total([item(unit_kcal=0.5), item(unit_kcal=0.5)]) == 2
        assert food_total(None) == 0


def save(store, date, **patch):
    return store.upsert_entry(date, validate_entry_patch(patch))


class TestCaloriesRule:
    def test_foods_set_calories(self, store):
        assert save(store, "2026-10-01", foods=[item(), item(unit_kcal=300)])["calories"] == 405

    def test_calories_alone_cannot_contradict_foods(self, store):
        save(store, "2026-10-01", foods=[item()])
        assert save(store, "2026-10-01", calories=5000)["calories"] == 105

    def test_other_fields_leave_foods_alone(self, store):
        save(store, "2026-10-01", foods=[item()])
        entry = save(store, "2026-10-01", weight_kg=80, note="fine")
        assert entry["calories"] == 105 and len(entry["foods"]) == 1

    def test_clearing_foods_clears_their_total(self, store):
        save(store, "2026-10-01", foods=[item()])
        entry = save(store, "2026-10-01", foods=[])
        assert entry["foods"] is None and entry["calories"] is None

    def test_clearing_foods_can_set_a_number_instead(self, store):
        save(store, "2026-10-01", foods=[item()])
        assert save(store, "2026-10-01", foods=[], calories=1900)["calories"] == 1900

    def test_empty_foods_on_a_manual_day_keep_its_number(self, store):
        """An imported row with an empty foods cell must not wipe a hand-typed total."""
        save(store, "2026-10-01", calories=1900)
        assert save(store, "2026-10-01", foods=None)["calories"] == 1900

    def test_days_without_foods_behave_as_before(self, store):
        assert save(store, "2026-10-01", calories=1900)["calories"] == 1900
        assert store.get_entry("2026-10-01")["foods"] is None


class TestStorage:
    def test_round_trips_through_reopen(self, tmp_path):
        path = tmp_path / "t.db"
        first = Store(path)
        save(first, "2026-10-01", foods=[item(name="Café au lait", quantity=0.5)])
        first.close()
        second = Store(path)
        try:
            assert second.get_entry("2026-10-01")["foods"][0]["name"] == "Café au lait"
            assert second.list_entries()[0]["foods"][0]["quantity"] == 0.5
        finally:
            second.close()

    def test_adds_the_column_to_an_older_database(self, tmp_path):
        path = tmp_path / "v3.db"
        legacy = sqlite3.connect(path)
        legacy.executescript(
            """
            CREATE TABLE entries (
                date TEXT PRIMARY KEY, weight_kg REAL, calories INTEGER,
                calories_burned INTEGER, calorie_target INTEGER, note TEXT,
                updated_at TEXT NOT NULL
            );
            INSERT INTO entries (date, calories, updated_at) VALUES ('2026-10-01', 2100, '2026-10-01T00:00:00');
            """
        )
        legacy.commit()
        legacy.close()
        store = Store(path)
        try:
            assert store.get_entry("2026-10-01")["foods"] is None
            assert store.get_entry("2026-10-01")["calories"] == 2100
            assert save(store, "2026-10-01", foods=[item()])["calories"] == 105
        finally:
            store.close()


class TestApi:
    def test_put_with_foods(self, store):
        status, payload = dispatch(store, "PUT", "/api/entries/2026-10-01", body={"foods": [item(quantity=2)]})
        assert status == 200
        assert payload["data"]["calories"] == 210

    def test_put_rejects_a_bad_item(self, store):
        status, payload = dispatch(store, "PUT", "/api/entries/2026-10-01", body={"foods": [item(quantity=-2)]})
        assert status == 400 and payload["field"] == "foods"

    def test_csv_round_trips_the_fixture_byte_for_byte(self, store):
        text = FIXTURE.read_text(encoding="utf-8")
        assert dispatch(store, "POST", "/api/import.csv", body={"csv": text})[0] == 200
        assert dispatch(store, "GET", "/api/export.csv")[1]["csv"] == text

    def test_import_recomputes_calories_from_foods(self, store):
        text = 'date,calories,foods\n2026-10-01,9999,"[{""name"":""Oats"",""quantity"":1,""unit_kcal"":300}]"\n'
        dispatch(store, "POST", "/api/import.csv", body={"csv": text})
        assert store.get_entry("2026-10-01")["calories"] == 300

    def test_import_reports_the_row_of_a_bad_food_cell(self, store):
        text = "date,foods\n2026-10-01,[]\n2026-10-02,oops\n"
        status, payload = dispatch(store, "POST", "/api/import.csv", body={"csv": text})
        assert status == 400 and "row 3" in payload["error"]
        assert store.list_entries() == ()
