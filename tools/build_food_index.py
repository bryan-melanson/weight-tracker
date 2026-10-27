"""Build the offline food index from USDA FoodData Central.

    python3 tools/build_food_index.py            # download and build
    python3 tools/build_food_index.py a.zip b.zip  # build from local zips

Reads the SR Legacy and Foundation Foods CSV releases and writes
static/foods.json: every food's name, its calories per 100 g, and the
household portions USDA measured for it ("1 cup, chopped" = 160 g). Nothing
else from the release is kept, so the file stays small enough to precache.

FoodData Central is published by the USDA Agricultural Research Service and is
in the public domain (CC0 1.0). This script is only run to refresh the index;
the app never downloads anything itself.

Standard library only, like the rest of the project.
"""

import csv
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "static" / "foods.json"

BASE = "https://fdc.nal.usda.gov/fdc-datasets/"
RELEASES = (
    BASE + "FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    BASE + "FoodData_Central_foundation_food_csv_2026-04-30.zip",
)

KEPT_TYPES = {"sr_legacy_food": "sr", "foundation_food": "foundation"}

# Energy, in the order to trust it. SR Legacy reports "Energy" in kcal; many
# Foundation foods report only the Atwater-factor energies instead.
ENERGY_PREFERENCE = (
    "Energy",
    "Energy (Atwater Specific Factors)",
    "Energy (Atwater General Factors)",
)

# measure_unit.csv names that carry no meaning of their own; the portion's
# modifier or description says what the measure is.
VAGUE_UNITS = {"", "undetermined", "unknown"}


def _open_zip(source: str) -> zipfile.ZipFile:
    if source.startswith("https://"):
        print(f"downloading {source}", file=sys.stderr)
        with urllib.request.urlopen(source, timeout=300) as response:
            return zipfile.ZipFile(io.BytesIO(response.read()))
    return zipfile.ZipFile(source)


def _rows(archive: zipfile.ZipFile, name: str):
    """Yield the rows of one CSV, wherever the release nests it."""
    matches = [entry for entry in archive.namelist() if entry.rsplit("/", 1)[-1] == name]
    if not matches:
        return
    with archive.open(matches[0]) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def _number(text) -> float | None:
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if value == value else None  # drop NaN


def _trim(value: float) -> float | int:
    """Round for the output file, and write whole numbers without '.0'."""
    rounded = round(value, 1)
    return int(rounded) if rounded.is_integer() else rounded


def portion_label(unit: str, description: str, modifier: str) -> str:
    """Name one portion, as a single measure of it ("cup, chopped").

    SR Legacy puts the measure in `modifier` and leaves the unit undetermined;
    Foundation Foods names the unit and uses `modifier` for detail. Either way
    the amount is left out: grams are normalized to one of the measure, so the
    person picks how many.
    """
    description = (description or "").strip()
    modifier = (modifier or "").strip()
    unit = (unit or "").strip()
    if unit.lower() in VAGUE_UNITS:
        unit = ""
    # A bare number in `modifier` is an SR measure code, not a word.
    if modifier.replace(".", "", 1).isdigit():
        modifier = ""
    parts = [part for part in (unit, description, modifier) if part]
    return ", ".join(dict.fromkeys(parts))  # drop exact repeats, keep order


def build(archives) -> dict:
    foods: dict[str, dict] = {}
    energy_ids: dict[str, int] = {}
    units: dict[str, str] = {}

    for archive in archives:
        for row in _rows(archive, "nutrient.csv"):
            if row.get("unit_name", "").upper() == "KCAL" and row["name"] in ENERGY_PREFERENCE:
                energy_ids[row["id"]] = ENERGY_PREFERENCE.index(row["name"])
        for row in _rows(archive, "measure_unit.csv"):
            units[row["id"]] = row["name"]
        for row in _rows(archive, "food.csv"):
            source = KEPT_TYPES.get(row.get("data_type", ""))
            name = (row.get("description") or "").strip()
            if source and name:
                foods[row["fdc_id"]] = {"name": name, "source": source, "energy": {}, "portions": {}}

    for archive in archives:
        for row in _rows(archive, "food_nutrient.csv"):
            food = foods.get(row["fdc_id"])
            rank = energy_ids.get(row["nutrient_id"])
            amount = _number(row.get("amount"))
            if food is not None and rank is not None and amount is not None and amount >= 0:
                food["energy"].setdefault(rank, amount)
        for row in _rows(archive, "food_portion.csv"):
            food = foods.get(row["fdc_id"])
            grams = _number(row.get("gram_weight"))
            amount = _number(row.get("amount"))
            if food is None or not grams or grams <= 0:
                continue
            if amount is not None and amount <= 0:
                continue
            label = portion_label(
                units.get(row.get("measure_unit_id", ""), ""),
                row.get("portion_description", ""),
                row.get("modifier", ""),
            )
            if label:
                food["portions"].setdefault(label, grams / (amount or 1))

    # The two releases, and Foundation Foods within itself, list some foods
    # more than once under one name ("Broccoli, raw" three times). Offering
    # three identical rows is noise, so they merge: the energy of the most
    # recently analysed one — Foundation over SR Legacy — and every measure
    # any of them had.
    merged: dict[str, dict] = {}
    order = sorted(foods.values(), key=lambda food: food["source"] != "foundation")
    for food in order:
        if not food["energy"]:
            continue  # nothing to count it by
        kcal = food["energy"][min(food["energy"])]
        into = merged.setdefault(food["name"], {"kcal": kcal, "portions": {}})
        for label, grams in food["portions"].items():
            into["portions"].setdefault(label, grams)

    out = []
    for name, food in merged.items():
        portions = [[label, _trim(grams)] for label, grams in food["portions"].items() if _trim(grams) > 0]
        out.append([name, _trim(food["kcal"]), portions])
    out.sort(key=lambda item: item[0].lower())

    return {
        "source": "USDA FoodData Central: SR Legacy (2018-04) and Foundation Foods (2026-04). Public domain.",
        "fields": ["name", "kcal_per_100g", "portions[label, grams]"],
        "foods": out,
    }


def main(argv: list[str]) -> int:
    sources = argv or list(RELEASES)
    index = build([_open_zip(source) for source in sources])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # One food per line: compact, but a refresh still diffs readably.
    lines = [json.dumps(food, ensure_ascii=False, separators=(",", ":")) for food in index["foods"]]
    header = {key: value for key, value in index.items() if key != "foods"}
    text = json.dumps(header, ensure_ascii=False)[:-1] + ',"foods":[\n' + ",\n".join(lines) + "\n]}\n"
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"wrote {len(lines)} foods to {OUTPUT.relative_to(ROOT)} ({len(text.encode()) // 1024} KiB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
