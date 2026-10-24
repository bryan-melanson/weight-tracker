"""The browser backend carries its own copy of the domain limits.

static/js/backend/limits.js mirrors tracker/config.py so the IndexedDB backend
rejects exactly what the server rejects. Nothing links the two files at
runtime, so these tests are what stop them drifting apart: change a bound in
config.py without changing limits.js and one of these fails.
"""

import re
from pathlib import Path

import pytest

from tracker import config

LIMITS_JS = (config.PROJECT_ROOT / "static" / "js" / "backend" / "limits.js").read_text()
FORMAT_JS = (config.PROJECT_ROOT / "static" / "js" / "format.js").read_text()

# The bounds declared as `export const NAME = value;` in limits.js.
SCALARS = (
    "MIN_WEIGHT_KG",
    "MAX_WEIGHT_KG",
    "MIN_CALORIES",
    "MAX_CALORIES",
    "MIN_TARGET",
    "MAX_TARGET",
    "MAX_NOTE_LENGTH",
    "MIN_YEAR",
    "MAX_YEAR",
)


def _exported(name: str, source: str = LIMITS_JS) -> str:
    match = re.search(rf"^export const {name} = (.+?);$", source, re.MULTILINE)
    assert match, f"limits.js does not export {name}"
    return match.group(1).strip()


def _strings(literal: str) -> list[str]:
    return re.findall(r"'([^']*)'", literal)


class TestScalarBounds:
    @pytest.mark.parametrize("name", SCALARS)
    def test_matches_config(self, name):
        assert float(_exported(name)) == float(getattr(config, name))

    def test_every_bound_is_covered(self):
        """A new bound in config.py has to be mirrored and listed here."""
        declared = set(re.findall(r"^export const ([A-Z_]+) = [-\d.]+;$", LIMITS_JS, re.MULTILINE))
        assert declared == set(SCALARS)


class TestUnits:
    def test_matches_config(self):
        assert tuple(_strings(_exported("UNITS"))) == config.UNITS


class TestWeekdays:
    """limits.js derives the weekday target fields from format.js's WEEKDAYS,
    so that list is the thing which has to agree with the server."""

    def test_keys_match_config(self):
        keys = re.findall(r"\{ key: '(\w+)',", FORMAT_JS)
        assert tuple(keys) == config.WEEKDAYS

    def test_names_match_config(self):
        pairs = re.findall(r"\{ key: '(\w+)', label: '\w+', name: '(\w+)' \}", FORMAT_JS)
        assert dict(pairs) == config.WEEKDAY_NAMES


class TestDefaultSettings:
    def test_unit_matches_config(self):
        match = re.search(r"^\s+unit: '(\w+)',$", LIMITS_JS, re.MULTILINE)
        assert match and match.group(1) == config.DEFAULT_SETTINGS["unit"]

    def test_default_target_matches_config(self):
        match = re.search(r"^\s+default_calorie_target: (\d+),$", LIMITS_JS, re.MULTILINE)
        assert match and int(match.group(1)) == config.DEFAULT_SETTINGS["default_calorie_target"]

    def test_goal_fields_default_to_unset(self):
        for field in ("goal_weight_kg", "goal_date"):
            assert re.search(rf"^\s+{field}: null,$", LIMITS_JS, re.MULTILINE)
            assert config.DEFAULT_SETTINGS[field] is None


class TestEnergyEquivalent:
    def test_kcal_per_kg_matches_config(self):
        """format.js owns this one; stats.js derives the balance chart from it."""
        assert float(_exported("KCAL_PER_KG", FORMAT_JS)) == float(config.KCAL_PER_KG)

    def test_lb_per_kg_matches_config(self):
        assert float(_exported("LB_PER_KG", FORMAT_JS)) == float(config.LB_PER_KG)
