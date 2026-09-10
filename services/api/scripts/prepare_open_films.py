"""Download complete licensed films and prepare reproducible artwork and adaptive HLS assets."""

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO / "content/open-films/catalog.json"
MANIFEST_PATH = REPO / "content/open-films/manifest.json"
ASSETS = Path(__file__).resolve().parent / "seed-assets"
RENDITIONS = {"720p": (1280, 720, "2800k"), "360p": (640, 360, "800k")}


def checksum(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def download(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "curl",
            "-fSL",
            "--retry",
            "3",
            "--retry-all-errors",
            "--connect-timeout",
            "20",
            "--max-time",
            "1800",
            "-C",
            "-",
            url,
            "-o",
            str(path),
        ],
        check=True,
    )


def validate_playlist(path: Path, expected_duration: float) -> dict:
    lines = path.read_text().splitlines()
    if not lines or lines[0] != "#EXTM3U" or "#EXT-X-ENDLIST" not in lines:
        raise ValueError(f"Incomplete VOD playlist: {path}")
    durations = [float(line.split(":", 1)[1].rstrip(",")) for line in lines if line.startswith("#EXTINF:")]
    segments = [line for line in lines if line and not line.startswith("#")]
    if not segments or len(segments) != len(durations):
        raise ValueError(f"Invalid segment count: {path}")
    if any(not math.isfinite(seconds) or seconds <= 0 for seconds in durations):
        raise ValueError(f"Invalid segment duration: {path}")
    for segment in segments:
        if not re.fullmatch(r"seg\d+\.ts", segment):
            raise ValueError(f"Unexpected segment path: {segment}")
        if not (path.parent / segment).is_file() or (path.parent / segment).stat().st_size == 0:
            raise ValueError(f"Missing or empty segment: {segment}")
    duration = sum(durations)
    if abs(duration - expected_duration) > 1:
        raise ValueError(f"Film was truncated: {path}: {duration} != {expected_duration}")
    peak = max(
        (path.parent / segment).stat().st_size * 8 / seconds
        for segment, seconds in zip(segments, durations, strict=True)
    )
    return {"duration_sec": round(duration, 3), "segments": len(segments), "bandwidth": math.ceil(peak * 1.1)}


def ffmpeg_binary(explicit: str | None) -> str:
    executable = explicit or shutil.which("ffmpeg")
    if executable:
        return str(Path(executable).resolve())
    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise RuntimeError("Install ffmpeg or install imageio-ffmpeg in the API virtual environment.") from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def run_ffmpeg(executable: str, arguments: list[str]) -> None:
    subprocess.run([executable, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *arguments], check=True)


