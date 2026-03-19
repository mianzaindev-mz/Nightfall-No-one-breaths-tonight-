// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Blackwell Manor (Season 2 Map System)
// 26 rooms across 3 floors with adjacency tracking,
// Servant's Passage cross-floor bridge, and sound propagation.
// ═══════════════════════════════════════════════════════════════

// ── FLOOR DEFINITIONS ────────────────────────────────────────
const FLOORS = {
  1: { name: 'Ground Floor', icon: '🏛', color: '#8d6e63' },
  2: { name: 'Upper Floor',  icon: '🪟', color: '#5c6bc0' },
  3: { name: 'Attic & Cellar', icon: '🕯', color: '#6d4c41' },
};

// ── ROOM DEFINITIONS ─────────────────────────────────────────
// Each room: id, name, floor, icon, description, isPassage (special)
const ROOMS = [
  // ═══ GROUND FLOOR (Floor 1) — 10 rooms ═══
  { id: 'foyer',       name: 'Grand Foyer',       floor: 1, icon: '🚪', desc: 'The central entrance hall. A chandelier sways overhead.', ambiance: 'A cold draft sweeps through the entrance.', killFlavor: ['A bloodstain was found near the chandelier chain.', 'The foyer carpet is soaked in something dark.', 'Scratch marks lead from the front door inward.'] },
  { id: 'parlor',      name: 'Drawing Parlor',    floor: 1, icon: '🛋', desc: 'Velvet chairs circle a cold fireplace. Portraits watch.', ambiance: 'The fireplace crackles softly.', killFlavor: ['A velvet cushion was used to muffle the struggle.', 'Blood was found on the fireplace poker.'] },
  { id: 'dining',      name: 'Dining Hall',       floor: 1, icon: '🍽', desc: 'A long table set for a feast that never came.', ambiance: 'Candles flicker along the table.', killFlavor: ['A steak knife is missing from the place setting.', 'Wine glass shattered — blood mixed with red wine.'] },
  { id: 'kitchen',     name: 'Kitchen',           floor: 1, icon: '🍳', desc: 'Copper pots hang from the ceiling. Something boils.', ambiance: 'Steam rises from something on the stove.', killFlavor: ['A knife is missing from the block.', 'Blood was found near the cutting board.', 'The pantry door was forced open.'] },
  { id: 'library',     name: 'Library',           floor: 1, icon: '📚', desc: 'Thousands of books. Some shelves have been disturbed.', ambiance: 'Pages rustle in an unseen wind.', killFlavor: ['A heavy book was used as a blunt weapon.', 'Someone was crushed between the sliding shelves.'] },
  { id: 'study',       name: 'Study',             floor: 1, icon: '🖋', desc: 'A desk covered in letters. The ink is still wet.', ambiance: 'A quill pen rolls across the desk.', killFlavor: ['The letter opener is stained red.', 'A desk drawer was forced open during a struggle.'] },
  { id: 'ballroom',    name: 'Ballroom',          floor: 1, icon: '💃', desc: 'Marble floors reflect the moonlight. Music echoes.', ambiance: 'Faint waltz music echoes from nowhere.', killFlavor: ['Drag marks cross the marble floor.', 'A broken mirror shard was used as a weapon.'] },
  { id: 'conserv',     name: 'Conservatory',      floor: 1, icon: '🌿', desc: 'Glass walls reveal an overgrown garden. Humid.', ambiance: 'Tropical humidity fogs the glass.', killFlavor: ['Vine clippings were used to restrain the victim.', 'A heavy flower pot was shattered over someone.'] },
  { id: 'servants_q',  name: 'Servants\' Quarters', floor: 1, icon: '🛏', desc: 'Narrow beds in a row. A candle still burns.', ambiance: 'A single candle light flickers.', killFlavor: ['A pillow was used to smother the victim.', 'The bedframe shows signs of a violent struggle.'] },
  { id: 'passage_g',   name: 'Servant\'s Passage', floor: 1, icon: '🚶', desc: 'A hidden corridor behind the walls.', ambiance: 'Hollow echoes from every direction.', isPassage: true, killFlavor: ['Blood trails along the hidden corridor walls.'] },

  // ═══ UPPER FLOOR (Floor 2) — 9 rooms ═══
  { id: 'master_bed',  name: 'Master Bedroom',    floor: 2, icon: '🛏', desc: 'A four-poster bed draped in crimson. Locked from inside.', ambiance: 'Silk curtains billow in absolute silence.', killFlavor: ['The bedsheets are soaked in blood.', 'A heavy candlestick was the murder weapon.'] },
  { id: 'guest_bed',   name: 'Guest Bedroom',     floor: 2, icon: '🛌', desc: 'Two twin beds. One has been slept in recently.', ambiance: 'An unmade bed still holds warmth.', killFlavor: ['The guest was strangled with a curtain cord.', 'Under the bed — signs of a body being dragged.'] },
  { id: 'nursery',     name: 'Nursery',           floor: 2, icon: '🧸', desc: 'Old toys scattered about. A music box plays softly.', ambiance: 'A music box plays a haunting tune.', killFlavor: ['A wooden toy train was used as a blunt weapon.', 'The rocking horse is spattered with blood.'] },
  { id: 'gallery',     name: 'Portrait Gallery',  floor: 2, icon: '🖼', desc: 'Family portraits line the walls. Eyes seem to follow.', ambiance: 'Painted eyes follow your every step.', killFlavor: ['A portrait frame was smashed over the victim.', 'The gallery rope was used as a garotte.'] },
  { id: 'bathroom',    name: 'Grand Bathroom',    floor: 2, icon: '🛁', desc: 'A clawfoot tub. The faucet drips steadily.', ambiance: 'Water drips with metronomic precision.', killFlavor: ['The victim was drowned in the bathtub.', 'A razor blade found on the bathroom floor.'] },
  { id: 'balcony',     name: 'Balcony',           floor: 2, icon: '🌙', desc: 'Overlooks the dark garden. Cold wind howls.', ambiance: 'Wind howls through the iron railing.', killFlavor: ['The victim was pushed over the railing.', 'Scratches on the railing from desperate fingers.'] },
  { id: 'sewing',      name: 'Sewing Room',       floor: 2, icon: '🧵', desc: 'Threads and needles everywhere. A mannequin stands.', ambiance: 'Needles glint in faint light.', killFlavor: ['Large scissors were the weapon.', 'Thread was used to bind the victim.'] },
  { id: 'passage_u',   name: 'Upper Passage',     floor: 2, icon: '🚶', desc: 'A narrow stairway hidden behind a bookshelf.', ambiance: 'Creaking stairs in total darkness.', isPassage: true, killFlavor: ['The victim was pushed down the hidden stairs.'] },
  { id: 'hall_upper',  name: 'Upper Hallway',     floor: 2, icon: '🏛', desc: 'A long corridor with flickering sconces.', ambiance: 'Sconces cast dancing shadows.', killFlavor: ['A wall sconce was torn free and used to strike.', 'The carpet runner shows drag marks.'] },

  // ═══ ATTIC & CELLAR (Floor 3) — 7 rooms ═══
  { id: 'attic',       name: 'Attic',             floor: 3, icon: '🕸', desc: 'Dusty trunks and cobwebs. Something scuttles in the dark.', ambiance: 'Floorboards groan underfoot.', killFlavor: ['A heavy trunk was dropped on the victim.', 'Cobwebs are torn where a struggle occurred.'] },
  { id: 'tower',       name: 'Clock Tower',       floor: 3, icon: '🕰', desc: 'Gears grind. The clock has stopped at midnight.', ambiance: 'Gears grind in an ominous rhythm.', killFlavor: ['The victim was caught in the clock gears.', 'Blood on the tower bell rope.'] },
  { id: 'cellar',      name: 'Wine Cellar',       floor: 3, icon: '🍷', desc: 'Rows of bottles. Some are broken. Blood red stains.', ambiance: 'The scent of oak and iron fills the air.', killFlavor: ['A wine bottle was shattered over the victim.', 'The victim was locked in the wine cage.'] },
  { id: 'dungeon',     name: 'Old Dungeon',       floor: 3, icon: '⛓', desc: 'Chains on the walls. This room hasn\'t been used in years.', ambiance: 'Chains rattle in the damp cold.', killFlavor: ['The victim was chained to the wall.', 'An old iron maiden was used.'] },
  { id: 'crypt',       name: 'Family Crypt',      floor: 3, icon: '⚰', desc: 'Stone coffins line the walls. Names are scratched out.', ambiance: 'The air is impossibly cold.', killFlavor: ['A coffin lid was used to crush the victim.', 'The victim was sealed inside a stone coffin.'] },
  { id: 'boiler',      name: 'Boiler Room',       floor: 3, icon: '🔥', desc: 'Pipes hiss and groan. Uncomfortably warm.', ambiance: 'Pipes hiss with scalding steam.', killFlavor: ['A steam pipe was turned on the victim.', 'The boiler door was opened — burns everywhere.'] },
  { id: 'passage_c',   name: 'Cellar Passage',    floor: 3, icon: '🚶', desc: 'A damp tunnel connecting to the servant corridors.', ambiance: 'Water drips in the darkness.', isPassage: true, killFlavor: ['The victim was ambushed in the narrow passage.'] },
];

