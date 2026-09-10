"""Build, verify and archive the portable five-series, 25-chapter media pack.

Verification runs on Python 3.9 or newer with no third-party packages, because that is what a receiving
developer actually has: macOS ships 3.9 with the Xcode command line tools, and asking someone to install a
newer Python before they can check what they were sent defeats the point of a self-verifying pack. Building
needs ffmpeg as well, which is a deliberate difference: only the sender builds.
"""

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

if sys.version_info < (3, 9):  # noqa: UP036 - the guard exists for interpreters this file still has to greet
    raise SystemExit(
        f"This pack needs Python 3.9 or newer; found {sys.version.split()[0]}."
    )

ROOT = Path(__file__).resolve().parent
PROFILES = {"720p": (1280, 720, "2800k"), "360p": (640, 360, "800k")}
# One megabyte at a time: large enough that the Python loop costs nothing next to the hashing, small enough
# that a 200 MB source never has to fit in memory.
READ_SIZE = 1024 * 1024


def digest(path):
    """SHA-256 of a file. Hand-rolled rather than `hashlib.file_digest`, which arrived in 3.11."""
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(READ_SIZE), b""):
            hasher.update(block)
    return hasher.hexdigest()


def write_json(path, value):
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def safe_path(root, key):
    parts = PurePosixPath(key)
    if (
        not key
        or "\\" in key
        or parts.is_absolute()
        or ".." in parts.parts
        or ":" in key
    ):
        raise ValueError(f"Unsafe asset path: {key}")
    path = (root / key).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"Asset escapes pack: {key}")
    return path


def ffmpeg_binary(explicit=None):
    if explicit or shutil.which("ffmpeg"):
        return explicit or shutil.which("ffmpeg")
    try:
        import imageio_ffmpeg
    except ImportError as error:
        raise RuntimeError(
            "Install ffmpeg, or imageio-ffmpeg in this Python environment."
        ) from error
    return imageio_ffmpeg.get_ffmpeg_exe()


def ffmpeg(executable, *arguments):
    subprocess.run(
        [
            executable,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            *map(str, arguments),
        ],
        check=True,
    )


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
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
            str(partial),
        ],
        check=True,
    )
    partial.replace(destination)


def playlist_segments(path):
    lines = path.read_text().splitlines()
    if not lines or lines[0] != "#EXTM3U" or "#EXT-X-ENDLIST" not in lines:
        raise ValueError(f"Incomplete playlist: {path}")
    segments = []
    duration = None
    for line in lines:
        if line.startswith("#EXTINF:"):
            if duration is not None:
                raise ValueError(f"Missing segment URI: {path}")
            duration = float(line.split(":", 1)[1].split(",", 1)[0])
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError(f"Invalid duration: {path}")
        elif line and not line.startswith("#"):
            if duration is None or not re.fullmatch(r"seg\d+\.ts", line):
                raise ValueError(f"Invalid segment: {line}")
            asset = safe_path(path.parent, line)
            if not asset.is_file() or not asset.stat().st_size:
                raise ValueError(f"Missing segment: {asset}")
            segments.append((duration, asset))
            duration = None
    if not segments or duration is not None:
        raise ValueError(f"Invalid playlist: {path}")
    return segments


def chapter_ranges(segment_count, chapters=5):
    if segment_count < chapters:
        raise ValueError("Not enough segments for the requested chapters")
    return [
        (index * segment_count // chapters, (index + 1) * segment_count // chapters)
        for index in range(chapters)
    ]


def write_playlist(destination, segments):
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        f"#EXT-X-TARGETDURATION:{math.ceil(max(seconds for seconds, _ in segments))}",
    ]
    for index, (seconds, source) in enumerate(segments):
        target = destination.parent / f"seg{index:04d}.ts"
        shutil.copyfile(source, target)
        lines.extend([f"#EXTINF:{seconds:.6f},", target.name])
    lines.append("#EXT-X-ENDLIST")
    destination.write_text("\n".join(lines) + "\n")


