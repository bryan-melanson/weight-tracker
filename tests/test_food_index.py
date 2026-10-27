"""The food index builder, against small fixtures shaped like the USDA releases.

The real releases cannot be fetched in a test, so these reproduce the parts
of their layout the builder depends on: the CSVs nested in a folder, SR Legacy
putting the measure in `modifier` with an undetermined unit, and Foundation
Foods reporting energy only through the Atwater factors.
"""

import csv
import importlib.util
import io
import json
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("build_food_index", ROOT / "tools" / "build_food_index.py")
builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(builder)

INDEX = ROOT / "static" / "foods.json"


def _csv(rows: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def _zip(folder: str, tables: dict[str, list[dict]]) -> zipfile.ZipFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, rows in tables.items():
            archive.writestr(f"{folder}/{name}", _csv(rows))
    buffer.seek(0)
    return zipfile.ZipFile(buffer)


NUTRIENTS = [
    {"id": "1008", "name": "Energy", "unit_name": "KCAL", "nutrient_nbr": "208"},
    {"id": "1062", "name": "Energy", "unit_name": "kJ", "nutrient_nbr": "268"},
    {"id": "2047", "name": "Energy (Atwater General Factors)", "unit_name": "KCAL", "nutrient_nbr": "957"},
    {"id": "2048", "name": "Energy (Atwater Specific Factors)", "unit_name": "KCAL", "nutrient_nbr": "958"},
]
UNITS = [{"id": "9999", "name": "undetermined"}, {"id": "1000", "name": "cup"}]


def _portion(fdc_id, amount, unit, description, modifier, grams):
    return {
        "id": f"{fdc_id}-{modifier}-{grams}",
        "fdc_id": fdc_id,
        "seq_num": "1",
        "amount": amount,
        "measure_unit_id": unit,
        "portion_description": description,
        "modifier": modifier,
        "gram_weight": grams,
    }


@pytest.fixture
def sr_legacy():
    return _zip(
        "FoodData_Central_sr_legacy_food_csv_2018-04",
        {
            "nutrient.csv": NUTRIENTS,
            "measure_unit.csv": UNITS,
            "food.csv": [
                {"fdc_id": "1", "data_type": "sr_legacy_food", "description": "Bananas, raw"},
                {"fdc_id": "2", "data_type": "sr_legacy_food", "description": "Almonds"},
                {"fdc_id": "3", "data_type": "sr_legacy_food", "description": "Mystery, no energy"},
                {"fdc_id": "4", "data_type": "branded_food", "description": "Some Brand Bar"},
            ],
            "food_nutrient.csv": [
                {"id": "a", "fdc_id": "1", "nutrient_id": "1008", "amount": "89"},
                {"id": "b", "fdc_id": "1", "nutrient_id": "1062", "amount": "371"},
                {"id": "c", "fdc_id": "2", "nutrient_id": "1008", "amount": "579"},
                {"id": "d", "fdc_id": "4", "nutrient_id": "1008", "amount": "400"},
            ],
            "food_portion.csv": [
                _portion("1", "1", "9999", "", "cup, mashed", "225"),
                _portion("1", "1", "9999", "", "medium (7\" to 7-7/8\" long)", "118"),
                _portion("1", "0.5", "9999", "", "cup, sliced", "75"),
                _portion("2", "10", "9999", "", "almonds", "12"),
                _portion("2", "1", "9999", "", "12", "28.35"),  # an SR measure code
                _portion("2", "1", "9999", "", "oz", "0"),  # no weight: dropped
            ],
        },
    )


@pytest.fixture
def foundation():
    return _zip(
        "FoodData_Central_foundation_food_csv_2026-04-30",
        {
            "nutrient.csv": NUTRIENTS,
            "measure_unit.csv": UNITS,
            "food.csv": [
                {"fdc_id": "10", "data_type": "foundation_food", "description": "Oats, whole grain, rolled"},
                {"fdc_id": "11", "data_type": "sample_food", "description": "Oats sample 4"},
            ],
            "food_nutrient.csv": [
                {"id": "e", "fdc_id": "10", "nutrient_id": "2047", "amount": "382"},
                {"id": "f", "fdc_id": "10", "nutrient_id": "2048", "amount": "375"},
            ],
            "food_portion.csv": [_portion("10", "1", "1000", "", "", "81")],
        },
    )


def _by_name(index):
    return {name: (kcal, portions) for name, kcal, portions in index["foods"]}


class TestBuild:
    def test_keeps_only_generic_foods_with_energy(self, sr_legacy, foundation):
        foods = _by_name(builder.build([sr_legacy, foundation]))
        assert set(foods) == {"Bananas, raw", "Almonds", "Oats, whole grain, rolled"}

    def test_energy_is_kcal_not_kilojoules(self, sr_legacy):
        assert _by_name(builder.build([sr_legacy]))["Bananas, raw"][0] == 89

    def test_foundation_prefers_atwater_specific(self, foundation):
        assert _by_name(builder.build([foundation]))["Oats, whole grain, rolled"][0] == 375

    def test_portions_are_normalized_to_one_measure(self, sr_legacy):
        portions = dict(_by_name(builder.build([sr_legacy]))["Bananas, raw"][1])
        assert portions["cup, mashed"] == 225
        assert portions["cup, sliced"] == 150  # 75 g was half a cup
        assert portions['medium (7" to 7-7/8" long)'] == 118

    def test_counted_portions_become_one_each(self, sr_legacy):
        assert dict(_by_name(builder.build([sr_legacy]))["Almonds"][1]) == {"almonds": 1.2}

    def test_foundation_names_the_unit(self, foundation):
        assert _by_name(builder.build([foundation]))["Oats, whole grain, rolled"][1] == [["cup", 81]]

    def test_sorted_by_name(self, sr_legacy, foundation):
        names = [food[0] for food in builder.build([sr_legacy, foundation])["foods"]]
        assert names == sorted(names, key=str.lower)


class TestPortionLabel:
    @pytest.mark.parametrize(
        ("unit", "description", "modifier", "expected"),
        [
            ("undetermined", "", "cup, chopped", "cup, chopped"),
            ("cup", "", "", "cup"),
            ("cup", "", "cup", "cup"),
            ("tbsp", "", "melted", "tbsp, melted"),
            ("undetermined", "1 large", "", "1 large"),
            ("undetermined", "", "42", ""),
        ],
    )
    def test_label(self, unit, description, modifier, expected):
        assert builder.portion_label(unit, description, modifier) == expected


@pytest.mark.skipif(not INDEX.exists(), reason="food index not built yet")
class TestCommittedIndex:
    """Sanity checks on the shipped file, which the app trusts as-is."""

    @pytest.fixture(scope="class")
    def index(self):
        return json.loads(INDEX.read_text(encoding="utf-8"))

    def test_has_thousands_of_foods(self, index):
        assert len(index["foods"]) > 5000

    def test_every_food_is_well_formed(self, index):
        for name, kcal, portions in index["foods"]:
            assert isinstance(name, str) and name
            assert isinstance(kcal, (int, float)) and 0 <= kcal <= 1000
            for label, grams in portions:
                assert isinstance(label, str) and label
                assert isinstance(grams, (int, float)) and grams > 0

    def test_small_enough_to_precache(self):
        assert INDEX.stat().st_size < 3 * 1024 * 1024
