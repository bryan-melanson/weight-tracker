from tracker import config
from tracker.__main__ import parse_args


def test_defaults_match_config():
    args = parse_args([])
    assert args.host == config.DEFAULT_HOST
    assert args.port == config.DEFAULT_PORT
    assert args.db == str(config.DEFAULT_DB_PATH)
    assert args.no_browser is False


def test_overrides():
    args = parse_args(["--host", "localhost", "--port", "9000", "--db", "/tmp/x.db", "--no-browser"])
    assert (args.host, args.port, args.db, args.no_browser) == ("localhost", 9000, "/tmp/x.db", True)