def download_video(url, destination, expected_size):
    chunks = destination.with_suffix(".chunks")
    chunks.mkdir(parents=True, exist_ok=True)
    chunk_size = 4 * 1024 * 1024

    def fetch_chunk(start):
        end = min(start + chunk_size, expected_size) - 1
        chunk = chunks / f"{start:012d}.bin"
        headers = chunk.with_suffix(".headers")
        expected_range = f"content-range: bytes {start}-{end}/{expected_size}"
        if (
            chunk.exists()
            and chunk.stat().st_size == end - start + 1
            and headers.exists()
            and expected_range in headers.read_text().lower()
        ):
            return chunk
        subprocess.run(
            [
                "curl",
                "-fsSL",
                "--retry",
                "5",
                "--retry-all-errors",
                "--connect-timeout",
                "20",
                "--max-time",
                "120",
                "--range",
                f"{start}-{end}",
                "-D",
                str(headers),
                "-o",
                str(chunk),
                url,
            ],
            check=True,
        )
        if (
            chunk.stat().st_size != end - start + 1
            or expected_range not in headers.read_text().lower()
        ):
            raise ValueError(f"Incorrect HTTP range response: {url} {start}-{end}")
        print(f"Downloaded {destination.name}: bytes {start}-{end}", flush=True)
        return chunk

    with ThreadPoolExecutor(max_workers=4) as workers:
        ordered = list(workers.map(fetch_chunk, range(0, expected_size, chunk_size)))
    partial = destination.with_suffix(".mp4.part")
    with partial.open("wb") as output:
        for chunk in ordered:
            with chunk.open("rb") as stream:
                shutil.copyfileobj(stream, output)
    if partial.stat().st_size != expected_size:
        raise ValueError("Incomplete ranged source download")
    partial.replace(destination)


def prepare_source(film, executable, reuse, allow_download):
    source = ROOT / ".cache/sources" / f"{film['slug']}.mp4"
    if not source.exists() and reuse:
        cached = reuse / "source/open-films" / source.name
        if cached.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(cached, source)
    if not source.exists() or source.stat().st_size != film["size"]:
        if not allow_download:
            raise ValueError(f"Missing source {source}; pass --download")
        download_video(film["source_url"], source, film["size"])
    if source.stat().st_size != film["size"]:
        raise ValueError(f"Unexpected source size: {film['slug']}")
    streams = {}
    for label, (width, height, bitrate) in PROFILES.items():
        playlist = ROOT / ".cache/hls" / film["slug"] / label / "index.m3u8"
        if not playlist.exists() and reuse:
            cached = reuse / "hls/open-films" / film["slug"] / label
            if cached.exists():
                shutil.copytree(cached, playlist.parent, dirs_exist_ok=True)
        if not playlist.exists():
            playlist.parent.mkdir(parents=True, exist_ok=True)
            print(f"Encoding {film['slug']} {label}", flush=True)
            ffmpeg(
                executable,
                "-i",
                source,
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
                str(int(bitrate[:-1]) * 2) + "k",
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
                "independent_segments",
                "-hls_segment_filename",
                playlist.parent / "seg%04d.ts",
                playlist,
            )
        streams[label] = playlist_segments(playlist)
        if abs(sum(seconds for seconds, _ in streams[label]) - film["duration"]) > 1:
            raise ValueError(f"Truncated film: {film['slug']}")
    if [duration for duration, _ in streams["720p"]] != [
        duration for duration, _ in streams["360p"]
    ]:
        raise ValueError(f"Unaligned adaptive variants: {film['slug']}")
    return source, streams


def still(executable, source, seconds, target, portrait=False):
    transform = (
        "scale=600:1066:force_original_aspect_ratio=increase,crop=600:1066"
        if portrait
        else "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"
    )
    ffmpeg(
        executable,
        "-ss",
        seconds,
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        transform,
        "-q:v",
        "2",
        target,
    )