def build_film(film: dict, executable: str, allow_download: bool, force: bool, refresh_artwork: bool = False) -> dict:
    slug = film["slug"]
    source = ASSETS / "source/open-films" / f"{slug}.mp4"
    partial = source.with_suffix(".mp4.part")
    if not source.exists():
        if not partial.exists() or partial.stat().st_size != film["source_size_bytes"]:
            if not allow_download:
                raise FileNotFoundError(f"Download missing/incomplete for {slug}; run with --download.")
            download(film["source_url"], partial)
        if partial.stat().st_size != film["source_size_bytes"]:
            raise ValueError(f"Unexpected download size: {slug}")
        partial.rename(source)
    if source.stat().st_size != film["source_size_bytes"]:
        raise ValueError(f"Unexpected source size: {slug}")
    digest = checksum(source)
    if MANIFEST_PATH.exists():
        previous = json.loads(MANIFEST_PATH.read_text())["films"]
        pinned = next((item for item in previous if item["slug"] == slug), None)
        if pinned and pinned["source_sha256"] != digest:
            raise ValueError(f"Source checksum changed: {slug}")

    output = ASSETS / "hls/open-films" / slug
    output.mkdir(parents=True, exist_ok=True)
    streams = {}
    for label, (width, height, bitrate) in RENDITIONS.items():
        rendition = output / label
        rendition.mkdir(exist_ok=True)
        playlist = rendition / "index.m3u8"
        valid = False
        if playlist.exists() and not force:
            try:
                validate_playlist(playlist, film["expected_duration_sec"])
                valid = True
            except ValueError:
                pass
        if not valid:
            print(f"Encoding {slug} {label} (complete film and credits)", flush=True)
            run_ffmpeg(
                executable,
                [
                    "-i",
                    str(source),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0",
                    "-vf",
                    f"fps=24,scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-threads",
                    "4",
                    "-profile:v",
                    "main",
                    "-level:v",
                    "3.1",
                    "-pix_fmt",
                    "yuv420p",
                    "-maxrate",
                    bitrate,
                    "-bufsize",
                    str(int(bitrate.rstrip("k")) * 2) + "k",
                    "-g",
                    "144",
                    "-keyint_min",
                    "144",
                    "-sc_threshold",
                    "0",
                    "-force_key_frames",
                    "expr:gte(t,n_forced*6)",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    "-ac",
                    "2",
                    "-ar",
                    "48000",
                    "-f",
                    "hls",
                    "-hls_time",
                    "6",
                    "-hls_playlist_type",
                    "vod",
                    "-hls_flags",
                    "independent_segments+temp_file",
                    "-hls_segment_filename",
                    str(rendition / "seg%04d.ts"),
                    str(playlist),
                ],
            )
        streams[label] = {
            **validate_playlist(playlist, film["expected_duration_sec"]),
            "width": width,
            "height": height,
        }
    master = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"]
    for label, stream in streams.items():
        master.extend(
            [
                f'#EXT-X-STREAM-INF:BANDWIDTH={stream["bandwidth"]},RESOLUTION={stream["width"]}x{stream["height"]},FRAME-RATE=24.000,CODECS="avc1.4d401f,mp4a.40.2"',
                f"{label}/index.m3u8",
            ]
        )
    (output / "master.m3u8").write_text("\n".join(master) + "\n")

    artwork = ASSETS / "images/open-films" / slug
    artwork.mkdir(parents=True, exist_ok=True)
    for filename, video_filter in {
        "cover.jpg": "scale=600:1066:force_original_aspect_ratio=increase,crop=600:1066",
        "banner.jpg": "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
    }.items():
        if force or refresh_artwork or not (artwork / filename).exists():
            run_ffmpeg(
                executable,
                [
                    "-ss",
                    str(film["artwork_frame_sec"]),
                    "-i",
                    str(source),
                    "-frames:v",
                    "1",
                    "-vf",
                    video_filter,
                    "-q:v",
                    "2",
                    str(artwork / filename),
                ],
            )
    review = REPO / "review/open-films"
    review.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        executable,
        [
            "-ss",
            str(film["credits_check_sec"]),
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "scale=960:-2",
            str(review / f"{slug}-credits.jpg"),
        ],
    )
    objects = [*output.rglob("*.m3u8"), *output.rglob("*.ts"), *artwork.glob("*.jpg")]
    print(f"Prepared {slug}: {streams['720p']['duration_sec']} seconds; {len(objects)} objects", flush=True)
    return {
        "slug": slug,
        "source_key": source.relative_to(ASSETS).as_posix(),
        "source_sha256": digest,
        "source_size_bytes": source.stat().st_size,
        "duration_sec": round(streams["720p"]["duration_sec"]),
        "hls_master_key": (output / "master.m3u8").relative_to(ASSETS).as_posix(),
        "cover_key": (artwork / "cover.jpg").relative_to(ASSETS).as_posix(),
        "banner_key": (artwork / "banner.jpg").relative_to(ASSETS).as_posix(),
        "renditions": streams,
        "objects": {path.relative_to(ASSETS).as_posix(): checksum(path) for path in sorted(objects)},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--force", action="store_true", help="Rebuild renditions and artwork.")
    parser.add_argument("--refresh-artwork", action="store_true", help="Refresh film stills without re-encoding video.")
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    catalog = json.loads(CATALOG_PATH.read_text())
    executable = ffmpeg_binary(args.ffmpeg)
    films = [build_film(film, executable, args.download, args.force, args.refresh_artwork) for film in catalog["films"]]
    manifest = {
        "version": 1,
        "prepared_at": datetime.now(UTC).isoformat(),
        "catalog_sha256": checksum(CATALOG_PATH),
        "films": films,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST_PATH.relative_to(REPO)}")


if __name__ == "__main__":
    main()
