"""Boundary validation.

Nothing reaches the database without passing through here. Every function is
pure: it returns a new normalized value and never mutates its argument.
"""

import json
from collections.abc import Mapping
from datetime import date as date_cls
from math import floor, isfinite

from . import config


# Human-readable names for the fields, so an error message reads as a sentence
# rather than echoing an internal column name back at the user.
FIELD_LABELS = {
    "date": "Date",
    "weight_kg": "Weight in kilograms",
    "calories": "Calories",
    "calories_burned": "Calories burned",
    "calorie_target": "Calorie target",
    "note": "Note",
    "foods": "Food log",
    "unit": "Unit",
    "default_calorie_target": "Daily calorie target",
    "goal_weight_kg": "Goal weight in kilograms",
    "goal_date": "Goal date",
    "from": "Range start",
    "to": "Range end",
    **{
        f"calorie_target_{day}": f"{name} calorie target"
        for day, name in config.WEEKDAY_NAMES.items()
    },
}


def label(field: str) -> str:
    return FIELD_LABELS.get(field, field)


class ValidationError(ValueError):
    """Raised when untrusted input fails a boundary check."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field


def _is_blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def validate_date(value, field: str = "date") -> str:
    if not isinstance(value, str):
        raise ValidationError("Date must be a string in YYYY-MM-DD form.", field)
    text = value.strip()
    try:
        parsed = date_cls.fromisoformat(text)
    except ValueError:
        raise ValidationError(f"'{text}' is not a valid YYYY-MM-DD date.", field) from None
    if not config.MIN_YEAR <= parsed.year <= config.MAX_YEAR:
        raise ValidationError(
            f"Date must fall between {config.MIN_YEAR} and {config.MAX_YEAR}.", field
        )
    return parsed.isoformat()


def _validate_float(value, field: str, low: float, high: float) -> float:
    if isinstance(value, bool):
        raise ValidationError(f"{label(field)} must be a number.", field)
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{label(field)} must be a number.", field) from None
    if not isfinite(number):
        raise ValidationError(f"{label(field)} must be a finite number.", field)
    if not low <= number <= high:
        raise ValidationError(f"{label(field)} must be between {low:g} and {high:g}.", field)
    return number


def _validate_int(value, field: str, low: int, high: int) -> int:
    if isinstance(value, bool):
        raise ValidationError(f"{label(field)} must be a whole number.", field)
    if isinstance(value, float) and not value.is_integer():
        raise ValidationError(f"{label(field)} must be a whole number.", field)
    if isinstance(value, str):
        value = value.strip()
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{label(field)} must be a whole number.", field) from None
    if not low <= number <= high:
        raise ValidationError(f"{label(field)} must be between {low:,} and {high:,}.", field)
    return number


def _validate_note(value, field: str = "note") -> str:
    if not isinstance(value, str):
        raise ValidationError("Note must be text.", field)
    text = value.strip()
    if len(text) > config.MAX_NOTE_LENGTH:
        raise ValidationError(f"Note must be {config.MAX_NOTE_LENGTH} characters or fewer.", field)
    return text


def _validate_unit(value, field: str = "unit") -> str:
    if not isinstance(value, str):
        raise ValidationError("Unit must be a string.", field)
    unit = value.strip().lower()
    if unit not in config.UNITS:
        raise ValidationError(f"Unit must be one of: {', '.join(config.UNITS)}.", field)
    return unit


FOOD_KEYS = ("name", "portion", "quantity", "unit_kcal", "unit_grams")


def _plain(number: float) -> float | int:
    """A whole number as an int, so the stored JSON reads 105 rather than
    105.0 — which is also what JavaScript writes, keeping both backends'
    exports byte-identical."""
    return int(number) if number.is_integer() else number


def _food_text(value, what: str, limit: int, required: bool) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValidationError(f"{what} must be text.", "foods")
    text = value.strip()
    if required and not text:
        raise ValidationError(f"{what} is required.", "foods")
    if len(text) > limit:
        raise ValidationError(f"{what} must be {limit} characters or fewer.", "foods")
    if any(ord(char) < 32 or ord(char) == 127 for char in text):
        raise ValidationError(f"{what} must not contain control characters.", "foods")
    return text


def _food_number(value, what: str, low: float, high: float, low_inclusive: bool = True) -> float | int:
    # Numbers only, never numeric strings: items always arrive as JSON, and
    # float() and JavaScript's Number() disagree on strings like "1_000".
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{what} must be a number.", "foods")
    number = float(value)
    if not isfinite(number):
        raise ValidationError(f"{what} must be a finite number.", "foods")
    too_low = number < low if low_inclusive else number <= low
    if too_low or number > high:
        bound = f"between {low:g} and {high:g}" if low_inclusive else f"above {low:g} and at most {high:g}"
        raise ValidationError(f"{what} must be {bound}.", "foods")
    return _plain(number)


def food_kcal(item: Mapping) -> int:
    """One item's energy, rounded half up. Spelled out rather than round(),
    which rounds half to even, so JavaScript's port can match it exactly."""
    return floor(item["quantity"] * item["unit_kcal"] + 0.5)


def food_total(foods) -> int:
    return sum(food_kcal(item) for item in foods or ())


