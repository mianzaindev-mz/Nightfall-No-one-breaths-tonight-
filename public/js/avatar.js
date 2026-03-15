// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Avatar / Character Generator
// 48 personas, 12 trait categories, false evidence system
// ═══════════════════════════════════════════════════════════════

// ── 48 PERSONA NAMES ─────────────────────────────────────────
const PERSONA_NAMES = [
  { name: 'The Rose',        icon: '🌹' }, { name: 'The Raven',       icon: '🐦‍⬛' },
  { name: 'The Clockmaker',  icon: '⏱' },  { name: 'The Alchemist',   icon: '⚗' },
  { name: 'The Lantern',     icon: '🏮' }, { name: 'The Phantom',     icon: '👻' },
  { name: 'The Serpent',     icon: '🐍' }, { name: 'The Moth',        icon: '🦋' },
  { name: 'The Bell',        icon: '🔔' }, { name: 'The Thorn',       icon: '🌿' },
  { name: 'The Mirror',      icon: '🪞' }, { name: 'The Ink',         icon: '🖋' },
  { name: 'The Ember',       icon: '🔥' }, { name: 'The Mask',        icon: '🎭' },
  { name: 'The Key',         icon: '🗝' },  { name: 'The Owl',         icon: '🦉' },
  { name: 'The Pearl',       icon: '🦪' }, { name: 'The Crow',        icon: '🪶' },
  { name: 'The Frost',       icon: '❄' },  { name: 'The Shadow',      icon: '🌑' },
  { name: 'The Willow',      icon: '🌳' }, { name: 'The Spider',      icon: '🕷' },
  { name: 'The Compass',     icon: '🧭' }, { name: 'The Storm',       icon: '⛈' },
  { name: 'The Viper',       icon: '🐉' }, { name: 'The Chalice',     icon: '🏆' },
  { name: 'The Dagger',      icon: '🗡' },  { name: 'The Candle',      icon: '🕯' },
  { name: 'The Scarecrow',   icon: '🧟' }, { name: 'The Whisper',     icon: '💨' },
  { name: 'The Bone',        icon: '🦴' }, { name: 'The Eclipse',     icon: '🌘' },
  { name: 'The Anchor',      icon: '⚓' }, { name: 'The Orchid',      icon: '🌺' },
  { name: 'The Coin',        icon: '🪙' }, { name: 'The Hound',       icon: '🐕' },
  { name: 'The Gargoyle',    icon: '🗿' }, { name: 'The Vine',        icon: '🍇' },
  { name: 'The Hourglass',   icon: '⏳' }, { name: 'The Wolf',        icon: '🐺' },
  { name: 'The Jewel',       icon: '💎' }, { name: 'The Crypt',       icon: '⚰' },
  { name: 'The Quill',       icon: '✒' },  { name: 'The Iris',        icon: '👁' },
  { name: 'The Thistle',     icon: '🌾' }, { name: 'The Rook',        icon: '♜' },
  { name: 'The Coral',       icon: '🪸' }, { name: 'The Sundial',     icon: '☀' },
  { name: 'The Ash',         icon: '🌫' }, { name: 'The Siren',       icon: '🧜' },
];

// ── PUBLIC TRAIT POOLS ───────────────────────────────────────
const HAIR_STYLE = [
  'Curly and wild', 'Sleek and straight', 'Tightly braided', 'Slicked back with pomade',
  'Shaved close to the scalp', 'Long and wavy', 'Messy bun', 'Thick dreadlocks',
  'Cropped military-short', 'Neatly parted to one side', 'Windswept and tangled',
  'Loose ponytail with loose strands', 'Tangled and unkempt', 'Pinned up with silver clips',
  'Hidden under a dark hood', 'Flowing well past shoulders', 'Twisted ornate updo',
  'Buzzed on one side, long on other', 'Thick tightly coiled curls', 'Choppy pixie-cut',
  'Feathered layered style', 'Two long braids', 'Cornrows with gold beads',
  'Afro natural and voluminous', 'Wet-look slicked forward', 'Half-up half-down with ribbon',
  'Finger waves pressed tight', 'Shaggy surfer-style', 'Crown braid around the head',
];

