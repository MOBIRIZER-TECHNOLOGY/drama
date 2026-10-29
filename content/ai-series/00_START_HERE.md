# KATHA AI SERIES PACK: START HERE

Ten original Hindi short-drama series, written so another machine can generate the videos and hand back files
that import straight into the Katha app. This guide is the shared part: setup, the exact output format,
assembly commands and the delivery checklist. Each series has its own file in `series/`.

All characters, places and stories are fictional. No real person, celebrity, politician, brand or deity is
depicted or imitated. Keep it that way: never add a real person's face or voice.

## The ten series

| # | File | Title | Genre | Look |
|---|---|---|---|---|
| 01 | `series/01-neel-mahal-ka-raaz.md` | Neel Mahal Ka Raaz | Fantasy mystery romance | Painterly 2.5D illustration |
| 02 | `series/02-chai-ki-tapri-pe-pyaar.md` | Chai Ki Tapri Pe Pyaar | Small-town romance | Warm 2D storybook |
| 03 | `series/03-baraat-bhaag-gayi.md` | Baraat Bhaag Gayi | Wedding comedy-romance | Bright 3D cartoon |
| 04 | `series/04-aakhri-local.md` | Aakhri Local | Mumbai night thriller | Ink-and-neon graphic novel |
| 05 | `series/05-badla-bandini.md` | Badla Bandini | Revenge drama | Oil-painting chiaroscuro |
| 06 | `series/06-vetaal-ki-paheli.md` | Vetaal Ki Paheli | Folk fantasy riddles | Shadow-puppet / folk art |
| 07 | `series/07-dilli-2099.md` | Dilli 2099 | Sci-fi romance | Neon cel-shaded anime |
| 08 | `series/08-hostel-number-13.md` | Hostel Number 13 | Campus horror-comedy | Claymation 3D |
| 09 | `series/09-maa-ka-sapna.md` | Maa Ka Sapna | Family drama | Soft watercolour |
| 10 | `series/10-chhoti-dukaan-bada-sapna.md` | Chhoti Dukaan, Bada Sapna | Business drama | Gouache paper-cut collage |

Each series: **5 episodes x 12 shots of 5 seconds = 60 shots, about 60 s per episode**. Episodes 1-3 are free,
4-5 are coin-locked. In total 50 episodes, 600 shots.

Every look is stylised, not photoreal. That is deliberate: it hides the weak spots of current video models
(face drift, uncanny faces, Indian skin-tone realism) and keeps each series visually distinct.

**Suggested order:** do series 01 end to end first as the test. Judge it, fix the process, then batch the rest.
Do not start all ten at once.

## 1. What you hand back

For each series, one folder named by its slug, all inside one parent folder:

```
katha-ai-series-delivery/
  neel-mahal-ka-raaz/
    series.json                  see section 5
    cover.jpg                    600 x 1066 portrait poster
    banner.jpg                   1280 x 720 landscape still
    episode-01/
      video.mp4                  720x1280, 24 fps, H.264 + AAC, finished episode with audio
      thumbnail.jpg              720 x 1280 still from the episode
      subtitles.hi.srt           Hindi subtitles timed to the final cut (UTF-8)
      generation_log.jsonl       one line per generation attempt (section 4)
    episode-02/ ... episode-05/
  chai-ki-tapri-pe-pyaar/
    ...
```

Rules for the files:

- `video.mp4`: **exactly 720x1280** (9:16), constant 24 fps, H.264 High, `yuv420p`, AAC stereo 48 kHz,
  `-movflags +faststart`. About 60 s per episode (55-75 s). No burned-in subtitles; the app shows the `.srt`.
- Loudness: integrated -16 LUFS, true peak -1 dB.
- Folder and file names exactly as above (lowercase, hyphens, two-digit episode numbers, series slug as the folder).
- Nothing secret inside: no API keys, account details or personal data.
- Deliver series one at a time if you like. A finished series folder is useful on its own.

What happens on the Katha side: I verify the files, make the HLS ladder with the worker's transcode settings,
create the catalogue entries from `series.json`, import as **draft**, and test playback on web and mobile.
Nothing is published without the owner's OK.

