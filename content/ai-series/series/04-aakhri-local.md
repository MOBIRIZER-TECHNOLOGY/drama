# Series 04: "Aakhri Local" (आख़िरी लोकल)

Mumbai night thriller · UA13 · 5 episodes x 12 shots · slug `aakhri-local`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Aakhri Local (आख़िरी लोकल), "The Last Local" |
| Language | Hindi (Hinglish-tinged, everyday Mumbai spoken) |
| Genre | Night thriller / survival drama |
| Look | Stylised ink-and-neon graphic-novel illustration, **not photoreal** (see section 2) |
| Rating | UA13: tension and threat, violence only implied, no gore, no strong language |
| Setting | The fictional Sagar Line, a suburban rail line of a Mumbai-like city, one night from midnight to dawn. Fictional stations: Madhavnagar, Neelwadi, Kharghat |
| Premise | Anjali, a young nurse, boards the last local after her shift and sees fixer Kisan Mhatre's men push a man off the train. She is left holding his leather pouch. Dinkar Kaka, a retired ticket collector, and Sunny, a street-smart delivery boy, help her stay alive until dawn while Kisan's men search every compartment. |
| Hook per episode | Every episode ends on a threat or a reveal. Ep 1: the phone rings in a silent coach. Ep 2: the luggage-room lock turns. Ep 3: a torch beam finds them. Ep 4: Dinkar is taken. Ep 5: Kisan reveals he let them lead him to the survivor. |

