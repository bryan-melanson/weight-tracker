"""An update reaches an installed app on its own.

The worker used to precache a new version and then wait for every tab to close
before taking over, which on an installed iOS app can mean never: a CSS fix sat
undelivered while the app kept serving the old cache. The new worker now takes
over as soon as it is ready and the page reloads itself, so the only thing an
update needs is for the app to be opened.

These are assertions about the source rather than the behaviour — there is no
service worker to drive in a Python test — so they are deliberately about the
few calls the whole mechanism rests on.
"""

from pathlib import Path

from tracker import config

SW = (config.STATIC_DIR / "sw.js").read_text()
PWA = (config.STATIC_DIR / "js" / "pwa.js").read_text()


class TestWorkerTakesOver:
    def test_the_new_worker_does_not_wait_for_every_tab_to_close(self):
        """Without skipWaiting it stays parked behind the old one indefinitely."""
        assert "self.skipWaiting()" in SW

    def test_it_takes_charge_of_the_page_already_open(self):
        """claim() is what fires controllerchange in the page below."""
        assert "self.clients.claim()" in SW

    def test_it_claims_only_after_the_stale_caches_are_gone(self):
        """Claiming first would serve a page out of a cache about to be deleted."""
        assert SW.index("caches.delete") < SW.index("self.clients.claim()")


class TestPageReplacesItself:
    def test_it_listens_for_the_worker_taking_over(self):
        assert "controllerchange" in PWA

    def test_it_reloads_so_no_two_modules_come_from_different_versions(self):
        assert "location.reload()" in PWA

    def test_a_first_install_is_not_mistaken_for_an_update(self):
        """Controller none -> one is the first registration; the page is current
        already, and reloading it would be a flash for no reason."""
        assert "navigator.serviceWorker.controller" in PWA

    def test_the_reload_waits_until_the_app_is_in_the_background(self):
        """An update is not worth discarding a half-typed entry for."""
        assert "visibilitychange" in PWA
        assert "hidden" in PWA