## 2. Tool setup (one workable local stack)

For an NVIDIA machine with 16 GB VRAM. These are starting points to confirm, not guarantees. The newest GPUs
may need recent PyTorch/CUDA builds.

1. **ComfyUI** (latest) with the Wan video nodes and a GGUF loader.
2. **Keyframes:** Flux or SDXL, quantized (fp8/NF4). Per series, make one **reference sheet per character**
   (front, side, three-quarter, two expressions) in that series' look. Optionally train one LoRA per main
   character from 15-40 reference images (ai-toolkit, kohya or OneTrainer, about 1-3 h each) using the
   trigger word in the characters table. Lock one reference image per location.
3. **Animation:** **Wan 2.2 image-to-video.** Draft with TI2V-5B; final with I2V-14B GGUF (Q4/Q5) at about
   480x832, then upscale to 720x1280. Wan has no native audio. License: Apache 2.0.
4. **Voice:** Hindi TTS (section 3). **Lip-sync:** LatentSync or MuseTalk on dialogue shots. Hindi quality
   is unverified, so check every dialogue shot by eye and ear. Cartoon, claymation and puppet looks may lip-sync
   less cleanly than realistic faces; if so, a simple mouth-flap or off-screen delivery is acceptable.
5. **Assembly:** ffmpeg (section 6). Optional upscaling: Real-ESRGAN or Topaz.

For dialogue shots that fail after lip-sync, a hosted model is the fallback. Log which shots used one.

Per-shot recipe: build the keyframe from the STYLE_PREFIX + character tags + the shot's visual line (with the
character LoRA/reference attached) -> animate with Wan I2V (5 s) -> make the voice line -> lip-sync if the
speaker's face is on screen -> trim to 5 s. Keep palette, grain and costume identical across the series.
Change only the shot content.

Shot types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert), OTS (over the shoulder). `(VO)` is
voice-over (no lip-sync). `-` means no speech: add ambience and music only.

## 3. Voices

Use **consented voice actors or licensed stock/TTS voices**. Never clone or imitate a real person or celebrity.
Each series file has a voice brief per character. Pick one Hindi TTS (or actors) per character and keep it for
the whole series so the voice stays stable. Options from the research: Sarvam Bulbul, ElevenLabs v3, Indic
Parler-TTS and F5-TTS (open). Test each line for natural stress before committing; wrong stress is the most
common failure. Music must be original or properly licensed for commercial use. No existing film songs.

## 4. Generation log (for audit, cost and AI labelling)

One JSON object per line in each episode's `generation_log.jsonl`:

```json
{"shot":"1-03","attempt":2,"stage":"video","tool":"wan2.2-i2v-14b-q5","local":true,"seed":123456,"prompt_file":"prompts/1-03.txt","reference_sha256":["..."],"started":"2026-10-25T10:02:11Z","seconds_gpu":780,"cost_usd":0,"accepted":true,"defect":null}
```

`stage` is one of `keyframe`, `video`, `voice`, `lipsync`, `music`, `upscale`. If a hosted service was used,
set `local` to false and put the real billed amount in `cost_usd`.

## 5. series.json (one per series)

Copy this, fill the blanks from the series file (title, characters, episode titles and loglines are all there).
Fill each `duration_sec` with the real length of `video.mp4` in whole seconds. Coin prices are set later in
the Katha admin, so leave them out.

