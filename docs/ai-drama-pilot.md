# AI drama pilot (Phase 0): task list

Two weeks, no new product code. The pilot answers one question: **can an AI pipeline produce usable Hindi
vertical drama at a cost per usable minute below roughly a third of conventional shooting?** Everything else
in the plan (production graph, review UI, schema) is built only if the answer is yes.

Source: the deep-research report of 2026-10-21 ("Build Katha's hybrid AI drama studio"). Most prices in it
come from resellers and blogs; the pilot exists to replace them with measured numbers. Re-check every price
against the vendor's own page on the day you spend money.

## Decision rule (write it down before generating anything)

Proceed to Phase 1 only if **all three** hold for the best stack:

1. Cost per usable minute < ~1/3 of conventional cost (Rs 10-25k per minute, so under about Rs 3-8k).
2. Hindi lip-sync on frontal close-ups is accepted by the blind raters (target: >= 70% of clips score >= 4/5).
3. Identity survives the re-generation test (same shot regenerated two weeks apart still scores >= 4/5 identity).

Otherwise pivot: dubbing of human-shot content into Indian languages, plus stylised or non-dialogue genres.
Fix the thresholds above with the team on day 1; do not move them after seeing results.

## Day 0: unblockers (do before spending anything)

- [ ] Name a pilot owner, one editor, and three native Hindi raters (blind: they must not see which model made a clip).
- [ ] Counsel scopes the consent templates (voice actors x2, one on-camera cast member): scope, territory, term, withdrawal, AI-training exclusion.
- [ ] Counsel answers: is Katha an "intermediary" under the IT Rules 2026 for its own content? Does the synthetic-information label apply to fictional scenes? (Pilot output stays internal, not published, until answered.)
- [ ] Read the commercial-use, output-ownership and indemnity terms of every vendor used. Record them in a table (vendor, date read, link, key clauses). The research did not cover these.
- [ ] Set a hard spend cap (suggest USD 1,500 / about Rs 1.3 lakh) and open accounts: fal.ai (prepaid credits), Kling API, BytePlus/Seedance, Google (Gemini Omni Flash; Veo 3.1 retires 2026-10-22, so do not build on it), Sarvam, ElevenLabs, sync.so.
- [ ] Confirm Gemini Omni Flash supports 9:16 and its max clip length. The research could not.

## Days 1-2: test script and references

- [ ] Write a 3-minute test script in Hinglish: two recurring leads, one scene with three speakers, one wide establishing shot, one emotional close-up, one profile-angle line, wardrobe in saree and kurta, an Indian interior and an outdoor location.
- [ ] Break it into a 30-shot list (about 8 s each) as JSON: shot id, type (close-up / two-shot / wide / profile / multi-speaker), dialogue line, camera, wardrobe, location. Tag each shot's type; results are reported per type.
- [ ] Lock reference sheets per lead (front, side, three-quarter, 2 expressions) and per location. Store with SHA-256 in `scratchpad` or a pilot bucket, not in git.
- [ ] Record the two voice actors' consented reference samples (Kling needs a 5-30 s voice sample; ElevenLabs/Sarvam cloning needs consent evidence).

## Days 3-8: generation

Models under test (confirm availability first): Kling 3.0 Omni, Seedance 2.x, Gemini Omni Flash. Optionally Hailuo H3.

- [ ] Write one harness script (`scripts/pilot/generate.py`, not committed to the app) that reads the shot list and, per model, submits N=10 generations per shot with the same references. Log every attempt to a CSV/JSONL: shot id, model, version, request id, seed (if any), prompt, reference hashes, submit/finish time, latency, status, vendor-billed cost, failure reason.
- [ ] Run the same 30 shots x 10 generations on each model. Keep raw outputs.
- [ ] Voice track A: each model's native audio, where it has any.
- [ ] Voice track B: Hindi TTS for every line from Sarvam Bulbul V3 and ElevenLabs v3 (cloned voices from the consented samples).
- [ ] Lip-sync: run sync-3 and lipsync-2-pro on the same clips with the TTS audio. Include frontal, profile and multi-face shots.
- [ ] Generate music for two scenes (ElevenLabs Music or Suno, subscription active) and note the licence terms actually shown at purchase.
- [ ] Do not tune prompts between models; use one prompt template so differences are the models', not the prompts'.

## Days 9-12: scoring

- [ ] Build a scoring sheet: per clip accept/reject, lip-sync 1-5, emotion 1-5, identity 1-5, Indian-face/wardrobe realism 1-5, free-text defect. Raters score blind and independently.
- [ ] The editor separately marks each clip usable / needs fix / unusable and logs minutes spent fixing.
- [ ] Automated QC in parallel (do not let it influence human scores): ArcFace/InsightFace identity distance against the reference sheet, plus a Gemini or Claude vision rubric per clip. Later, measure how well it predicts the human rejects.
- [ ] Identity-stability test: regenerate 3 chosen shots (same references, same prompts) and score them against the originals.
- [ ] Assemble one 90-120 s cut from the best clips per model stack: loudness normalise (ffmpeg loudnorm, I=-16 / TP=-1), burn subtitles aligned to the known script. Time the human edit.

## Days 13-14: analysis and decision

- [ ] Compute, per model and per shot type: reject rate r (generations per usable shot), cost per usable minute (all spend including lip-sync, voice, music, and editor time at the real hourly rate, divided by accepted minutes), Hindi lip-sync pass rate for frontal vs profile and 1 vs multi-face, identity score and drift, latency.
- [ ] Compute QC gate precision/recall against human rejects.
- [ ] Replace the report's placeholder inputs with the measured ones: retry ratio, editor hours, actual vendor prices.
- [ ] Write a 2-page result: the three decision-rule checks, a table of numbers, 10 best and 10 worst clips, vendor-terms table, open legal questions.
- [ ] Go / no-go meeting. Record the decision and the numbers behind it in this file.

## Deliverables

1. `generation_log` (CSV/JSONL) of every attempt with cost.
2. Scoring sheet with raw rater scores.
3. The three assembled test cuts.
4. Vendor-terms table and counsel's written answers.
5. Result memo with the go / no-go decision.

## If go: what Phase 1 builds (not part of the pilot)

Only to the depth one 40-episode series needs; see the report's section 6 for the full design.

- [ ] `VideoProvider` registry beside the LLM one in `services/ai/katha_ai/providers.py` (submit, status, cancel, normalise), adapters for the 1-2 winning vendors. Vendors have been shutting down models; swapping must be config.
- [ ] arq jobs `submit_shot` / `poll_shot` / `assemble_episode` and an idempotent webhook (unique on vendor `request_id`, reconciliation cron for stuck shots).
- [ ] Tables: `production_run`, `shot`, `shot_attempt`, `asset`, `character`, `talent_release`.
- [ ] Episode fields `ai_disclosure`, `provenance_manifest_uri`, `generation_run_id`, exposed in the API and shown as a badge in web, admin and mobile; C2PA manifest signed after HLS transcode.
- [ ] Admin shot-review grid with accept / reject / re-roll, running cost meter, and a fast unpublish control.

## Risks to watch during the pilot

- Vendor churn: confirm each model is still offered on the day you start (Sora's API and Veo 3.1 are already gone or going).
- Reseller prices differ from official ones; log what you are actually billed.
- Do not publish or show pilot output outside the team until counsel answers the labelling question.
- Likeness: use only consented talent or fully invented characters. No real-person or celebrity likeness or voice, and nothing that resembles one.