const HAIR_COLOR = [
  'Jet black', 'Silver-grey', 'Auburn', 'Platinum blonde', 'Dark brown',
  'Copper red', 'Ash blonde', 'Midnight blue-black', 'Strawberry blonde',
  'Deep chestnut', 'Snow white', 'Honey gold', 'Raven black with grey streaks',
  'Dusty rose pink', 'Salt-and-pepper', 'Russet brown', 'Ink-dark purple-black',
  'Fiery orange-red', 'Mousy light brown', 'Charcoal with silver streaks',
  'Burgundy wine', 'Sun-bleached sandy', 'Mahogany', 'Ginger with freckle-match',
  'Obsidian black, almost blue', 'Tawny caramel',
];

const OUTFIT = [
  'Long dark overcoat with brass buttons', 'Red silk evening dress', 'Torn leather biker jacket',
  'White linen three-piece suit', 'Hooded velvet cloak, moth-eaten', 'Grey cable-knit wool sweater',
  'Black turtleneck, skintight', 'Embroidered waistcoat with gold thread', 'Flowing kimono-style robe',
  'Patched denim jacket with pins', 'Sharply tailored navy blazer', 'Stained butcher\'s apron over shirt',
  'Fur-trimmed cape, blood-red lining', 'Striped Breton sailor shirt', 'Military peacoat, epaulets torn',
  'Silk pajamas, monogrammed', 'Oversized trench coat, collar popped', 'Corset and ruffled blouse',
  'Old tweed hunting suit', 'Long leather duster, trail-worn', 'Layered shawls over a thin dress',
  'Pinstripe three-button vest', 'Nurse\'s uniform, slightly yellowed', 'Priest\'s cassock, frayed hem',
  'Tuxedo with a crooked bowtie', 'Faded floral housedress', 'Mechanic\'s jumpsuit, oil-stained',
  'Sequined cocktail dress', 'Moth-bitten fur coat', 'Rain-soaked canvas poncho',
];

const OUTFIT_COLOR = [
  'Midnight blue', 'Crimson', 'Charcoal grey', 'Forest green', 'Ivory',
  'Deep purple', 'Burnt sienna', 'Slate black', 'Burgundy wine', 'Olive drab',
  'Rose pink', 'Dusty lavender', 'Oxblood', 'Teal', 'Sand beige',
  'Copper-brown', 'Ink indigo', 'Moss green', 'Amber gold', 'Pearl white',
  'Charcoal and cream pinstripe', 'Faded navy', 'Rust orange', 'Bone white',
  'Blood-red', 'Smoke grey',
];

const SHOES = [
  'Tall black riding boots', 'Red stiletto heels, scuffed', 'Worn leather sandals, rope-tied',
  'Polished oxford shoes, mirror shine', 'Completely barefoot', 'Silver-buckled ankle boots',
  'Mud-caked heavy work boots', 'Velvet embroidered slippers', 'Towering platform shoes',
  'Laced-up cavalry riding boots', 'Pointed crocodile-skin stilettos', 'Canvas high-top sneakers',
  'Wooden Dutch clogs', 'Fur-lined moccasins', 'Steel-toed industrial boots',
  'Flat embroidered ballet shoes', 'Knee-high dark suede boots', 'Woven rope espadrilles',
  'Patent leather penny loafers', 'Gladiator sandals with bronze clasps', 'Cracked old cowboy boots',
  'Chunky combat boots with chains', 'Silk house slippers', 'Rain-soaked galoshes',
  'Hiking boots with red laces', 'Nurse\'s white rubber-soled shoes',
];

