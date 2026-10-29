# Seed data

Everything a developer needs to fill a fresh Katha install with content, in one place.

```
seed/
  README.md                         this file
  ai-series/                        the five AI-generated Hindi demo series (32 episodes)
    catalog.json                    index of every series and episode, with the file path of each asset
    README.txt                      the delivery note from the production team
    <slug>/series.json              full series metadata, tools used, voice licences, AI disclosure
    <slug>/cover.jpg  banner.jpg    600x1066 poster and 1280x720 banner
    <slug>/episode-NN/
      thumbnail.jpg                 720x1280 episode thumbnail
      subtitles.hi.srt              Hindi subtitles (imported as WebVTT captions, not burned in)
      generation_log.jsonl          how each shot was made (provenance; the app does not read it)
      video.mp4                     the episode  <- NOT in git, see below
```

Everything except `video.mp4` is in git (about 12 MB, plus `videos.manifest.json`). The videos are not, because they are large.

## Fastest path

```bash
cp .env.example services/api/.env        # or use the handover zip's .env
unzip katha-seed-videos.zip -d .         # the videos, from the project owner (about 430 MB)
pnpm seed                                # infra, migrations, admin, translations, pages, the 5 series, published
```

`pnpm seed` is `scripts/seed-all.sh`. It starts a worker for the encoding if none is running, imports the series,
waits for every video to be transcoded to the encrypted 720p/480p/360p stream, then publishes. Re-running is safe.
Options: `-- --no-series` (skip the demo series), `-- --demo-data` (also demo purchases and offers),
`-- --no-infra` (Docker is already up).

Admin login after seeding: `admin@katha.local` / `katha-local-admin` (override with `KATHA_SEED_ADMIN_EMAIL` and
`KATHA_SEED_ADMIN_PASSWORD`).

## The videos

| Copy | Size | Where | Use |
|---|---|---|---|
| Light development copies, 720x1280 H.264 at about 2.5 Mbps | about 430 MB (about 13 MB an episode) | `katha-seed-videos.zip`, from the owner | what `pnpm seed` imports |
| Delivered masters, about 20 Mbps | 4.6 GB (145 MB an episode) | `katha-demo-5-series.zip`, kept by the owner | archive; source for the light copies |

`videos.manifest.json` lists the SHA-256 and size of every light copy, so you can check a download:

```bash
cd seed/ai-series && python3 - <<'PY'
import hashlib, json, pathlib
m = json.load(open("videos.manifest.json"))
bad = [p for p, v in m["files"].items() if hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() != v["sha256"]]
print("all good" if not bad else f"mismatch: {bad}")
PY
```

To rebuild the light copies from the masters: `scripts/encode-seed-videos.sh <masters folder>`. The masters folder
mirrors this one (`<slug>/episode-NN/video.mp4`).

## Importing by hand

```bash
cd services/api
uv run python scripts/import_ai_series.py                       # preview: counts and missing files, changes nothing
uv run python scripts/import_ai_series.py --apply               # upload and create drafts, queue the transcodes
uv run python scripts/import_ai_series.py --apply --publish     # also wait for the worker, then publish
```

The importer reads `seed/ai-series` by default; `--pack <folder>` and `--video-root <folder>` override it.
Content ratings are checked against U, UA7, UA13, UA16 and A (the pack's plain "UA" is mapped to UA7).

## Rules for this content

- Every series is **AI-generated**. The label and the disclosure note come from `series.json` and must stay visible.
- The dialogue has **not been reviewed by a native Hindi speaker**, and the owner's approval is pending. Use it
  for demos and development only until both are done.
- Characters are fictional; voices are licensed synthetic voices; the music is generated.
- Do not commit videos. `seed/ai-series/**/video.mp4` is git-ignored.