```json
{
  "slug": "",
  "title": "",
  "title_hi": "",
  "synopsis": "",
  "synopsis_hi": "",
  "year": 2026,
  "original_language": "hi",
  "audio": "Hindi dialogue",
  "categories": [],
  "content_rating": "UA13",
  "content_advisory": "",
  "completion_status": "Ongoing",
  "free_episodes": 3,
  "cover_path": "cover.jpg",
  "banner_path": "banner.jpg",
  "ai_disclosure": "ai_generated",
  "ai_disclosure_note": "Story written by humans; images, motion and voices generated with AI tools.",
  "tools": [
    {"stage": "keyframe", "name": "", "version": ""},
    {"stage": "video", "name": "wan2.2-i2v-14b", "version": ""},
    {"stage": "voice", "name": "", "version": ""},
    {"stage": "lipsync", "name": "", "version": ""},
    {"stage": "music", "name": "", "version": ""}
  ],
  "talent": [
    {"character": "", "voice_source": "consented actor | licensed TTS voice", "consent_ref": ""}
  ],
  "episodes": [
    {"number": 1, "title": "", "title_hi": "", "description": "", "duration_sec": 0, "is_free": true},
    {"number": 2, "title": "", "title_hi": "", "description": "", "duration_sec": 0, "is_free": true},
    {"number": 3, "title": "", "title_hi": "", "description": "", "duration_sec": 0, "is_free": true},
    {"number": 4, "title": "", "title_hi": "", "description": "", "duration_sec": 0, "is_free": false},
    {"number": 5, "title": "", "title_hi": "", "description": "", "duration_sec": 0, "is_free": false}
  ]
}
```

Suggested `categories` per series (use the genre): 01 Fantasy, Mystery, Romance · 02 Romance, Drama ·
03 Comedy, Romance · 04 Thriller, Crime · 05 Drama, Revenge · 06 Fantasy, Folk Tales · 07 Science Fiction,
Romance · 08 Comedy, Horror · 09 Family, Drama, Music · 10 Drama, Comedy.

## 6. Assembly (ffmpeg)

Per shot: mux the animated clip with its voice line, trim to 5 s.
```
ffmpeg -i shot.mp4 -i line.wav -map 0:v -map 1:a -t 5 -r 24 -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k shot_out.mp4
```
Shots without speech still need an audio track (ambience/silence) so the concat stays in sync.

Concatenate an episode (list file `parts.txt` with `file 'shot_out_01.mp4'` lines, in order):
```
ffmpeg -f concat -safe 0 -i parts.txt -c copy episode_raw.mp4
```
Add a quiet music bed (ducked under speech), normalise loudness and set the final format:
```
ffmpeg -i episode_raw.mp4 -i music.wav -filter_complex "[1:a]volume=0.25[m];[0:a][m]sidechaincompress=threshold=0.05:ratio=8[d];[0:a][d]amix=inputs=2:duration=first,loudnorm=I=-16:TP=-1:LRA=11[a]" -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -vf scale=720:1280 -r 24 -c:a aac -b:a 160k -movflags +faststart video.mp4
```
Thumbnail: `ffmpeg -ss 12 -i video.mp4 -frames:v 1 thumbnail.jpg`.
Subtitles: write `subtitles.hi.srt` from the dialogue column using each shot's start time (shot n of an
episode starts at (n-1) x 5 s), then check it against the audio.
Verify a finished file: `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate -of default=nw=1 video.mp4`.

## 7. Delivery checklist (tick before sending each series)

- [ ] 5 episode folders, each with `video.mp4`, `thumbnail.jpg`, `subtitles.hi.srt`, `generation_log.jsonl`
- [ ] `series.json` filled in (durations, tools, talent and consent references), plus `cover.jpg` and `banner.jpg`
- [ ] Every `video.mp4` is 720x1280, 24 fps, H.264/AAC, about -16 LUFS, plays start to end with no black frames or silent gaps
- [ ] Same face, hair and costume for each character across all 60 shots (compare against the reference sheets)
- [ ] Hindi lines sound natural; lip-sync acceptable on every dialogue shot (redo any that are not)
- [ ] No real person's likeness or voice, no text or logos baked into the picture, no copyrighted music
- [ ] Voice and music licences checked and noted (commercial use allowed)
- [ ] Nothing secret in the folder (keys, accounts, personal data)

## 8. Before anything goes public

- The Hindi in these scripts was drafted by an AI. **A native Hindi speaker must review every line** (grammar,
  gender agreement, tone) before recording or generating voice.
- India's rules on synthetic media (IT Rules amendments in force since 20 Feb 2026) require a prominent label
  and a provenance marker on photoreal synthetic content. These looks are stylised, but whether the label
  applies still needs counsel's answer. Keep `ai_disclosure` accurate in `series.json`.
- Keep the generation logs, the consent records and the tool licences. They are the audit trail.
