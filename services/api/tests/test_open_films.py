from pathlib import Path

import pytest

from scripts.prepare_open_films import validate_playlist


def playlist(tmp_path: Path, durations: list[str], *, end: bool = True) -> Path:
    lines = ["#EXTM3U", "#EXT-X-PLAYLIST-TYPE:VOD"]
    for number, duration in enumerate(durations):
        segment = f"seg{number:04d}.ts"
        (tmp_path / segment).write_bytes(b"video-segment")
        lines.extend([f"#EXTINF:{duration},", segment])
    if end:
        lines.append("#EXT-X-ENDLIST")
    path = tmp_path / "index.m3u8"
    path.write_text("\n".join(lines))
    return path


def test_complete_film_playlist(tmp_path):
    result = validate_playlist(playlist(tmp_path, ["6", "6", "2"]), 14)
    assert result["duration_sec"] == 14
    assert result["segments"] == 3


def test_incomplete_encode_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="Incomplete"):
        validate_playlist(playlist(tmp_path, ["6"], end=False), 6)


def test_missing_segment_is_rejected(tmp_path):
    path = playlist(tmp_path, ["6", "6"])
    (tmp_path / "seg0001.ts").unlink()
    with pytest.raises(ValueError, match="Missing or empty"):
        validate_playlist(path, 12)


def test_truncated_film_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="truncated"):
        validate_playlist(playlist(tmp_path, ["6", "6"]), 734)


@pytest.mark.parametrize("duration", ["0", "-1", "nan", "inf"])
def test_invalid_segment_durations_are_rejected(tmp_path, duration):
    with pytest.raises(ValueError, match="Invalid segment duration"):
        validate_playlist(playlist(tmp_path, [duration]), 6)


def test_remote_or_traversing_segment_is_rejected(tmp_path):
    path = playlist(tmp_path, ["6"])
    path.write_text(path.read_text().replace("seg0000.ts", "../seg0000.ts"))
    with pytest.raises(ValueError, match="Unexpected segment path"):
        validate_playlist(path, 6)
