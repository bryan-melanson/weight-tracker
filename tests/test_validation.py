import pytest

from tracker import config
from tracker.validation import (
    ValidationError,
    validate_date,
    validate_entry_patch,
    validate_settings_patch,
)


class TestValidateDate:
    def test_accepts_iso_date(self):
        assert validate_date("2026-10-23") == "2026-10-23"

    def test_strips_whitespace(self):
        assert validate_date("  2026-10-23 ") == "2026-10-23"

    @pytest.mark.parametrize(
        "bad", ["", "23-10-2026", "2026-13-01", "2026-10-32", "today", None, 42, "1899-01-01", "2200-01-01"]
    )
    def test_rejects_bad_dates(self, bad):
        with pytest.raises(ValidationError):
            validate_date(bad)


class TestValidateEntryPatch:
    def test_normalizes_fields(self):
        out = validate_entry_patch({"weight_kg": "80.5", "calories": "2100", "calorie_target": 2000})
        assert out == {"weight_kg": 80.5, "calories": 2100, "calorie_target": 2000}

    def test_does_not_mutate_input(self):
        src = {"weight_kg": "80.5"}
        validate_entry_patch(src)
        assert src == {"weight_kg": "80.5"}

    def test_allows_explicit_null_to_clear(self):
        assert validate_entry_patch({"weight_kg": None}) == {"weight_kg": None}

    def test_blank_string_clears_value(self):
        assert validate_entry_patch({"calories": ""}) == {"calories": None}

    def test_trims_and_limits_note(self):
        assert validate_entry_patch({"note": "  hi  "}) == {"note": "hi"}
        with pytest.raises(ValidationError):
            validate_entry_patch({"note": "x" * 501})

    def test_rejects_unknown_field(self):
        with pytest.raises(ValidationError):
            validate_entry_patch({"nope": 1})

    def test_rejects_non_mapping(self):
        with pytest.raises(ValidationError):
            validate_entry_patch([1, 2])

    @pytest.mark.parametrize("weight", [0, -5, 9.9, 700.1, "heavy", float("nan"), float("inf")])
    def test_rejects_out_of_range_weight(self, weight):
        with pytest.raises(ValidationError):
            validate_entry_patch({"weight_kg": weight})

    @pytest.mark.parametrize("cals", [-1, 20001, "lots", 1.5])
    def test_rejects_bad_calories(self, cals):
        with pytest.raises(ValidationError):
            validate_entry_patch({"calories": cals})

    def test_normalizes_calories_burned(self):
        assert validate_entry_patch({"calories_burned": "450"}) == {"calories_burned": 450}

    def test_blank_string_clears_calories_burned(self):
        assert validate_entry_patch({"calories_burned": ""}) == {"calories_burned": None}

    @pytest.mark.parametrize("burned", [-1, 20001, "a jog", 1.5, True])
    def test_rejects_bad_calories_burned(self, burned):
        with pytest.raises(ValidationError):
            validate_entry_patch({"calories_burned": burned})

    def test_calories_burned_message_names_the_field(self):
        with pytest.raises(ValidationError) as excinfo:
            validate_entry_patch({"calories_burned": -1})
        assert "Calories burned" in excinfo.value.message
        assert excinfo.value.field == "calories_burned"

    def test_empty_patch_is_allowed(self):
        assert validate_entry_patch({}) == {}


class TestValidateSettingsPatch:
    def test_normalizes_fields(self):
        out = validate_settings_patch(
            {"unit": "LB", "default_calorie_target": "2000", "goal_weight_kg": "75", "goal_date": "2026-12-31"}
        )
        assert out == {
            "unit": "lb",
            "default_calorie_target": 2000,
            "goal_weight_kg": 75.0,
            "goal_date": "2026-12-31",
        }

    def test_accepts_a_target_for_each_weekday(self):
        patch = {f"calorie_target_{day}": 1800 + index * 50 for index, day in enumerate(config.WEEKDAYS)}
        assert validate_settings_patch(patch) == patch

    def test_normalizes_a_weekday_target(self):
        assert validate_settings_patch({"calorie_target_mon": "2100"}) == {"calorie_target_mon": 2100}

    def test_blank_weekday_target_falls_back_to_the_default(self):
        assert validate_settings_patch({"calorie_target_sat": ""}) == {"calorie_target_sat": None}

    @pytest.mark.parametrize("bad", [0, -1, 20001, "lots", 1.5])
    def test_rejects_out_of_range_weekday_target(self, bad):
        with pytest.raises(ValidationError):
            validate_settings_patch({"calorie_target_wed": bad})

    def test_weekday_target_message_names_the_day(self):
        with pytest.raises(ValidationError) as excinfo:
            validate_settings_patch({"calorie_target_thu": 0})
        assert "Thursday" in excinfo.value.message
        assert excinfo.value.field == "calorie_target_thu"

    def test_rejects_an_unknown_weekday(self):
        with pytest.raises(ValidationError):
            validate_settings_patch({"calorie_target_funday": 2000})

    def test_rejects_unknown_unit(self):
        with pytest.raises(ValidationError):
            validate_settings_patch({"unit": "stone"})

    def test_goal_fields_are_nullable(self):
        out = validate_settings_patch({"goal_weight_kg": None, "goal_date": ""})
        assert out == {"goal_weight_kg": None, "goal_date": None}

    def test_default_target_must_be_positive(self):
        with pytest.raises(ValidationError):
            validate_settings_patch({"default_calorie_target": 0})

    def test_rejects_unknown_field(self):
        with pytest.raises(ValidationError):
            validate_settings_patch({"admin": True})


class TestErrorMessages:
    def test_names_the_field_in_plain_language(self):
        with pytest.raises(ValidationError) as exc:
            validate_entry_patch({"calories": 999_999})
        assert str(exc.value).startswith("Calories must be between")
        assert exc.value.field == "calories"

    def test_weight_message_states_the_unit(self):
        with pytest.raises(ValidationError) as exc:
            validate_entry_patch({"weight_kg": 5})
        assert "kilograms" in str(exc.value)

    def test_settings_messages_are_readable(self):
        with pytest.raises(ValidationError) as exc:
            validate_settings_patch({"default_calorie_target": 0})
        assert str(exc.value).startswith("Daily calorie target must be between")
