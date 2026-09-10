# Open Short Films starter catalogue

This package contains three complete licensed short films. They are not Katha originals, Hindi dramas,
or ten newly produced episodes. Each title is represented by one playable **Full Film** entry in the
existing series/episode model. All three are free to watch, with their entire original credit rolls retained.

| Film | Runtime of this edition | Format | Audio | Director |
| --- | --- | --- | --- | --- |
| Tears of Steel (2012) | 12:14 | Live-action science fiction | English | Ian Hubert |
| Sintel (2010) | 14:48 | Animated fantasy drama | English | Colin Levy |
| Big Buck Bunny (2008) | 10:35 | Animated comedy, remastered edition | No spoken dialogue | Sacha Goedegebure |

Total: approximately **37 minutes 37 seconds**, rounded to whole seconds for catalogue labels.
Source downloads: approximately **578 MB decimal**. Exact HLS durations are in `manifest.json`.
The Tears of Steel and Sintel source editions have no caption tracks in Blender's PeerTube API at acquisition;
Big Buck Bunny has no spoken dialogue.
Do not advertise subtitles or Hindi dubbing. Content guidance in `catalog.json` is editorial, not an
official age certificate or a substitute for either store's content-rating questionnaire.

## Files and rights

- `catalog.json`: titles, original descriptions, directors, genres, language, editorial advisories,
  original pages, licence statements, download URLs and expected sizes/durations.
- `manifest.json`: measured runtime, source SHA-256 checksums, HLS variants and every media object's checksum.
- `evidence/`: original official API responses and creator licence pages downloaded on 2026-09-10.
- `../../services/api/scripts/seed-assets/source/open-films/`: original, complete MP4 downloads, gitignored.
- `../../services/api/scripts/seed-assets/hls/open-films/`: adaptive HLS, gitignored.
- `../../services/api/scripts/seed-assets/images/open-films/`: covers and banners extracted from the actual films,
  gitignored. These are cropped/resized film stills, not official theatrical posters.
- `../../review/open-films/`: screenshots of the source credits for visual inspection.

The rights sources are [Tears of Steel](https://mango.blender.org/about/),
[Sintel](https://durian.blender.org/sharing/) and [Big Buck Bunny](https://peach.blender.org/about/).
The films are shared under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
The entire credits remain in the stream; descriptions and the public Film credits & licences page
also identify the creators, licence, source and changes. No creator endorsement is claimed.

Only the complete films and stills from them are used. Separate soundtrack releases, DVD cover art,
third-party marks, logos and unrelated site artwork are not included as catalogue assets.
Do not use the actors' likenesses as an endorsement or a separate product advertisement.
The service's terms must preserve the reuse permissions granted by each film's licence.

## Rebuild and import

From the repository root, with the API virtual environment installed and ffmpeg on PATH
(or `imageio-ffmpeg` installed in that environment):

```bash
services/api/.venv/bin/python services/api/scripts/prepare_open_films.py --download
services/api/.venv/bin/python services/api/scripts/import_open_films.py
```

The first command resumes incomplete downloads, verifies expected source sizes and pinned hashes,
encodes the entire films at 720p/360p with aligned six-second segments, extracts artwork and writes the manifest.
Original aspect ratios are preserved using letterboxing. The soundtrack stays attached to each film.
The second command verifies hashes and playlist completeness without changing the database or storage.
Use `--force` on the preparation command only when intentionally rebuilding the renditions/artwork.
Use `--refresh-artwork` to refresh the selected film frames without re-encoding video.

To upload to the configured object storage and import drafts, supply your actual API environment values:

```bash
services/api/.venv/bin/python services/api/scripts/import_open_films.py --apply
```

To make the imported collection visible in the configured environment:

```bash
services/api/.venv/bin/python services/api/scripts/import_open_films.py --apply --publish
```

The importer uses `KATHA_DATABASE_URL`, `KATHA_S3_ENDPOINT`, `KATHA_S3_ACCESS_KEY`,
`KATHA_S3_SECRET_KEY`, `KATHA_S3_BUCKET` and `KATHA_CDN_BASE_URL` from the API settings.
Do not commit their real values. Asset keys are stored without a hostname, so the API resolves them
against its current CDN configuration. Ensure public access to the free `hls/open-films/` and
`images/open-films/` prefixes and CORS for the web origin; the original `source/` MP4s can remain private.

`--archive-demo` additionally archives `sample-series` and the three known `e2e-filler-monsoon`,
`e2e-filler-harbour` and `e2e-filler-orchard` fixtures, retaining their test files, records and history.
It requires `--publish`. Other existing catalogue records are not altered.
Repeated imports update these same three slugs and episode number 1 instead of creating duplicates.
Do not rerun the old sample seeder for a release catalogue; it is intended for development fixtures.

The credits page is available at web `/p/film-credits` and mobile `/page/film-credits`.
Per-film attribution is also in the synopsis, accessible from each client's film details screen.

Verify the live API, anonymous playback, both HLS variants, artwork and licence page:

```bash
services/api/.venv/bin/python services/api/scripts/validate_open_films.py --api-url http://127.0.0.1:8000
```

This downloads every public HLS/artwork object and compares its SHA-256 with the prepared manifest.
It writes `review/open-films/api-validation.json`; it does not use login credentials or change the catalogue.

## Store submission handoff

The downloaded content package does not publish either app or guarantee approval. Before submitting a build:

1. Import into the real release database/storage and verify publicly reachable HTTPS playback and artwork.
2. Exclude remaining fictional seed titles, dummy statistics and incomplete shows from the release catalogue.
3. Use actual app screenshots and accurate descriptions: a starter short-film catalogue, without claiming
   original Hindi dramas, unavailable dubbing or a larger library than is present.
4. Complete the store age-rating questionnaires from the films' actual content; review violence/language guidance.
5. Supply genuine privacy/support URLs, operator details, data disclosures and reviewer access for any locked features.
   The repository's old legal-page seeder explicitly creates placeholders; those are not final launch policies.
6. Verify any advertised coin/subscription purchases and account deletion on release builds.

Suggested content paragraph for review notes after release-host verification:

> The initial catalogue includes three complete short films: Tears of Steel, Sintel and Big Buck Bunny.
> Each title has a Full Film entry and is free to play without purchasing coins. The films are licensed
> under Creative Commons Attribution 3.0, with original credits retained. Creator attribution, licence
> links and transformation details appear in each title's synopsis and in Film credits & licences.
> The films are English-language or dialogue-free works; they are not presented as Katha originals.

Other account-based features still require their own review access instructions. Do not invent credentials,
claim production hosting is ready, or state that purchases were validated merely because this content is imported.