const ACCESSORY = [
  'Gold pocket watch on a chain', 'Silver locket with a portrait inside', 'Wide-brim feathered hat',
  'Round tortoiseshell spectacles', 'Embroidered silk scarf, bloodstain on edge',
  'Black leather gloves, tight-fitting', 'Beaded wooden bracelet', 'Ornate walking cane, silver tip',
  'Heavy jeweled signet ring', 'Pearl drop earrings', 'Copper brooch shaped like a moth',
  'Worn leather messenger satchel', 'Tattered lace parasol', 'Bone-handled folding fan',
  'Thick gold chain with an emerald pendant', 'Brass monocle on a cord', 'Fingerless knit gloves',
  'Ruby-studded hairpin', 'Brass compass on a leather cord', 'Ivory cameo pin at the throat',
  'Black velvet choker with a stone', 'Wrist-wrapped bandages, fresh', 'Reading glasses on a beaded chain',
  'Pocket square, monogrammed', 'Rosary beads around the wrist', 'Leather tool belt, mostly empty',
  'Fox-fur stole around the neck', 'Tarnished military dog tags',
];

// ── HIDDEN TRAIT POOLS ───────────────────────────────────────
const PERFUME = [
  'Sandalwood and musk', 'Wild lavender', 'Stale tobacco smoke', 'Fresh rain on hot soil',
  'Burnt caramel sugar', 'Old cedarwood chest', 'Worn saddle leather', 'Night-blooming jasmine',
  'Wet rusted iron', 'Cloves and crushed cinnamon', 'Salt air and seaweed', 'Bitter almonds',
  'Pine resin and tree sap', 'Dried funeral roses', 'Industrial machine oil', 'Dark patchouli',
  'Sweet rot and decay', 'Warm honey and beeswax', 'Black gunpowder', 'Smoked bourbon vanilla',
  'Antiseptic hospital smell', 'Camphor and menthol', 'Fresh-cut hay', 'Overripe fruit',
  'Wet dog and mud', 'Formaldehyde, faint',
];

const MARK = [
  'Deep scar across left cheek', 'Permanently ink-stained fingertips', 'Calloused sandpaper-rough hands',
  'Missing ring finger on left hand', 'Old burn mark circling the wrist', 'Chipped front tooth, visible when smiling',
  'Faded neck tattoo, words illegible', 'Crooked nose, clearly broken before', 'Ghostly pale, almost translucent skin',
  'Dense freckles across nose and cheeks', 'Hollow deep-set dark circles', 'Bitten-down bloody nails',
  'Split lip, recently scabbed over', 'Nicotine-yellow stained fingers', 'Small beauty mole above the lip',
  'Parallel scratch marks on forearm', 'Cauliflower ear, badly disfigured', 'Pronounced dimpled chin',
  'Unusually long spider-like fingers', 'Deeply weathered sun-damaged skin', 'Vitiligo patches on hands',
  'Fresh bruise on the jawline', 'Needle-track scars on inner arm', 'Glass eye, slightly off-color',
  'Birthmark shaped like a crescent on neck', 'Webbed toes',
];

const WALK_STYLE = [
  'Light-footed, almost silent', 'Heavy deliberate stomps that echo', 'Pronounced limp on right side',
  'Glides like a shadow, no sound', 'Brisk nervous shuffle, head down', 'Confident wide powerful strides',
  'Painfully slow, measured pace', 'Hurried hunched-over scurry', 'Graceful, poised, dancer-like',
  'Uneven lurching gait', 'Swaying gently side to side', 'Tiptoes constantly, never flat-footed',
  'Drags left foot with a scrape', 'Military-precise rigid march', 'Lazy slouching amble',
  'Quick darting movements, like a rodent', 'Bouncy energetic childlike step', 'Cautious heel-to-toe creep',
  'Wide bowlegged waddle', 'Pigeon-toed inward step',
];

