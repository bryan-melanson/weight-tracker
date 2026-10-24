"""Command line entry point: python3 -m tracker"""

import argparse
import sys
import webbrowser

from . import config
from .server import create_server


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="tracker", description="Local weight & calorie tracker.")
    parser.add_argument("--host", default=config.DEFAULT_HOST, help="interface to bind (default: %(default)s)")
    parser.add_argument("--port", type=int, default=config.DEFAULT_PORT, help="port (default: %(default)s)")
    parser.add_argument("--db", default=str(config.DEFAULT_DB_PATH), help="SQLite file (default: %(default)s)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    httpd = create_server(args.host, args.port, args.db)
    url = f"http://{args.host}:{httpd.server_address[1]}/"
    print(f"Weight tracker running at {url}\nData file: {args.db}\nPress Ctrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
