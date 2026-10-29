# Series 03: "Baraat Bhaag Gayi" (बारात भाग गई)

Wedding comedy-romance · UA · 5 episodes x 12 shots · slug `baraat-bhaag-gayi`
Shared setup, delivery format, ffmpeg and checklist are in `00_START_HERE.md`. This file is only the content.

## 1. Series bible

| | |
|---|---|
| Title | Baraat Bhaag Gayi (बारात भाग गई), "The Wedding That Ran Away" |
| Language | Hindi (Hinglish-tinged, everyday spoken) |
| Genre | Wedding comedy / romance / chase |
| Look | Bright saturated 3D-cartoon, Pixar-like stylised look, **not photoreal** (see section 2) |
| Rating | UA: slapstick and light peril, no violence, no strong language |
| Setting | Rangpur, a fictional big Indian city, present day: a banquet lawn, a flower market, a railway halt, a bazaar, a lake ghat and a puppet tent |
| Premise | The night before the pheras, groom Rohan vanishes from a lavish wedding. The bride's cousin Kavya and the groom's best friend Jugnu, who start out blaming each other, have 24 hours to find him across the city, and fall for each other on the way. |
| Hook per episode | 1: the groom is gone and the clock starts. 2: a decoy, then Rohan seen on a train. 3: the bride is on the phone, and she knew. 4: a glowing tent across the lake. 5: Rohan is found and brought back, but now the bride has vanished (season 2 setup). |

Why this look: bright stylised 3D-cartoon characters are the most forgiving format for current video models (clean
shapes, consistent faces, no uncanny skin), and the saturated festive colours and big expressions suit fast comedy.
It is a deliberate choice for the pilot.

## 2. Look and style (paste into every prompt)

STYLE_PREFIX:
```
bright saturated 3D animated cartoon look, Pixar-style stylised characters with big expressive eyes and smooth skin, vibrant magenta, orange, teal and gold palette, glossy festive lighting, fairy lights and marigold garlands, bustling Indian city, vertical 9:16 composition
```

NEGATIVE (for models that take one):
```
photorealistic, real person, celebrity, text, watermark, logo, subtitles, extra fingers, deformed hands, distorted face, blurry, low quality, realistic skin pores, dark horror mood, gore
```

Keep palette, lighting and costume identical across all 60 shots. Change only the shot content.

## 3. Characters

Make one **reference sheet per character first** (front, side, three-quarter, two expressions) and keep the
same sheet attached to every shot of that character. If you train a LoRA, use the trigger word shown.

| Tag | Trigger | Canonical description |
|---|---|---|
| KAVYA | `kavyaC` | Indian woman, 24, petite, warm brown skin, curly shoulder-length black hair in a high ponytail with a yellow scrunchie, round pink-framed glasses, tiny star-shaped nose pin on the right nostril, turquoise embroidered short kurti, cream palazzo pants, red dupatta knotted at the waist, white sneakers. Sharp, bossy, big-hearted. |
| JUGNU | `jugnuC` | Indian man, 26, tall and lanky, medium-brown skin, messy wavy dark-brown hair with one cowlick sticking up, thick eyebrows, dimpled chin, salmon-pink bandi jacket over a white kurta, blue jeans, brown loafers, chunky black wristwatch. Goofy, loyal, cool under pressure. |
| ROHAN | `rohanC` | Indian man, 27, medium build, fair wheatish skin, neat short black hair, trimmed moustache, small mole below the left eye, ivory sherwani with gold buttons and a maroon safa (turban) with a feather kalgi, gentle nervous face. Sweet, anxious, hiding a dream. Appears only from ep 5 except as a distant figure. |
| TANVI | `tanviC` | Indian woman, 25, slim, fair-brown skin, long loose waves of black hair, deep red-and-gold bridal lehenga, kundan necklace and maang tikka, mehendi patterns on both hands, thin gold nath nose ring with a chain to the ear. Calm, clever, always one step ahead. |
| PAPPU | `pappuC` | Indian man, 52, short and round, shiny bald head with grey side hair, big handlebar moustache, loud purple silk kurta, gold chain, gold-framed sunglasses pushed up on his forehead. Tanvi's uncle and the wedding manager, panics at everything. |

Minor one-shot roles (no reference sheet needed, keep generic): TRUMPETER, a wedding-band musician with a big
moustache in a red band uniform (ep 2); OLD DHOLWALA, a grey-haired drummer in a yellow turban (ep 3);
BOATMAN, a thin old man in a faded blue shirt rowing a wooden boat (ep 4).

