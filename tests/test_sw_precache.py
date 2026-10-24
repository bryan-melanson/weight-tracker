"""The service worker names every file the installed app needs offline.

caches.addAll() is atomic: one missing path and nothing is cached, leaving the
app unable to open without a network. A file added to static/ and not added to
the list is the quieter failure — the app installs, then breaks offline on the
module it never cached. Both are caught here.
"""

import re
from pathlib import Path

import pytest

from tracker import config

SW = config.STATIC_DIR / "sw.js"
PRECACHE = re.search(r"const PRECACHE = \[(.*?)\];", SW.read_text(), re.DOTALL)

# Served, but deliberately not precached: the worker cannot cache itself, and
# the SVG icon sources are only inputs to the committed PNGs.
NOT_PRECACHED = {"sw.js", "icons/icon.svg", "icons/icon-maskable.svg"}


def _listed() -> set[str]:
    assert PRECACHE, "sw.js no longer declares a PRECACHE array"
    return set(re.findall(r"'([^']+)'", PRECACHE.group(1)))


def _shipped() -> set[str]:
    return {
        str(path.relative_to(config.STATIC_DIR))
        for path in config.STATIC_DIR.rglob("*")
        if path.is_file()
    }


class TestPrecache:
    @pytest.mark.parametrize("path", sorted(_listed() - {"./"}))
    def test_every_listed_file_exists(self, path):
        """A path that 404s makes addAll reject and caches nothing at all."""
        assert (config.STATIC_DIR / path).is_file()

    def test_every_shipped_file_is_listed(self):
        """A new module in static/ has to be added to the list as well."""
        assert _shipped() - NOT_PRECACHED - _listed() == set()

    def test_the_start_url_is_cached(self):
        """Launching the installed app requests './', not 'index.html'."""
        assert "./" in _listed()

    def test_nothing_outside_static_is_listed(self):
        for path in _listed() - {"./"}:
            resolved = (config.STATIC_DIR / path).resolve()
            assert resolved.is_relative_to(config.STATIC_DIR.resolve())
