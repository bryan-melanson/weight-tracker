"""Boundary validation.

Nothing reaches the database without passing through here. Every function is
pure: it returns a new normalized value and never mutates its argument.
"""

from collections.abc import Mapping
from datetime import date as date_cls
from math import isfinite

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


_ENTRY_FIELDS = {
    "weight_kg": lambda v: _validate_float(v, "weight_kg", config.MIN_WEIGHT_KG, config.MAX_WEIGHT_KG),
    "calories": lambda v: _validate_int(v, "calories", config.MIN_CALORIES, config.MAX_CALORIES),
    "calories_burned": lambda v: _validate_int(
        v, "calories_burned", config.MIN_CALORIES, config.MAX_CALORIES
    ),
    "calorie_target": lambda v: _validate_int(v, "calorie_target", config.MIN_TARGET, config.MAX_TARGET),
    "note": _validate_note,
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