Locations (also lock a reference image each): **GULMOHAR LAWN** (the wedding venue at night, huge mandap, fairy
lights, marigold gates), **FLOWER MARKET** (dawn, mountains of marigold and rose, narrow lanes), **RAILWAY HALT**
(small platform with a waiting train), **BAZAAR** (colourful busy street with signboards left blank), **LAKE
GHAT** (stone steps, floating lamps, wooden boats), **PUPPET TENT** (small striped tent lit from inside, shadow
screen and tiny puppets).

## 4. Voices

Use **consented voice actors or a licensed stock/TTS voice**. Never clone a real person or imitate a celebrity.
Record who gave consent and where the consent form is stored in `series.json` (see `00_START_HERE.md`).

| Character | Voice brief |
|---|---|
| KAVYA | Young woman, bright and fast, bossy with sudden softness, comic exasperation |
| JUGNU | Young man, relaxed mid baritone, cheerful and goofy, steady when serious |
| ROHAN | Young man, gentle slightly high voice, hesitant, apologetic pace |
| TANVI | Young woman, low calm voice, slow, amused, a little secretive; whispered on the phone |
| PAPPU | Middle-aged man, loud and cracking, very fast, melodramatic |

Pick one Hindi TTS or consented-actor pipeline and use it for the whole series so the voices stay stable.
Always test a Hindi line for natural stress before committing.

## 5. Episodes, shots and dialogue

Shot length is **5 s**. Types: WIDE, MED (medium), CU (close-up), TWO (two-shot), INS (insert), OTS (over the
shoulder). `VO` = voice-over (no lip-sync needed). Dialogue is in Devanagari, followed by a short English gist.
"-" means no speech (music/ambience only). Prompt = STYLE_PREFIX + the character tags + the visual line.

### Episode 1: "Dulha Gayab" (दूल्हा ग़ायब), free