def build(args):
    config = json.loads((ROOT / "sources.json").read_text())
    executable = ffmpeg_binary(args.ffmpeg)
    previous = (
        json.loads((ROOT / "seed.json").read_text())
        if (ROOT / "seed.json").exists()
        else {"series": []}
    )
    previous_hashes = {
        item["source"]["slug"]: item["source"]["sha256"] for item in previous["series"]
    }
    catalogue = {
        "schema_version": 1,
        "pack_id": "open-film-chapters-v1",
        "collection": config["collection"],
        "purpose": config["editorial_note"],
        "storage_prefix": "developer-seed/v1",
        "series": [],
    }
    for film in config["films"]:
        source, streams = prepare_source(
            film, executable, args.reuse_assets, args.download
        )
        source_hash = digest(source)
        if previous_hashes.get(film["slug"], source_hash) != source_hash:
            raise ValueError(f"Pinned source changed: {film['slug']}")
        slug = film["slug"] + "-chapters"
        folder = ROOT / "media" / slug
        folder.mkdir(parents=True, exist_ok=True)
        still(
            executable,
            source,
            film["artwork_frame"],
            folder / "cover.jpg",
            portrait=True,
        )
        still(executable, source, film["artwork_frame"], folder / "banner.jpg")
        relative = lambda path: path.relative_to(ROOT).as_posix()
        series = {
            "slug": slug,
            "title": film["title"] + " — Chapters",
            "synopsis": film["synopsis"],
            "year": film["year"],
            "director": film["director"],
            "original_language": "en",
            "audio": film["audio"],
            "categories": ["Short Films", *film["genres"]],
            "content_rating": film["rating"],
            "content_advisory": film["advisory"]
            + " Editorial guidance, not an official certificate.",
            "free_episodes": 5,
            "episode_price": 0,
            "is_premium": False,
            "completion_status": "Completed",
            "release_note": f"5 sequential film chapters · {film['year']} · Developer seed",
            "cover_path": relative(folder / "cover.jpg"),
            "banner_path": relative(folder / "banner.jpg"),
            "attribution": film["attribution"],
            "license": film["license"],
            "license_url": film["license_url"],
            "rights_url": film["rights_url"],
            "source_page_url": film["source_page_url"],
            "changes": "Divided into five sequential chapters at six-second HLS boundaries. Original audio and final credits retained. HLS converted to 24 fps, letterboxed; artwork uses cropped/resized film stills. Chapter titles are technical labels, not creator episode titles.",
            "source": {
                "slug": film["slug"],
                "url": film["source_url"],
                "sha256": source_hash,
                "size_bytes": source.stat().st_size,
                "duration_seconds": round(
                    sum(seconds for seconds, _ in streams["720p"]), 6
                ),
            },
            "episodes": [],
        }
        start_seconds = 0.0
        for number, (start, end) in enumerate(chapter_ranges(len(streams["720p"])), 1):
            episode_folder = folder / f"episode-{number:02d}"
            renditions = {}
            master = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"]
            for label, (width, height, _) in PROFILES.items():
                segments = streams[label][start:end]
                playlist = episode_folder / label / "index.m3u8"
                write_playlist(playlist, segments)
                bandwidth = math.ceil(
                    max(path.stat().st_size * 8 / seconds for seconds, path in segments)
                    * 1.1
                )
                duration = round(sum(seconds for seconds, _ in segments), 6)
                renditions[label] = {
                    "path": relative(playlist),
                    "width": width,
                    "height": height,
                    "bandwidth": bandwidth,
                    "duration_seconds": duration,
                    "segments": len(segments),
                }
                master.extend(
                    [
                        f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={width}x{height},FRAME-RATE=24.000,CODECS="avc1.4d401f,mp4a.40.2"',
                        f"{label}/index.m3u8",
                    ]
                )
            (episode_folder / "master.m3u8").write_text("\n".join(master) + "\n")
            video = episode_folder / "video.mp4"
            ffmpeg(
                executable,
                "-i",
                episode_folder / "720p/index.m3u8",
                "-map",
                "0:v:0",
                "-map",
                "0:a:0",
                "-c",
                "copy",
                "-bsf:a",
                "aac_adtstoasc",
                "-movflags",
                "+faststart",
                video,
            )
            thumbnail_time = start_seconds + min(20, duration / 2)
            thumbnail = episode_folder / "thumbnail.jpg"
            still(executable, source, thumbnail_time, thumbnail)
            series["episodes"].append(
                {
                    "number": number,
                    "title": f"{film['title']} — Chapter {number} of 5",
                    "description": f"Sequential chapter {number}/5 of the original film; watch in order."
                    + (" Includes the original end credits." if number == 5 else ""),
                    "duration_seconds": duration,
                    "duration_sec": math.ceil(duration),
                    "is_free": True,
                    "price": 0,
                    "source_start_seconds": round(start_seconds, 6),
                    "source_end_seconds": round(start_seconds + duration, 6),
                    "thumbnail_frame_seconds": thumbnail_time,
                    "thumbnail_path": relative(thumbnail),
                    "video_path": relative(video),
                    "video_sha256": digest(video),
                    "video_size_bytes": video.stat().st_size,
                    "hls_master_path": relative(episode_folder / "master.m3u8"),
                    "renditions": renditions,
                }
            )
            start_seconds += duration
            print(f"Prepared {slug} chapter {number}: {duration:.2f}s", flush=True)
        catalogue["series"].append(series)
        for suffix, url in [
            ("source.json", film["source_api_url"]),
            ("rights.html", film["rights_url"]),
        ]:
            evidence = ROOT / "evidence" / f"{film['slug']}-{suffix}"
            if not evidence.exists() and args.reuse_assets:
                cached = (
                    args.reuse_assets.parents[3]
                    / "content/open-films/evidence"
                    / evidence.name
                )
                if cached.is_file():
                    evidence.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(cached, evidence)
            if not evidence.exists():
                if not args.download:
                    raise ValueError("Missing licence evidence; pass --download")
                download(url, evidence)
    write_json(ROOT / "seed.json", catalogue)
    seal(ROOT)
    verify(ROOT)


