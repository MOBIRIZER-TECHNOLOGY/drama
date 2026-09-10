# Five-series developer media pack

This folder is the handoff unit: **5 series × 5 episodes = 25 unique chapter videos**.
Every series is a licensed open film divided into five sequential technical chapters. These are not
25 newly produced drama episodes, Hindi dubs, or Katha originals. Watch each sequence in order; the
complete original film and its end credits are retained across the five chapters.

Films: Tears of Steel, Sintel, Big Buck Bunny, Spring, and Elephants Dream.
All chapters are free in the supplied seed. Chapter lengths are approximately 1½–3 minutes,
with the measured values and exact source intervals in `seed.json`.

## What to share

Share this **entire folder**, not only `seed.json` or a GitHub/source-code ZIP. The `media/` directory is
gitignored to keep binary assets out of Git. The pack command explicitly includes those assets in a
separate ZIP; do not use `git archive` to make the media handoff.

```text
developer-seed/
  README.md
  sources.json                 creator/source/licence metadata
  seed.json                    portable catalogue and 25 episode records
  checksums.json               SHA-256 and byte size of each deliverable
  pack.py                      build, verify, ZIP commands
  import_seed.py               Katha importer (preview by default)
  validate_api.py              verify imported catalogue and public asset hashes
  evidence/                    captured creator pages and official video metadata
  media/<series-slug>/
    cover.jpg                  600 × 1066 portrait film still
    banner.jpg                 1280 × 720 film still
    episode-01/ ... episode-05/
      thumbnail.jpg            individual 1280 × 720 episode still
      video.mp4                H.264/AAC, 720p, fast-start
      master.m3u8              adaptive HLS
      720p/index.m3u8 + *.ts
      360p/index.m3u8 + *.ts
```

No symlinks, absolute machine paths, database dumps, user data or credentials are required by `seed.json`.
All asset paths are relative to this folder. `.cache/` is only a local rebuild cache; it is deliberately
excluded from the ZIP and is not needed to verify/import/play the delivered videos.

## Verify after receiving

Requires Python 3.9 or newer; basic verification uses only the standard library.

```sh
python3 /path/to/developer-seed/pack.py verify
```

Checks all file hashes, five ordered episodes per series, unique video checksums, no timeline gaps or
overlaps, full-film coverage, and aligned complete HLS playlists. To also fully decode every MP4 and
both HLS versions, install ffmpeg (or `imageio-ffmpeg`) and run:

```sh
python3 /path/to/developer-seed/pack.py verify --decode
```

Play an individual MP4 in a media player without the app. For HLS/browser playback use an HTTP server
with correct MIME types and CORS; `file://` playback is not a reliable HLS test.

## Import into Katha

Use the receiving developer's Katha checkout, installed API environment, migrated database, and object
storage bucket. Configure `KATHA_DATABASE_URL`, `KATHA_S3_ENDPOINT`, `KATHA_S3_ACCESS_KEY`,
`KATHA_S3_SECRET_KEY`, `KATHA_S3_BUCKET`, and `KATHA_CDN_BASE_URL` for that environment; do not put their
real values inside this pack. Run from the API directory if using its local `.env` file.

```sh
/path/to/katha/services/api/.venv/bin/python /path/to/developer-seed/import_seed.py --repo /path/to/katha
/path/to/katha/services/api/.venv/bin/python /path/to/developer-seed/import_seed.py --repo /path/to/katha --apply --publish
```

The first command only verifies/previews. `--apply` uploads and upserts drafts; `--publish` makes them
visible. The importer matches stable `*-chapters` slugs and episode numbers, reuses matching storage
objects, and does not duplicate records on rerun. It updates the `film-credits` CMS page with all five
creators/licences. The pack contains no fake views, likes or user accounts.

Assets are stored below `developer-seed/v1/media/`. Allow public read access to this free-content prefix
and CORS for the web/mobile origins. Keep playlists and segment paths together. To replace the earlier
one-full-film-per-series listings, explicitly add `--archive-originals`; this archives only matching
original film slugs, retaining their records and media. It does not delete other catalogue content.

Other platforms can ingest `seed.json` directly, upload `media/` with the same hierarchy, and prepend
their CDN base to the relative paths. The importer is Katha-specific; the data and videos are not.

After publishing, validate all 25 playback grants, thumbnails, both HLS renditions, MP4s and credits:

```sh
python3 /path/to/developer-seed/validate_api.py --api-url http://localhost:8000 --report /tmp/developer-seed-validation.json
```

## Rebuild and create the separate media ZIP

From this repository root, with ffmpeg or imageio-ffmpeg available:

```sh
services/api/.venv/bin/python content/developer-seed/pack.py build --download --reuse-assets services/api/scripts/seed-assets
services/api/.venv/bin/python content/developer-seed/pack.py zip --output review/exports/katha-developer-seed.zip
```

`--reuse-assets` is optional; without it the builder downloads all five original editions from their
official source URLs. The source metadata pins expected sizes, and completed builds pin source hashes
in `seed.json`. Existing altered sources or missing licence evidence fail the build rather than being
silently accepted. Chapter MP4s are remuxed from the 720p HLS stream, not copies of the same clip.
The ZIP contains media even though Git ignores it and has an adjacent `.zip.sha256` transfer checksum.
After extracting, run `pack.py verify` before importing.

## Attribution and editorial limitations

- Tears of Steel, Sintel and Big Buck Bunny: CC BY 3.0, as stated on their creator pages.
- Spring: CC BY 4.0, per https://studio.blender.org/projects/spring/pages/about/.
- Elephants Dream: CC BY 2.5, per https://orange.blender.org/page/2/ and https://orange.blender.org/press/.
- `sources.json` and `seed.json` record the exact attribution and source/rights links for every film;
  retain them in your catalogue. `evidence/` preserves the official metadata and creator statements.
- Spring's generic PeerTube licence label differs from its project statement; Elephants Dream's API
  label is Unknown. This package follows the explicit creator project licences, not those API labels.
- Changes: five sequential chapter cuts, HLS conversion to 24 fps and 720p/360p with letterboxing,
  and resized/cropped stills. No replacement music, dubbing, creator endorsement, standalone soundtrack,
  unrelated web logos or official DVD cover artwork. The soundtrack remains attached to each scene.
- `duration_seconds` is each chapter's video timeline, which is what the playlists sum to. A player reads
  the container instead, and a container ends with its audio: every fifth chapter runs roughly a tenth of a
  second past its last frame because AAC frames do not align with it. Elephants Dream runs 0.67s past,
  because that film's own soundtrack is 0.57s longer than its picture; the tail is kept rather than trimmed,
  since cutting a creator's audio to tidy a number is an editorial change this pack does not make.
- Preserve CC permissions in service terms and keep creator credits. The chapter titles are technical
  labels, not creator-supplied episode titles. Artwork consists of film stills, not official posters.
- Content guidance is editorial, not official certification. This fixture does not certify app-store
  readiness, age ratings, authenticated billing, subtitles, or production hosting.