Logline: The groom vanishes the night before the pheras and the 24-hour search begins.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 1-01 | WIDE | GULMOHAR LAWN at night, glowing mandap, fairy lights, dhol drummers and guests dancing | KAVYA (VO): "शादी में सबसे ज़रूरी चीज़ क्या होती है? दूल्हा!" (What is the most important thing at a wedding? The groom!) |
| 1-02 | MED | PAPPU waves his arms, directing garland carriers | PAPPU: "सब तैयार हैं! बस दूल्हे को बुलाओ!" (Everyone's ready! Just call the groom!) |
| 1-03 | MED | KAVYA knocks on a decorated door in a corridor | - |
| 1-04 | MED | JUGNU arrives out of breath and pushes the door open | JUGNU: "खुला ही है। पर कमरा ख़ाली है!" (It's open already. But the room is empty!) |
| 1-05 | INS | Empty room: open window, curtains fluttering, a maroon safa left on the bed | - |
| 1-06 | CU | KAVYA holds up a folded note and reads it aloud | KAVYA: "'मुझे माफ़ करना, मैं कल शाम तक लौटूँगा।'" ("Forgive me, I will return by tomorrow evening.") |
| 1-07 | TWO | KAVYA and JUGNU face to face, glaring | KAVYA: "तुम उसके दोस्त हो, तुम्हें ज़रूर पता होगा!" (You're his friend, you must know!) |
| 1-08 | CU | JUGNU, innocent, both palms raised | JUGNU: "क़सम से नहीं पता! पर ढूँढ सकता हूँ।" (I swear I don't know! But I can find him.) |
| 1-09 | WIDE | TANVI alone on a balcony in her red bridal lehenga, looking at the night city | - |
| 1-10 | MED | PAPPU faints backwards onto a pile of marigold garlands | - |
| 1-11 | TWO | KAVYA and JUGNU face each other, determined, a clumsy handshake | KAVYA: "चौबीस घंटे हैं। फेरों से पहले उसे ढूँढना है।" (We have twenty-four hours. We must find him before the pheras.) |
| 1-12 | WIDE | LAWN gate: a scooter races away with a rider in an ivory sherwani, garland flapping, KAVYA and JUGNU running behind | JUGNU: "वो रहा दूल्हा! भागो!" (There's the groom! Run!) |

### Episode 2: "Phoolon Ki Mandi" (फूलों की मंडी), free

Logline: A chase through the flower market ends in a decoy, a clue and a glimpse of Rohan on a train.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 2-01 | WIDE | FLOWER MARKET at dawn, mountains of marigold and rose, a scooter weaving through, KAVYA and JUGNU in a rickshaw behind | KAVYA: "तेज़ चलाओ भैया! वो आगे निकल गया!" (Drive faster, bhaiya! He's getting away!) |
| 2-02 | MED | JUGNU clings to the rickshaw handle, hair flying | - |
| 2-03 | WIDE | The scooter crashes softly into a heap of marigolds, the rider tumbles out | - |
| 2-04 | MED | The rider sits up covered in petals: TRUMPETER in the ivory sherwani; JUGNU stares | JUGNU: "ये रोहन नहीं है!" (This isn't Rohan!) |
| 2-05 | CU | TRUMPETER, sheepish, holds up his sherwani collar | TRUMPETER: "साहब, दूल्हे ने मुझे कपड़े दिए, कहा भाग जा!" (Sir, the groom gave me these clothes and said run!) |
| 2-06 | TWO | KAVYA and JUGNU look at each other, puzzled | - |
| 2-07 | INS | TRUMPETER's hand gives over a crumpled paper train ticket | - |
| 2-08 | CU | KAVYA reads the ticket, eyes wide | KAVYA: "रेलवे स्टेशन! पहली गाड़ी आठ बजे जाती है!" (Railway station! The first train leaves at eight!) |
| 2-09 | WIDE | They run through the market, JUGNU slips on petals and slides on his back with legs in the air | - |
| 2-10 | MED | KAVYA stops, pulls JUGNU up by the collar | KAVYA: "तुम हमेशा इतने अनाड़ी रहते हो?" (Are you always this clumsy?) |
| 2-11 | CU | JUGNU grinning, marigold petals in his hair | JUGNU: "सिर्फ़ ख़ूबसूरत लड़कियों के सामने।" (Only in front of pretty girls.) |
| 2-12 | WIDE | RAILWAY HALT: a train pulls out; in a window a small figure in an ivory sherwani looks back at KAVYA and JUGNU on the platform | KAVYA: "वो ट्रेन में है, और ट्रेन जा चुकी है!" (He's on the train, and the train has gone!) |

### Episode 3: "Baraat Mein Baraat" (बारात में बारात), free

Logline: They catch the train at the next halt, get swept into another wedding procession, and Rohan's phone rings.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 3-01 | WIDE | Small RAILWAY HALT, a train waiting at a signal; KAVYA and JUGNU squeezed in a three-wheeler tempo with baskets of oranges | JUGNU: "सिग्नल हरा हो गया तो हम गए!" (If the signal turns green, we're finished!) |
| 3-02 | MED | KAVYA leans from the tempo toward the train steps, JUGNU holds her dupatta | KAVYA: "खींचो मत, दुपट्टा फट जाएगा!" (Don't pull, my dupatta will tear!) |
| 3-03 | INS | An empty window seat on the train with a lone phone, wedding photo on its screen | - |
| 3-04 | CU | JUGNU picks up the phone and holds it up | JUGNU: "फ़ोन यहाँ है, मतलब वो ख़ुद उतर गया!" (The phone is here, so he got off by himself!) |
| 3-05 | MED | KAVYA kneels beside a trail of muddy footprints leading away from the halt | - |
| 3-06 | WIDE | BAZAAR: another wedding procession fills the street, a band, a decorated horse, dancing guests | - |
| 3-07 | MED | The dancers pull JUGNU into the circle and he dances awkwardly | JUGNU: "अरे! मैं तो जासूस हूँ, नर्तक नहीं!" (Hey! I'm a detective, not a dancer!) |
| 3-08 | MED | KAVYA laughing, clapping and spinning in spite of herself | KAVYA: "तुम तो अच्छा नाच रहे हो, जासूस जी!" (You're dancing well, Mr Detective!) |
| 3-09 | TWO | KAVYA and JUGNU stop in the middle of the dancers, eyes meeting, lights glowing around them | - |
| 3-10 | CU | OLD DHOLWALA points down a side lane with his drumstick | OLD DHOLWALA: "वो लड़का? नाव घाट की तरफ़ भागा था।" (That boy? He ran toward the boat ghat.) |
| 3-11 | MED | KAVYA grabs JUGNU's wrist and pulls him out of the crowd | KAVYA: "चलो, घाट! अभी!" (Come, to the ghat! Now!) |
| 3-12 | CU | JUGNU lifts the buzzing phone to his ear, eyes widening; TANVI's whisper from the phone | TANVI (phone, whisper): "रोहन, तुम पहुँचे? किसी को बताया तो नहीं?" (Rohan, did you get there? You didn't tell anyone, did you?) |

### Episode 4: "Ghaat Ki Raat" (घाट की रात), coin-locked

Logline: Kavya learns her cousin knew everything, and a lake crossing brings the two closer.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 4-01 | WIDE | LAKE GHAT at dusk, stone steps, floating lamps, wooden boats, pink-gold sky | - |
| 4-02 | TWO | KAVYA and JUGNU on the steps, she holds the phone, upset | KAVYA: "मेरी अपनी बहन ने मुझसे झूठ बोला!" (My own sister lied to me!) |
| 4-03 | MED | KAVYA sits on the steps hugging her knees | - |
| 4-04 | MED | JUGNU sits beside her and offers a paper bag of snacks | - |
| 4-05 | CU | JUGNU, gentle smile | JUGNU: "मैं हूँ ना। हम उसे ढूँढ लेंगे।" (I'm here. We'll find him.) |
| 4-06 | MED | BOATMAN pushes a wooden boat along the shore and points across the water | BOATMAN: "सफ़ेद शेरवानी वाला उस पार गया था।" (A man in a white sherwani went to the other side.) |
| 4-07 | TWO | KAVYA and JUGNU in the rowboat, JUGNU rowing in circles | KAVYA: "ऐसे तो हम सुबह तक वहीं घूमेंगे!" (At this rate we'll be going round in circles till morning!) |
| 4-08 | WIDE | The boat drifts in the middle of the lake among floating lamps and stars | - |
| 4-09 | TWO | KAVYA takes an oar, they row together, shoulders touching | - |
| 4-10 | CU | KAVYA, worried | KAVYA: "अगर रोहन ना मिला तो?" (What if we don't find Rohan?) |
| 4-11 | CU | JUGNU, sincere | JUGNU: "तब भी मैं तुम्हें अकेला नहीं छोड़ूँगा।" (Even then I won't leave you alone.) |
| 4-12 | WIDE | Far shore: a small striped PUPPET TENT glows, the shadow of a tiny puppet dances on its wall | ROHAN (off-screen): "कौन है वहाँ?" (Who's there?) |

### Episode 5: "Pheron Se Pehle" (फेरों से पहले), coin-locked

Logline: Rohan is found and brought back in time, but now the bride is missing.

| # | Type | Visual | Speaker: dialogue |
|---|---|---|---|
| 5-01 | MED | PUPPET TENT: ROHAN in his ivory sherwani holds a hand puppet, startled, lamp-lit | ROHAN: "काव्या? जुगनू? तुम लोग यहाँ कैसे?" (Kavya? Jugnu? How did you two get here?) |
| 5-02 | CU | JUGNU hugs ROHAN, relieved and cross at once | - |
| 5-03 | CU | ROHAN, ashamed, looking down | ROHAN: "मैंने बैंक की नौकरी छोड़ दी… मुझे कठपुतली दिखानी हैं।" (I quit my bank job... I want to do puppet shows.) |
| 5-04 | MED | Around ROHAN, tiny puppets of a bride and a groom sway on strings | - |
| 5-05 | CU | KAVYA, softening | KAVYA: "तन्वी को सब पता था, है ना?" (Tanvi knew everything, didn't she?) |
| 5-06 | CU | ROHAN, small nod | ROHAN: "उसी ने कहा था, सच बोलकर लौट आना।" (She's the one who said, tell the truth and come back.) |
| 5-07 | WIDE | A tempo races through the lit-up city at dusk with ROHAN in the middle, KAVYA and JUGNU squashed on either side | - |
| 5-08 | WIDE | GULMOHAR LAWN at dusk, guests and dhol; PAPPU spots them and drops onto a cushion | PAPPU: "वो आ गया! दूल्हा आ गया!" (He's here! The groom is here!) |
| 5-09 | MED | ROHAN knocks on the bride's door, KAVYA and JUGNU just behind | ROHAN: "तन्वी, मैं आ गया हूँ। दरवाज़ा खोलो!" (Tanvi, I've come. Open the door!) |
| 5-10 | WIDE | The door opens on an empty room: open window, red dupatta tied to the balcony rail, curtains flapping | - |
| 5-11 | TWO | KAVYA and JUGNU look at each other, then at the empty room | KAVYA: "फिर से चौबीस घंटे?" (Another twenty-four hours?) |
| 5-12 | WIDE | A taxi races through neon city streets; TANVI in the back seat smiles at the camera, phone in hand; end card "सीज़न 1 जारी है…" | TANVI (VO): "माफ़ करना, मुझे भी अपना सपना ढूँढना है।" (Sorry, I have to find my dream too.) |
