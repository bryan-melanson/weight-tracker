import json
import threading
import urllib.error
import urllib.request

import pytest

from tracker.server import create_server

MUTATION_HEADER = {"X-Requested-With": "weight-tracker", "Content-Type": "application/json"}


@pytest.fixture
def live(tmp_path):
    httpd = create_server("127.0.0.1", 0, tmp_path / "live.db")
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


def request(url, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


class TestStaticFiles:
    def test_serves_index_at_root(self, live):
        status, body, headers = request(live + "/")
        assert status == 200
        assert headers["Content-Type"].startswith("text/html")
        assert b"<title>" in body

    def test_serves_asset(self, live):
        status, _, headers = request(live + "/css/app.css")
        assert status == 200
        assert headers["Content-Type"].startswith("text/css")

    def test_missing_asset_is_404(self, live):
        assert request(live + "/css/nope.css")[0] == 404

    @pytest.mark.parametrize("path", ["/../pytest.ini", "/..%2fpytest.ini", "/css/../../pytest.ini"])
    def test_blocks_path_traversal(self, live, path):
        status, body, _ = request(live + path)
        assert status in (400, 404)
        assert b"testpaths" not in body

    def test_sends_no_store_cache_header(self, live):
        assert "no-store" in request(live + "/")[2].get("Cache-Control", "")

    def test_serves_the_web_app_manifest(self, live):
        """index.html links it, so the desktop app requests it too."""
        status, body, headers = request(live + "/manifest.webmanifest")
        assert status == 200
        assert headers["Content-Type"] == "application/manifest+json"
        assert json.loads(body)["start_url"] == "./"

    def test_serves_an_icon(self, live):
        status, body, headers = request(live + "/icons/icon-192.png")
        assert status == 200
        assert headers["Content-Type"] == "image/png"
        assert body[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serves_a_nested_backend_module(self, live):
        status, _, headers = request(live + "/js/backend/local.js")
        assert status == 200
        assert headers["Content-Type"].startswith(("application/javascript", "text/javascript"))


class TestApiOverHttp:
    def test_state_round_trip(self, live):
        status, body, headers = request(live + "/api/state")
        assert status == 200
        assert headers["Content-Type"].startswith("application/json")
        assert json.loads(body)["data"]["settings"]["unit"] == "lb"

    def test_put_entry_and_read_back(self, live):
        status, body, _ = request(
            live + "/api/entries/2026-10-01", "PUT", {"weight_kg": 80, "calories": 2000}, MUTATION_HEADER
        )
        assert status == 200
        status, body, _ = request(live + "/api/state")
        assert json.loads(body)["data"]["entries"][0]["weight_kg"] == 80.0

    def test_export_served_as_csv_download(self, live):
        request(live + "/api/entries/2026-10-01", "PUT", {"calories": 2000}, MUTATION_HEADER)
        status, body, headers = request(live + "/api/export.csv")
        assert status == 200
        assert headers["Content-Type"].startswith("text/csv")
        assert "attachment" in headers["Content-Disposition"]
        assert body.startswith(b"date,weight_kg")

    def test_malformed_json_is_400(self, live):
        req = urllib.request.Request(
            live + "/api/settings", data=b"{not json", method="PUT", headers=MUTATION_HEADER
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req, timeout=5)
        assert exc.value.code == 400


class TestLocalOnlyHardening:
    def test_mutation_without_header_is_rejected(self, live):
        status, _, _ = request(live + "/api/entries/2026-10-01", "PUT", {"calories": 2000}, {"Content-Type": "application/json"})
        assert status == 403

    def test_mutation_with_foreign_origin_is_rejected(self, live):
        headers = dict(MUTATION_HEADER, Origin="https://evil.example")
        assert request(live + "/api/entries/2026-10-01", "PUT", {"calories": 1}, headers)[0] == 403

    def test_mutation_with_own_origin_is_allowed(self, live):
        headers = dict(MUTATION_HEADER, Origin=live)
        assert request(live + "/api/entries/2026-10-01", "PUT", {"calories": 1}, headers)[0] == 200

    def test_rejects_foreign_host_header(self, live):
        assert request(live + "/api/state", headers={"Host": "evil.example"})[0] == 403

    def test_no_cors_headers_exposed(self, live):
        headers = request(live + "/api/state")[2]
        assert "Access-Control-Allow-Origin" not in headers


class TestRequestLimits:
    def test_oversize_body_is_rejected(self, live):
        headers = dict(MUTATION_HEADER, **{"Content-Length": str(3 * 1024 * 1024)})
        req = urllib.request.Request(
            live + "/api/settings", data=b"{}", method="PUT", headers=headers
        )
        with pytest.raises((urllib.error.HTTPError, urllib.error.URLError, OSError)) as exc:
            urllib.request.urlopen(req, timeout=5)
        if isinstance(exc.value, urllib.error.HTTPError):
            assert exc.value.code == 400

    def test_unsupported_method_on_static_is_405(self, live):
        assert request(live + "/", "POST", {}, MUTATION_HEADER)[0] == 405

    def test_head_on_index_sends_no_body(self, live):
        status, body, headers = request(live + "/", "HEAD")
        assert status == 200
        assert body == b""
        assert int(headers["Content-Length"]) > 0

    def test_import_over_http(self, live):
        payload = {"csv": "date,weight_kg,calories\n2026-10-03,78.2,1850\n"}
        status, body, _ = request(live + "/api/import.csv", "POST", payload, MUTATION_HEADER)
        assert status == 200
        assert json.loads(body)["data"]["imported"] == 1


class TestKeepAlive:
    """A refused request must not desynchronise a reused connection."""

    def _connection(self, live):
        import http.client

        host, port = live.replace('http://', '').split(':')
        return http.client.HTTPConnection(host, int(port), timeout=5)

    def test_connection_survives_a_refused_mutation(self, live):
        conn = self._connection(live)
        try:
            conn.request('PUT', '/api/entries/2026-10-01', body=b'{"calories": 2000}',
                         headers={'Content-Type': 'application/json'})
            refused = conn.getresponse()
            refused.read()
            assert refused.status == 403
        finally:
            conn.close()

        conn = self._connection(live)
        try:
            conn.request('GET', '/api/state')
            response = conn.getresponse()
            assert response.status == 200
            assert json.loads(response.read())['ok'] is True
        finally:
            conn.close()

    def test_pipelined_reads_stay_in_sync(self, live):
        conn = self._connection(live)
        try:
            for _ in range(3):
                conn.request('GET', '/api/state')
                response = conn.getresponse()
                assert response.status == 200
                assert json.loads(response.read())['ok'] is True
        finally:
            conn.close()
