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
git clone git@github.com:MOBIRIZER-TECHNOLOGY/drama.git && cd drama
pnpm bootstrap
```

`pnpm bootstrap` (`scripts/bootstrap.sh`) checks your tools, runs `pnpm install`, downloads **one file**,
`katha-dev-bundle.zip` (about 430 MB), from Google Drive, verifies its checksum, and unpacks it into place. The
bundle holds the `.env` files for the API, web, admin and mobile apps and the 32 demo videos. It then runs
`pnpm seed`, which starts the data stores, applies the migrations, creates the admin user, loads the translations and
pages, starts a worker for the encoding, imports the 5 series, waits for the encrypted 720p/480p/360p streams and
publishes them. Everything is safe to re-run, and existing `.env` files are never overwritten.

If the Drive download is blocked on your network, download the file in a browser, save it in the repository root as
`katha-dev-bundle.zip`, and run `pnpm bootstrap` again.

`pnpm seed` on its own (Docker already running, bundle already unpacked) takes `-- --no-series` (skip the demo
series), `-- --demo-data` (also demo purchases and offers) and `-- --no-infra`.

Admin login after seeding: `admin@katha.local` / `katha-local-admin` (override with `KATHA_SEED_ADMIN_EMAIL` and
`KATHA_SEED_ADMIN_PASSWORD`).

## The bundle

| Item | What it is |
|---|---|
| `katha-dev-bundle.zip` | one file on Google Drive: `.env` files + the light demo videos. Its Drive id and checksum are in `seed/bundle.json` |
| Light videos | 720x1280 H.264 at about 2.5 Mbps, about 13 MB an episode, 426 MB in all |
| Delivered masters | about 20 Mbps, 145 MB an episode, 4.6 GB in all. Kept by the owner; the source for the light copies |

The bundle has **no production secrets and no Razorpay keys**. For test purchases ask the owner privately for the
Razorpay *test* key id and secret and put them in `services/api/.env`.

`videos.manifest.json` lists the SHA-256 and size of every video, so you can check an unpacked bundle:

```bash
cd seed/ai-series && python3 - <<'PY'
import hashlib, json, pathlib
m = json.load(open("videos.manifest.json"))
bad = [p for p, v in m["files"].items() if hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() != v["sha256"]]
print("all good" if not bad else f"mismatch: {bad}")
PY
```

To rebuild the light copies from the masters: `scripts/encode-seed-videos.sh <masters folder>`. The masters folder
mirrors `seed/ai-series` (`<slug>/episode-NN/video.mp4`).

### For the owner: publishing a new bundle

1. Build the zip (env files and `seed/ai-series/*/episode-*/video.mp4`, paths relative to the repository root).
2. Upload it to Google Drive and share it as "Anyone with the link can view".
3. Run `scripts/set-bundle.sh "<the share link>" path/to/katha-dev-bundle.zip`, then commit `seed/bundle.json`.

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
