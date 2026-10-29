# Series 10: "Chhoti Dukaan, Bada Sapna" (छोटी दुकान, बड़ा सपना)

Rags-to-riches business drama · UA · 5 episodes x 12 shots · slug `chhoti-dukaan-bada-sapna`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Chhoti Dukaan, Bada Sapna (छोटी दुकान, बड़ा सपना), "Small Shop, Big Dream" |
| Language | Hindi (Hinglish-tinged, everyday spoken) |
| Genre | Rags-to-riches business drama, warm and funny, underdog story |
| Look | Lively gouache / paper-cut collage illustration with bright festival colours, **not photoreal** (see section 2) |
| Rating | UA: family-friendly, no violence, no strong language |
| Setting | Phoolgali, a fictional old-city bazaar with narrow lanes, bunting and brass utensils, present day |
| Premise | Bittu, 16, and his grandfather Dadu run a tiny roadside jalebi shop. When a glossy sweet-shop chain tries to buy the whole lane, Bittu turns the family's secret recipe and a simple idea ("one jalebi, one story", filmed on a phone) into a fight to save the bazaar. The chain's young manager is not a pure villain. |
| Hook per episode | Ep 1: the lane has 30 days left. Ep 2: the rival tastes the jalebi and breaks down. Ep 3: Dadu walks away at night. Ep 4: a midnight ultimatum. Ep 5: a hidden tin under the floor sets up season 2. |

