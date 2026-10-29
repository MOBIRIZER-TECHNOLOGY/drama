# Series 06: "Vetaal Ki Paheli" (वेताल की पहेली)

Folk fantasy anthology-style serial · UA · 5 episodes x 12 shots · slug `vetaal-ki-paheli`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Vetaal Ki Paheli (वेताल की पहेली), "The Spirit's Riddle" |
| Language | Hindi (simple, everyday spoken, light Hinglish) |
| Genre | Folk fantasy, anthology-style serial: one riddle story per episode inside a continuing frame story |
| Look | Stylised shadow-puppet and Madhubani-inspired folk-art animation, **not photoreal** (see section 2) |
| Rating | UA: spooky forest, mild peril, no gore, no strong language |
| Setting | A fictional haunted forest in an old kingdom, "Kaalvan", long ago |
| Premise | Prince Vikrant cannot be crowned until he finishes a task set by his teacher, Shunya Guruji: carry the talking spirit Vetaal, who hangs from a sheesham tree, across the forest. To pass the time Vetaal tells riddle-stories and ends each with a question. If Vikrant knows the answer and keeps silent, he loses. If he answers, Vetaal flies back to the tree and must be fetched again. The frame story: why is Vetaal bound, and what is Guruji really after? |
| Hook per episode | Ep 1: Vetaal says Guruji hid why he is imprisoned. Ep 2: Mandira secretly reports to Guruji. Ep 3: Vikrant's father bound the Vetaal. Ep 4: Guruji appears and demands Vetaal. Ep 5: Guruji's mask comes off and he is Vikrant's "dead" father (sets up season 2) |

Story-within-story rule: the riddle stories are told as shadow-puppet scenes (flat black cut-out figures with ochre
highlights on a lit cloth screen). Their mini-characters are described in the visual line and need no character
sheet. Only the frame characters in section 3 appear as "full" folk-art characters.

