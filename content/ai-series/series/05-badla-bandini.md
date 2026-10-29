# Series 05: "Badla Bandini" (बदला बंदिनी)

Revenge drama · UA13 · 5 episodes x 12 shots · slug `badla-bandini`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Badla Bandini (बदला बंदिनी), "The Prisoner's Revenge" |
| Language | Hindi (Hinglish-tinged, everyday spoken, village register) |
| Genre | Revenge drama / family secrets |
| Look | Stylised oil-painting illustration with dramatic chiaroscuro, **not photoreal** (see section 2) |
| Rating | UA13: emotional cruelty and implied danger, no gore, no strong language |
| Setting | Surajpur, a fictional village with the Thakur family's ochre haveli on a hill, in an unnamed north Indian state, present day |
| Premise | Seven years ago a fire in the Thakur family's grain warehouse killed three workers. Gauri, the young daughter-in-law who found the ledger proving the family ordered it, was framed for arson and jailed. Released, she returns under the name Kamla as the haveli's new cook, to expose the family one truth at a time. Her father-in-law, Thakur Dalip Singh, is believed to have died five years ago. |
| Hook per episode | Every episode ends on a reveal or a threat. Ep 1: Vikram notices her scar. Ep 2: the boy has seen her bangles in the cellar. Ep 3: Vikram finds her with the wedding dupatta. Ep 4: Bhavani overhears and vows not to repeat her mistake. Ep 5: the dead Thakur is alive. |

