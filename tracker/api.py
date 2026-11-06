"""HTTP-shaped routing over the store.

`dispatch` is transport-agnostic: it takes a parsed request and returns a
`(status, payload)` pair, which makes every route directly unit-testable.
All responses use one envelope: {"ok": bool, "data"|"error": ...}.
"""

import csv
import io
from collections.abc import Mapping
from urllib.parse import parse_qs

from .store import Store
from .validation import (
    ValidationError,
    encode_foods,
    validate_date,
    validate_entry_patch,
    validate_settings_patch,
)

CSV_KEY = "csv"
CSV_COLUMNS = ("date", "weight_kg", "calories", "calories_burned", "calorie_target", "note", "foods")

_ENTRY_PREFIX = "/api/entries/"


def _ok(data=None, **extra) -> dict:
    return {"ok": True, "data": data, **extra}


def _err(message: str, field: str | None = None) -> dict:
    return {"ok": False, "error": message, "field": field}


def _require_mapping(body) -> dict:
    if body is None:
        return {}
    if not isinstance(body, Mapping):
        raise ValidationError("Request body must be a JSON object.")
    return dict(body)


def _range_from_query(query: str) -> tuple[str | None, str | None]:
    params = parse_qs(query or "")
    date_from = params.get("from", [None])[0]
    date_to = params.get("to", [None])[0]
    return (
        validate_date(date_from, "from") if date_from else None,
        validate_date(date_to, "to") if date_to else None,
    )


def _csv_cell(entry: dict, column: str):
    value = entry[column]
    if value is None:
        return ""
    # The food log travels as one JSON cell, so a day stays one row and a
    # file without the column still imports.
    return encode_foods(value) if column == "foods" else value


def _export_csv(store: Store) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for entry in store.list_entries():
        writer.writerow([_csv_cell(entry, column) for column in CSV_COLUMNS])
    return buffer.getvalue()


def _import_csv(store: Store, text: str) -> int:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "date" not in reader.fieldnames:
        raise ValidationError("CSV must have a header row including a 'date' column.", CSV_KEY)
    unknown = sorted(set(reader.fieldnames) - set(CSV_COLUMNS))
    if unknown:
        raise ValidationError(f"CSV has unsupported column(s): {', '.join(unknown)}.", CSV_KEY)

    staged = []
    for offset, row in enumerate(reader, start=2):  # row 1 is the header
        try:
            date = validate_date(row.get("date"))
            patch = validate_entry_patch(
                {column: row[column] for column in CSV_COLUMNS if column != "date" and column in row}
            )
        except ValidationError as exc:
            raise ValidationError(f"CSV row {offset}: {exc.message}", exc.field) from None
        staged.append((date, patch))

    # Validate the whole file before writing any of it, so a bad row late in
    # the file cannot leave a half-applied import behind.
    for date, patch in staged:
        store.upsert_entry(date, patch)
    return len(staged)


def _dispatch_settings(store: Store, method: str, body) -> tuple[int, dict]:
    if method == "GET":
        return 200, _ok(store.get_settings())
    if method == "PUT":
        patch = validate_settings_patch(_require_mapping(body))
        return 200, _ok(store.update_settings(patch))
    return 405, _err(f"Method {method} is not allowed on /api/settings.")


def _dispatch_entry_collection(store: Store, method: str, query: str) -> tuple[int, dict]:
    if method != "GET":
        return 405, _err(f"Method {method} is not allowed on /api/entries.")
    date_from, date_to = _range_from_query(query)
    return 200, _ok(list(store.list_entries(date_from, date_to)))


def _dispatch_single_entry(store: Store, method: str, raw_date: str, body) -> tuple[int, dict]:
    date = validate_date(raw_date)
    if method == "GET":
        entry = store.get_entry(date)
        return (200, _ok(entry)) if entry else (404, _err(f"No entry recorded for {date}."))
    if method == "PUT":
        patch = validate_entry_patch(_require_mapping(body))
        return 200, _ok(store.upsert_entry(date, patch))
    if method == "DELETE":
        if store.delete_entry(date):
            return 200, _ok({"date": date, "deleted": True})
        return 404, _err(f"No entry recorded for {date}.")
    return 405, _err(f"Method {method} is not allowed on this entry.")


def dispatch(store: Store, method: str, path: str, query: str = "", body=None) -> tuple[int, dict]:
    """Route one API request. Returns (http status, JSON-serializable payload)."""
    try:
        if path == "/api/state":
            if method != "GET":
                return 405, _err(f"Method {method} is not allowed on /api/state.")
            return 200, _ok({"settings": store.get_settings(), "entries": list(store.list_entries())})

        if path == "/api/settings":
            return _dispatch_settings(store, method, body)

        if path in ("/api/entries", "/api/entries/"):
            return _dispatch_entry_collection(store, method, query)

        if path.startswith(_ENTRY_PREFIX):
            return _dispatch_single_entry(store, method, path[len(_ENTRY_PREFIX) :], body)

        if path == "/api/export.csv":
            if method != "GET":
                return 405, _err(f"Method {method} is not allowed on /api/export.csv.")
            return 200, _ok(None, **{CSV_KEY: _export_csv(store)})

        if path == "/api/import.csv":
            if method != "POST":
                return 405, _err(f"Method {method} is not allowed on /api/import.csv.")
            payload = _require_mapping(body)
            text = payload.get(CSV_KEY)
            if not isinstance(text, str) or not text.strip():
                raise ValidationError("Provide the file contents as a 'csv' string.", CSV_KEY)
            return 200, _ok({"imported": _import_csv(store, text)})

        return 404, _err(f"Unknown endpoint: {path}")
    except ValidationError as exc:
        return 400, _err(exc.message, exc.field)
