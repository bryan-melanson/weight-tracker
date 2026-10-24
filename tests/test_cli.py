import pytest

from tracker import config
from tracker.__main__ import main, parse_args
from tracker.server import create_server


def test_defaults_match_config():
    args = parse_args([])
    assert args.host == config.DEFAULT_HOST
    assert args.port == config.DEFAULT_PORT
    assert args.db == str(config.DEFAULT_DB_PATH)
    assert args.no_browser is False


def test_overrides():
    args = parse_args(["--host", "localhost", "--port", "9000", "--db", "/tmp/x.db", "--no-browser"])
    assert (args.host, args.port, args.db, args.no_browser) == ("localhost", 9000, "/tmp/x.db", True)


def test_reports_a_busy_port_instead_of_crashing(capsys):
    """Starting a second copy is the common mistake; it should say so."""
    first = create_server("127.0.0.1", 0, ":memory:")
    try:
        port = first.server_address[1]
        assert main(["--host", "127.0.0.1", "--port", str(port), "--no-browser"]) == 1
        message = capsys.readouterr().err
        assert f"127.0.0.1:{port}" in message
        assert "--port" in message
    finally:
        first.server_close()


def test_a_failed_bind_raises_the_real_error(tmp_path):
    """The half-built server must not mask the bind failure."""
    first = create_server("127.0.0.1", 0, tmp_path / "a.db")
    try:
        with pytest.raises(OSError):
            create_server("127.0.0.1", first.server_address[1], tmp_path / "b.db")
    finally:
        first.server_close()
