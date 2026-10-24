"""Loopback HTTP server: static frontend plus the JSON API.

Hardening notes - this server holds personal health data on the user's own
machine with no login, so it refuses anything that does not look like a
request from the local browser:
  * it binds 127.0.0.1 only;
  * the Host header must name loopback (blocks DNS rebinding);
  * mutating requests must carry a custom header a cross-origin form cannot
    set, and any Origin they do send must be loopback (CSRF guard);
  * no CORS headers are ever emitted.
"""

import json
import mimetypes
import os
from datetime import date as date_cls
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from . import api, config
from .store import Store

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
MAX_BODY_BYTES = 2 * 1024 * 1024

SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("Cache-Control", "no-store"),
    (
        "Content-Security-Policy",
        # api.github.com is the single external host, reached only by the
        # optional backup; everything else stays same-origin.
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
        "connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'; "
        "frame-ancestors 'none'",
    ),
)


def _host_is_local(header_value: str | None) -> bool:
    if not header_value:
        return False
    host = header_value.strip()
    if host.startswith("["):  # bracketed IPv6 literal, e.g. [::1]:8777
        host = host.split("]")[0] + "]"
    else:
        host = host.split(":")[0]
    return host.lower() in config.ALLOWED_HOST_NAMES


def _origin_is_local(header_value: str | None) -> bool:
    if not header_value or header_value == "null":
        return False
    hostname = urlsplit(header_value).hostname
    return bool(hostname) and hostname.lower() in config.ALLOWED_HOST_NAMES


def _resolve_static(url_path: str) -> Path | None:
    """Map a URL path to a file inside static/, or None if it escapes."""
    relative = unquote(url_path).lstrip("/") or "index.html"
    if "\x00" in relative:
        return None
    normalized = os.path.normpath(relative)
    if normalized.startswith("..") or os.path.isabs(normalized):
        return None
    candidate = (config.STATIC_DIR / normalized).resolve()
    root = config.STATIC_DIR.resolve()
    if root != candidate and root not in candidate.parents:
        return None
    return candidate


class Handler(BaseHTTPRequestHandler):
    server_version = "WeightTracker/1.0"
    protocol_version = "HTTP/1.1"

    # -- plumbing ---------------------------------------------------------

    @property
    def store(self) -> Store:
        return self.server.store

    def log_message(self, fmt, *args):  # quieter than the default access log
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)

    def _send(self, status: int, body: bytes, content_type: str, extra_headers=()) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (*SECURITY_HEADERS, *extra_headers):
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _send_error_json(self, status: int, message: str, *, drop_connection: bool = False) -> None:
        # When a request is refused without its body being read, those bytes are
        # still queued on a keep-alive connection and would be parsed as the
        # next request. Closing is the only safe answer.
        if drop_connection:
            self.close_connection = True
        self._send_json(status, {"ok": False, "error": message, "field": None})

    def _read_body(self):
        length_header = self.headers.get("Content-Length", "0")
        try:
            length = int(length_header)
        except ValueError:
            raise ValueError("Content-Length must be an integer.") from None
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large.")
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Request body must be valid JSON.") from None

    # -- request flow -----------------------------------------------------

    def _guard(self) -> bool:
        """Reject requests that do not look like they came from the local app."""
        if not _host_is_local(self.headers.get("Host")):
            self._send_error_json(
                HTTPStatus.FORBIDDEN, "Requests must address this server as localhost.", drop_connection=True
            )
            return False
        if self.command in MUTATING_METHODS:
            if self.headers.get(config.CSRF_HEADER) != config.CSRF_VALUE:
                self._send_error_json(
                    HTTPStatus.FORBIDDEN,
                    f"Missing {config.CSRF_HEADER}: {config.CSRF_VALUE} header.",
                    drop_connection=True,
                )
                return False
            origin = self.headers.get("Origin")
            if origin is not None and not _origin_is_local(origin):
                self._send_error_json(
                    HTTPStatus.FORBIDDEN, "Cross-origin requests are not accepted.", drop_connection=True
                )
                return False
        return True

    def _handle(self) -> None:
        if not self._guard():
            return
        split = urlsplit(self.path)
        path = unquote(split.path)
        if path.startswith("/api/"):
            self._handle_api(path, split.query)
        elif self.command in ("GET", "HEAD"):
            self._handle_static(split.path)
        else:
            self._send_error_json(
                HTTPStatus.METHOD_NOT_ALLOWED, f"Method {self.command} is not allowed.", drop_connection=True
            )

    def _handle_api(self, path: str, query: str) -> None:
        try:
            body = self._read_body()
        except ValueError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc), drop_connection=True)
            return
        status, payload = api.dispatch(self.store, self.command, path, query, body)
        if status == 200 and api.CSV_KEY in payload:
            filename = f"weight-tracker-{date_cls.today().isoformat()}.csv"
            self._send(
                status,
                payload[api.CSV_KEY].encode("utf-8"),
                "text/csv; charset=utf-8",
                (("Content-Disposition", f'attachment; filename="{filename}"'),),
            )
            return
        self._send_json(status, payload)

    def _handle_static(self, raw_path: str) -> None:
        target = _resolve_static(raw_path)
        if target is None:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid path.")
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            self._send_error_json(HTTPStatus.NOT_FOUND, "Not found.")
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        self._send(HTTPStatus.OK, target.read_bytes(), content_type)

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = _handle


class TrackerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, db_path):
        super().__init__(address, handler)
        self.store = Store(db_path)

    def server_close(self) -> None:
        super().server_close()
        self.store.close()


def create_server(host: str = config.DEFAULT_HOST, port: int = config.DEFAULT_PORT, db_path=None) -> TrackerServer:
    # Pinned rather than guessed: mimetypes reads the system registry, which
    # does not carry these everywhere.
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    return TrackerServer((host, port), Handler, db_path or config.DEFAULT_DB_PATH)