// ── ADJACENCY MAP ────────────────────────────────────────────
// Keys = room ID, Values = array of connected room IDs
// Same-floor adjacency + Servant's Passage cross-floor bridges
const ADJACENCY = {
  // Ground Floor
  foyer:      ['parlor', 'dining', 'library', 'ballroom', 'passage_g'],
  parlor:     ['foyer', 'study', 'dining'],
  dining:     ['foyer', 'parlor', 'kitchen'],
  kitchen:    ['dining', 'servants_q', 'passage_g'],
  library:    ['foyer', 'study', 'conserv'],
  study:      ['parlor', 'library'],
  ballroom:   ['foyer', 'conserv'],
  conserv:    ['library', 'ballroom'],
  servants_q: ['kitchen', 'passage_g'],
  passage_g:  ['foyer', 'kitchen', 'servants_q', 'passage_u', 'passage_c'], // CROSS-FLOOR

  // Upper Floor
  master_bed: ['hall_upper', 'bathroom', 'balcony'],
  guest_bed:  ['hall_upper', 'nursery'],
  nursery:    ['guest_bed', 'sewing'],
  gallery:    ['hall_upper', 'sewing'],
  bathroom:   ['master_bed'],
  balcony:    ['master_bed'],
  sewing:     ['nursery', 'gallery'],
  passage_u:  ['hall_upper', 'passage_g', 'passage_c'], // CROSS-FLOOR
  hall_upper: ['master_bed', 'guest_bed', 'gallery', 'passage_u'],

  // Attic & Cellar
  attic:      ['tower'],
  tower:      ['attic'],
  cellar:     ['dungeon', 'passage_c'],
  dungeon:    ['cellar', 'crypt'],
  crypt:      ['dungeon'],
  boiler:     ['passage_c'],
  passage_c:  ['cellar', 'boiler', 'passage_g', 'passage_u'], // CROSS-FLOOR
};

