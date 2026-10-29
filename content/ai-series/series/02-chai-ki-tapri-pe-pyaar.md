# Series 02: "Chai Ki Tapri Pe Pyaar" (चाय की टपरी पे प्यार)

Small-town enemies-to-lovers romance · UA13 · 5 episodes x 12 shots · slug `chai-ki-tapri-pe-pyaar`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Chai Ki Tapri Pe Pyaar (चाय की टपरी पे प्यार), "Love at the Tea Stall" |
| Language | Hindi (Hinglish-tinged, everyday spoken) |
| Genre | Small-town romance comedy / enemies-to-lovers |
| Look | Warm flat-colour hand-illustrated 2D storybook look, golden-hour palette, **not photoreal** (see section 2) |
| Rating | UA13: family quarrels and heartbreak, no violence, no strong language |
| Setting | Raniganj Kasba, a fictional small town in the UP/Bihar belt, present day. Two rival chai stalls (a blue-canopy one and a red-canopy one) face each other across one narrow lane. |
| Premise | Chhavi, 22, runs her late mother's blue-canopy stall with her father Shankar. Across the lane, Lalan's red-canopy stall has been Shankar's enemy for years. Lalan's son Veer returns from the city, and when the town announces that only one stall will survive after the annual fair, the two must compete, and slowly fall for each other. |
| Hook per episode | 1: only one stall will survive. 2: the fathers catch them together and ban it. 3: a misunderstanding, Chhavi thinks Veer is selling the lane. 4: the lane has a new owner, and it seems to be Veer. 5: the truth is told, the fathers reconcile, and a photo reveals they were once partners (season 2 setup). |

