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
MIN_HEIGHT_CM = 50.0
MAX_HEIGHT_CM = 280.0

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
CM_PER_IN = 2.54

# The profile behind the maintenance estimate. Mifflin-St Jeor needs a weight,
# a height, an age and one of two sex constants; it is defined for those two
# only, which is why this is not a broader list.
SEXES = ("male", "female")

# Resting energy times one of these gives maintenance. Logged exercise is
# netted out of intake separately, so the level to pick is the one describing
# everything apart from the workouts being logged.
ACTIVITY_LEVELS = (
    ("sedentary", 1.2, "Sedentary — desk job, little walking"),
    ("light", 1.375, "Lightly active — walking most days"),
    ("moderate", 1.55, "Moderately active — on your feet all day"),
    ("very", 1.725, "Very active — physical job"),
    ("extra", 1.9, "Extremely active — heavy physical job"),
)
ACTIVITY_KEYS = tuple(key for key, _factor, _label in ACTIVITY_LEVELS)
ACTIVITY_FACTORS = {key: factor for key, factor, _label in ACTIVITY_LEVELS}
DEFAULT_ACTIVITY_LEVEL = "sedentary"

# The settings that make up that profile. All four are needed before a
# maintenance estimate can be made (activity_level falls back to the default).
PROFILE_FIELDS = ("height_cm", "birth_date", "sex", "activity_level")

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
    # The maintenance profile. Unset until it is filled in, and the running
    # balance falls back to the calorie targets until it is.
    "height_cm": None,
    "birth_date": None,
    "sex": None,
    "activity_level": None,
    # Unset by default: an empty weekday falls back to the default target.
    **{field: None for field in WEEKDAY_TARGET_FIELDS},
}

# Energy equivalent of one kilogram of body mass, used to translate a running
# calorie balance into an expected weight change.
KCAL_PER_KG = 7700
