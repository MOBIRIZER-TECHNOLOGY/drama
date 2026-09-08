from worker.jobs.media import LADDER, _master_playlist


def test_master_playlist_lists_each_rendition():
    rend = {
        "1080p": {"bandwidth": LADDER["1080p"]["bandwidth"], "width": 1080, "height": 1920},
        "480p": {"bandwidth": LADDER["480p"]["bandwidth"], "width": 480, "height": 854},
    }
    text = _master_playlist(rend, encrypted=True)
    assert text.startswith("#EXTM3U")
    assert "RESOLUTION=1080x1920" in text and "1080p/index.m3u8" in text
    assert "RESOLUTION=480x854" in text and "480p/index.m3u8" in text


def test_the_playlist_version_follows_the_container():
    """fMP4 needs EXT-X-VERSION 7 for EXT-X-MAP; MPEG-TS does not, and claiming 7 there excludes players
    that support everything actually used. Encryption is what decides the container, so it decides this."""
    rend = {"1080p": {"bandwidth": LADDER["1080p"]["bandwidth"], "width": 1080, "height": 1920}}
    assert "#EXT-X-VERSION:6" in _master_playlist(rend, encrypted=True)
    assert "#EXT-X-VERSION:7" in _master_playlist(rend, encrypted=False)