Why this look: cut-paper and gouache art hides the weaknesses of current video models (face drift, uncanny
faces, Indian skin-tone realism), keeps flat bright colours stable from shot to shot, and its festival
cheerfulness suits a funny, feel-good underdog story.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
gouache and paper-cut collage illustration, layered flat cut-paper shapes with soft painted texture and visible paper grain, bright festival palette of marigold orange, magenta and leaf green, warm morning sunlight, hand-painted old-city Indian bazaar with bunting and brass utensils, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, 3D render, real person, celebrity, text, watermark, logo, brand name, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, western setting, dark gritty mood, gore
```

Keep palette, paper texture and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| BITTU | `bittuCD` | Indian boy, 16, lean, medium-brown skin, messy black hair with a cowlick at the front, round face, small scar on the chin, faded blue checked shirt worn open over an orange t-shirt, rolled-up navy trousers, rubber chappals, red-and-white checked cotton towel over the left shoulder. Cheeky, quick-witted, big-hearted. |
| DADU | `daduCD` | Indian man, 72, thin, deep-brown skin, bald with a white fringe, thick white moustache, round steel-rimmed glasses, white cotton kurta with sleeves rolled to the elbow, white dhoti, marigold-orange cotton towel around the neck, a pale burn mark on the left forearm. Gentle, stubborn, proud. |
| RITIKA | `ritikaCD` | Indian woman, 28, light wheat skin, black hair in a sleek high ponytail, small silver nose stud, teal blazer over a white shirt, black trousers, small gold stud earrings, carries a slim brown folder. Sharp, polite, secretly homesick. |
| SETHJI | `sethjiCD` | Indian man, 58, heavyset, brown skin, grey hair combed back, thick grey moustache, cream silk kurta under a dark green sleeveless jacket, heavy gold ring on the left index finger, gold wristwatch. Smooth, confident, hides old regret. |
| PINKI | `pinkiCD` | Indian girl, 15, slim, dark-wheat skin, two thick braids tied with magenta ribbons, round cheeks, green salwar kameez with a yellow dupatta, holds a cheap phone in a sticker-covered case. Chatty, fearless, Bittu's best friend. |

Locations (also lock a reference image each): **SHOP** (tiny roadside sweet shop with a coal stove, a big
iron kadhai and a hand-painted tin signboard with no writing), **LANE** (Phoolgali bazaar lane with bunting,
marigold garlands and brass pots), **STEPS** (old stone steps by a river at dawn, mist), **HOME** (small room
above the shop with a cot, a lamp and a loose floor tile), **FESTIVAL** (the same lane at night with lanterns
and one giant kadhai in the middle).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| BITTU | Teen boy, about 16, bright and cheeky, quick pace, natural Hinglish rhythm |
| DADU | Elderly man, about 72, warm and raspy, slow pace, gentle humour |
| RITIKA | Young woman, about 28, clear polite city Hindi, measured pace, softens over time |
| SETHJI | Mature man, about 58, smooth deep voice, unhurried, confident, a crack of emotion late |
| PINKI | Teen girl, about 15, high energy, fast and chatty |

Hindi TTS or cloning options in my research: Sarvam Bulbul, ElevenLabs v3, Indic Parler-TTS and F5-TTS
(open). Pick one and use it for the whole series so the voices stay stable. Always test a Hindi line for
natural stress before committing: wrong stress is the most common failure.

## 5. Episodes, shots and dialogue

Shot length is **5 s** unless noted. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert),
OTS (over the shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short
English gist. "-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the
visual line.

### Episode 1: "Subah Ki Pehli Jalebi" (सुबह की पहली जलेबी), free

Logline: A normal morning at the jalebi shop turns upside down when a stranger offers to buy the entire lane.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | LANE at dawn, shutters rolling up, bunting swaying, warm light on brass pots | BITTU (VO): "मेरा नाम बिट्टू है, और ये हमारी दुकान है।" (My name is Bittu, and this is our shop.) |
| 1-02 | MED | SHOP: DADU fans a glowing coal stove under a big iron kadhai | - |
| 1-03 | CU | BITTU pours a spiral of orange batter into hot oil | DADU (off-screen): "धीरे बिट्टू, जलेबी को प्यार चाहिए।" (Gently, Bittu. Jalebi needs love.) |
| 1-04 | INS | Golden jalebi coils bubbling in the oil | - |
| 1-05 | TWO | DADU hands BITTU a hot jalebi on a green leaf plate | BITTU: "दादू, इसमें वो ख़ास राज़ क्या है?" (Dadu, what's the special secret in it?) |
| 1-06 | CU | DADU smiles, eyes twinkling | DADU: "राज़ बताया नहीं जाता, बिट्टू। विरासत में मिलता है।" (A secret isn't told, Bittu. It's inherited.) |
| 1-07 | WIDE | A glossy white-and-pink van parks at the lane's mouth, shopkeepers turn to look | - |
| 1-08 | MED | RITIKA steps out of the van holding a gift box of sweets and a folder | RITIKA: "नमस्ते! मैं ऋतिका हूँ, एक बड़ी कंपनी से।" (Namaste! I'm Ritika, from a big company.) |
| 1-09 | TWO | RITIKA offers the folder to DADU at the SHOP counter | RITIKA: "हम पूरी गली ख़रीदना चाहते हैं, अच्छे दाम पर।" (We want to buy the whole lane, at a good price.) |
| 1-10 | CU | DADU shakes his head gently, still smiling | DADU: "गली बिकाऊ नहीं है, बेटी। चाय पियोगी?" (The lane isn't for sale, daughter. Will you have tea?) |
| 1-11 | INS | A folded official notice with a red stamp pasted on a SHOP pillar | - |
| 1-12 | CU | BITTU reads it, his face falls | BITTU: "दादू… ये गली तीस दिन में ख़ाली करनी है।" (Dadu… this lane must be vacated in thirty days.) |

### Episode 2: "Ek Jalebi, Ek Kahani" (एक जलेबी, एक कहानी), free

Logline: Bittu and Pinki turn free jalebi and the bazaar's stories into a video that takes off overnight.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | TWO | Evening, BITTU and PINKI sit on the SHOP step, PINKI holding her phone | PINKI: "बिट्टू, लोगों को कहानियाँ पसंद हैं, सिर्फ़ मिठाई नहीं।" (Bittu, people like stories, not just sweets.) |
| 2-02 | CU | BITTU's eyes light up | BITTU: "एक जलेबी, एक कहानी! अपनी कहानी सुनाओ, जलेबी मुफ़्त!" (One jalebi, one story! Tell your story, get a free jalebi!) |
| 2-03 | WIDE | Morning, BITTU hangs a bright hand-painted cloth banner of a jalebi across the SHOP front | - |
| 2-04 | MED | DADU sits on a stool, shy, as PINKI holds her phone toward him | DADU: "इस दुकान में मेरे पिताजी ने पहली जलेबी बनाई थी।" (My father made the first jalebi in this shop.) |
| 2-05 | CU | PINKI behind the phone, grinning | PINKI: "वाह दादू! अब रुकना मत, पूरी कहानी सुनाओ।" (Wow Dadu! Don't stop now, tell the whole story.) |
| 2-06 | WIDE | LANE: neighbours queue with plates, laughing, waiting to tell their stories | - |
| 2-07 | TWO | PINKI taps her phone and shows BITTU the screen | PINKI: "हो गया पोस्ट। अब बस इंतज़ार।" (It's posted. Now we just wait.) |
| 2-08 | INS | The phone glows on a cot in the dark, one small heart pulses on the screen | - |
| 2-09 | MED | HOME at night, BITTU asleep on the cot, the phone buzzing beside him | - |
| 2-10 | CU | PINKI bursts in, shaking BITTU's shoulder | PINKI: "बिट्टू! उठ! सब हमारा वीडियो देख रहे हैं!" (Bittu! Get up! Everyone is watching our video!) |
| 2-11 | WIDE | Next morning, a long queue of strangers winds through the LANE to the SHOP | - |
| 2-12 | CU | RITIKA alone in her parked van, bites a jalebi, eyes widen and fill with tears | RITIKA: "ये स्वाद… मैंने ये पहले भी चखा है।" (This taste… I have tasted this before.) |

### Episode 3: "Sauda" (सौदा), free

Logline: Fame brings a huge offer, and a careless answer hurts Dadu deeply.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | WIDE | The LANE packed with customers, steam rising from the SHOP, bunting bright | - |
| 3-02 | MED | DADU sweating, ladling jalebi fast, BITTU serving at the counter | DADU: "बिट्टू, तेल गरम है! जल्दी पत्ते लाओ!" (Bittu, the oil is hot! Quick, bring the leaf plates!) |
| 3-03 | CU | PINKI laughing as she films the crowd on her phone | - |
| 3-04 | MED | SETHJI arrives at the SHOP counter, smiling, hands behind his back | SETHJI: "शाबाश, लड़के! तुम्हारी जलेबी में दम है।" (Well done, boy! Your jalebi has something special.) |
| 3-05 | TWO | SETHJI draws BITTU aside and shows a thick envelope | SETHJI: "मैं तुम्हारी रेसिपी ख़रीदूँगा। दस लाख, अभी।" (I'll buy your recipe. Ten lakh, right now.) |
| 3-06 | CU | BITTU stunned, glancing up at the cracked SHOP roof | BITTU: "दस लाख? इससे तो छत भी बन जाएगी…" (Ten lakh? That could even fix the roof…) |
| 3-07 | MED | DADU stands frozen behind a pillar, holding a tray, having overheard | - |
| 3-08 | CU | DADU, hurt, voice low | DADU: "तो अब रेसिपी भी बिकाऊ है, बिट्टू?" (So now even the recipe is for sale, Bittu?) |
| 3-09 | TWO | BITTU and DADU face to face in the SHOP | BITTU: "दादू, मैं तो बस आपकी मदद करना चाहता था!" (Dadu, I only wanted to help you!) |
| 3-10 | CU | DADU, shaking his head | DADU: "मदद पैसे से नहीं, भरोसे से होती है।" (Help comes from trust, not from money.) |
| 3-11 | INS | DADU's brass ladle set down beside the SHOP key on the counter | - |
| 3-12 | WIDE | Night, the shuttered LANE, DADU's small silhouette with a cloth bag walks away under a lamp; BITTU at the SHOP mouth | BITTU: "दादू? दादू, आप कहाँ जा रहे हैं?" (Dadu? Dadu, where are you going?) |

### Episode 4: "Dadu Ki Dastaan" (दादू की दास्तान), coin-locked

Logline: Bittu finds Dadu, learns what the recipe really means, and gets an unexpected ally.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | STEPS at dawn, mist on the river, DADU sitting small and alone on the old stone steps | - |
| 4-02 | MED | BITTU arrives out of breath and stops a few steps behind him | BITTU: "दादू, मुझे माफ़ कर दो। मैं ग़लत था।" (Dadu, forgive me. I was wrong.) |
| 4-03 | TWO | BITTU sits down beside DADU on the steps | DADU: "ये रेसिपी मेरे पिताजी ने बाज़ार को तोहफ़े में दी थी।" (My father gave this recipe to the bazaar as a gift.) |
| 4-04 | CU | DADU, eyes warm | DADU: "राज़ बस इतना है: हर जलेबी में पड़ोसी का हिस्सा है।" (The secret is just this: every jalebi has a neighbour's share.) |
| 4-05 | INS | DADU's worn recipe diary, one page torn off at the edge | - |
| 4-06 | CU | BITTU nods slowly, understanding, a small smile | - |
| 4-07 | MED | RITIKA walks down the steps, no blazer now, in a plain kurta | RITIKA: "बिट्टू, मुझे तुमसे ज़रूरी बात करनी है।" (Bittu, I need to talk to you about something important.) |
| 4-08 | TWO | RITIKA and BITTU stand facing each other, she holds her folder to her chest | RITIKA: "ज़मीन सबके नाम है। सब मना करें, तो सौदा रुक जाएगा।" (The land is in everyone's name. If all refuse, the deal stops.) |
| 4-09 | CU | BITTU, puzzled | BITTU: "आप हमारी मदद क्यों कर रही हैं?" (Why are you helping us?) |
| 4-10 | CU | RITIKA, soft, looking at the river | RITIKA: "क्योंकि मेरी नानी भी ऐसी ही जलेबी बनाती थीं।" (Because my nani used to make jalebi just like this.) |
| 4-11 | WIDE | FESTIVAL night: lanterns strung across the LANE, a giant kadhai in the middle, neighbours gathering | - |
| 4-12 | CU | SETHJI at the edge of the lantern light, cold | SETHJI: "आधी रात तक बेचो, या कल गली छोड़ो।" (Sell by midnight, or leave the lane tomorrow.) |

### Episode 5: "Aakhri Jalebi" (आख़िरी जलेबी), coin-locked

Logline: The bazaar cooks together, the rival tastes his past, and a hidden tin opens a bigger story.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | WIDE | FESTIVAL: a row of stoves, neighbours stirring pots, lanterns glowing | - |
| 5-02 | MED | DADU hands BITTU the big ladle beside the giant kadhai | DADU: "आज की जलेबी तुम बनाओगे, बिट्टू।" (Today you will make the jalebi, Bittu.) |
| 5-03 | CU | BITTU pours a huge spiral of batter, determined | BITTU: "आज हर दुकान का हिस्सा इसमें है।" (Today every shop has a share in this.) |
| 5-04 | INS | Golden jalebis stacked high on a huge brass tray | - |
| 5-05 | WIDE | Neighbours queue with plates; SETHJI stands alone at the edge | - |
| 5-06 | MED | SETHJI takes a bite and freezes | - |
| 5-07 | CU | SETHJI, eyes shining | SETHJI: "ये स्वाद… मैं ये सौदा रद्द करता हूँ।" (This taste… I cancel this deal.) |
| 5-08 | WIDE | The whole bazaar cheers and tosses marigold petals into the air | - |
| 5-09 | TWO | SETHJI faces DADU | SETHJI: "पहचाना नहीं, बाबूलाल? मैं तुम्हारी दुकान पर काम करता था।" (Don't you recognise me, Babulal? I used to work at your shop.) |
| 5-10 | MED | DADU, astonished, steps closer | DADU: "मोहन! तुम? इतने बरस कहाँ थे?" (Mohan! You? Where were you all these years?) |
| 5-11 | INS | SETHJI's hand gives DADU a torn page showing a sketch of the SHOP floor with a small cross | SETHJI (off-screen): "ये आख़िरी पन्ना है। असली राज़ फ़र्श के नीचे है।" (This is the last page. The real secret is under the floor.) |
| 5-12 | CU | HOME at night, BITTU lifts a loose floor tile and opens a rusty tin with an old envelope inside; end card "सीज़न 2 जारी है…" | BITTU (whisper): "पापा…?" (Papa…?) |