const VOICE = [
  'Deep gravelly bass', 'Hoarse whispered rasp', 'Sharp clipped accent', 'Warm honeyed alto',
  'High-pitched and breathy', 'Flat affect monotone', 'Commanding booming baritone',
  'Soft-spoken barely audible mumble', 'Foreign-accented and melodic', 'Dry croaking rasp',
  'Thunderously loud by default', 'Silky smooth radio voice', 'Nervous stuttering hesitation',
  'Nasal whiny complaint', 'Lilting singsongy cadence', 'Cold surgically precise diction',
  'Hoarse from constant screaming', 'Whisper so quiet you lean in', 'Lisping with every sibilant',
  'Thick rural drawl',
];

const HABIT = [
  'Fidgets with a ring, spinning it', 'Cracks knuckles loudly', 'Taps fingers in rhythmic patterns',
  'Hums an eerie lullaby under breath', 'Bites lower lip until it bleeds', 'Adjusts collar every few seconds',
  'Picks at torn cuticles', 'Twirls a strand of hair obsessively', 'Clenches jaw when nervous, visibly',
  'Rubs palms together as if washing', 'Avoids all eye contact, looks at floor', 'Stares without blinking, unsettling',
  'Touches old scar absently, ritually', 'Paces in tight circles when stressed', 'Crosses arms defensively, chin tucked',
  'Drums fingers on every surface', 'Smells the air before entering a room', 'Whistles the same five notes tunelessly',
  'Counts things under breath — doors, steps, tiles', 'Folds and unfolds hands, wringing',
  'Chews on a toothpick', 'Snaps fingers when thinking', 'Mutters to themselves constantly',
  'Blinks rapidly when lying',
];

const SECRET_ITEM = [
  'Bloodied handkerchief, stuffed in pocket', 'Vial of unidentified amber liquid', 'Torn love letter, half-burned',
  'Rusted skeleton key to an unknown lock', 'Lock of someone else\'s hair, tied with ribbon',
  'Cracked compass that points south', 'Faded photograph of a stranger', 'Sharpened animal bone fragment',
  'Coil of thin piano wire', 'Stained playing card — Ace of Spades', 'Stolen ruby, uncut',
  'Coded note on parchment, unsolved', 'Small folding knife, recently cleaned',
  'Bottle of crushed sleeping powder', 'Broken pocket mirror, cracked in half',
  'Bundle of dried nightshade herbs', 'Wax-sealed envelope, never opened', 'Small jar of teeth, origin unknown',
  'Glass prosthetic eye', 'Single black leather glove, left hand', 'Death certificate, name scratched out',
  'Syringe, empty but stained', 'Locket containing a tiny key', 'Map of the house with an X marked',
  'Ticket stub to a funeral',
];

// ── ALL POOLS ────────────────────────────────────────────────
const PUBLIC_POOLS = {
  hairStyle:    { label: '💇 Hair Style',  pool: HAIR_STYLE },
  hairColor:    { label: '🎨 Hair Color',  pool: HAIR_COLOR },
  outfit:       { label: '👔 Outfit',      pool: OUTFIT },
  outfitColor:  { label: '🎨 Outfit Color',pool: OUTFIT_COLOR },
  shoes:        { label: '👟 Shoes',       pool: SHOES },
  accessory:    { label: '💍 Accessory',   pool: ACCESSORY },
};

const HIDDEN_POOLS = {
  perfume:      { label: '🌸 Scent',      pool: PERFUME },
  mark:         { label: '🔖 Mark',       pool: MARK },
  walkStyle:    { label: '🚶 Walk',       pool: WALK_STYLE },
  voice:        { label: '🗣 Voice',      pool: VOICE },
  habit:        { label: '🤏 Habit',      pool: HABIT },
  secretItem:   { label: '🔒 Secret Item',pool: SECRET_ITEM },
};

// ── Utility: pick random unique ──────────────────────────────
function pickUnique(pool, usedSet) {
  const avail = pool.filter(v => !usedSet.has(v));
  if (!avail.length) return pool[Math.floor(Math.random() * pool.length)];
  const picked = avail[Math.floor(Math.random() * avail.length)];
  usedSet.add(picked);
  return picked;
}

