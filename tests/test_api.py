import json

from tracker import api


def call(store, method, path, body=None, query=""):
    return api.dispatch(store, method, path, query, body)


class TestState:
    def test_returns_settings_and_entries(self, store):
        store.upsert_entry("2026-10-01", {"calories": 2000})
        status, payload = call(store, "GET", "/api/state")
        assert status == 200
        assert payload["ok"] is True
        assert payload["data"]["settings"]["unit"] == "lb"
        assert len(payload["data"]["entries"]) == 1


class TestSettingsRoutes:
    def test_get(self, store):
        status, payload = call(store, "GET", "/api/settings")
        assert status == 200
        assert payload["data"]["default_calorie_target"] == 2000

    def test_put_updates(self, store):
        status, payload = call(store, "PUT", "/api/settings", {"unit": "kg", "goal_weight_kg": 75})
        assert status == 200
        assert payload["data"]["unit"] == "kg"
        assert payload["data"]["goal_weight_kg"] == 75.0

    def test_put_sets_weekday_targets(self, store):
        status, payload = call(
            store, "PUT", "/api/settings", {"calorie_target_mon": 1800, "calorie_target_sun": 2400}
        )
        assert status == 200
        assert payload["data"]["calorie_target_mon"] == 1800
        assert payload["data"]["calorie_target_sun"] == 2400

    def test_state_carries_the_weekday_targets(self, store):
        store.update_settings({"calorie_target_fri": 2200})
        _, payload = call(store, "GET", "/api/state")
        assert payload["data"]["settings"]["calorie_target_fri"] == 2200

    def test_put_rejects_invalid(self, store):
        status, payload = call(store, "PUT", "/api/settings", {"unit": "stone"})
        assert status == 400
        assert payload["ok"] is False
        assert payload["field"] == "unit"

    def test_put_rejects_non_object_body(self, store):
        status, _ = call(store, "PUT", "/api/settings", [1, 2])
        assert status == 400


class TestEntryRoutes:
    def test_put_then_get(self, store):
        status, payload = call(store, "PUT", "/api/entries/2026-10-01", {"weight_kg": 80, "calories": 2100})
        assert status == 200
        assert payload["data"]["weight_kg"] == 80.0
        status, payload = call(store, "GET", "/api/entries/2026-10-01")
        assert status == 200
        assert payload["data"]["calories"] == 2100

    def test_get_missing_is_404(self, store):
        status, payload = call(store, "GET", "/api/entries/2026-10-01")
        assert status == 404
        assert payload["ok"] is False

    def test_put_rejects_bad_date_in_path(self, store):
        status, _ = call(store, "PUT", "/api/entries/not-a-date", {"calories": 1})
        assert status == 400

    def test_put_rejects_bad_value(self, store):
        status, payload = call(store, "PUT", "/api/entries/2026-10-01", {"calories": -5})
        assert status == 400
        assert payload["field"] == "calories"

    def test_delete(self, store):
        call(store, "PUT", "/api/entries/2026-10-01", {"calories": 2000})
        assert call(store, "DELETE", "/api/entries/2026-10-01")[0] == 200
        assert call(store, "DELETE", "/api/entries/2026-10-01")[0] == 404

    def test_list_with_range_query(self, store):
        for d in ("2026-10-01", "2026-10-05"):
            call(store, "PUT", f"/api/entries/{d}", {"calories": 2000})
        status, payload = call(store, "GET", "/api/entries", query="from=2026-10-05")
        assert status == 200
        assert [e["date"] for e in payload["data"]] == ["2026-10-05"]

    def test_list_rejects_bad_range(self, store):
        assert call(store, "GET", "/api/entries", query="from=garbage")[0] == 400