def _validate_food(item, position: int) -> dict:
    prefix = f"Food {position}"
    if not isinstance(item, Mapping):
        raise ValidationError(f"{prefix} must be an object.", "foods")
    unknown = sorted(set(item) - set(FOOD_KEYS))
    if unknown:
        raise ValidationError(f"{prefix} has unknown field(s): {', '.join(unknown)}.", "foods")
    for key in ("name", "quantity", "unit_kcal"):
        if key not in item:
            raise ValidationError(f"{prefix} is missing '{key}'.", "foods")
    grams = item.get("unit_grams")
    food = {
        "name": _food_text(item["name"], f"{prefix} name", config.MAX_FOOD_NAME_LENGTH, True),
        "portion": _food_text(item.get("portion"), f"{prefix} portion", config.MAX_PORTION_LENGTH, False),
        "quantity": _food_number(
            item["quantity"], f"{prefix} quantity", config.MIN_FOOD_QUANTITY, config.MAX_FOOD_QUANTITY
        ),
        "unit_kcal": _food_number(item["unit_kcal"], f"{prefix} calories", 0, config.MAX_CALORIES),
        "unit_grams": None
        if grams is None
        else _food_number(grams, f"{prefix} grams", 0, config.MAX_PORTION_GRAMS, low_inclusive=False),
    }
    if food_kcal(food) > config.MAX_CALORIES:
        raise ValidationError(f"{prefix} comes to more than {config.MAX_CALORIES:,} kcal.", "foods")
    return food


def validate_foods(value, field: str = "foods") -> list[dict]:
    """A day's food log: a list of items, or the same list as JSON text (how
    it arrives from a CSV cell). Returns normalized copies in a fixed key
    order, so the stored JSON is the same whichever backend wrote it."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise ValidationError("Food log must be a JSON list.", field) from None
    if not isinstance(value, list):
        raise ValidationError("Food log must be a list.", field)
    if len(value) > config.MAX_FOODS_PER_DAY:
        raise ValidationError(f"A day can hold at most {config.MAX_FOODS_PER_DAY} foods.", field)
    foods = [_validate_food(item, position) for position, item in enumerate(value, start=1)]
    if food_total(foods) > config.MAX_CALORIES:
        raise ValidationError(f"The day's foods come to more than {config.MAX_CALORIES:,} kcal.", field)
    return foods


def encode_foods(foods) -> str:
    """The stored and exported form: compact JSON, keys in FOOD_KEYS order."""
    return json.dumps(
        [{key: item[key] for key in FOOD_KEYS} for item in foods],
        ensure_ascii=False,
        separators=(",", ":"),
    )


_ENTRY_FIELDS = {
    "weight_kg": lambda v: _validate_float(v, "weight_kg", config.MIN_WEIGHT_KG, config.MAX_WEIGHT_KG),
    "calories": lambda v: _validate_int(v, "calories", config.MIN_CALORIES, config.MAX_CALORIES),
    "calories_burned": lambda v: _validate_int(
        v, "calories_burned", config.MIN_CALORIES, config.MAX_CALORIES
    ),
    "calorie_target": lambda v: _validate_int(v, "calorie_target", config.MIN_TARGET, config.MAX_TARGET),
    "note": _validate_note,
    "foods": validate_foods,
}


def _target_validator(field: str):
    """Bind the field name, so a rejected value names the weekday it came from."""
    return lambda value: _validate_int(value, field, config.MIN_TARGET, config.MAX_TARGET)


_SETTINGS_FIELDS = {
    "unit": _validate_unit,
    "default_calorie_target": lambda v: _validate_int(
        v, "default_calorie_target", config.MIN_TARGET, config.MAX_TARGET
    ),
    "goal_weight_kg": lambda v: _validate_float(
        v, "goal_weight_kg", config.MIN_WEIGHT_KG, config.MAX_WEIGHT_KG
    ),
    "goal_date": lambda v: validate_date(v, "goal_date"),
    **{field: _target_validator(field) for field in config.WEEKDAY_TARGET_FIELDS},
}

# Fields that may be cleared by sending null or an empty string.
_NULLABLE = frozenset(
    {
        "weight_kg",
        "calories",
        "calories_burned",
        "calorie_target",
        "note",
        "foods",
        "goal_weight_kg",
        "goal_date",
        *config.WEEKDAY_TARGET_FIELDS,
    }
)


def _validate_patch(patch, validators: dict, kind: str) -> dict:
    if not isinstance(patch, Mapping):
        raise ValidationError(f"{kind} must be a JSON object.")
    unknown = sorted(set(patch) - set(validators))
    if unknown:
        raise ValidationError(f"Unknown field(s): {', '.join(unknown)}.", unknown[0])
    result = {}
    for field, raw in patch.items():
        if _is_blank(raw) and field in _NULLABLE:
            result[field] = None
        else:
            result[field] = validators[field](raw)
    return result


def validate_entry_patch(patch) -> dict:
    """Return a normalized copy of a daily-entry patch."""
    return _validate_patch(patch, _ENTRY_FIELDS, "Entry")


def validate_settings_patch(patch) -> dict:
    """Return a normalized copy of a settings patch."""
    return _validate_patch(patch, _SETTINGS_FIELDS, "Settings")
