# Series 01: "Neel Mahal Ka Raaz" (नील महल का राज़)

Fantasy mystery romance · UA13 · 5 episodes x 12 shots · slug `neel-mahal-ka-raaz`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Neel Mahal Ka Raaz (नील महल का राज़), "The Secret of the Blue Palace" |
| Language | Hindi (Hinglish-tinged, everyday spoken) |
| Genre | Folk fantasy / mystery romance |
| Look | Stylised painterly 2.5D illustration, **not photoreal** (see section 2) |
| Rating | UA13: supernatural peril, no gore, no strong language |
| Setting | Neelgarh, a fictional sandstone fortress-palace with blue domes in Rajasthan, present day |
| Premise | Meera, a young archivist, takes a month-long job cataloguing a palace sealed for 100 years. Its old caretaker seems to have been waiting for her. A blue mirror holds the imprisoned spirit of Queen Neelambari, and Meera's family is bound to her curse. |
| Hook per episode | Every episode ends on a reveal or a threat |

Why this look: stylised art hides the weaknesses of current video models (face drift, uncanny faces, Indian
skin-tone realism) and suits fantasy. It is a deliberate choice for the pilot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
painterly cinematic illustration, 2.5D storybook look, rich indigo and amber palette, warm lantern light against cool blue moonlight, soft film grain, sandstone Rajasthani haveli architecture with jali screens and blue domes, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, western setting, modern city, gore
```

Keep palette, grain and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| MEERA | `meeraC` | Indian woman, 22, warm brown skin, long black braid over the left shoulder, small mole above the left eyebrow, big expressive eyes, mustard-yellow cotton kurta, dusty-pink dupatta, thin silver earrings, tote bag of notebooks. Curious, brave, quick to smile. |
| RUDRA | `rudraC` | Indian man, 35, tall, short trimmed beard, sharp jaw, tired dark eyes, maroon bandhgala jacket over black kurta, a silver ring on the right hand. Stern, guarded, hides grief. |
| DADI | `dadiC` | Indian woman, 70, silver hair in a low bun, thin gold-rimmed spectacles, plain white cotton saree with a thin blue border, deep smile lines, holds a brass oil lamp. Warm, knowing, secretive. |
| BHAIRAV | `bhairavC` | Indian man, 52, slicked grey-streaked hair, thin moustache, black achkan with gold buttons, a cane with a silver cobra head. Smooth, polite, menacing. |
| NEELAMBARI | `neelC` | Spirit of a queen: tall translucent woman made of blue light and mist, ornate blue lehenga and heavy gold jewellery, veil, glowing blue eyes, long hair drifting as if underwater. Sorrowful, powerful. |

Locations (also lock a reference image each): **GATE** (palace gate and courtyard, dawn), **HALL** (grand dusty
hall with sheeted furniture and jali light), **ARCHIVE** (Meera's candle-lit room with ledgers), **MIRROR ROOM**
(upper room with a tall oval blue mirror in a silver frame), **TERRACE** (rooftop at dusk with distant dunes).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| MEERA | Young woman, warm, curious, light Hindi, natural Hinglish rhythm |
| RUDRA | Low calm baritone, clipped, restrained emotion |
| DADI | Elderly woman, soft, slow, affectionate with a secretive edge |
| BHAIRAV | Smooth mid-low male, polite, quietly threatening |
| NEELAMBARI | Female, ethereal, slight echo/reverb; whispered |

Hindi TTS or cloning options in my research: Sarvam Bulbul, ElevenLabs v3, Indic Parler-TTS and F5-TTS
(open). Pick one and use it for the whole series so the voices stay stable. Always test a Hindi line for
natural stress before committing: wrong stress is the most common failure.

## 5. Episodes, shots and dialogue

Shot length is **5 s** unless noted. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line.

### Episode 1: "Neelgarh Ki Chaabi" (नीलगढ़ की चाबी), free

Logline: Meera reaches the sealed palace and the caretaker greets her by name.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | Dawn mist, Neelgarh palace on a hill, blue domes catching first light | MEERA (VO): "कहते हैं नीलगढ़ के दरवाज़े सौ साल से बंद हैं।" (They say Neelgarh's doors have been shut for a hundred years.) |
| 1-02 | MED | MEERA steps from a dusty jeep at GATE, holding an appointment letter | - |
| 1-03 | CU | MEERA looks up at the huge carved gate | MEERA: "मुझे बस एक महीना चाहिए, सब कुछ दर्ज करने के लिए।" (I only need a month to catalogue everything.) |
| 1-04 | TWO | A small door opens in the gate; DADI with a lamp beside MEERA | DADI: "तुम आ गईं, बिटिया। मैं कब से इंतज़ार कर रही थी।" (You've come, child. I've been waiting so long.) |
| 1-05 | CU | MEERA surprised | MEERA: "आप मुझे जानती हैं?" (You know me?) |
| 1-06 | WIDE | HALL, dust sheets over furniture, blue light through jali | - |
| 1-07 | MED | DADI in profile, lamp lighting her face | DADI: "तीन बातें याद रखना, बिटिया।" (Remember three things, child.) |
| 1-08 | CU | DADI, serious | DADI: "रात को ऊपर मत जाना। नीला आईना मत छूना।" (Don't go upstairs at night. Don't touch the blue mirror.) |
| 1-09 | MED | ARCHIVE at night, MEERA writing in a ledger by candle | - |
| 1-10 | CU | MEERA stops writing, hears faint anklets | MEERA: "कौन है वहाँ?" (Who's there?) |
| 1-11 | WIDE | Dark corridor, a blue glow at the end, a veiled woman's silhouette (NEELAMBARI) | - |
| 1-12 | CU | MEERA's eyes with a blue reflection; end card "अगले एपिसोड में…" | NEELAMBARI (whisper, off-screen): "मीरा… तुम लौट आईं।" (Meera… you have returned.) |

### Episode 2: "Neela Aaina" (नीला आईना), free

Logline: Meera ignores the warning and finds the blue mirror, and the heir finds her.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | MED | TERRACE, morning; DADI pours tea for MEERA | DADI: "सुबह की चाय ठंडी हो रही है।" (Your morning tea is getting cold.) |
| 2-02 | CU | MEERA, uneasy | MEERA: "दादी, रात को मैंने पायल की आवाज़ सुनी।" (Dadi, last night I heard anklets.) |
| 2-03 | CU | DADI stops pouring, tense | DADI: "यहाँ की दीवारें बहुत बोलती हैं। सुनना मत।" (These walls speak a lot. Don't listen.) |
| 2-04 | WIDE | Low angle: MEERA climbs the forbidden upper stairs | - |
| 2-05 | INS | A hand on an old door with a blue-carved lock | - |
| 2-06 | WIDE | MIRROR ROOM: tall oval blue mirror, glowing frame | - |
| 2-07 | CU | MEERA reaching toward the glass | MEERA: "बस एक बार देखना है…" (I just want one look…) |
| 2-08 | MED | The mirror ripples; a faint vision of NEELAMBARI on this balcony | - |
| 2-09 | MED | Door slams; RUDRA stands in the doorway in shadow | RUDRA: "कौन हो तुम? और यहाँ क्या कर रही हो?" (Who are you? What are you doing here?) |
| 2-10 | CU | MEERA, defiant | MEERA: "मैं मीरा हूँ। राजपरिवार ने मुझे बुलाया है।" (I'm Meera. The royal family called me.) |
| 2-11 | CU | RUDRA, cold | RUDRA: "मैंने किसी को नहीं बुलाया। निकल जाओ, वरना बहुत देर हो जाएगी।" (I called no one. Leave before it's too late.) |
| 2-12 | OTS | Over MEERA's shoulder: the mirror reflection shows her in the queen's jewellery, smiling when she isn't | NEELAMBARI (whisper): "वो आ रही है।" (She is coming.) |

### Episode 3: "Dadi Ka Raaz" (दादी का राज़), free

Logline: The curse's history, a photo of Meera's mother, and a new villain.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | MED | Library; RUDRA and MEERA across a table, lamp between them | RUDRA: "सौ साल पहले रानी नीलांबरी इसी आईने में क़ैद हुई थी।" (A hundred years ago Queen Neelambari was imprisoned in this mirror.) |
| 3-02 | CU | MEERA | MEERA: "किसने क़ैद किया?" (Who imprisoned her?) |
| 3-03 | CU | RUDRA, looking away | RUDRA: "मेरे परदादा ने। श्राप तब से हर पूर्णिमा पर जागता है।" (My great-grandfather. The curse wakes every full moon.) |
| 3-04 | INS | An old photograph: DADI and a young woman who looks like MEERA | - |
| 3-05 | CU | MEERA, stunned | MEERA: "ये तो मेरी माँ हैं!" (That's my mother!) |
| 3-06 | MED | DADI in the doorway, caught | DADI: "मैंने तुम्हें इसी लिए बुलाया था।" (That's why I called you.) |
| 3-07 | MED | DADI, lamp trembling | DADI: "तुम्हारी माँ ने रानी को आधा छुड़ा दिया था।" (Your mother half-freed the queen.) |
| 3-08 | CU | MEERA | MEERA: "आधा? मतलब?" (Half? What does that mean?) |
| 3-09 | CU | DADI | DADI: "बाक़ी आधा तुम्हारे रक्त में बंधा है।" (The other half is bound in your blood.) |
| 3-10 | WIDE | RUDRA steps back, stunned | RUDRA: "तो तुम ही वो हो।" (So you are the one.) |
| 3-11 | WIDE | From a window: BHAIRAV with men walking into the courtyard at dusk | - |
| 3-12 | CU | BHAIRAV smiling, cane in hand | BHAIRAV: "आख़िरकार… वारिस मिल गई।" (At last… the heir is found.) |

### Episode 4: "Poornima Ki Raat" (पूर्णिमा की रात), coin-locked

Logline: Full moon: the mirror opens and the queen steps out.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | Huge full moon over Neelgarh, blue light on the domes | - |
| 4-02 | MED | RUDRA prepares a silver talisman by lamp | RUDRA: "आज रात आईना खुलेगा। तुम्हें मेरे साथ रहना होगा।" (Tonight the mirror opens. You must stay with me.) |
| 4-03 | CU | MEERA | MEERA: "अगर मैं मना कर दूँ?" (And if I refuse?) |
| 4-04 | CU | RUDRA, grave | RUDRA: "तो भैरव तुम्हें ले जाएगा, और रानी हमेशा के लिए बेक़ाबू हो जाएगी।" (Then Bhairav will take you, and the queen will be unleashed forever.) |
| 4-05 | WIDE | Courtyard: BHAIRAV's men with torches at the gates | - |
| 4-06 | CU | BHAIRAV at the gate | BHAIRAV: "दरवाज़ा खोलो, राजकुमार! वक़्त नहीं है तुम्हारे पास।" (Open the door, prince! You have no time.) |
| 4-07 | MED | DADI bars the door with her lamp raised | DADI: "मैं इन्हें रोकती हूँ, तुम दोनों ऊपर जाओ!" (I'll hold them. You two, go upstairs!) |
| 4-08 | TWO | MEERA and RUDRA running up the stairs | - |
| 4-09 | WIDE | MIRROR ROOM: the mirror cracked and blazing blue | - |
| 4-10 | WIDE | NEELAMBARI rises from the mirror, vast and luminous | - |
| 4-11 | CU | NEELAMBARI's face | NEELAMBARI: "मीरा, तुम्हारी माँ ने मुझसे एक वादा किया था।" (Meera, your mother made me a promise.) |
| 4-12 | CU | MEERA, shocked; hard cut to black | MEERA: "कौन सा वादा?" (What promise?) |

### Episode 5: "Aakhri Darwaza" (आख़िरी दरवाज़ा), coin-locked

Logline: A choice, a betrayal revealed, and the mirror breaks.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | MED | NEELAMBARI offers her hand to MEERA | NEELAMBARI: "आईना खोलो, और मैं तुम्हारे परिवार को हर श्राप से मुक्त कर दूँगी।" (Open the mirror and I will free your family of every curse.) |
| 5-02 | CU | RUDRA, urgent | RUDRA: "मत सुनो! ये छल है!" (Don't listen! It's a trick!) |
| 5-03 | CU | MEERA torn | MEERA: "सच कौन बोल रहा है?" (Who is telling the truth?) |
| 5-04 | WIDE | Mirror vision: BHAIRAV's ancestor betraying the queen in a dark hall | - |
| 5-05 | CU | MEERA to RUDRA, accusing | MEERA: "रानी को धोखा तो तुम्हारे ख़ानदान ने दिया था, राजकुमार।" (Your family betrayed the queen, prince.) |
| 5-06 | CU | RUDRA, shaken | RUDRA: "मुझे नहीं पता था…" (I didn't know…) |
| 5-07 | WIDE | BHAIRAV bursts in with men | BHAIRAV: "बहुत हुआ नाटक!" (Enough of this drama!) |
| 5-08 | MED | DADI, hurt, leaning on the doorframe, lamp dim | DADI: "मीरा… आईना तोड़ना मत…" (Meera… don't break the mirror…) |
| 5-09 | INS | MEERA's hand pressing the glass; blue light floods | - |
| 5-10 | WIDE | The room dissolves in white-blue light | - |
| 5-11 | WIDE | Dawn; the palace silent; MEERA alone on the TERRACE | - |
| 5-12 | CU | MEERA's reflection in a window: her eyes glow blue; end card "सीज़न 1 जारी है…" | - |