// ── ROOM LOOKUP ──────────────────────────────────────────────
const ROOM_MAP = new Map();
ROOMS.forEach(r => ROOM_MAP.set(r.id, r));

// ═══════════════════════════════════════════════════════════════
// MANOR CLASS — Public API
// ═══════════════════════════════════════════════════════════════
export default class Manor {
  constructor() {
    this.rooms = ROOMS;
    this.adjacency = ADJACENCY;
    this.floors = FLOORS;
    this.playerLocations = new Map(); // playerId -> roomId
  }

  // ── Get room by ID ─────────────────────────────────────────
  getRoom(id) {
    return ROOM_MAP.get(id) || null;
  }

  // ── Get all rooms on a given floor ─────────────────────────
  getRoomsByFloor(floor) {
    return ROOMS.filter(r => r.floor === floor);
  }

  // ── Get adjacent rooms from a given room ───────────────────
  getAdjacentRooms(roomId) {
    const adj = ADJACENCY[roomId];
    if (!adj) return [];
    return adj.map(id => ROOM_MAP.get(id)).filter(Boolean);
  }

  // ── Check if two rooms are adjacent ────────────────────────
  areAdjacent(roomA, roomB) {
    return (ADJACENCY[roomA] || []).includes(roomB);
  }

  // ── Check if two rooms are on the same floor ───────────────
  sameFloor(roomA, roomB) {
    const a = ROOM_MAP.get(roomA);
    const b = ROOM_MAP.get(roomB);
    return a && b && a.floor === b.floor;
  }