def deliverables(root):
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and not any(
            part.startswith(".") or part == "__pycache__"
            for part in path.relative_to(root).parts
        )
        and path.name != "checksums.json"
    )


def seal(root):
    write_json(
        root / "checksums.json",
        {
            "algorithm": "sha256",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "files": {
                path.relative_to(root).as_posix(): {
                    "sha256": digest(path),
                    "size_bytes": path.stat().st_size,
                }
                for path in deliverables(root)
            },
        },
    )


def verify(root, decode=False, executable=None):
    manifest = json.loads((root / "checksums.json").read_text())
    for key, item in manifest["files"].items():
        path = safe_path(root, key)
        if (
            not path.is_file()
            or path.stat().st_size != item["size_bytes"]
            or digest(path) != item["sha256"]
        ):
            raise ValueError(f"Missing or modified pack file: {key}")
    if {path.relative_to(root).as_posix() for path in deliverables(root)} != set(
        manifest["files"]
    ):
        raise ValueError(
            "Unlisted files in the pack; rebuild intentionally before sharing"
        )
    seed = json.loads((root / "seed.json").read_text())
    if (
        seed["schema_version"] != 1
        or len(seed["series"]) != 5
        or len({series["slug"] for series in seed["series"]}) != 5
    ):
        raise ValueError("Expected five unique series")
    video_hashes = set()
    for series in seed["series"]:
        if [episode["number"] for episode in series["episodes"]] != list(range(1, 6)):
            raise ValueError("Expected five ordered episodes in every series")
        for field in ("cover_path", "banner_path"):
            if series[field] not in manifest["files"]:
                raise ValueError(f"Unlisted artwork: {series[field]}")
        position = 0.0
        for episode in series["episodes"]:
            if (
                abs(episode["source_start_seconds"] - position) > 0.001
                or episode["duration_seconds"] <= 0
            ):
                raise ValueError(
                    "Chapter timeline has a gap, overlap or invalid duration"
                )
            position += episode["duration_seconds"]
            if abs(episode["source_end_seconds"] - position) > 0.001:
                raise ValueError("Incorrect chapter end")
            for field in ("video_path", "thumbnail_path", "hls_master_path"):
                if episode[field] not in manifest["files"]:
                    raise ValueError(f"Unlisted episode asset: {episode[field]}")
            video = safe_path(root, episode["video_path"])
            if (
                digest(video) != episode["video_sha256"]
                or video.stat().st_size != episode["video_size_bytes"]
            ):
                raise ValueError("Episode video metadata mismatch")
            video_hashes.add(episode["video_sha256"])
            master = safe_path(root, episode["hls_master_path"])
            references = [
                line
                for line in master.read_text().splitlines()
                if line and not line.startswith("#")
            ]
            if references != [f"{label}/index.m3u8" for label in PROFILES]:
                raise ValueError("Invalid adaptive master")
            timeline = None
            for label in PROFILES:
                rendition = episode["renditions"][label]
                path = safe_path(root, rendition["path"])
                if path != master.parent / label / "index.m3u8":
                    raise ValueError("Rendition path does not match master")
                segments = playlist_segments(path)
                durations = [seconds for seconds, _ in segments]
                if abs(sum(durations) - episode["duration_seconds"]) > 0.001 or (
                    timeline is not None and timeline != durations
                ):
                    raise ValueError("Truncated or unaligned episode rendition")
                timeline = durations
                if decode:
                    ffmpeg(
                        executable,
                        "-xerror",
                        "-i",
                        path,
                        "-map",
                        "0:v:0",
                        "-map",
                        "0:a:0",
                        "-f",
                        "null",
                        "-",
                    )
            if decode:
                ffmpeg(
                    executable,
                    "-xerror",
                    "-i",
                    video,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0",
                    "-f",
                    "null",
                    "-",
                )
        if abs(position - series["source"]["duration_seconds"]) > 0.001:
            raise ValueError(
                "Chapter sequence does not cover the complete original film"
            )
    if len(video_hashes) != 25:
        raise ValueError("Repeated episode video content")
    print(
        f"Verified 5 series, 25 unique MP4s, 50 HLS renditions and {len(manifest['files'])} checksummed files",
        flush=True,
    )
    return seed, manifest


def archive(root, output):
    verify(root)
    if output.resolve().is_relative_to(root.resolve()):
        raise ValueError("Write the ZIP outside the pack folder")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        output, "w", compression=zipfile.ZIP_STORED, allowZip64=True
    ) as bundle:
        for path in [*deliverables(root), root / "checksums.json"]:
            bundle.write(path, "developer-seed/" + path.relative_to(root).as_posix())
    output.with_suffix(".zip.sha256").write_text(f"{digest(output)}  {output.name}\n")
    print(
        f"Share {output} ({output.stat().st_size / 1_000_000:.1f} MB) and {output.name}.sha256"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "verify", "zip", "seal"])
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--reuse-assets", type=lambda value: Path(value).resolve())
    parser.add_argument("--ffmpeg")
    parser.add_argument("--decode", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "build":
        build(args)
    elif args.command == "verify":
        verify(ROOT, args.decode, ffmpeg_binary(args.ffmpeg) if args.decode else None)
    elif args.command == "seal":
        seal(ROOT)
        verify(ROOT)
    else:
        if not args.output:
            parser.error("zip requires --output outside this directory")
        archive(ROOT, args.output)


if __name__ == "__main__":
    main()