Why this look: stylised ink-and-neon art hides the weaknesses of current video models (face drift, uncanny faces,
Indian skin-tone realism, wet-surface physics) and suits a night thriller, since heavy shadow and coloured light
keep faces simple and consistent. Fictional stations and line avoid any real railway.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
moody graphic-novel illustration, bold ink outlines, flat cel shading with light film grain, deep teal and sodium-orange palette, neon glow on rain-slick surfaces, night-time suburban railway in an Indian metro, strong shadows, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, real brand, western setting, blood, gore, weapon close-up
```

Keep palette, grain and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| ANJALI | `anjaliC` | Indian woman, 24, slim, medium-brown skin, black hair in a low ponytail, small gold stud in the nose, tired kind eyes, teal hospital scrubs under a grey knitted cardigan, white canvas shoes, black sling bag, hospital ID lanyard around the neck. Brave, tired, quick-thinking. |
| DINKAR | `dinkarC` | Indian man, 68, thin and slightly stooped, deep-brown skin, short white stubble, thick black-framed glasses, faded khaki jacket with a missing top button, old black cap, a steel thermos in hand and a heavy brass key ring on his belt. Gentle, patient, hides a secret. |
| SUNNY | `sunnyC` | Indian young man, 19, lean, wiry, light-brown skin, messy short black hair, thin line of moustache, orange delivery jacket with reflective stripe, black cap worn backwards, big orange insulated delivery bag on his back, scuffed sneakers. Cheeky, fast, loyal. |
| KISAN | `kisanC` | Indian man, 50, heavy build, wide shoulders, slicked-back grey-black hair, thick moustache, long black raincoat over a maroon shirt, gold ring on the right hand and a gold chain at the neck. Smooth, patient, dangerous. |
| BABLU | `babluC` | Indian man, 30, tall and muscular, shaved head, a long scar on the left cheek, dark green jacket, black trousers, carries a torch. Gruff, relentless, Kisan's right hand. |

Locations (also lock a reference image each): **PLATFORM** (Madhavnagar platform at midnight, sodium lamps,
rain-slick floor), **COACH** (the ladies' compartment and the cramped luggage nook at the end of the train),
**TRACKS** (Neelwadi station and the dark track yard beyond it, rusted goods wagons), **SIGNAL CABIN** (a lone
iron cabin on stilts with a lever frame and a cut phone line), **STREET** (narrow wet lanes at dawn, laundry lines),
**HOSPITAL** (a quiet ICU corridor with a glass window, cool teal light).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| ANJALI | Young woman, mid-pitch, tired but clear, speaks fast when scared and drops to a whisper when hiding |
| DINKAR | Elderly man, warm, slow and gravelly, calm pace, a fatherly tone |
| SUNNY | Young male, bright and quick, street Hinglish, jokes when nervous |
| KISAN | Low smooth male, unhurried, polite and quietly menacing |
| BABLU | Rough mid-low male, curt, clipped, shouts in short bursts |

Pick one Hindi TTS or cloning option and use it for the whole series so the voices stay stable. Always test a
Hindi line for natural stress before committing.

## 5. Episodes, shots and dialogue

Shot length is **5 s** unless noted. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line.

### Episode 1: "Aakhri Gaadi" (आख़िरी गाड़ी), free

Logline: Anjali boards the last local after her night shift and sees something she should never have seen.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | PLATFORM at midnight, rain-slick, sodium lamps, the last local waiting almost empty | ANJALI (VO): "रात की आख़िरी लोकल। यही मुझे घर पहुँचाती है।" (The last local of the night. Only this one takes me home.) |
| 1-02 | MED | ANJALI steps into the ladies' COACH, yawning, sling bag on her shoulder | - |
| 1-03 | INS | Her phone in her hand, glowing, a thin red sliver of battery | - |
| 1-04 | MED | DINKAR sits on the bench opposite with his thermos | DINKAR: "इतनी रात गए अकेली, बिटिया?" (Out alone so late, child?) |
| 1-05 | CU | ANJALI, tired smile | ANJALI: "नाइट ड्यूटी थी, काका। अब आदत हो गई है।" (Night duty, Kaka. I'm used to it now.) |
| 1-06 | WIDE | The train rushes through a dark stretch, orange windows against an ink-black sky | - |
| 1-07 | OTS | Over ANJALI's shoulder, through the window glass: KISAN grips a man in a grey coat by the collar | KISAN (muffled): "मना किया था ना, फ़ाइल मत खोलना।" (I told you not to open that file.) |
| 1-08 | WIDE | The connecting door swings open in the wind; two dark silhouettes by the open door, then one | - |
| 1-09 | INS | A brown leather pouch slides across the floor, ANJALI's hand picks it up | - |
| 1-10 | CU | ANJALI frozen, pouch to her chest, whispering | ANJALI: "वो आदमी कहाँ गया?" (Where did that man go?) |
| 1-11 | MED | BABLU appears in the far doorway of the coach, scanning with a torch | BABLU: "सारे डिब्बे देखो। एक लड़की ने सब देख लिया है।" (Check every compartment. A girl has seen everything.) |
| 1-12 | CU | ANJALI's wide eyes in the dark; her phone lights up and rings loudly in her bag | ANJALI (whisper): "नहीं… अभी नहीं!" (No… not now!) |

### Episode 2: "Kaka Ki Chaabi" (काका की चाबी), free

Logline: Dinkar hides Anjali using old railway tricks, and a delivery boy leaps aboard at Neelwadi.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | TWO | DINKAR pulls ANJALI down behind the seats, her phone muted in her fist | DINKAR: "चुप रहो और मेरे पीछे आओ।" (Quiet. Follow me.) |
| 2-02 | TWO | DINKAR unlocks a small steel door at the end of the COACH with a big brass key | DINKAR: "तीस साल टीसी रहा हूँ। हर ताला जानता हूँ।" (Thirty years a ticket collector. I know every lock.) |
| 2-03 | INS | The key turning in an old padlock | - |
| 2-04 | MED | The cramped luggage nook with parcel sacks; ANJALI crouches among them | ANJALI: "काका, आप मेरी मदद क्यों कर रहे हैं?" (Kaka, why are you helping me?) |
| 2-05 | CU | DINKAR, a sad, steady look | DINKAR: "कुछ सवाल सुबह के लिए रखो, बिटिया।" (Keep some questions for the morning, child.) |
| 2-06 | WIDE | The train slows into empty Neelwadi platform, neon glow; two small figures walk along the train | - |
| 2-07 | MED | SUNNY sprints along the platform and leaps through the open luggage door | - |
| 2-08 | TWO | SUNNY lands on the sacks, staring at ANJALI and DINKAR | SUNNY: "अरे! आप लोग यहाँ क्या कर रहे हैं?" (Hey! What are you two doing here?) |
| 2-09 | CU | ANJALI, pleading | ANJALI: "प्लीज़, किसी को मत बताना। वो लोग मुझे ढूँढ रहे हैं।" (Please tell no one. Those men are looking for me.) |
| 2-10 | MED | SUNNY peeks through a slat, then turns back, tense grin | SUNNY: "मैं इन्हें जानता हूँ। मुझे यहाँ के रास्ते पता हैं।" (I know them. I know the routes here.) |
| 2-11 | INS | Heavy boots and a long shadow stop under the door slit | - |
| 2-12 | CU | DINKAR, finger on lips; behind him the door handle slowly turns | BABLU (muffled, outside): "यहाँ किसी ने ताला खोला है।" (Someone has opened this lock.) |

### Episode 3: "Bhaagti Patri" (भागती पटरी), free

Logline: Cornered at Neelwadi, the three escape onto the tracks as Kisan himself steps off the train.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | MED | SUNNY heaves open the far-side door and shoves a parcel sack out to make noise | SUNNY: "काका, पीछे का दरवाज़ा! जल्दी!" (Kaka, the back door! Quick!) |
| 3-02 | WIDE | Three small figures climb down onto the dark TRACKS, mist and orange lamps | - |
| 3-03 | MED | ANJALI, behind a rusted goods wagon, opens the leather pouch with trembling hands | - |
| 3-04 | INS | Inside the pouch: a black pen drive and a creased passport photo of a man in a grey coat | - |
| 3-05 | CU | ANJALI, whispering | ANJALI: "ये उसी आदमी का है, जो गिर गया।" (This belongs to the man who fell.) |
| 3-06 | CU | DINKAR looks at the photo and goes very still | DINKAR: "इसे सँभालकर रखना, बिटिया। यही सबूत है।" (Keep this safe, child. This is the proof.) |
| 3-07 | WIDE | KISAN steps down from the train onto the platform, long black raincoat, lamps behind him | - |
| 3-08 | MED | KISAN adjusts his gold ring, looks down the tracks | KISAN: "लड़की पटरी पर ही होगी। रोशनी लाओ।" (The girl must be on the tracks. Bring lights.) |
| 3-09 | TWO | SUNNY and ANJALI crouched behind the wagon | SUNNY: "दीदी, आगे सिग्नल केबिन है। वहाँ से निकल सकते हैं।" (Didi, there's a signal cabin ahead. We can get out from there.) |
| 3-10 | TWO | DINKAR, hand on his chest, breathing hard, beside ANJALI | DINKAR: "तुम दोनों जाओ। मैं इन्हें रोक लूँगा।" (You two go. I'll hold them back.) |
| 3-11 | CU | ANJALI, firm | ANJALI: "नहीं काका, हम आपको छोड़कर नहीं जाएँगे!" (No Kaka, we won't leave you!) |
| 3-12 | WIDE | Torch beams sweep the yard and catch three tiny silhouettes | BABLU (off-screen): "वो रहे! पकड़ो!" (There they are! Catch them!) |

### Episode 4: "Signal Cabin" (सिग्नल केबिन), coin-locked

Logline: In the signal cabin they try to stop the train and call for help, but the line is cut and Dinkar is taken.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | A lone SIGNAL CABIN on stilts in the rain, green and red lamps glowing | - |
| 4-02 | MED | SUNNY pulls ANJALI up the iron stairs, DINKAR climbing behind | SUNNY: "ऊपर चलो, नीचे से कोई नहीं देख पाएगा।" (Go up, nobody can see us from below.) |
| 4-03 | INS | An old black desk phone, the receiver dangling on a cut wire | - |
| 4-04 | CU | ANJALI, frightened | ANJALI: "लाइन कटी हुई है! हम फँस गए।" (The line is cut! We're trapped.) |
| 4-05 | MED | DINKAR, hand on a big red lever of the lever frame | DINKAR: "फँसे नहीं हैं। ये लीवर मुझे अच्छे से याद है।" (We're not trapped. I remember this lever well.) |
| 4-06 | INS | The lever pulled down; far away a signal lamp turns red | - |
| 4-07 | WIDE | The last local brakes to a halt on the dark tracks, sparks flying from the wheels | - |
| 4-08 | CU | KISAN at the train door, furious, looking up toward the cabin | KISAN: "सिग्नल किसने लाल किया? ऊपर देखो!" (Who turned the signal red? Look up there!) |
| 4-09 | TWO | SUNNY holds up his phone beside ANJALI | SUNNY: "दीदी, मेरे फ़ोन में नेटवर्क आ गया! पुलिस को बुलाऊँ?" (Didi, my phone has network! Should I call the police?) |
| 4-10 | CU | DINKAR shakes his head slowly | DINKAR: "पुलिस में भी उसके आदमी हैं। पहले सही आदमी ढूँढो।" (He has men in the police too. First find the right person.) |
| 4-11 | MED | BABLU's hand grips DINKAR's shoulder from behind in the doorway | BABLU: "काका, बहुत खेल लिया आपने।" (Kaka, you've played enough.) |
| 4-12 | CU | ANJALI and SUNNY on the ground below, looking up at the lit window where DINKAR's silhouette is pulled away | DINKAR (shouting from above): "भागो! सुबह तक ज़िंदा रहना!" (Run! Stay alive till morning!) |

### Episode 5: "Subah Ka Sach" (सुबह का सच), coin-locked

Logline: As dawn breaks, Anjali and Sunny reach her hospital and learn why Kaka was really on that train.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | WIDE | Dawn over Kharghat, grey-orange sky, empty STREET, a scooter with two riders | - |
| 5-02 | MED | ANJALI on the scooter pillion, pouch pressed to her chest | ANJALI: "सनी, मेरा अस्पताल पास में है। वहाँ गार्ड हैं।" (Sunny, my hospital is close. There are guards there.) |
| 5-03 | CU | SUNNY at the handlebars, helmetless, grim grin | SUNNY: "ठीक है दीदी, कसकर पकड़ लेना!" (All right, didi, hold on tight!) |
| 5-04 | WIDE | A dark jeep turns into the lane behind the scooter, headlights glaring | - |
| 5-05 | MED | The scooter weaves through a narrow lane of laundry lines | SUNNY: "इन गलियों में मुझसे कोई नहीं जीत सकता!" (Nobody can beat me in these lanes!) |
| 5-06 | WIDE | HOSPITAL gate in soft morning light; the two run inside | - |
| 5-07 | MED | ANJALI in the ICU corridor stops at a glass window, stunned | - |
| 5-08 | CU | Through the glass: the man in the grey coat alive in a hospital bed, clean bandage on his head, monitors glowing | ANJALI: "ये ज़िंदा है! इसे यहीं लाया गया था!" (He's alive! He was brought here!) |
| 5-09 | TWO | DINKAR, bruised and capless, walks slowly down the corridor toward ANJALI | DINKAR: "ये मेरा बेटा है। मैं उसे बचाने गाड़ी में बैठा था।" (This is my son. I boarded the train to save him.) |
| 5-10 | CU | ANJALI, tears in her eyes | ANJALI: "काका, आपने मुझे पहले क्यों नहीं बताया?" (Kaka, why didn't you tell me earlier?) |
| 5-11 | WIDE | In the ICU glass, KISAN's reflection appears behind ANJALI and DINKAR, smiling | - |
| 5-12 | CU | KISAN, calm; end card "सीज़न 1 जारी है…" | KISAN: "तुम्हें यहाँ मैंने ही पहुँचाया है, काका। शुक्रिया।" (I'm the one who got you here, Kaka. Thank you.) |
