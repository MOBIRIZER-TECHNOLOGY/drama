# Series 09: "Maa Ka Sapna" (माँ का सपना)

Family drama / mother-daughter ambition · UA · 5 episodes x 12 shots · slug `maa-ka-sapna`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Maa Ka Sapna (माँ का सपना), "Mother's Dream" |
| Language | Hindi (Hinglish-tinged, everyday spoken) |
| Genre | Family drama, mother-daughter ambition, music competition |
| Look | Soft watercolour illustration, **not photoreal** (see section 2) |
| Rating | UA: emotional family conflict, no violence, no strong language |
| Setting | A fictional mid-size north Indian city (a lane of old houses, a rooftop terrace, a small music school, a town auditorium), present day |
| Premise | Shobha, 45, a homemaker, secretly returns to her unfinished dream of becoming a classical-singing teacher. Her teenage daughter Ishita becomes her first student and ally while her husband's family resists. A local music competition, Sur Sangam, becomes the test of her courage. |
| Hook per episode | Ep 1: the daughter discovers her mother's voice. Ep 2: the grandmother follows the sound. Ep 3: the old guru names the competition. Ep 4: the grandmother collapses on the night before the final. Ep 5: a hidden past is revealed (season 2). |

Why this look: watercolour washes and soft edges hide the weaknesses of current video models (face drift,
hand detail, Indian skin-tone realism) and suit gentle, emotional drama and music, where saffron and
turquoise colour can bloom like notes in the air. It is a deliberate choice for the pilot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
soft watercolour storybook illustration, gentle ink outlines, warm pastel palette with saffron and turquoise accents, paper texture, diffused golden light, small-city Indian homes and rooftops, tender emotional mood, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, western setting, gore, harsh neon, 3D render
```

Keep palette, paper texture and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| SHOBHA | `shobhaC` | Indian woman, 45, medium wheatish skin, round gentle face, black hair in a low bun with a thin silver streak at the left temple, small mole on the right cheek, small red bindi, turquoise cotton saree with a narrow saffron border, thin glass bangles on both wrists. Shy, warm, quietly determined. |
| ISHITA | `ishitaC` | Indian girl, 16, slim, dark-brown skin, long black hair in a high ponytail with a turquoise scrunchie, mustard-yellow kurti over blue jeans, white earbuds hanging round the neck, an ink stain on the right index finger. Cheeky, loving, fiercely loyal to her mother. |
| SUDHIR | `sudhirC` | Indian man, 48, medium-brown skin, thinning hair grey at the sides, neat moustache, slight belly, steel-framed round spectacles, light-blue half-sleeve shirt, grey trousers, a black wristwatch on the left wrist. Practical, worried about "what people will say", slowly softens. |
| KAMLA | `kamlaC` | Indian woman, 72, fair wrinkled skin, white hair in a tight bun, thick brown-framed glasses, maroon cotton saree with a gold border, a dark wooden walking stick in the right hand. Strict and sharp, hides an old wound. |
| GURUJI | `gurujiC` | Indian man, 75, thin, white hair and a short white beard, white cotton kurta and dhoti, a saffron shawl over the left shoulder, kind deep-set eyes, always seated at a small wooden harmonium. Gentle, wise, a little sad. |

Extras (same watercolour style): a panel of three competition judges (WIDE or one line each, the speaking
judge is a woman in a cream saree with short grey hair), other contestants and an audience (WIDE only).

Locations (also lock a reference image each, one locked reference image per location): **HOME** (living
room and kitchen of a modest two-storey house, turquoise gate, cane chairs, steel utensils), **TERRACE**
(rooftop with clotheslines, water tank and evening saffron sky), **MUSIC ROOM** (Guruji's small riyaaz room
with a tanpura, harmonium, floor mats and a window onto a neem tree), **LANE** (narrow lane of old houses
and a flower stall, morning), **HALL** (town auditorium: stage with turquoise curtains, a single
microphone, rows of seats), **BEDROOM** (Kamla's room with an iron bed and a small cupboard, night).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Voices must come from consented actors or
licensed TTS voices, never a real person or celebrity. Record who gave consent and where the consent form
is stored in `series.json` (see `00_START_HERE.md`).

Music: all songs, humming, aalap and background score must be original or licensed music. No existing film
songs, bhajans, ghazals or recognisable tunes. Compose or license a short original raag-based melody for
Shobha's three singing moments (episodes 1, 4 and 5) and use the same one across the series.

| Character | Voice brief |
|---|---|
| SHOBHA | Woman, mid-40s, soft and slightly hesitant, medium-slow pace, grows steadier through the series; singing voice warm and clear, trained classical style |
| ISHITA | Teen girl, 16, bright and playful, quick pace, natural Hinglish rhythm |
| SUDHIR | Man, late 40s, tired and clipped, medium pace, softer in the last episodes |
| KAMLA | Elderly woman, strict and slow, a dry edge that cracks into tenderness in the end |
| GURUJI | Elderly man, gentle and breathy, slow, warm |
| JUDGE (extra) | Woman, 50s, calm, kind and clear, medium pace |

Pick one Hindi TTS or voice-actor setup and use it for the whole series so the voices stay stable. Always
test a Hindi line for natural stress before committing: wrong stress is the most common failure.

## 5. Episodes, shots and dialogue

Shot length is **5 s**. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line. Sung lines are marked "(singing)" and use the original series melody.

### Episode 1: "Chhupa Hua Sur" (छुपा हुआ सुर), free

Logline: A homemaker hums in secret, and her daughter hears her true voice.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | Dawn over rooftops of a small city, saffron sky, a house with a turquoise gate | SHOBHA (VO): "हर औरत के अंदर एक अधूरा सपना होता है।" (Every woman has an unfinished dream inside her.) |
| 1-02 | MED | HOME kitchen: SHOBHA rolls rotis, steam rising, bangles jingling | - |
| 1-03 | CU | SHOBHA's lips softly humming, eyes half closed | - |
| 1-04 | MED | SUDHIR at the table with a newspaper, glancing at his watch | SUDHIR: "शोभा, चाय कहाँ है? दफ़्तर को देर हो रही है।" (Shobha, where is the tea? I'm getting late for office.) |
| 1-05 | CU | SHOBHA, startled out of her humming | SHOBHA: "बस लाती हूँ, जी।" (Bringing it right away.) |
| 1-06 | MED | KAMLA in a cane chair, sipping tea, eyeing SHOBHA over her glasses | KAMLA: "बहू, सुबह-सुबह गुनगुनाना अच्छा नहीं लगता।" (Daughter-in-law, humming early in the morning isn't nice.) |
| 1-07 | TWO | ISHITA at the kitchen door watching SHOBHA quietly, earbuds round her neck | - |
| 1-08 | INS | Afternoon: ISHITA opens a dusty old trunk, a small wooden harmonium and a yellowed certificate inside | - |
| 1-09 | CU | ISHITA lifts the harmonium, curious | ISHITA: "ये किसका है?" (Whose is this?) |
| 1-10 | WIDE | TERRACE at night, saffron lamplight, SHOBHA alone on a mat with the harmonium | - |
| 1-11 | CU | SHOBHA, eyes closed, sings the first phrase, watercolour notes drift up | SHOBHA (singing, original aalap): "आ… आ… आ…" |
| 1-12 | MED | Behind SHOBHA, ISHITA stands in the terrace doorway, eyes wide | ISHITA: "माँ… आप इतना अच्छा गाती हैं?" (Mom... you sing this well?) |

### Episode 2: "Pehli Shishya" (पहली शिष्या), free

Logline: Ishita begs to learn, and the terrace becomes a secret classroom.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | CU | SHOBHA, flustered, hiding the harmonium behind her back | SHOBHA: "ये कुछ नहीं है, बस पुरानी चीज़ है।" (It's nothing, just an old thing.) |
| 2-02 | CU | ISHITA, earnest and bright-eyed | ISHITA: "माँ, मुझे भी सिखाओ। प्लीज़!" (Mom, teach me too. Please!) |
| 2-03 | MED | SHOBHA hesitates, glancing down the stairs toward the house | - |
| 2-04 | TWO | ISHITA holds out her little finger to SHOBHA | ISHITA: "राज़ पक्का! आप मेरी गुरु, मैं आपकी शिष्या।" (Secret promised! You are my guru, I am your student.) |
| 2-05 | MED | TERRACE, next afternoon: mother and daughter sit cross-legged, SHOBHA plays the harmonium | - |
| 2-06 | CU | ISHITA sings off-key and scrunches her nose | - |
| 2-07 | CU | SHOBHA laughs freely for the first time | SHOBHA: "कोई बात नहीं। फिर से, धीरे-धीरे।" (No problem. Again, slowly.) |
| 2-08 | INS | Two pairs of hands on the harmonium keys: bangled and inky | - |
| 2-09 | WIDE | Evening: the two climb down the stairs hiding the harmonium in a laundry basket | - |
| 2-10 | MED | HOME kitchen: KAMLA sniffs around suspiciously with her stick | KAMLA: "आजकल तुम दोनों छत पर क्या करती हो?" (What do you two do on the roof these days?) |
| 2-11 | CU | ISHITA, a very bad liar | ISHITA: "कपड़े सुखाते हैं, दादी।" (We dry clothes, Dadi.) |
| 2-12 | MED | Night: KAMLA climbs the stairs toward a faint tune, stick tapping | KAMLA: "देखती हूँ कौन सा कपड़ा सुर में सूखता है।" (Let me see which cloth dries in tune.) |

### Episode 3: "Ghar Ki Deewarein" (घर की दीवारें), free

Logline: The secret is out, the family pushes back, and Shobha goes to find her old guru.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | WIDE | HOME living room, night: SUDHIR and KAMLA seated, SHOBHA and ISHITA standing before them | - |
| 3-02 | CU | SUDHIR, arms crossed | SUDHIR: "इस उम्र में गाना? लोग क्या कहेंगे?" (Singing at this age? What will people say?) |
| 3-03 | CU | KAMLA, tapping her stick | KAMLA: "हमारे घर की बहुएँ मंच पर नहीं गातीं।" (The daughters-in-law of our house don't sing on stage.) |
| 3-04 | CU | SHOBHA, voice quiet but firm | SHOBHA: "बीस साल मैंने सबकी सुनी। अब अपनी भी सुनूँगी।" (For twenty years I listened to everyone. Now I will listen to myself too.) |
| 3-05 | CU | ISHITA steps forward | ISHITA: "पापा, मैं माँ के साथ हूँ।" (Papa, I am with Mom.) |
| 3-06 | MED | SUDHIR looks away silently, rubbing his spectacles | - |
| 3-07 | WIDE | LANE, next morning: SHOBHA walks with a cloth bag past a flower stall | - |
| 3-08 | MED | MUSIC ROOM: GURUJI at his harmonium, the neem tree in the window behind him | - |
| 3-09 | CU | GURUJI looks up, stunned | GURUJI: "शोभा? बाईस साल बाद?" (Shobha? After twenty-two years?) |
| 3-10 | CU | SHOBHA with palms joined, tears in her eyes | SHOBHA: "गुरुजी, मैं फिर से सीखना चाहती हूँ।" (Guruji, I want to learn again.) |
| 3-11 | MED | SHOBHA sings a short aalap, GURUJI closes his eyes and listens | - |
| 3-12 | CU | GURUJI, eyes wet | GURUJI: "सुर संगम में गाओगी? कल आख़िरी तारीख़ है।" (Will you sing at Sur Sangam? Tomorrow is the last date.) |

### Episode 4: "Sur Sangam" (सुर संगम), coin-locked

Logline: Stage nerves, a selection, and a night that tests Shobha's choice.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | HALL, afternoon: contestants waiting in rows of seats, turquoise stage curtains | - |
| 4-02 | CU | SHOBHA seated, clutching the edge of her saree | SHOBHA: "मेरी आवाज़ तो काँप रही है।" (My voice is trembling.) |
| 4-03 | TWO | ISHITA squeezes her mother's hand | ISHITA: "माँ, जैसे छत पर गाती हैं, वैसे गाइए।" (Mom, sing the way you do on the terrace.) |
| 4-04 | WIDE | The stage: SHOBHA small under a single spotlight, three judges at a table | - |
| 4-05 | CU | SHOBHA closes her eyes and breathes in | - |
| 4-06 | MED | SHOBHA sings, saffron and turquoise watercolour notes float over the seats | SHOBHA (singing, original): "सुर मेरे… सपने मेरे…" |
| 4-07 | CU | The JUDGE puts down her pen, moved | - |
| 4-08 | MED | JUDGE, smiling warmly | JUDGE: "आप फ़ाइनल में पहुँच गई हैं। बधाई हो!" (You have reached the final. Congratulations!) |
| 4-09 | TWO | SHOBHA and ISHITA hug outside the hall | ISHITA: "आप जीत गईं, माँ!" (You won, Mom!) |
| 4-10 | MED | HOME doorway, evening: SUDHIR awkwardly holding a box of sweets | SUDHIR: "मैंने सुना कि तुम फ़ाइनल में हो।" (I heard that you're in the final.) |
| 4-11 | WIDE | BEDROOM, night: KAMLA rises from the bed, wobbles, her stick clatters to the floor | - |
| 4-12 | CU | SHOBHA kneels holding KAMLA's hand, KAMLA's eyes closed | SHOBHA: "माँजी! माँजी, आँखें खोलिए!" (Mother-in-law! Please open your eyes!) |

### Episode 5: "Aakhri Taan" (आख़िरी तान), coin-locked

Logline: A grandmother's confession, a song for a daughter, and a reveal in the front row.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | MED | BEDROOM, night: KAMLA sits up in bed, tired but awake, SHOBHA beside her with a glass of water | KAMLA: "डॉक्टर ने कहा, बस थकान थी। तुम कल जाओ।" (The doctor said it was only tiredness. You go tomorrow.) |
| 5-02 | CU | SHOBHA, astonished | SHOBHA: "पर माँजी, आप तो मना करती थीं…" (But Mother-in-law, you used to say no...) |
| 5-03 | CU | KAMLA, softly, looking at her hands | KAMLA: "मुझे भी कभी गाने से रोका गया था।" (I too was once stopped from singing.) |
| 5-04 | INS | KAMLA's wrinkled hands unfold an old cloth bundle: a faded saffron silk stole | - |
| 5-05 | WIDE | HALL, evening: packed audience in the dark, SHOBHA in the saffron stole over her turquoise saree walks to the microphone | - |
| 5-06 | TWO | Front row: SUDHIR, holding KAMLA's hand, sits beside ISHITA | - |
| 5-07 | CU | SHOBHA at the microphone, eyes closed | SHOBHA: "ये गीत मेरी बेटी के लिए है।" (This song is for my daughter.) |
| 5-08 | MED | SHOBHA sings, saffron and turquoise petals swirl above the audience | SHOBHA (singing, original): "तू मेरा सुर है, तू मेरा सवेरा…" |
| 5-09 | CU | ISHITA, crying and smiling | - |
| 5-10 | WIDE | The whole hall rises in a standing ovation, petals falling | - |
| 5-11 | MED | GURUJI walks to the front row and stops before KAMLA, staring at the saffron stole | GURUJI: "ये दुपट्टा… कमला, क्या तुम हो?" (This stole... Kamla, is it you?) |
| 5-12 | CU | KAMLA, tears on her wrinkled cheeks; end card "सीज़न 2 जारी है…" | KAMLA: "गुरुजी… मैंने आपसे किया वादा तोड़ दिया था।" (Guruji... I broke the promise I made to you.) |
