from worker.jobs.media import LADDER, _master_playlist


def test_master_playlist_lists_each_rendition():
    rend = {
        "1080p": {"bandwidth": LADDER["1080p"]["bandwidth"], "width": 1080, "height": 1920},
        "480p": {"bandwidth": LADDER["480p"]["bandwidth"], "width": 480, "height": 854},
    }
    text = _master_playlist(rend)
    assert text.startswith("#EXTM3U")
    assert "RESOLUTION=1080x1920" in text and "1080p/index.m3u8" in text
    assert "RESOLUTION=480x854" in text and "480p/index.m3u8" in text