Why this look: flat folk-art and shadow-puppet shapes with bold outlines hide the weaknesses of current video models
(face drift, uncanny faces, skin-tone realism), keep motion simple and readable in 5 seconds, and fit an oral
folk-tale. It is a deliberate choice for the pilot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
stylised Indian folk-art animation, Madhubani-inspired bold black outlines and geometric patterns, shadow-puppet cut-out feel, flat earthy ochre, deep black and indigo palette with small touches of red, paper-and-cloth texture, soft lantern glow, haunted forest drawn as twisting patterned trees, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, 3D render, modern clothing, modern city, gore, deity, religious idol
```

Keep palette, texture and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) in the folk-art style
and keep the same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| VIKRANT | `vikrantC` | Indian prince, 19, lean build, wheatish-brown skin, shoulder-length black hair tied half-up, large almond eyes with dark kohl, indigo angarkha tunic with an ochre border, white churidar trousers, plain brown sandals, a thin gold-thread armband on the left upper arm, a small iron-handled torch. Earnest, stubborn, quietly brave. |
| VETAAL | `vetaalC` | Spirit: tall thin figure with ash-grey skin, long matted black hair hanging down as if he is upside down, glowing yellow eyes with black pupils, ragged black-indigo shroud, long thin fingers, a broken iron ring on the right ankle with a short snapped chain. Mocking, clever, tired underneath. |
| MANDIRA | `mandiraC` | Indian girl, 17, dusky skin, one long thick braid with a red thread tied at the end, small brass nose ring, ochre cotton skirt, indigo blouse, red dupatta knotted at the waist, a brass lantern in hand, a black bead amulet on a cord around the neck. Bold, quick, hides fear. |
| GURUJI | `shunyaC` | Shunya Guruji: tall man, about 60, face covered in ash-white paint with three black dots in a row on the forehead, long grey beard, black hooded cloak, tall wooden staff topped with a black iron ring. Calm, commanding, cold. (Under the paint he has a scar on the left cheek, same as DHARMPAL.) |
| DHARMPAL | `dharmpalC` | King Dharmpal, about 58, Vikrant's father, grey beard, deep scar on the left cheek, maroon-and-gold turban with one red jewel, ochre royal robe with gold border. Proud, weary. Appears only as a painted portrait (ep 3) and in the reveal (ep 5). |

Locations (also lock a reference image each): **FOREST** (twisting patterned black trees under an indigo sky and a huge
ochre moon; includes the path and a rope bridge over a ravine), **SHEESHAM** (one gnarled tree with a dark bundle
hanging from a branch), **HUT** (Guruji's small hut with a clay lamp, flashback), **PUPPET SCREEN** (a glowing
ochre cloth screen where the riddle stories play as black cut-outs), **RUINED VILLAGE** (empty mud houses and a broken
well in moonlight), **STONE CIRCLE** (a cliff-top ring of standing stones with an iron ring set in the floor, dawn).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| VIKRANT | Young man, around 20, earnest, steady, slightly formal Hindi, medium pace |
| VETAAL | Mid-low male, raspy and playful, teasing, slow pace with sudden whispers, slight echo |
| MANDIRA | Young woman, quick and bright, village-flavoured Hindi, a little breathless when scared |
| GURUJI | Deep calm male, 60s, slow, measured, every word weighed; quietly threatening |
| DHARMPAL | Only seen in ep 3 and ep 5; no lines. (If a voice is ever needed, use the GURUJI voice.) |

Always test a Hindi line for natural stress before committing: wrong stress is the most common failure. Use one voice
engine for the whole series so the voices stay stable.

## 5. Episodes, shots and dialogue

Shot length is **5 s** unless noted. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line. "Puppet" shots play on the PUPPET SCREEN as flat black cut-outs.

### Episode 1: "Sheesham Ka Saaya" (शीशम का साया), free

Logline: Prince Vikrant takes the Vetaal from the tree and hears the first riddle, about who gave more.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | FOREST at night, twisting black trees, a huge ochre moon, VIKRANT a tiny figure with a torch on the path | VIKRANT (VO): "राजा बनने से पहले मुझे गुरुजी का एक काम पूरा करना है।" (Before I become king I must finish one task for my teacher.) |
| 1-02 | MED | HUT (flashback): GURUJI at the doorway points his staff into the dark, VIKRANT bowing | GURUJI: "शीशम के पेड़ से लटके वेताल को मेरे पास ले आओ।" (Bring me the Vetaal hanging from the sheesham tree.) |
| 1-03 | CU | GURUJI's painted face, lamp flame beside him | GURUJI: "वो पहेली पूछेगा। जवाब जानकर चुप रहे, तो हार जाओगे।" (He will ask a riddle. Stay silent knowing the answer and you lose.) |
| 1-04 | WIDE | SHEESHAM: VIKRANT stops before the tree, a dark bundle hangs upside down from a branch | - |
| 1-05 | CU | VETAAL's yellow eyes snap open, upside down, grinning | VETAAL: "आ गए, राजकुमार? जवाब दोगे तो मैं उड़ जाऊँगा।" (You came, prince? If you answer, I will fly away.) |
| 1-06 | MED | VIKRANT lifts VETAAL over his shoulder, jaw set | - |
| 1-07 | TWO | VIKRANT walks the forest path, VETAAL hanging over his shoulder, hair swaying | - |
| 1-08 | WIDE | Puppet: a small old woman in a hut handing one roti to a thief at her door | VETAAL (VO): "बूढ़ी ने चोर को एक रोटी दी, सेठ ने सौ बोरे अनाज।" (The old woman gave a thief one roti; the merchant gave a hundred sacks of grain.) |
| 1-09 | MED | Puppet: a round-bellied merchant beside a cart piled with sacks, hands open | - |
| 1-10 | CU | VETAAL, upside down, leaning toward VIKRANT's ear | VETAAL: "बोलो राजकुमार, ज़्यादा दान किसने किया?" (Say, prince, who gave more?) |
| 1-11 | CU | VIKRANT, thinking, then speaking | VIKRANT: "बुढ़िया ने। उसने अपना सब कुछ दे दिया।" (The old woman. She gave everything she had.) |
| 1-12 | MED | VETAAL laughs and floats up into the tree's branches, VIKRANT staring after him | VETAAL: "सही! पर गुरुजी ने नहीं बताया, मैं क़ैद क्यों हूँ।" (Right! But Guruji didn't tell you why I'm imprisoned.) |

### Episode 2: "Teen Rajkumar" (तीन राजकुमार), free

Logline: A girl with a lantern offers to guide Vikrant, and a riddle asks what is most precious.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | WIDE | FOREST: VIKRANT with VETAAL over his shoulder crosses a rope bridge above a deep dark ravine | - |
| 2-02 | MED | VETAAL on his shoulder, peering down at the ravine, teasing | VETAAL: "डर रहे हो, राजकुमार? अभी तो जंगल शुरू हुआ है।" (Scared, prince? The forest has only just begun.) |
| 2-03 | CU | VIKRANT, jaw clenched, eyes straight ahead | - |
| 2-04 | MED | MANDIRA steps out at the far end of the bridge, holding her lantern high | MANDIRA: "रुको! आगे का रास्ता सिर्फ़ मुझे मालूम है।" (Stop! Only I know the way ahead.) |
| 2-05 | TWO | MANDIRA leads, VIKRANT follows; VETAAL narrows his yellow eyes at her back | - |
| 2-06 | WIDE | Puppet: a palace balcony, PRINCESS RATNA in a tall crown looking down at three princes | VETAAL (VO): "रत्ना ने कहा, सबसे क़ीमती चीज़ लाने वाले से ब्याह करूँगी।" (Ratna said, I will marry whoever brings the most precious thing.) |
| 2-07 | MED | Puppet: one prince holding up a big diamond, a second prince beside him with a golden parrot in a cage | - |
| 2-08 | MED | Puppet: the third prince, dusty, carrying a clay pot of water toward a dry well | VETAAL (VO): "तीसरा राजकुमार गाँव के सूखे कुएँ के लिए पानी लाया।" (The third prince brought water for the village's dry well.) |
| 2-09 | CU | VETAAL, eyes glowing | VETAAL: "राजकुमारी किसे चुनेगी? सोचकर बताना।" (Whom will the princess choose? Answer after thinking.) |
| 2-10 | CU | VIKRANT, calm | VIKRANT: "पानी वाले को। जो प्यास समझे, वही राज के लायक है।" (The water-bringer. Whoever understands thirst deserves to rule.) |
| 2-11 | MED | VETAAL slips off the shoulder and dissolves upward into black smoke, VIKRANT reaching for him | VETAAL: "सही! अब फिर से मुझे ढूँढना पड़ेगा।" (Right! Now you'll have to find me again.) |
| 2-12 | MED | MANDIRA alone behind VIKRANT's back, holding her black amulet up to the moon, whispering | MANDIRA (whisper): "गुरुजी, वो जाल में फँसता जा रहा है।" (Guruji, he is walking into the trap.) |

### Episode 3: "Dhol Ki Awaaz" (ढोल की आवाज़), free

Logline: A broken rule saves a village, and Vetaal reveals Vikrant's father is part of the secret.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | WIDE | RUINED VILLAGE in moonlight, empty mud houses, VIKRANT and MANDIRA walking in | - |
| 3-02 | MED | VETAAL sits on the broken well wall, legs dangling, smirking | VETAAL: "देर कर दी, राजकुमार। मेरी कहानी ठंडी पड़ गई।" (You're late, prince. My story has gone cold.) |
| 3-03 | CU | MANDIRA, whispering urgently toward VIKRANT | MANDIRA: "इसकी बातों में मत आना, ये ज़हर घोलता है।" (Don't fall for his talk, he spreads poison.) |
| 3-04 | TWO | VIKRANT lifts VETAAL onto his shoulder, glancing doubtfully at MANDIRA | - |
| 3-05 | WIDE | Puppet: a village on a riverbank, a small boy on a rooftop with a big drum | - |
| 3-06 | MED | Puppet: a stout HEADMAN with a big moustache wagging a finger at the boy | VETAAL (VO): "मुखिया ने रात में ढोल बजाना मना किया था।" (The headman had forbidden drumming at night.) |
| 3-07 | MED | Puppet: the boy beats the drum hard, behind him the river rises as wavy lines | VETAAL (VO): "नदी चढ़ी, तो लड़के ने ढोल बजाया और गाँव बच गया।" (When the river rose, the boy drummed and the village was saved.) |
| 3-08 | MED | Puppet: the HEADMAN snaps the drum in two, the boy kneeling before him | - |
| 3-09 | CU | VETAAL, whispering into VIKRANT's ear | VETAAL: "मुखिया ने लड़के को सज़ा दी। सही या ग़लत?" (The headman punished the boy. Right or wrong?) |
| 3-10 | CU | VIKRANT, firm | VIKRANT: "ग़लत। जो नियम जान न बचा सके, उसे बदलना चाहिए।" (Wrong. A rule that can't save a life should be changed.) |
| 3-11 | CU | VETAAL, smiling slyly | VETAAL: "अच्छा जवाब। तुम्हारे पिता ने भी एक नियम बनाया था।" (Good answer. Your father also made a rule once.) |
| 3-12 | INS | A painted portrait of DHARMPAL slips from VIKRANT's cloak onto the dirt; VIKRANT's hand stops mid-reach | VETAAL (whisper, off-screen): "मुझे बाँधने का।" (A rule to bind me.) |

### Episode 4: "Chup Dost" (चुप दोस्त), coin-locked

Logline: Mandira's secret comes out, a riddle about silence, and Guruji arrives.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | FOREST campfire clearing at night, VIKRANT sitting, VETAAL hanging from a low branch above | - |
| 4-02 | MED | MANDIRA at the clearing's edge, back turned, holding her black amulet to the moon; VIKRANT standing behind her | - |
| 4-03 | CU | VIKRANT, eyes hard | VIKRANT: "ये ताबीज़ किसका है, मंदिरा?" (Whose amulet is this, Mandira?) |
| 4-04 | CU | MANDIRA, tearful | MANDIRA: "गुरुजी ने मेरे भाई को बंधक बना रखा है।" (Guruji is holding my brother hostage.) |
| 4-05 | MED | VETAAL chuckling beside VIKRANT's ear | VETAAL: "देखा? हर किसी की अपनी एक रस्सी होती है।" (See? Everyone has a rope of their own.) |
| 4-06 | WIDE | Puppet: two boys at a potter's shop, a broken pot on the floor, one boy stepping forward | VETAAL (VO): "श्याम से घड़ा टूटा, राजू ने इल्ज़ाम अपने सिर ले लिया।" (Shyam broke the pot; Raju took the blame on himself.) |
| 4-07 | MED | Puppet: the angry POTTER raising a stick over RAJU, SHYAM hiding behind a pillar | - |
| 4-08 | MED | Puppet: RAJU sweeping the potter's yard, SHYAM in fine clothes walking past without looking | - |
| 4-09 | WIDE | Puppet: a courtroom, SHYAM as a judge on a high seat, RAJU standing below him | VETAAL (VO): "सालों बाद श्याम जज बना, और राजू उसके सामने खड़ा था।" (Years later Shyam became a judge, and Raju stood before him.) |
| 4-10 | CU | VETAAL, eyes burning yellow | VETAAL: "क्या श्याम की चुप्पी अपराध थी? बोलो।" (Was Shyam's silence a crime? Speak.) |
| 4-11 | CU | VIKRANT, looking down, then up | VIKRANT: "हाँ। अन्याय पर चुप रहना भी अन्याय है।" (Yes. Staying silent before injustice is injustice too.) |
| 4-12 | WIDE | On a ridge, GURUJI's tall silhouette against the huge moon, staff raised; MANDIRA stepping back | GURUJI: "बहुत अच्छा, बेटा। अब वेताल को मेरे हवाले कर दो।" (Very good, son. Now hand the Vetaal over to me.) |

### Episode 5: "Aakhri Paheli" (आख़िरी पहेली), coin-locked

Logline: The last riddle is Vetaal's own story, and the face behind Guruji's mask changes everything.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | WIDE | STONE CIRCLE at grey dawn: GURUJI waits beside the iron ring in the floor, VIKRANT and MANDIRA arrive with VETAAL | - |
| 5-02 | MED | GURUJI holds out a heavy iron chain toward VIKRANT | GURUJI: "वेताल को चक्र में बाँध दो, तुम्हारा काम पूरा हो जाएगा।" (Bind the Vetaal in the circle and your task will be done.) |
| 5-03 | CU | VETAAL, calm for the first time | VETAAL: "एक आख़िरी कहानी, राजकुमार। फिर जो चाहे करना।" (One last story, prince. Then do what you will.) |
| 5-04 | WIDE | Puppet: cracked dry land, a tall-crowned king kneeling before a dark shape | VETAAL (VO): "अकाल पड़ा, तो एक राजा ने मुझसे बारिश माँगी।" (In a famine a king begged me for rain.) |
| 5-05 | MED | Puppet: rain falls in thin lines, the king ties a rope around the dark shape and a tree | - |
| 5-06 | CU | VETAAL, bitter | VETAAL: "वचन उसका था, सज़ा मेरी। क्या यह न्याय है?" (The promise was his, the punishment mine. Is this justice?) |
| 5-07 | CU | VIKRANT, eyes wet, certain | VIKRANT: "नहीं। जिसने बाँधा, वही दोषी है, तुम नहीं।" (No. The one who bound you is guilty, not you.) |
| 5-08 | INS | VIKRANT's hands pull the iron chain off the stone; the broken ring on VETAAL's ankle cracks open | - |
| 5-09 | MED | GURUJI lunges forward, staff raised, MANDIRA shrinking back | GURUJI: "रुको! तुम नहीं जानते तुमने क्या कर दिया!" (Stop! You don't know what you have done!) |
| 5-10 | WIDE | VETAAL rises into the dawn sky as black smoke wings, first raindrops falling over the circle | VETAAL (VO): "धन्यवाद, राजकुमार। अब अपने गुरुजी का असली चेहरा देखो।" (Thank you, prince. Now see your Guruji's true face.) |
| 5-11 | CU | GURUJI's hand wipes the white paint from his face; underneath, the scarred, grey-bearded face of DHARMPAL | - |
| 5-12 | CU | VIKRANT, frozen in the rain; end card "सीज़न 1 जारी है…" | VIKRANT: "पिताजी…?" (Father…?) |
