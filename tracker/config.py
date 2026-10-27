"""Static configuration and domain limits.

Every bound the validators enforce lives here so there are no magic numbers
scattered through the code.
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "static"
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "tracker.db"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8777

# Hosts allowed in the Host header; anything else is refused so that a DNS
# rebinding attack cannot reach the loopback server from a public page.
ALLOWED_HOST_NAMES = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})

# Mutating requests must carry this header. Browsers forbid custom headers on
# simple cross-origin form posts, so this is a cheap, dependency-free CSRF guard.
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "weight-tracker"

MIN_WEIGHT_KG = 10.0
MAX_WEIGHT_KG = 700.0
MIN_CALORIES = 0
MAX_CALORIES = 20_000
MIN_TARGET = 1
MAX_TARGET = 20_000
MAX_NOTE_LENGTH = 500
MIN_YEAR = 1900
MAX_YEAR = 2100

# The food log: a day's list of items, each a quantity of one portion with the
# energy of a single portion. A day's calories are their sum whenever it has
# any (see validation.food_total).
MAX_FOODS_PER_DAY = 200
MAX_FOOD_NAME_LENGTH = 160
MAX_PORTION_LENGTH = 120
MIN_FOOD_QUANTITY = 0.01
MAX_FOOD_QUANTITY = 10_000
MAX_PORTION_GRAMS = 10_000

UNITS = ("lb", "kg")
LB_PER_KG = 2.2046226218

# The week, in reading order. Each weekday can carry its own calorie target;
# a day's target is resolved from the day's own entry first, then from this
# weekly schedule, then from "default_calorie_target".
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
WEEKDAY_NAMES = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}
WEEKDAY_TARGET_FIELDS = tuple(f"calorie_target_{day}" for day in WEEKDAYS)

DEFAULT_SETTINGS = {
    "unit": "lb",
    "default_calorie_target": 2000,
    "goal_weight_kg": None,
    "goal_date": None,
    # Unset by default: an empty weekday falls back to the default target.
    **{field: None for field in WEEKDAY_TARGET_FIELDS},
}

# Energy equivalent of one kilogram of body mass, used to translate a running
# calorie balance into an expected weight change.
KCAL_PER_KG = 7700
