# Series 08: "Hostel Number 13" (हॉस्टल नंबर 13)

Campus horror-comedy · UA13 · 5 episodes x 12 shots · slug `hostel-number-13`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Hostel Number 13 (हॉस्टल नंबर 13), "Hostel Number 13" |
| Language | Hindi (Hinglish-tinged, everyday campus speech) |
| Genre | Campus horror-comedy with heart |
| Look | Chunky colourful 3D claymation / stop-motion style, **not photoreal** (see section 2) |
| Rating | UA13: playful scares only, no gore, no strong language |
| Setting | A fictional engineering college campus and its old boys' hostel, present day. Room 13 is the one room every senior avoids. |
| Premise | Four first-year engineering students are given Room 13. The ghost of a long-dead warden, who never let anyone sleep, turns out to be lonely. All he wants is a cricket team to play one last match, played in the mess hall and on the ground at midnight. |
| Hook per episode | Ep 1: a whistle at midnight and a ghost at the bed. Ep 2: the ghost's sad reason. Ep 3: his old team appears. Ep 4: the ghost is fading. Ep 5: a new glowing door appears (season 2). |

Why this look: clay figures are forgiving for current video models (simple shapes, thick outlines, little
face drift, no skin-realism problems) and the soft, handmade feel keeps ghosts funny and cuddly instead of
frightening, which suits a UA13 horror-comedy. It is a deliberate choice for the pilot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
chunky 3D claymation stop-motion style, handmade plasticine characters with visible thumbprint textures, teal and warm yellow colour palette, soft miniature-set lighting, shallow depth of field, playful spooky night mood, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, gore, blood, realistic horror, western setting
```

Keep palette, clay texture and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| ROHAN | `rohanC` | Clay figure of an Indian boy, 18, tall and lanky, medium-brown skin, messy black hair, round black glasses, orange hoodie with a small paper-boat patch on the chest, blue jeans, white sneakers, green backpack. Nervous, kind, the planner of the group. |
| GURI | `guriC` | Clay figure of an Indian boy, 18, broad and stocky, wheat skin, bright mustard-yellow patka (head cloth), light black beard fuzz, red-and-white striped T-shirt, brown cargo shorts, a steel kada on the right wrist. Loud, brave, always hungry. |
| VENKAT | `venkatC` | Clay figure of an Indian boy, 18, short and round, dark-brown skin, curly black hair, thick eyebrows, green checked shirt, khaki trousers, big grey headphones around the neck, a calculator pouch on the belt. Easily scared, a maths genius, always sleepy. |
| IMRAN | `imranC` | Clay figure of an Indian boy, 18, tall and athletic, light-brown skin, short black hair, small scar on the left chin, navy tracksuit jacket with yellow stripes, a cricket-ball keyring on his bag. Calm, sporty, the peacemaker. |
| TIWARI | `tiwariC` | Ghost of a warden in his 60s, tall and thin, translucent teal glowing clay, grey handlebar moustache, round gold glasses, khaki safari suit with brass buttons, a brass whistle on a cord around his neck, an old wristwatch stopped at 12. Gruff and bossy on the outside, lonely and soft inside. |

Extras (same clay style, WIDE or background only): senior students in red cricket jerseys, with one SENIOR
captain (tall, thick eyebrows, red jersey, towel on shoulder) who speaks a few lines; the ten ghost
teammates in old-fashioned cricket whites (glowing teal, faces kept soft and simple).

Locations (also lock a reference image each, one locked reference image per location): **HOSTEL** (the
old three-storey hostel at dusk with crows and one lit teal window), **CORRIDOR** (long dim corridor with
shut doors and a yellow glow under the last door), **ROOM13** (small room, four iron beds, wall clock, wooden
wardrobe), **OFFICE** (dusty warden's office with framed photos and a drawer of old registers), **MESS**
(big mess hall with long steel tables and a serving counter), **GROUND** (cricket ground beside the hostel,
night, teal lanterns).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Voices must come from consented actors or
licensed TTS voices, never a real person or celebrity. Record who gave consent and where the consent form
is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| ROHAN | Young male, 18, gentle and slightly nervous, medium pace, clear everyday Hindi |
| GURI | Young male, 18, loud and cheerful, fast and bouncy, natural Hinglish rhythm |
| VENKAT | Young male, 18, soft and squeaky when scared, slightly drowsy, medium-fast pace |
| IMRAN | Young male, 18, relaxed and warm, low-medium pitch, steady slow pace |
| TIWARI | Older male, 60s, gruff barking tone that softens, slow pace, light echo as a ghost |
| SENIOR (extra) | Young male, 20, cocky and teasing, medium pace |

Pick one Hindi TTS or voice-actor setup and use it for the whole series so the voices stay stable. Always
test a Hindi line for natural stress before committing: wrong stress is the most common failure.

## 5. Episodes, shots and dialogue

Shot length is **5 s**. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line.

### Episode 1: "Kamra Number Terah" (कमरा नंबर तेरह), free

Logline: Four freshers get the room every senior avoids, and the first night is not quiet.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | Dusk over HOSTEL, crows circling, one teal window lit on the top floor | ROHAN (VO): "हमारे कॉलेज में एक कमरा है, जहाँ कोई रहना नहीं चाहता।" (Our college has one room where nobody wants to live.) |
| 1-02 | MED | ROHAN and GURI drag suitcases through the hostel gate | GURI: "वाह! कितनी बड़ी बिल्डिंग है, भूख लग गई!" (Wow, what a big building, I'm hungry!) |
| 1-03 | TWO | IMRAN and VENKAT, IMRAN holding up a brass key | IMRAN: "हमें कमरा नंबर तेरह मिला है।" (We've got room number thirteen.) |
| 1-04 | MED | A SENIOR on the stairs freezes, a bucket slips from his hand | SENIOR: "तेरह? अरे भाई, अपना ख़याल रखना।" (Thirteen? Brother, take care of yourselves.) |
| 1-05 | CU | VENKAT gulps, eyes wide | VENKAT: "सब लोग हमें ऐसे क्यों देख रहे हैं?" (Why is everyone looking at us like this?) |
| 1-06 | WIDE | CORRIDOR, long and dim, shut doors, a faint yellow glow under the last door | - |
| 1-07 | MED | ROOM13: the door creaks open, four dusty beds, GURI sneezes a puff of dust | - |
| 1-08 | TWO | ROHAN and IMRAN placing their bags on two beds | ROHAN: "ठीक है, बस पढ़ाई करनी है, डरना नहीं है।" (Fine, we just have to study, no need to be scared.) |
| 1-09 | WIDE | ROOM13 at night, all four asleep, teal moonlight, the ceiling fan turning slowly | - |
| 1-10 | INS | The wall clock hands click to 12; a tiny puff of dust drifts off the glass | - |
| 1-11 | CU | GURI sits up in bed, patka crooked, eyes wide | GURI: "ओए! कौन सीटी बजा रहा है?" (Hey! Who is blowing a whistle?) |
| 1-12 | WIDE | TIWARI floats at the foot of the beds, torch under his chin, glowing teal, whistle in mouth | TIWARI: "सोने का समय नहीं है! उठो, सब उठो!" (It's no time for sleeping! Get up, all of you!) |

### Episode 2: "Seeti Ki Raat" (सीटी की रात), free

Logline: After a sleepless night the friends hunt the whistle and meet the warden face to face.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | MED | MESS, morning, VENKAT with dark circles, face drooping over his plate | VENKAT: "रात भर सीटी बजती रही, मैं एक मिनट नहीं सोया।" (The whistle kept blowing all night, I didn't sleep a minute.) |
| 2-02 | CU | GURI, mouth full of paratha | GURI: "मैंने भूत देखा! उसकी मूँछें बहुत बड़ी थीं!" (I saw the ghost! He had a huge moustache!) |
| 2-03 | CU | IMRAN, calm, thinking | IMRAN: "चलो पता करते हैं कि वो कौन है।" (Let's find out who he is.) |
| 2-04 | MED | OFFICE: ROHAN opens a creaking drawer, cobwebs and dust fly | - |
| 2-05 | INS | A framed photo: a stern man in a khaki safari suit with a whistle, same face as the ghost | - |
| 2-06 | CU | ROHAN studying the photo | ROHAN: "ये वार्डन तिवारी जी हैं। बहुत साल पहले यहीं रहते थे।" (This is Warden Tiwari. He lived here many years ago.) |
| 2-07 | TWO | VENKAT and GURI, a door slams shut behind them | VENKAT: "भाई, दरवाज़ा अपने आप बंद हो गया!" (Brother, the door closed by itself!) |
| 2-08 | WIDE | CORRIDOR: all four run, TIWARI floats after them blowing his whistle | - |
| 2-09 | MED | The four squeeze behind a pillar, GURI wedged in the middle | - |
| 2-10 | CU | TIWARI's face pops out of the pillar right beside ROHAN | TIWARI: "भागते कहाँ हो? मेरे हॉस्टल में कोई नहीं सोता!" (Where are you running? Nobody sleeps in my hostel!) |
| 2-11 | CU | ROHAN, trembling but brave | ROHAN: "सर, हम सो जाएँ तो क्या होगा?" (Sir, what happens if we sleep?) |
| 2-12 | CU | TIWARI, whistle drooping, teal eyes sad | TIWARI: "फिर मैं… फिर से अकेला रह जाऊँगा।" (Then I... will be left alone again.) |

### Episode 3: "Akela Warden" (अकेला वार्डन), free

Logline: The ghost's secret is simple: he wants friends, and one last cricket match.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | MED | ROOM13, night: the four friends sit on beds facing TIWARI on a chair | TIWARI: "मैं बीस साल यहाँ वार्डन था। फिर सब चले गए।" (I was warden here for twenty years. Then everyone left.) |
| 3-02 | CU | GURI wipes his eyes with his sleeve | - |
| 3-03 | CU | TIWARI, a teal clay teardrop on his cheek | TIWARI: "जो सो जाता है, वो मुझे भूल जाता है।" (Whoever sleeps forgets me.) |
| 3-04 | INS | An old photo: eleven boys in cricket whites holding a trophy, young TIWARI proud beside them | - |
| 3-05 | CU | IMRAN, pointing at the photo | IMRAN: "सर, आप तो क्रिकेट टीम के कोच थे!" (Sir, you were the cricket team's coach!) |
| 3-06 | MED | TIWARI lifts an old wooden bat from the wardrobe, it glows warm yellow | - |
| 3-07 | CU | VENKAT, counting on his fingers | VENKAT: "ग्यारह खिलाड़ी चाहिए, हम सिर्फ़ चार हैं।" (We need eleven players, we are only four.) |
| 3-08 | TWO | ROHAN and TIWARI face to face | ROHAN: "सर, हम आपकी टीम बनाएँगे।" (Sir, we will build your team.) |
| 3-09 | CU | TIWARI, stunned, then twirling his moustache with a huge smile | - |
| 3-10 | WIDE | MESS in daylight, tables pushed aside, GURI bowling, IMRAN batting, VENKAT hiding behind a pillar | - |
| 3-11 | MED | A tennis ball flies straight through TIWARI's chest; he looks down at the hole in surprise | TIWARI: "अरे! गेंद मेरे आर-पार चली गई!" (Oh! The ball went right through me!) |
| 3-12 | WIDE | MESS doorway at night: ten glowing teal ghost boys in old cricket whites stand together; TIWARI turns round | TIWARI: "ये… ये तो मेरी पुरानी टीम है!" (This... this is my old team!) |

### Episode 4: "Gyarah Ka Khel" (ग्यारह का खेल), coin-locked

Logline: The seniors throw down a challenge, the ghost team cannot hold a bat, and the warden is fading.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | GROUND, morning: the seniors' team in red jerseys lined up, SENIOR captain in front | - |
| 4-02 | MED | SENIOR captain smirks at ROHAN | SENIOR: "फ्रेशर्स, शनिवार आधी रात मैच। हारे तो महीने भर हमारे कपड़े धोना!" (Freshers, match on Saturday midnight. If you lose, wash our clothes for a month!) |
| 4-03 | CU | GURI, chest out | GURI: "मंज़ूर है! हम ग्यारह खिलाड़ी लाएँगे!" (Accepted! We'll bring eleven players!) |
| 4-04 | TWO | VENKAT leans his forehead on GURI's shoulder | VENKAT: "हम चार हैं, बाक़ी सब भूत हैं!" (We are four, the rest are ghosts!) |
| 4-05 | WIDE | MESS at night: ghost team in whites tries to catch a ball, it passes through them and they tumble in a pile | - |
| 4-06 | MED | IMRAN hands a bat to a ghost player, the bat drops through his glowing hands | IMRAN: "सर, इन्हें बल्ला पकड़ना सिखाना पड़ेगा।" (Sir, we'll have to teach them to hold a bat.) |
| 4-07 | CU | TIWARI, thinking, twirling his moustache | TIWARI: "भूत तभी ठोस होते हैं जब कोई दिल से चाहे।" (Ghosts become solid only when someone wants them from the heart.) |
| 4-08 | TWO | GURI hugs a ghost player, the teal glow turns warm yellow and the ghost grips a bat | GURI: "आओ भाई, मैं तुम्हारा दोस्त हूँ!" (Come brother, I'm your friend!) |
| 4-09 | WIDE | MESS: the four hug the ghost team one by one, a yellow glow ripples across the hall | - |
| 4-10 | MED | Dawn light through the MESS window, TIWARI looks at his hand, now nearly see-through | - |
| 4-11 | CU | ROHAN notices, worried | ROHAN: "सर… आपका हाथ?" (Sir... your hand?) |
| 4-12 | CU | TIWARI, soft smile, glow dimming | TIWARI: "मैच के बाद मेरा काम पूरा हो जाएगा, बच्चो।" (After the match my work will be done, children.) |

### Episode 5: "Aakhri Over" (आख़िरी ओवर), coin-locked

Logline: The midnight match, a goodbye, and a new door in the corridor wall.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | WIDE | GROUND at midnight, teal lanterns, the ghost team in whites on one side, the seniors across with jaws dropped | - |
| 5-02 | CU | SENIOR captain, shaking, bat trembling | SENIOR: "ये… ये तो असली भूत हैं!" (These... these are real ghosts!) |
| 5-03 | CU | IMRAN, calm and smiling | IMRAN: "डरो मत, ये बस खेलने आए हैं।" (Don't be scared, they have only come to play.) |
| 5-04 | WIDE | Match in action, a ball flying over the hostel roof, ghosts cheering | - |
| 5-05 | MED | VENKAT bowls a wobbly ball with his eyes shut | VENKAT: "मैंने आँखें बंद की हैं, बस गेंद फेंक रहा हूँ!" (I have my eyes shut, I'm just throwing the ball!) |
| 5-06 | MED | TIWARI walks to the crease, bat on shoulder, whistle in mouth | TIWARI: "आख़िरी गेंद, छह रन चाहिए।" (Last ball, six runs needed.) |
| 5-07 | INS | The ball leaves the bowler's hand, spinning | - |
| 5-08 | CU | TIWARI swings with eyes closed | - |
| 5-09 | WIDE | The ball sails high over the hostel under a big yellow moon, everyone looks up | GURI: "छक्का! हम जीत गए!" (Six! We won!) |
| 5-10 | TWO | TIWARI with the four friends, glowing softly, edges fading into sparkles | TIWARI: "आज मैं चैन से सोऊँगा। तुम भी सो जाना।" (Tonight I will sleep in peace. You sleep too.) |
| 5-11 | WIDE | ROOM13 at dawn, the four asleep, the brass whistle resting on ROHAN's pillow, sunlight | - |
| 5-12 | WIDE | CORRIDOR at night: GURI with a torch, a new door in the wall glows yellow and knocks from inside; end card "सीज़न 1 जारी है…" | GURI: "ये दरवाज़ा पहले यहाँ नहीं था!" (This door wasn't here before!) |