class TestExportImport:
    def test_export_csv_has_header_and_rows(self, store):
        store.upsert_entry(
            "2026-10-01",
            {"weight_kg": 80.0, "calories": 2100, "calories_burned": 450, "calorie_target": 2000},
        )
        status, payload = call(store, "GET", "/api/export.csv")
        assert status == 200
        lines = payload["csv"].strip().splitlines()
        assert lines[0] == "date,weight_kg,calories,calories_burned,calorie_target,note,foods"
        assert lines[1].startswith("2026-10-01,80.0,2100,450,2000")

    def test_import_round_trips(self, store):
        csv_text = "date,weight_kg,calories,calorie_target,note\n2026-10-02,79.5,1900,2000,ok\n"
        status, payload = call(store, "POST", "/api/import.csv", {"csv": csv_text})
        assert status == 200
        assert payload["data"]["imported"] == 1
        assert store.get_entry("2026-10-02")["note"] == "ok"

    def test_import_round_trips_calories_burned(self, store):
        csv_text = "date,calories,calories_burned\n2026-10-02,1900,520\n"
        status, payload = call(store, "POST", "/api/import.csv", {"csv": csv_text})
        assert status == 200
        assert store.get_entry("2026-10-02")["calories_burned"] == 520

    def test_import_without_the_burn_column_leaves_it_empty(self, store):
        call(store, "POST", "/api/import.csv", {"csv": "date,calories\n2026-10-02,1900\n"})
        assert store.get_entry("2026-10-02")["calories_burned"] is None

    def test_import_reports_bad_row(self, store):
        csv_text = "date,weight_kg,calories\n2026-10-02,79.5,oops\n"
        status, payload = call(store, "POST", "/api/import.csv", {"csv": csv_text})
        assert status == 400
        assert "row 2" in payload["error"]

    def test_import_requires_csv_string(self, store):
        assert call(store, "POST", "/api/import.csv", {})[0] == 400


class TestRouting:
    def test_unknown_route_is_404(self, store):
        assert call(store, "GET", "/api/nope")[0] == 404

    def test_wrong_method_is_405(self, store):
        status, _ = call(store, "DELETE", "/api/settings")
        assert status == 405

    def test_payloads_are_json_serializable(self, store):
        store.upsert_entry("2026-10-01", {"weight_kg": 80.0})
        for path in ("/api/state", "/api/settings", "/api/entries"):
            json.dumps(call(store, "GET", path)[1])


class TestMethodGuards:
    def test_state_rejects_post(self, store):
        assert call(store, "POST", "/api/state")[0] == 405

    def test_entries_collection_rejects_post(self, store):
        assert call(store, "POST", "/api/entries")[0] == 405

    def test_entry_rejects_patch(self, store):
        assert call(store, "PATCH", "/api/entries/2026-10-01")[0] == 405

    def test_export_rejects_post(self, store):
        assert call(store, "POST", "/api/export.csv")[0] == 405

    def test_import_rejects_get(self, store):
        assert call(store, "GET", "/api/import.csv")[0] == 405


class TestImportGuards:
    def test_requires_header_row_with_date(self, store):
        status, payload = call(store, "POST", "/api/import.csv", {"csv": "weight_kg\n80\n"})
        assert status == 400
        assert "date" in payload["error"]

    def test_rejects_unsupported_columns(self, store):
        status, payload = call(store, "POST", "/api/import.csv", {"csv": "date,bodyfat\n2026-10-01,12\n"})
        assert status == 400
        assert "bodyfat" in payload["error"]

    def test_blank_cells_clear_values(self, store):
        store.upsert_entry("2026-10-01", {"weight_kg": 80.0, "calories": 2000})
        call(store, "POST", "/api/import.csv", {"csv": "date,weight_kg,calories\n2026-10-01,81,\n"})
        entry = store.get_entry("2026-10-01")
        assert entry["weight_kg"] == 81.0
        assert entry["calories"] is None

    def test_rejects_blank_csv_string(self, store):
        assert call(store, "POST", "/api/import.csv", {"csv": "   "})[0] == 400

    def test_bad_date_names_the_row(self, store):
        status, payload = call(store, "POST", "/api/import.csv", {"csv": "date,calories\nnope,2000\n"})
        assert status == 400
        assert "row 2" in payload["error"]
