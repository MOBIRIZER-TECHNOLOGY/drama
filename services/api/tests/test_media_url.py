"""Resolving stored cover, banner and thumbnail values.

These columns used to hold absolute URLs, which tied every row to one client's view of one host: the same
database served working images to the phone and broken ones to the browser, because a device and a browser do
not agree on what a development machine is called. In production the same shape bakes the CDN hostname into
every row, so moving or regionalising the CDN becomes a data migration.

They hold keys now, resolved at response time. Two behaviours have to hold together: a key resolves against
the configured base, and anything already absolute is left exactly as it is — otherwise migrating the existing
rows would have to happen in one atomic step, and a poster hosted somewhere else could never be used.
"""

import pytest

from app.core.config import get_settings
from app.services.media import media_url


@pytest.fixture(autouse=True)
def base(monkeypatch):
    monkeypatch.setattr(get_settings(), "cdn_base_url", "https://cdn.katha.test/media", raising=False)


def test_a_key_resolves_against_the_configured_base():
    assert media_url("library/ashes/cover.jpg") == "https://cdn.katha.test/media/library/ashes/cover.jpg"


def test_a_leading_slash_does_not_double_up():
    assert media_url("/library/ashes/cover.jpg") == "https://cdn.katha.test/media/library/ashes/cover.jpg"


def test_an_absolute_url_is_left_alone():
    """Rows written before the change still resolve, so the migration does not have to be atomic."""
    for url in (
        "https://images.example.com/poster.jpg",
        "http://192.168.1.200:8090/library/a/cover.jpg",
        "//cdn.example.com/poster.jpg",
    ):
        assert media_url(url) == url


def test_a_data_uri_is_left_alone():
    uri = "data:image/gif;base64,R0lGODlhAQABAAAAACw="
    assert media_url(uri) == uri


def test_nothing_stays_nothing():
    assert media_url(None) is None
    assert media_url("") is None


def test_changing_the_base_moves_every_asset():
    """The whole point: the CDN can move without touching a single row."""
    key = "library/ashes/cover.jpg"
    first = media_url(key)
    get_settings().cdn_base_url = "https://edge2.katha.test"
    assert media_url(key) == "https://edge2.katha.test/library/ashes/cover.jpg"
    assert first != media_url(key)
