"""Builds ten short portrait HLS streams so the player can be exercised for real on a local stack.

Local development has no transcoder, so every episode answers `asset_not_ready` from
`POST /v1/episodes/{id}/play` and the player, swipe-between-episodes, auto-advance, resume and the scrubber
cannot be tested at all. The part of the product most worth testing is the part a local stack cannot reach.

Each episode gets its own hue and its own burned-in number, plus a seconds counter that only advances while
frames are actually decoding. That is what makes a screenshot conclusive: the number says which episode is on
screen, and the counter says it is playing rather than frozen on a first frame.

Output is deliberately not committed. Run this, then `scripts/seed_local_media.py` to point the seeded
episodes at it, and serve the directory:

    python scripts/seed-assets/gen-hls.py
    uv run python scripts/seed_local_media.py
    python -m http.server 8090 --directory services/api/scripts/seed-assets

Requires ffmpeg on PATH.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE / "media" / "heiress"
SECONDS = 30
EPISODES = 10
# One hue per episode, walking the brand's warm range so neighbouring episodes never look alike.
HUES = ["6B1220", "8C1A2E", "A8262B", "C03A22", "D4571A", "C76A12", "A87016", "80641F", "5A4A2A", "3A2A2E"]

# drawtext needs a real font file, and ffmpeg's own fontconfig lookup is unreliable on Windows.
FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
]


def find_font() -> Path | None:
    return next((p for p in FONT_CANDIDATES if p.exists()), None)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source", type=Path, help="Optional real video source; each episode uses a different 30-second excerpt."
    )
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"), help="Path to ffmpeg when it is not on PATH.")
    args = parser.parse_args()

    if not args.ffmpeg:
        print("ffmpeg is not on PATH.")
        return 1
    ffmpeg = str(Path(args.ffmpeg).resolve())
    if args.source and not args.source.exists():
        print(f"Source video does not exist: {args.source}")
        return 1

    font = find_font()
    if font is None:
        print(f"No usable font found. Looked in: {', '.join(str(p) for p in FONT_CANDIDATES)}")
        return 1

    # ffmpeg's filter syntax treats ':' and '\' as separators, so the font is referenced by a plain name from
    # the working directory rather than an absolute path.
    local_font = HERE / "_hls-font.ttf"
    shutil.copyfile(font, local_font)

    if ROOT.exists():
        shutil.rmtree(ROOT)

    try:
        for n in range(1, EPISODES + 1):
            out = ROOT / f"ep{n}"
            out.mkdir(parents=True, exist_ok=True)
            text = (
                f"drawtext=fontfile={local_font.name}:text='EP {n}':fontcolor=white:fontsize=170:"
                "x=(w-text_w)/2:y=(h-text_h)/2-120,"
                rf"drawtext=fontfile={local_font.name}:text='%{{eif\:t\:d}}':fontcolor=white@0.85:fontsize=110:"
                "x=(w-text_w)/2:y=(h-text_h)/2+120"
            )
            if args.source:
                inputs = ["-ss", str(45 + (n - 1) * 45), "-t", str(SECONDS), "-i", str(args.source.resolve())]
                video_filter = (
                    "[0:v]split=2[back][front];"
                    "[back]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=24[bg];"
                    "[front]scale=720:1280:force_original_aspect_ratio=decrease[fg];"
                    "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p"
                )
                filter_args = ["-filter_complex", video_filter]
            else:
                inputs = [
                    "-f",
                    "lavfi",
                    "-i",
                    f"color=c=0x{HUES[n - 1]}:s=720x1280:d={SECONDS}:r=25",
                    "-f",
                    "lavfi",
                    "-i",
                    f"sine=frequency={220 + n * 40}:duration={SECONDS}",
                ]
                filter_args = ["-vf", text]

            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-loglevel",
                    "error",
                    *inputs,
                    *filter_args,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-pix_fmt",
                    "yuv420p",
                    "-g",
                    "50",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "64k",
                    "-f",
                    "hls",
                    "-hls_time",
                    "4",
                    "-hls_playlist_type",
                    "vod",
                    "-hls_flags",
                    "independent_segments",
                    "-hls_segment_filename",
                    str(out / "seg%d.ts"),
                    str(out / "master.m3u8"),
                ],
                check=True,
                cwd=HERE,
            )
            print(f"ep{n}: {len(list(out.glob('*.ts')))} segments")
    finally:
        local_font.unlink(missing_ok=True)

    print(f"Wrote {EPISODES} streams to {ROOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
