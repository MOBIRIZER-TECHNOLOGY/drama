import ast
import importlib.util
from pathlib import Path

import pytest

SEED_DIR = Path(__file__).resolve().parents[3] / "content/developer-seed"
PACK_PATH = SEED_DIR / "pack.py"
SPEC = importlib.util.spec_from_file_location("developer_seed_pack", PACK_PATH)
pack = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pack)

# The pack verifies itself with whatever `python3` the person who received it happens to have, and on macOS
# that is the 3.9 the Xcode command line tools install. These are the newer conveniences that would turn a
# one-command integrity check into "first upgrade your Python", each with the version that introduced it.
TOO_NEW = {
    "datetime.UTC": (3, 11),
    "hashlib.file_digest": (3, 11),
    "zip(strict=...)": (3, 10),
    "match statement": (3, 10),
}
PORTABLE_SCRIPTS = ["pack.py", "validate_api.py", "import_seed.py"]


def newer_than_floor(source):
    """Names used by `source` that a Python 3.9 interpreter would not have."""
    tree = ast.parse(source)
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "datetime":
            found.update("datetime.UTC" for alias in node.names if alias.name == "UTC")
        elif isinstance(node, ast.Attribute) and node.attr == "file_digest":
            found.add("hashlib.file_digest")
        elif isinstance(node, ast.Match):
            found.add("match statement")
        elif isinstance(node, ast.Call):
            callee = node.func.id if isinstance(node.func, ast.Name) else None
            if callee == "zip" and any(word.arg == "strict" for word in node.keywords):
                found.add("zip(strict=...)")
    return found


@pytest.mark.parametrize("name", PORTABLE_SCRIPTS)
def test_portable_scripts_run_on_the_oldest_supported_python(name):
    used = newer_than_floor((SEED_DIR / name).read_text())
    assert not used, f"{name} uses {', '.join(f'{item} ({TOO_NEW[item]})' for item in sorted(used))}"


def test_the_version_guard_names_the_requirement():
    # A 3.8 interpreter cannot parse its way to a helpful message, so the guard has to be the first thing
    # that runs and has to say the number.
    assert "3, 9" in PACK_PATH.read_text() and "Python 3.9 or newer" in PACK_PATH.read_text()


@pytest.mark.parametrize("count", [5, 6, 77, 106, 123, 149])
def test_chapters_cover_every_segment_once(count):
    intervals = pack.chapter_ranges(count)
    assert len(intervals) == 5
    assert [segment for start, end in intervals for segment in range(start, end)] == list(range(count))
    assert all(end > start for start, end in intervals)
    assert max(end - start for start, end in intervals) - min(end - start for start, end in intervals) <= 1


def test_too_short_source_is_rejected():
    with pytest.raises(ValueError, match="Not enough"):
        pack.chapter_ranges(4)


@pytest.mark.parametrize("key", ["../escape", "/absolute", "https://example.org/video", "folder\\video", "C:/video"])
def test_external_asset_paths_are_rejected(tmp_path, key):
    with pytest.raises(ValueError):
        pack.safe_path(tmp_path, key)


