Katha demo: 5 Hindi vertical drama series, 32 episodes (2026-10-28)

Series
  1. Neel Mahal Ka Raaz (नील महल का राज़): 12 episodes, first 3 free, rated UA13, folder neel-mahal-ka-raaz/
  2. Chai Ki Tapri Pe Pyaar (चाय की टपरी पे प्यार): 5 episodes, first 3 free, rated UA13, folder chai-ki-tapri-pe-pyaar/
  3. Baraat Bhaag Gayi (बारात भाग गई): 5 episodes, first 3 free, rated UA, folder baraat-bhaag-gayi/
  4. Aakhri Local (आख़िरी लोकल): 5 episodes, first 3 free, rated UA13, folder aakhri-local/
  5. Badla Bandini (बदला बंदिनी): 5 episodes, first 3 free, rated UA13, folder badla-bandini/

What is where
  catalog.json                     every series and episode with titles, descriptions, free/locked flag and file paths
                                   (start here when building the app)
  <series>/series.json             full series metadata, incl. the tools used and the voice licence of every character
  <series>/cover.jpg               600x1066 portrait poster
  <series>/banner.jpg              1280x720 landscape banner
  <series>/episode-NN/video.mp4    the episode
  <series>/episode-NN/thumbnail.jpg  720x1280 episode thumbnail
  <series>/episode-NN/subtitles.hi.srt  Hindi subtitles (not burned into the picture: show them as player captions)
  <series>/episode-NN/generation_log.jsonl  production record of how each shot was made (not needed by the app)

Video format
  720x1280 (9:16), 24 fps, H.264 High, AAC 48 kHz stereo, loudness -16 LUFS, about 57 s per episode.
  These are the masters, about 20 Mbps (about 145 MB an episode). For streaming in an app, upload them to a video host
  that makes adaptive (HLS) copies, or encode lighter copies; do not ship the masters inside the app bundle.

Before a public release
  - Every series is AI-generated: show an "AI-generated" label (series.json "ai_disclosure").
  - The native Hindi review of the dialogue and the owner's approval are still pending. Use these for the demo only
    until both are done.
  - All characters are fictional; voices are licensed synthetic TTS voices (no cloning); music is original (generated).