function generateCharacter(usedTraits) {
  const pub = {};
  for (const [key, { pool }] of Object.entries(PUBLIC_POOLS)) pub[key] = pickUnique(pool, usedTraits);
  const hidden = {};
  for (const [key, { pool }] of Object.entries(HIDDEN_POOLS)) hidden[key] = pickUnique(pool, usedTraits);
  return { pub, hidden };
}

export function assignCharacters(playerIds) {
  const shuffled = [...PERSONA_NAMES].sort(() => Math.random() - 0.5);
  const personas = new Map();
  const characters = new Map();
  const usedTraits = new Set();
  playerIds.forEach((id, i) => {
    personas.set(id, shuffled[i % shuffled.length]);
    characters.set(id, generateCharacter(usedTraits));
  });
  return { personas, characters };
}

// ── Description Formatters ───────────────────────────────────
export function getPublicDesc(character) {
  const p = character.pub;
  return Object.entries(PUBLIC_POOLS).map(([key, { label }]) => ({ label, value: p[key] }));
}

export function getHiddenDesc(character) {
  const h = character.hidden;
  return Object.entries(HIDDEN_POOLS).map(([key, { label }]) => ({ label, value: h[key] }));
}

// ── Trait Clue Generators ────────────────────────────────────
export function getPublicTraitClue(character) {
  const p = character.pub;
  const options = [
    `someone wearing ${p.outfit.toLowerCase()}`,
    `someone with ${p.hairStyle.toLowerCase()} ${p.hairColor.toLowerCase()} hair`,
    `someone in ${p.shoes.toLowerCase()}`,
    `someone carrying ${p.accessory.toLowerCase()}`,
    `someone dressed in ${p.outfitColor.toLowerCase()}`,
  ];
  return options[Math.floor(Math.random() * options.length)];
}

export function getHiddenTraitClue(character) {
  const h = character.hidden;
  const options = [
    `the lingering scent of ${h.perfume.toLowerCase()} at the scene`,
    `footprints suggesting ${h.walkStyle.toLowerCase().replace(/,.*/, '')}`,
    `a witness heard ${h.voice.toLowerCase()} nearby`,
    `the attacker was ${h.habit.toLowerCase()}`,
    `found near the body: ${h.secretItem.toLowerCase()}`,
    `the attacker had ${h.mark.toLowerCase()}`,
  ];
  return options[Math.floor(Math.random() * options.length)];
}

// ── FALSE EVIDENCE GENERATOR ─────────────────────────────────
// When accuracy is very low, generate a clue pointing to a RANDOM
// player instead of the actual suspect. This is misleading evidence.
export function getFalsePublicTraitClue(allCharacters, excludeId) {
  const ids = [...allCharacters.keys()].filter(id => id !== excludeId);
  if (!ids.length) return getPublicTraitClue(allCharacters.values().next().value);
  const randomId = ids[Math.floor(Math.random() * ids.length)];
  return getPublicTraitClue(allCharacters.get(randomId));
}

export function getFalseHiddenTraitClue(allCharacters, excludeId) {
  const ids = [...allCharacters.keys()].filter(id => id !== excludeId);
  if (!ids.length) return getHiddenTraitClue(allCharacters.values().next().value);
  const randomId = ids[Math.floor(Math.random() * ids.length)];
  return getHiddenTraitClue(allCharacters.get(randomId));
}

export function serializeForPlayer(personas, characters, playerId) {
  const data = {};
  personas.forEach((persona, id) => {
    data[id] = { persona, pub: characters.get(id).pub };
    if (id === playerId) data[id].hidden = characters.get(id).hidden;
  });
  return data;
}

export { PERSONA_NAMES, PUBLIC_POOLS, HIDDEN_POOLS };