  // ── Sound propagation: who can hear what ───────────────────
  // Returns list of room IDs that can "hear" activity in sourceRoom.
  // Rule: same-floor adjacency only. Passage rooms bridge ALL 3 floors.
  getSoundRange(sourceRoom) {
    const source = ROOM_MAP.get(sourceRoom);
    if (!source) return [];
    const adj = ADJACENCY[sourceRoom] || [];
    return adj.filter(id => {
      const r = ROOM_MAP.get(id);
      if (!r) return false;
      // Passage rooms always propagate sound across floors
      if (source.isPassage || r.isPassage) return true;
      // Normal rooms: same floor only
      return r.floor === source.floor;
    });
  }

  // ── Assign players to random rooms ─────────────────────────
  // Distributes N players across unique rooms (no 2 players in same room).
  // Returns Map<playerId, roomId>
  assignLocations(playerIds) {
    const available = ROOMS.filter(r => !r.isPassage); // don't spawn in passages
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    this.playerLocations.clear();

    playerIds.forEach((pid, i) => {
      const room = shuffled[i % shuffled.length]; // wraparound if enormous lobby
      this.playerLocations.set(pid, room.id);
    });

    return new Map(this.playerLocations);
  }

  // ── Get a player's current room ────────────────────────────
  getPlayerRoom(playerId) {
    const roomId = this.playerLocations.get(playerId);
    return roomId ? ROOM_MAP.get(roomId) : null;
  }

  // ── Get all players in a specific room ─────────────────────
  getPlayersInRoom(roomId) {
    const result = [];
    this.playerLocations.forEach((rid, pid) => {
      if (rid === roomId) result.push(pid);
    });
    return result;
  }

  // ── Get players in adjacent rooms (witnesses) ──────────────
  getNearbyPlayers(roomId) {
    const adj = ADJACENCY[roomId] || [];
    const nearby = [];
    adj.forEach(adjRoom => {
      this.playerLocations.forEach((rid, pid) => {
        if (rid === adjRoom) nearby.push({ playerId: pid, roomId: adjRoom });
      });
    });
    return nearby;
  }

  // ── Get floor info for a room ──────────────────────────────
  getFloorInfo(roomId) {
    const room = ROOM_MAP.get(roomId);
    return room ? FLOORS[room.floor] : null;
  }

  // ── Generate location summary for UI ───────────────────────
  // Returns a display-friendly object for the location overlay
  getLocationDisplay(playerId) {
    const roomId = this.playerLocations.get(playerId);
    if (!roomId) return null;
    const room = ROOM_MAP.get(roomId);
    if (!room) return null;
    const floor = FLOORS[room.floor];
    const adj = this.getAdjacentRooms(roomId);
    return {
      roomId: room.id,
      roomName: room.name,
      roomIcon: room.icon,
      roomDesc: room.desc,
      floorName: floor.name,
      floorIcon: floor.icon,
      floorNumber: room.floor,
      adjacentRooms: adj.map(r => ({ id: r.id, name: r.name, icon: r.icon })),
      isPassage: !!room.isPassage,
    };
  }

  // ── Static: get all room data for map rendering ────────────
  static getAllRooms() { return [...ROOMS]; }
  static getFloors() { return { ...FLOORS }; }
  static getRoomCount() { return ROOMS.length; }
}