def test_symlink_escape_is_rejected(tmp_path):
    (tmp_path / "outside").symlink_to(tmp_path.parent, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes"):
        pack.safe_path(tmp_path, "outside/escape")


@pytest.mark.parametrize("duration", ["nan", "inf", "0", "-1"])
def test_invalid_playlist_duration_is_rejected(tmp_path, duration):
    playlist = tmp_path / "index.m3u8"
    playlist.write_text(f"#EXTM3U\n#EXTINF:{duration},\nseg0000.ts\n#EXT-X-ENDLIST\n")
    with pytest.raises(ValueError, match="Invalid duration"):
        pack.playlist_segments(playlist)


@pytest.fixture
def bundle(tmp_path):
    seed = {"schema_version": 1, "series": []}
    for series_number in range(5):
        folder = tmp_path / "media" / f"series-{series_number}"
        folder.mkdir(parents=True)
        (folder / "cover.jpg").write_bytes(b"image")
        series = {
            "slug": folder.name,
            "cover_path": f"media/{folder.name}/cover.jpg",
            "banner_path": f"media/{folder.name}/cover.jpg",
            "source": {"duration_seconds": 30},
            "episodes": [],
        }
        for number in range(1, 6):
            episode_folder = folder / f"episode-{number:02d}"
            episode_folder.mkdir()
            video = episode_folder / "video.mp4"
            video.write_bytes(f"unique-{series_number}-{number}".encode())
            (episode_folder / "master.m3u8").write_text("#EXTM3U\n720p/index.m3u8\n360p/index.m3u8\n")
            relative = episode_folder.relative_to(tmp_path).as_posix()
            episode = {
                "number": number,
                "source_start_seconds": (number - 1) * 6,
                "source_end_seconds": number * 6,
                "duration_seconds": 6,
                "video_path": f"{relative}/video.mp4",
                "video_size_bytes": video.stat().st_size,
                "video_sha256": pack.digest(video),
                "thumbnail_path": series["cover_path"],
                "hls_master_path": f"{relative}/master.m3u8",
                "renditions": {},
            }
            for label in pack.PROFILES:
                rendition = episode_folder / label
                rendition.mkdir()
                (rendition / "seg0000.ts").write_bytes(b"segment")
                (rendition / "index.m3u8").write_text("#EXTM3U\n#EXTINF:6,\nseg0000.ts\n#EXT-X-ENDLIST\n")
                episode["renditions"][label] = {"path": f"{relative}/{label}/index.m3u8"}
            series["episodes"].append(episode)
        seed["series"].append(series)
    pack.write_json(tmp_path / "seed.json", seed)
    pack.seal(tmp_path)
    return tmp_path, seed


def test_complete_pack_verifies(bundle):
    root, _ = bundle
    seed, _ = pack.verify(root)
    assert sum(len(series["episodes"]) for series in seed["series"]) == 25


def test_tampered_video_is_rejected(bundle):
    root, seed = bundle
    (root / seed["series"][0]["episodes"][0]["video_path"]).write_bytes(b"altered")
    with pytest.raises(ValueError, match="modified"):
        pack.verify(root)


@pytest.mark.parametrize("mutation", ["gap", "order", "duplicate", "coverage"])
def test_invalid_catalogue_is_rejected(bundle, mutation):
    root, seed = bundle
    series = seed["series"][0]
    if mutation == "gap":
        series["episodes"][1]["source_start_seconds"] += 1
    elif mutation == "order":
        series["episodes"][1]["number"] = 1
    elif mutation == "coverage":
        series["source"]["duration_seconds"] += 5
    else:
        first, second = series["episodes"][:2]
        for key in ("video_path", "video_sha256", "video_size_bytes"):
            second[key] = first[key]
    pack.write_json(root / "seed.json", seed)
    pack.seal(root)
    with pytest.raises(ValueError):
        pack.verify(root)


def test_zip_includes_ignored_media_and_excludes_cache(bundle):
    root, seed = bundle
    (root / ".cache").mkdir()
    (root / ".cache/private.txt").write_text("not a deliverable")
    output = root.parent / "developer-media.zip"
    pack.archive(root, output)
    with pack.zipfile.ZipFile(output) as archive:
        assert "developer-seed/" + seed["series"][0]["episodes"][0]["video_path"] in archive.namelist()
        assert not any(".cache" in key for key in archive.namelist())
        assert archive.testzip() is None
    assert output.with_suffix(".zip.sha256").read_text().startswith(pack.digest(output))


def test_unlisted_extra_file_is_rejected(bundle):
    root, _ = bundle
    (root / "credentials.txt").write_text("should not be included")
    with pytest.raises(ValueError, match="Unlisted"):
        pack.verify(root)


def test_missing_hls_segment_is_rejected(bundle):
    root, seed = bundle
    episode = seed["series"][0]["episodes"][0]
    playlist = root / episode["renditions"]["720p"]["path"]
    (playlist.parent / "seg0000.ts").unlink()
    pack.seal(root)
    with pytest.raises(ValueError, match="Missing segment"):
        pack.verify(root)