Why this look: stylised oil-painting art hides the weaknesses of current video models (face drift, uncanny faces,
Indian skin-tone realism) and suits an emotional revenge story, because deep shadow and single-source lamp light
keep faces simple, dramatic and consistent from shot to shot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
rich oil-painting illustration, dramatic chiaroscuro, visible brush texture, deep red, ochre and shadow palette, warm oil-lamp and candle light, north Indian village haveli with carved wooden doors and ochre walls, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, modern city, western setting, deity, blood, gore
```

Keep palette, brush texture and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| GAURI | `gauriC` | Indian woman, 30, thin and upright, wheat-brown skin, black hair cut at the shoulder with a streak of grey at the left temple, deep dark eyes, an old burn scar across the back of the left hand, plain faded cotton saree in dull green with the pallu over the head while working as the cook "Kamla". Silent, steely, grieving. (In EP 5 she wears a plain white cotton saree with the pallu down.) |
| BHAVANI | `bhavaniC` | Indian woman, 62, tall and heavy-set, fair skin, grey hair in a tight bun, strong jaw, thick gold bangles on both wrists, large red bindi, deep maroon silk saree with a gold border, a bunch of keys tucked at the waist. Imperious, cold, controlling. |
| VIKRAM | `vikramC` | Indian man, 34, medium build, light-brown skin, short black hair, clean-shaven, tired eyes, cream kurta with a brown shawl over one shoulder, a thin silver wristwatch on the left wrist. Gentle, weak-willed, guilty. |
| RAMLAL | `ramlalC` | Indian man, 66, thin and bent, dark skin, bald with a white fringe, round steel spectacles on a thread, white dhoti and a worn brown waistcoat, a bundle of ledgers under the arm. Nervous, loyal, carrying a secret. |
| CHHOTU | `chhotuC` | Indian boy, 12, small and wiry, brown skin, tousled black hair, big curious eyes, oversized faded blue shirt, rolled-up shorts, bare feet. Cheeky, observant, kind. |

Locations (also lock a reference image each): **ROAD** (the jail gate at dawn and the dusty village road to the
haveli), **COURTYARD** (the haveli's open courtyard with the gate, cots, lamps and an upper balcony), **KITCHEN**
(smoky kitchen with a clay stove, brass pots and a stone grinder), **DINING HALL** (a long wooden table under hanging
lamps), **CELLAR** (a dusty cellar with trunks and one shaft of moonlight), **STUDY** (Ramlal's room, shelves of
ledgers, a single lamp).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| GAURI | Woman in her thirties, low and steady, slow measured pace, emotion held back, cracks only in the quiet moments |
| BHAVANI | Older woman, deep, commanding, cold and slow, every word deliberate |
| VIKRAM | Man in his thirties, soft, hesitant, slightly breathy, pace slows when he is guilty |
| RAMLAL | Elderly man, thin and quavering, quick nervous pace, humble |
| CHHOTU | Boy around twelve, bright and curious, quick pace, whispers when sneaking |

Pick one Hindi TTS or cloning option and use it for the whole series so the voices stay stable. Always test a
Hindi line for natural stress before committing.

## 5. Episodes, shots and dialogue

Shot length is **5 s** unless noted. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line.

### Episode 1: "Naya Naam" (नया नाम), free

Logline: Released after seven years, Gauri walks into the haveli that jailed her as the new cook.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | Dawn at the jail gate on the ROAD, red-ochre sky, a lone woman steps out holding a small cloth bundle | GAURI (VO): "सात साल। आज पहली बार आसमान बिना सलाखों के दिखा।" (Seven years. Today for the first time the sky has no bars.) |
| 1-02 | INS | GAURI's scarred hand opens the bundle: a faded photograph and a small brass key | - |
| 1-03 | MED | GAURI walks along the dusty village road at dusk, pallu over her head | GAURI (VO): "नाम बदल लिया है। अब मैं कमला हूँ।" (I've changed my name. Now I am Kamla.) |
| 1-04 | WIDE | The Thakur haveli on its hill at dusk, ochre walls, lamps lit in the windows | - |
| 1-05 | MED | At the COURTYARD gate, CHHOTU opens the small door for GAURI | CHHOTU: "आप ही नई कुक हैं? बड़ी ठकुराइन बुला रही हैं।" (Are you the new cook? The Thakurain is calling you.) |
| 1-06 | CU | BHAVANI seated on a carved chair, weighing GAURI with her eyes | BHAVANI: "नाम क्या है तुम्हारा?" (What is your name?) |
| 1-07 | CU | GAURI, eyes lowered | GAURI: "कमला, ठकुराइन जी। खाना अच्छा बनाती हूँ।" (Kamla, Thakurain ji. I cook well.) |
| 1-08 | CU | BHAVANI, cold | BHAVANI: "यहाँ आँखें और कान बंद रखना। यही नौकरी है।" (Keep your eyes and ears shut here. That is the job.) |
| 1-09 | MED | In the KITCHEN, GAURI lights the clay stove, flame lighting her face | - |
| 1-10 | INS | A dusty wedding photograph on a shelf: a bride's face scratched out beside a groom | - |
| 1-11 | MED | VIKRAM stands in the kitchen doorway, tired | VIKRAM: "नई आई हो? एक चाय मिलेगी?" (New here? Can I get some tea?) |
| 1-12 | CU | VIKRAM stares at the burn scar on GAURI's hand as she holds out the steel glass | VIKRAM: "ये निशान… मैंने पहले कहीं देखा है।" (This mark… I've seen it somewhere before.) |

### Episode 2: "Pehla Sach" (पहला सच), free

Logline: A taste from the past shakes the household, and a boy begins to guess who Kamla is.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | TWO | GAURI pulls her pallu over her scarred hand, VIKRAM watching | GAURI: "पुरानी जलन है, मालिक। बचपन की।" (An old burn, sir. From childhood.) |
| 2-02 | MED | VIKRAM leaves slowly, rubbing his temples | - |
| 2-03 | WIDE | COURTYARD in morning light, servants sweeping, washing on a line | - |
| 2-04 | MED | GAURI grinds spices on a stone, CHHOTU watching her closely | CHHOTU: "आप अलग हैं। रोती भी हैं तो चुपचाप।" (You're different. Even when you cry, you do it silently.) |
| 2-05 | CU | GAURI, a faint sad smile | GAURI: "सबको आँसू नहीं दिखाते, बेटा।" (We don't show our tears to everyone, son.) |
| 2-06 | MED | RAMLAL enters the KITCHEN with a ledger bundle and stops, sniffing the air | RAMLAL: "इस दाल की ख़ुशबू… बरसों बाद सूँघी है।" (This dal's aroma… I haven't smelled it in years.) |
| 2-07 | INS | A brass bowl of dal with a sizzling tadka | - |
| 2-08 | WIDE | DINING HALL, long table under hanging lamps, BHAVANI at the head, VIKRAM beside her | - |
| 2-09 | CU | BHAVANI tastes the dal, her spoon freezes in mid-air | BHAVANI: "ये स्वाद… किसने सिखाया तुम्हें?" (This taste… who taught you this?) |
| 2-10 | CU | GAURI, calm, eyes down | GAURI: "एक पुरानी मालकिन ने, ठकुराइन जी।" (An old mistress, Thakurain ji.) |
| 2-11 | TWO | BHAVANI sets her spoon down hard, eyes narrowed at GAURI | BHAVANI: "ये स्वाद इस घर की उस बहू का था जो जेल गई।" (This was the taste of the daughter-in-law who went to jail.) |
| 2-12 | CU | CHHOTU peeks through the kitchen doorway, whispering to GAURI | CHHOTU (whisper): "तहख़ाने में आपकी जैसी चूड़ियों वाला संदूक है।" (There's a trunk in the cellar with bangles like yours.) |

### Episode 3: "Tahkhane Ka Sandook" (तहख़ाने का संदूक), free

Logline: In the cellar Gauri finds proof of the fire's cause, and Vikram finds her.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | WIDE | Night in the haveli corridor, GAURI and CHHOTU tiptoe by lantern light | - |
| 3-02 | MED | CHHOTU lifts the latch of a low wooden door | CHHOTU: "धीरे चलिए, सीढ़ियाँ टूटी हुई हैं।" (Go slowly, the steps are broken.) |
| 3-03 | WIDE | The CELLAR: dusty trunks, a single shaft of moonlight | - |
| 3-04 | INS | GAURI lifts a trunk lid: a red bridal dupatta on top, a small tin box beneath | - |
| 3-05 | CU | GAURI presses the red dupatta to her cheek | GAURI (whisper): "मेरी शादी का दुपट्टा… इन्होंने रखा हुआ था?" (My wedding dupatta… they had kept it?) |
| 3-06 | INS | In the tin box: a scorched ledger page with columns of figures and a torn corner | - |
| 3-07 | CU | GAURI reading, her eyes hardening | GAURI (whisper): "आग से तीन दिन पहले मिट्टी का तेल मँगवाया गया था।" (Kerosene was ordered three days before the fire.) |
| 3-08 | MED | Footsteps above; a lantern glow grows on the stairs | - |
| 3-09 | MED | GAURI tucks the page into her pallu; the red dupatta slips from the trunk onto the floor | - |
| 3-10 | TWO | VIKRAM descends, lantern lighting his face, meeting GAURI's gaze | VIKRAM: "तुम यहाँ क्या कर रही हो, कमला?" (What are you doing here, Kamla?) |
| 3-11 | CU | GAURI, steady | GAURI: "जी, आटे की बोरी ढूँढ रही थी, मालिक।" (Sir, I was looking for a sack of flour.) |
| 3-12 | CU | VIKRAM lifts the lantern over the red dupatta on the floor, pale | VIKRAM: "ये दुपट्टा मेरी गौरी का है… तुम कौन हो?" (This dupatta is my Gauri's… who are you?) |

### Episode 4: "Ramlal Ki Gawahi" (रामलाल की गवाही), coin-locked

Logline: Vikram learns the truth, Bhavani prepares to destroy the evidence, and old Ramlal chooses to testify.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | TWO | In the CELLAR, VIKRAM and GAURI face to face, lantern between them | VIKRAM: "सच बताओ। तुम्हीं गौरी हो ना?" (Tell me the truth. You are Gauri, aren't you?) |
| 4-02 | CU | GAURI lets her pallu fall back, tears in her eyes | GAURI: "हाँ। सात साल बाद भी तुमने मुझे नहीं पहचाना।" (Yes. Even after seven years you didn't recognise me.) |
| 4-03 | MED | VIKRAM sinks to his knees, face in his hands | - |
| 4-04 | CU | GAURI, quiet and hard | GAURI: "चुप रहना भी गुनाह है, विक्रम।" (Staying silent is also a crime, Vikram.) |
| 4-05 | WIDE | At the top of the cellar stairs, BHAVANI's dark shadow with a lantern, listening | - |
| 4-06 | MED | STUDY, morning: BHAVANI stands over RAMLAL at his desk | BHAVANI: "रामलाल, पुरानी बही कल तक जला देना।" (Ramlal, burn the old ledgers by tomorrow.) |
| 4-07 | CU | RAMLAL bows his head, his hand trembling on the ledger | - |
| 4-08 | WIDE | Night: RAMLAL carries a cloth bundle across the COURTYARD toward the kitchen back door, glancing around | - |
| 4-09 | MED | At the KITCHEN back door, RAMLAL hands the bundle to GAURI | RAMLAL: "बहूरानी, मैंने सात साल ये बोझ उठाया है।" (Bahurani, I have carried this burden for seven years.) |
| 4-10 | CU | GAURI takes his trembling hand | GAURI: "तो अब गवाही दीजिए, चाचा।" (Then testify now, Chacha.) |
| 4-11 | INS | An open ledger page with a red seal stamp and a bold signature flourish | - |
| 4-12 | WIDE | On the upper balcony BHAVANI looks down at the two silhouettes, lantern in hand | BHAVANI: "सात साल पहले मुझसे एक भूल हुई थी। इस बार नहीं होगी।" (I made one mistake seven years ago. Not this time.) |

### Episode 5: "Haveli Ki Adalat" (हवेली की अदालत), coin-locked

Logline: At the family gathering Gauri unmasks herself, the ledger speaks, and a bigger secret rises from the upper floor.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | WIDE | COURTYARD at evening gathering, lamps lit, guests seated in rows, BHAVANI on a chair at the front | - |
| 5-02 | MED | GAURI enters in a plain white saree, pallu down, walking through the guests | - |
| 5-03 | CU | BHAVANI rises sharply | BHAVANI: "ये कौन है? इसे बाहर निकालो!" (Who is this? Throw her out!) |
| 5-04 | CU | GAURI, head high | GAURI: "मैं गौरी हूँ, इस घर की बहू। सात साल जेल में रही।" (I am Gauri, this house's daughter-in-law. Seven years in jail.) |
| 5-05 | MED | RAMLAL steps forward holding the ledger bundle, trembling | RAMLAL: "ये बही गवाह है। आग इसी घर ने लगवाई थी।" (This ledger is the witness. This house had the fire set.) |
| 5-06 | INS | The ledger open to a page, one entry circled in red ink | - |
| 5-07 | CU | BHAVANI, icy | BHAVANI: "झूठ! ये बूढ़े नौकर की बकवास है।" (Lies! This is an old servant's nonsense.) |
| 5-08 | MED | VIKRAM steps beside GAURI, taking her side | VIKRAM: "माँ, बस। अब मैं और चुप नहीं रहूँगा।" (Mother, enough. I will not stay silent any more.) |
| 5-09 | CU | BHAVANI, shaken | BHAVANI: "तुम… अपनी माँ के ख़िलाफ़?" (You… against your own mother?) |
| 5-10 | WIDE | BHAVANI steps back, the guests part and fall silent | - |
| 5-11 | CU | BHAVANI, a bitter smile | BHAVANI: "आग का हुक्म मैंने नहीं, तुम्हारे ससुर ने दिया था।" (The order for the fire wasn't mine. Your father-in-law gave it.) |
| 5-12 | WIDE | The upper-floor window lights up: an old man's silhouette in a chair raises a hand; end card "सीज़न 1 जारी है…" | GAURI (VO): "पर मेरे ससुर तो पाँच साल पहले चल बसे थे…" (But my father-in-law passed away five years ago…) |