Why this look: a flat-colour illustrated style hides the weaknesses of current video models (face drift,
uncanny skin, crowded detail), keeps faces simple enough to hold across 60 shots, and lets golden-hour warmth
carry the romance and humour. It is a deliberate choice for the pilot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
warm flat-colour hand-illustrated 2D storybook look, golden-hour palette of saffron, marigold and terracotta, soft paper-grain texture, bold clean outlines, small-town North Indian lane with tin-roofed chai stalls and tiled shopfronts, rising chai steam, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, 3D render, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, modern city skyline, gore
```

Keep palette, paper grain and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| CHHAVI | `chhaviC` | Indian woman, 22, medium build, warm wheatish-brown skin, thick black braid over the right shoulder tied with a red hairband, deep dimple on the right cheek, tiny gold stud in the left nostril, kohl-lined eyes, parrot-green cotton salwar kameez with a white dupatta tucked at the waist, steel kettle in hand when at the stall. Fiery, funny, secretly soft. |
| VEER | `veerC` | Indian man, 25, lean and tall, light tan skin, messy short black hair, light stubble, a thin scar through the left eyebrow, navy round-neck t-shirt under an open grey checked shirt, blue jeans, white sneakers, canvas backpack with a yellow strap. Easygoing, teasing, quietly guilty about the years away. |
| SHANKAR | `shankarC` | Indian man, 55, short and stout with a round belly, bald on top with grey side hair, bushy grey moustache, thick black-framed glasses taped at one hinge, cream kurta, sky-blue gamchha over the left shoulder. Loud, proud, soft-hearted about his daughter. Runs the blue-canopy stall. |
| LALAN | `lalanC` | Indian man, 58, tall and thin, white stubble, red-and-white checked gamchha tied on the head like a headband, maroon half-sleeve shirt, white dhoti, one gold-capped front tooth. Boastful, dramatic, adores his son. Runs the red-canopy stall. |
| MUNNI | `munniC` | Indian woman, 60, plump, grey hair in a tight bun, big round red bindi, bright orange cotton saree, steel tiffin box always in one hand. The lane's gossip; says everything loudly. Friendly to both stalls. |

Minor one-shot roles (no reference sheet needed, keep generic): BUILDER, a man in a grey suit with a slim folder
and polite smile (ep 3 and 4); an elder judge in a white kurta (ep 4).

Locations (also lock a reference image each): **LANE** (the narrow lane at golden hour, the two stalls facing each
other, one with a blue canopy and one with a red canopy), **BLUE STALL** (Shankar's stall: stove, steel kettle,
glass tumblers), **RED STALL** (Lalan's stall: copper pot, clay cups), **BUS STAND** (dusty roadside stop with a
peepal tree), **ROOFTOPS** (two neighbouring flat roofs with a narrow gap, clotheslines, string lights),
**MELA GROUND** (open fairground with swings, bunting and a small stage).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| CHHAVI | Young woman, mid-pitch, sharp and playful, quick pace, softens when emotional |
| VEER | Young man, warm light baritone, relaxed, teasing, slows down when sincere |
| SHANKAR | Middle-aged man, loud and gruff, medium pace, comic indignation |
| LALAN | Older man, thin theatrical voice, fast, dramatic pauses |
| MUNNI | Older woman, high and breathless, very fast, gossipy |

Pick one Hindi TTS or consented-actor pipeline and use it for the whole series so the voices stay stable.
Always test a Hindi line for natural stress before committing.

## 5. Episodes, shots and dialogue

Shot length is **5 s**. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert), OTS (over the
shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short English gist.
"-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the visual line.

### Episode 1: "Do Tapri, Ek Gali" (दो टपरी, एक गली), free

Logline: Veer comes home to the lane, collides with Chhavi, and the town announces only one stall will survive.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | LANE at golden hour, blue-canopy stall and red-canopy stall facing each other, steam rising from both | CHHAVI (VO): "हमारी गली में दो टपरियाँ हैं, और दो दुश्मन।" (Our lane has two tea stalls, and two enemies.) |
| 1-02 | MED | CHHAVI sweeping in front of BLUE STALL, glaring across the lane | - |
| 1-03 | MED | SHANKAR pours tea from a height into a glass, chest puffed with pride | - |
| 1-04 | MED | LALAN at RED STALL waving a ladle, shouting across the lane | LALAN: "अरे शंकर, तेरी चाय में तो पानी ही पानी है!" (Hey Shankar, your tea is nothing but water!) |
| 1-05 | WIDE | BUS STAND: a bus pulls away, VEER stands with his backpack in the dust | - |
| 1-06 | MED | VEER walks into the lane, smiling, looking at the old stalls | - |
| 1-07 | TWO | VEER and CHHAVI collide in the lane, her kettle tilts and steam puffs out | CHHAVI: "देखकर चलो! सारी चाय गिर गई!" (Watch where you walk! All the tea has spilled!) |
| 1-08 | CU | VEER, sheepish grin | VEER: "माफ़ करना। वैसे, तुम्हारी चाय की ख़ुशबू बहुत अच्छी है।" (Sorry. By the way, your tea smells lovely.) |
| 1-09 | MED | LALAN runs out of RED STALL and lifts VEER in a hug, CHHAVI watching from the background | LALAN: "मेरा बेटा शहर से आ गया!" (My son has come back from the city!) |
| 1-10 | CU | CHHAVI, eyes widening in horror | CHHAVI: "ओह नहीं… दुश्मन का बेटा!" (Oh no... the enemy's son!) |
| 1-11 | MED | MUNNI runs through the lane waving a folded paper, tiffin swinging | MUNNI: "ख़बर सुनो! मेले के बाद गली में एक ही टपरी बचेगी!" (Listen up! After the fair only one stall will be left in the lane!) |
| 1-12 | CU | CHHAVI and VEER stare at each other across the steam between the stalls | CHHAVI: "सिर्फ़ एक टपरी? तो वो मेरी होगी।" (Only one stall? Then it will be mine.) |

### Episode 2: "Baarish Wali Chai" (बारिश वाली चाय), free

Logline: Rain wrecks both stalls and Chhavi helps her enemy, and then both fathers catch them together.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | WIDE | LANE in warm rain, golden light through the clouds, both canopies sagging, puddles shining | - |
| 2-02 | MED | CHHAVI at BLUE STALL placing a steel bucket under a leaking canopy | CHHAVI: "बाबा, छत फिर टपक रही है!" (Baba, the roof is leaking again!) |
| 2-03 | MED | SHANKAR holding up a bamboo pole, glasses fogged | SHANKAR: "ये ज़रूर लालन की कोई चाल है!" (This is surely some trick of Lalan's!) |
| 2-04 | WIDE | Across the lane, VEER on a ladder fixing the red canopy, wobbling | - |
| 2-05 | MED | CHHAVI points across the lane at the slipping bamboo pole over the RED STALL stove | CHHAVI: "सावधान! तुम्हारा बाँस खिसक रहा है!" (Careful! Your pole is slipping!) |
| 2-06 | TWO | CHHAVI and VEER hold the pole together from both sides in the rain | VEER: "तुम तो मेरी दुश्मन हो ना? फिर मदद क्यों?" (You're my enemy, aren't you? Then why help?) |
| 2-07 | CU | CHHAVI, embarrassed, rain on her cheeks | CHHAVI: "चाय बर्बाद होते नहीं देख सकती, बस इसलिए।" (I can't watch tea go to waste, that's all.) |
| 2-08 | TWO | CHHAVI and VEER walk together under one yellow umbrella, awkwardly apart | - |
| 2-09 | INS | Two glasses of steaming chai side by side on a wooden bench | - |
| 2-10 | CU | VEER sips and his eyes go wide | VEER: "इसमें क्या डाला है? ये तो जादू है!" (What did you put in this? This is magic!) |
| 2-11 | CU | CHHAVI, proud smirk | CHHAVI: "ये मेरी माँ की रेसिपी है। बताऊँगी नहीं।" (This is my mother's recipe. I won't tell.) |
| 2-12 | WIDE | LANE: SHANKAR and LALAN glare at the pair from their stalls, MUNNI frozen between them, thunder flashes | SHANKAR: "आज के बाद उस लड़के से बात नहीं करोगी!" (From today you will not talk to that boy!) |

### Episode 3: "Galat Fehmi" (ग़लतफ़हमी), free

Logline: A rooftop evening of confessions ends when Chhavi sees Veer with a man who wants to buy the lane.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | WIDE | ROOFTOPS at dusk, two flat roofs with a narrow gap, string lights glowing, laundry on lines | - |
| 3-02 | MED | CHHAVI hanging marigold garlands on her roof, VEER's head pops up on the neighbouring roof | VEER: "डरो मत, मैं सिर्फ़ चाय माँगने आया हूँ।" (Don't be scared, I only came to ask for tea.) |
| 3-03 | CU | CHHAVI trying not to smile | CHHAVI: "मेरी चाय तुम्हारी टपरी को हरा देगी।" (My tea will beat your stall.) |
| 3-04 | CU | VEER, soft light on his face | VEER: "शहर में बहुत कमाया, पर सुकून नहीं मिला।" (I earned a lot in the city, but found no peace.) |
| 3-05 | CU | CHHAVI listening, her eyes gentle | - |
| 3-06 | CU | VEER, small smile | VEER: "मुझे बाबूजी की डाँट याद आती थी।" (I used to miss Babuji's scolding.) |
| 3-07 | TWO | Both on their separate roofs, looking at each other across the gap, lights glowing | - |
| 3-08 | WIDE | Next morning in the LANE: BUILDER holds a slim folder, talking with VEER beside a parked jeep | - |
| 3-09 | MED | CHHAVI watching from behind BLUE STALL, kettle in hand; BUILDER's voice off-screen | BUILDER (off-screen): "पूरी गली बिकाऊ है, बस आप साइन कीजिए।" (The whole lane is for sale, you just sign.) |
| 3-10 | CU | VEER looking down at the folder, thoughtful | VEER: "मुझे सोचने के लिए एक रात दीजिए।" (Give me one night to think.) |
| 3-11 | CU | CHHAVI, eyes wet, a clay cup slipping from her hand | CHHAVI: "तुम भी बाक़ियों जैसे निकले।" (You turned out like all the others.) |
| 3-12 | MED | CHHAVI walks away without turning; VEER reaches out toward her | VEER: "छवि, रुको! तुम ग़लत समझ रही हो!" (Chhavi, wait! You're misunderstanding!) |

### Episode 4: "Mele Ki Raat" (मेले की रात), coin-locked

Logline: At the fair, rivalry turns to worry for Lalan, and the lane's new owner is announced.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | MELA GROUND at golden hour, bunting, small swings, a crowd, lamps glowing | - |
| 4-02 | MED | CHHAVI at a contest table arranging glasses, jaw set; SHANKAR beside her | SHANKAR: "बेटी, आज हमारी इज़्ज़त का सवाल है।" (Daughter, today our honour is at stake.) |
| 4-03 | MED | Opposite table: VEER and LALAN stirring a copper pot | - |
| 4-04 | CU | VEER looking across at CHHAVI, guilty | VEER: "छवि, एक बार मेरी बात सुन लो।" (Chhavi, just listen to me once.) |
| 4-05 | CU | CHHAVI, cold, pouring tea without looking up | CHHAVI: "मुझे कुछ नहीं सुनना।" (I don't want to hear anything.) |
| 4-06 | INS | An elder judge's hands lift a steaming glass | - |
| 4-07 | WIDE | The crowd cheers as steam rises from both tables | - |
| 4-08 | MED | LALAN sways and lowers himself onto a stool, hand on forehead | LALAN: "थोड़ा चक्कर आ रहा है…" (I feel a little dizzy...) |
| 4-09 | TWO | CHHAVI rushes over and holds LALAN's arm, VEER stunned beside them | CHHAVI: "चाचा, बैठिए! कोई पानी लाओ!" (Chacha, sit down! Someone bring water!) |
| 4-10 | CU | VEER looking at CHHAVI with grateful, wet eyes | - |
| 4-11 | WIDE | On the small stage BUILDER takes the microphone; a spotlight swings toward VEER | BUILDER: "गली का नया मालिक आपके बीच खड़ा है!" (The lane's new owner is standing among you!) |
| 4-12 | CU | CHHAVI's face, shock turning to hurt | CHHAVI: "तो तुमने सचमुच हमारी गली ख़रीद ली?" (So you really bought our lane?) |

### Episode 5: "Chai Ka Teesra Pyaala" (चाय का तीसरा प्याला), coin-locked

Logline: The truth about the lane, two fathers share one cup, and an old photo opens a new secret.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | MED | MELA GROUND edge: CHHAVI walks away, VEER catches up holding a folded stamped paper | VEER: "मैंने गली बेची नहीं, बचाई है। ये काग़ज़ देखो।" (I didn't sell the lane, I saved it. Look at this paper.) |
| 5-02 | INS | VEER's hand holds out the folded paper, two blank signature lines visible | - |
| 5-03 | CU | CHHAVI reading, her eyes slowly widening | - |
| 5-04 | CU | VEER nods, shows an empty wallet with a shy shrug | - |
| 5-05 | CU | CHHAVI, a small smile through tears | CHHAVI: "तुम पूरे बुद्धू हो।" (You are a complete fool.) |
| 5-06 | WIDE | MELA GROUND stage: SHANKAR and LALAN stand far apart, LALAN recovered, both stiff | - |
| 5-07 | MED | CHHAVI and VEER hold out one clay cup toward the two fathers | CHHAVI: "बाबा, एक बार चाचा के साथ चाय पी लो।" (Baba, just have tea once with Chacha.) |
| 5-08 | TWO | SHANKAR and LALAN sip from the same cup, a silence, then both laugh | SHANKAR: "लालन… तेरी चाय में वाक़ई पानी बहुत है!" (Lalan... your tea really does have a lot of water!) |
| 5-09 | TWO | LALAN laughs, wagging a finger at SHANKAR | LALAN: "और तेरी में चीनी बहुत है!" (And yours has too much sugar!) |
| 5-10 | TWO | LANE at golden hour: CHHAVI hands VEER a glass, their fingers touch | VEER: "तुम्हारे बिना मेरी चाय फीकी है, छवि।" (Without you my tea is bland, Chhavi.) |
| 5-11 | INS | CHHAVI's recipe notebook falls open; an old photo slips out of two young men beside a single stall | - |
| 5-12 | CU | CHHAVI holding the photo, SHANKAR and LALAN frozen behind her; end card "सीज़न 1 जारी है…" | CHHAVI: "बाबा… आप दोनों पहले साथ चाय बेचते थे?" (Baba... you two used to sell tea together?) |
