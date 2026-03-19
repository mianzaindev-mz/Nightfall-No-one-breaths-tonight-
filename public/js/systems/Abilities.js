// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Role Abilities System (Season 2)
// Every role has 2 special abilities (1 use per match each).
// Abilities that interact with game state require a QTE.
// ═══════════════════════════════════════════════════════════════

import { getPublicTraitClue } from '../avatar.js';

// ── ABILITY DEFINITIONS ──────────────────────────────────────
const ABILITY_DEFS = {
  killer: [
    {
      id: 'disguise',
      name: 'Disguise',
      icon: '🎭',
      desc: 'This night, detective investigation returns "Civilian" instead of your real role.',
      maxUses: 1,
      requiresQTE: false,
      phase: 'night',
    },
    {
      id: 'evidence_destroy',
      name: 'Evidence Destroy',
      icon: '🔥',
      desc: 'Select 1 evidence to destroy. Completely blind pick — you don\'t know which is yours.',
      maxUses: 1,
      requiresQTE: true,
      qteType: 'burn',
      phase: 'night',
      mutuallyExclusive: 'forge', // Can't forge AND destroy in same match
    },
  ],
  detective: [
    {
      id: 'wiretap',
      name: 'Wiretap',
      icon: '📡',
      desc: 'See 1 random message from the killer team chat. Message is anonymized.',
      maxUses: 1,
      requiresQTE: false,
      phase: 'night',
    },
    {
      id: 'cold_case',
      name: 'Cold Case Reopen',
      icon: '🧩',
      desc: 'Restore a decayed evidence piece\'s accuracy ceiling to 80%.',
      maxUses: 1,
      requiresQTE: true,
      qteType: 'jigsaw',
      phase: 'investigate',
    },
  ],
  doctor: [
    {
      id: 'autopsy',
      name: 'Autopsy',
      icon: '🔬',
      desc: 'Examine a dead player to learn up to 2 of their hidden traits.',
      maxUses: 1,
      requiresQTE: true,
      qteType: 'slider',
      phase: 'investigate',
    },
    {
      id: 'patrol',
      name: 'Hallway Patrol',
      icon: '🩺',
      desc: 'Patrol a hallway (2-3 adjacent rooms). Saves victim if they\'re on your route.',
      maxUses: 99, // Per-night action, unlimited
      requiresQTE: false,
      phase: 'night',
    },
  ],
  civilian: [
    {
      id: 'night_activity',
      name: 'Night Activity',
      icon: '🌙',
      desc: 'Choose: Listen (intel), Barricade (defense), or Pray (hint).',
      maxUses: 2,
      requiresQTE: true,
      phase: 'night',
    },
    {
      id: 'town_watch',
      name: 'Town Watch',
      icon: '🔭',
      desc: 'Count how many night actions occurred on your floor.',
      maxUses: 1,
      requiresQTE: true,
      qteType: 'spotlight',
      phase: 'investigate',
    },
  ],
  jester: [
    {
      id: 'crocodile_tears',
      name: 'Crocodile Tears',
      icon: '🐊',
      desc: 'Fake a "saved by doctor" announcement next morning.',
      maxUses: 1,
      requiresQTE: false,
      phase: 'night',
    },
  ],
};

export default class Abilities {
  /**
   * @param {import('../game.js').default} game
   */
  constructor(game) {
    this.g = game;
    this.charges = {};       // { playerId: { abilityId: usesRemaining } }
    this.activeEffects = {}; // { playerId: Set of active effect ids this round }
    this.lastPatrolRoom = {};// { playerId: roomId } — doctor can't patrol same hallway twice
    this.hasForged = {};     // { playerId: true } — tracks if killer has forged (mutual exclusion)
  }

  // ── Initialize charges for a player ────────────────────────
  initPlayer(playerId, role) {
    const defs = ABILITY_DEFS[role] || [];
    this.charges[playerId] = {};
    this.activeEffects[playerId] = new Set();
    defs.forEach(d => {
      this.charges[playerId][d.id] = d.maxUses;
    });
  }

  // ── Initialize all players (call after role assignment) ────
  initAll() {
    this.g.players.forEach(p => {
      if (p.role) this.initPlayer(p.id, p.role);
    });
  }

  // ── Get ability definitions for a role ─────────────────────
  static getAbilities(role) {
    return ABILITY_DEFS[role] || [];
  }

  // ── Get remaining charges for a player's ability ───────────
  getCharges(playerId, abilityId) {
    return this.charges[playerId]?.[abilityId] ?? 0;
  }

  // ── Check if a player can use an ability ───────────────────
  canUse(playerId, abilityId) {
    const player = this.g.players.find(p => p.id === playerId);
    if (!player || !player.alive) return { allowed: false, reason: 'Dead players cannot use abilities' };

    const role = player.role;
    const defs = ABILITY_DEFS[role] || [];
    const def = defs.find(d => d.id === abilityId);
    if (!def) return { allowed: false, reason: 'Ability not available for your role' };

    const charges = this.getCharges(playerId, abilityId);
    if (charges <= 0) return { allowed: false, reason: `No charges remaining for ${def.name}` };

    // Mutual exclusion check (Evidence Destroy vs Forge)
    if (abilityId === 'evidence_destroy' && this.hasForged[playerId]) {
      return { allowed: false, reason: 'Cannot destroy evidence — you already forged this match' };
    }

    // Doctor patrol: can't patrol same hallway twice
    if (abilityId === 'patrol') {
      // This will be checked at use-time with the specific room
    }

    return { allowed: true, def };
  }

  // ── Use an ability (consume a charge) ──────────────────────
  useAbility(playerId, abilityId) {
    const check = this.canUse(playerId, abilityId);
    if (!check.allowed) return check;

    this.charges[playerId][abilityId]--;
    this.activeEffects[playerId].add(abilityId);
    return { allowed: true, def: check.def };
  }

  // ── Clear active effects (call at start of each round) ─────
  clearRoundEffects() {
    Object.keys(this.activeEffects).forEach(pid => {
      this.activeEffects[pid] = new Set();
    });
  }

  // ── Mark that a killer has forged (for mutual exclusion) ───
  markForged(playerId) {
    this.hasForged[playerId] = true;
  }

  // ═══════════════════════════════════════════════════════════
  // KILLER ABILITIES
  // ═══════════════════════════════════════════════════════════

  // ── Disguise: Returns true if killer is disguised this round
  isDisguised(playerId) {
    return this.activeEffects[playerId]?.has('disguise') || false;
  }

  // ── Evidence Destroy: Get a blind list of evidence for destruction
  getDestroyTargets() {
    // Killer sees evidence IDs and truncated text only — no metadata about
    // which are their forges. Completely blind.
    return this.g.evidenceLedger.map(e => ({
      id: e.id,
      preview: e.text.slice(0, 40) + (e.text.length > 40 ? '...' : ''),
    }));
  }

  // ── Evidence Destroy: Execute destruction after QTE
  destroyEvidence(evidenceId, qteSuccess) {
    if (qteSuccess) {
      // Remove evidence permanently
      const idx = this.g.evidenceLedger.findIndex(e => e.id === evidenceId);
      if (idx !== -1) {
        const removed = this.g.evidenceLedger.splice(idx, 1)[0];
        return { success: true, destroyed: removed.text.slice(0, 30) + '...' };
      }
      return { success: false, reason: 'Evidence not found' };
    } else {
      // QTE failed — evidence survives AND extra clue generated
      const myRoom = this.g.manor.getPlayerRoom(this.g.myId);
      const floorInfo = myRoom ? this.g.manor.getFloorInfo(myRoom.id) : null;
      const floorName = floorInfo ? floorInfo.name : 'an unknown area';
      return {
        success: false,
        extraClue: `🕯 Scorch marks found — someone tried to destroy evidence on the ${floorName}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DETECTIVE ABILITIES
  // ═══════════════════════════════════════════════════════════

  // ── Wiretap: Get a random anonymized killer message
  getWiretapMessage() {
    // Pull from killer chat log (stored on game state)
    const killerMessages = this.g.killerChatLog || [];
    if (!killerMessages.length) return { success: false, text: '📡 No killer communications intercepted.' };
    const msg = killerMessages[Math.floor(Math.random() * killerMessages.length)];
    return { success: true, text: `📡 Intercepted: "${msg.text}"` }; // Anonymized — no sender
  }

  // ── Cold Case: Get eligible evidence for restoration
  getColdCaseTargets() {
    return this.g.evidenceLedger
      .filter(e => {
        const age = this.g.round - e.round;
        const ceiling = this.g.evidence.getCeiling(e);
        return ceiling <= 70 && e.status !== 'destroyed';
      })
      .map(e => ({
        id: e.id,
        text: e.text.slice(0, 50) + (e.text.length > 50 ? '...' : ''),
        ceiling: this.g.evidence.getCeiling(e),
        age: this.g.round - e.round,
      }));
  }

  // ── Cold Case: Restore evidence ceiling after QTE
  restoreEvidence(evidenceId, qteSuccess) {
    if (!qteSuccess) return { success: false, text: '😞 The pieces don\'t fit. The evidence remains degraded.' };

    const ev = this.g.evidenceLedger.find(e => e.id === evidenceId);
    if (!ev) return { success: false, text: 'Evidence not found.' };

    // Restore by resetting the round so the effective age gives ~80% ceiling
    // Since ceiling at age 1 = 85%, we set round to (current - 1) to get ~85%
    ev.round = this.g.round - 1; // This gives 85% ceiling (closest to 80% without custom field)
    ev._coldCaseRestored = true;  // Flag for UI

    return { success: true, text: `🧩 Evidence reconstructed! Accuracy ceiling restored to ~85%.` };
  }

  // ═══════════════════════════════════════════════════════════
  // DOCTOR ABILITIES
  // ═══════════════════════════════════════════════════════════

  // ── Autopsy: Get eligible dead players
  getAutopsyTargets() {
    return this.g.players
      .filter(p => !p.alive && p.id !== this.g.myId)
      .map(p => ({ id: p.id, name: this.g._pname(p.id), avatar: p.avatar }));
  }

  // ── Autopsy: Examine body — QTE score determines trait count
  performAutopsy(targetId, qteScore) {
    const target = this.g.players.find(p => p.id === targetId);
    if (!target) return { success: false, text: 'Target not found.' };

    const character = this.g._hostCharacters?.get(targetId);
    if (!character?.hidden) return { success: false, text: 'No data found for this player.' };

    const hidden = character.hidden;
    const traitKeys = ['perfume', 'mark', 'walkStyle', 'voice', 'habit', 'secretItem'];
    const traitLabels = { perfume: 'Scent', mark: 'Mark', walkStyle: 'Gait', voice: 'Voice', habit: 'Habit', secretItem: 'Possession' };
    const shuffled = [...traitKeys].sort(() => Math.random() - 0.5);

    if (qteScore >= 0.7) {
      // Excellent: 2 hidden traits
      const traits = [
        { label: traitLabels[shuffled[0]], value: hidden[shuffled[0]] },
        { label: traitLabels[shuffled[1]], value: hidden[shuffled[1]] },
      ];
      return { success: true, traits, text: `🔬 Autopsy complete. Discovered: ${traits.map(t => `${t.label}: ${t.value}`).join(' • ')}` };
    } else if (qteScore >= 0.4) {
      // Partial: 1 hidden trait
      const traits = [{ label: traitLabels[shuffled[0]], value: hidden[shuffled[0]] }];
      return { success: true, traits, text: `🔬 Partial results. Found: ${traits[0].label}: ${traits[0].value}` };
    } else {
      // Failed: vague hint
      return { success: true, traits: [], text: `🔬 Inconclusive. Something about their ${traitLabels[shuffled[0]].toLowerCase()}...` };
    }
  }

  // ── Patrol: Set doctor's patrol hallway
  setPatrol(playerId, roomId) {
    // Can't patrol same hallway consecutively
    if (this.lastPatrolRoom[playerId] === roomId) {
      return { allowed: false, reason: 'Cannot patrol the same hallway twice in a row.' };
    }
    this.lastPatrolRoom[playerId] = roomId;
    const adjacent = this.g.manor.getAdjacentRooms(roomId);
    const patrolRoute = [roomId, ...adjacent.slice(0, 2).map(r => r.id)]; // 2-3 rooms
    return { allowed: true, route: patrolRoute };
  }

  // ── Patrol: Check if victim is on patrol route
  checkPatrolSave(patrolRoute, victimRoomId) {
    return patrolRoute.includes(victimRoomId);
  }

  // ═══════════════════════════════════════════════════════════
  // CIVILIAN ABILITIES
  // ═══════════════════════════════════════════════════════════

  // ── Listen: Check adjacent rooms for activity
  performListen(playerId, qteScore) {
    const roomId = this.g.manor.playerLocations.get(playerId);
    if (!roomId) return { success: false, text: 'Could not determine your location.' };

    if (qteScore < 0.3) return { success: false, text: '🫨 You shifted and the floorboard creaked. You couldn\'t hear clearly.' };

    const soundRange = this.g.manor.getSoundRange(roomId);
    const room = this.g.manor.getRoom(roomId);
    const results = [];

    // Check for kills in adjacent rooms
    if (this.g.nightActions) {
      Object.entries(this.g.nightActions).forEach(([killerId, victimId]) => {
        const victimRoom = this.g.manor.playerLocations.get(victimId);
        if (victimRoom && soundRange.includes(victimRoom)) {
          const vr = this.g.manor.getRoom(victimRoom);
          results.push(`🔊 You heard a violent struggle from the ${vr?.name || 'nearby room'}`);
        }
      });
    }

    if (results.length === 0) {
      return { success: true, text: `🔇 Silence surrounds the ${room?.name || 'your room'}` };
    }
    return { success: true, text: results.join('\n') };
  }

  // ── Barricade: Lock your room
  performBarricade(playerId, qteScore) {
    // QTE score determines block chance
    let blockChance;
    if (qteScore >= 0.8) blockChance = 0.40;     // Boosted
    else if (qteScore >= 0.5) blockChance = 0.30; // Standard
    else blockChance = 0.15;                       // Weak

    const room = this.g.manor.getPlayerRoom(playerId);
    const floorInfo = room ? this.g.manor.getFloorInfo(room.id) : null;

    return {
      success: true,
      blockChance,
      floorName: floorInfo?.name || 'Unknown Floor',
      text: `🚪 Barricade up. ${Math.round(blockChance * 100)}% block chance tonight.`,
    };
  }

  // ── Pray: Get a cryptic hint about the killer
  performPray(playerId, qteScore) {
    const killers = this.g.players.filter(p => p.alive && p.role === 'killer');
    if (!killers.length) return { success: false, text: '🙏 The spirits are silent.' };

    const killer = killers[Math.floor(Math.random() * killers.length)];
    const character = this.g._hostCharacters?.get(killer.id);
    if (!character) return { success: false, text: '🙏 The spirits are silent.' };

    // Accuracy based on QTE score
    let accuracy;
    if (qteScore >= 0.8) accuracy = 0.80;      // Boosted
    else if (qteScore >= 0.4) accuracy = 0.70;  // Standard
    else accuracy = 0.50;                        // Worse

    const isTruthful = Math.random() < accuracy;

    if (isTruthful) {
      const clue = getPublicTraitClue(character);
      const templates = [
        `The spirits whisper: the darkness wears ${clue}`,
        `A chill reveals: the killer's presence echoes with ${clue}`,
        `The candle flickers toward someone with ${clue}`,
      ];
      return { success: true, text: `🙏 ${templates[Math.floor(Math.random() * templates.length)]}`, accurate: true };
    } else {
      // Misleading hint — use a random non-killer character's trait
      const innocents = this.g.players.filter(p => p.alive && p.role !== 'killer');
      if (!innocents.length) return { success: true, text: '🙏 The spirits murmur incoherently...', accurate: false };
      const rando = innocents[Math.floor(Math.random() * innocents.length)];
      const randoChar = this.g._hostCharacters?.get(rando.id);
      if (!randoChar) return { success: true, text: '🙏 The spirits are confused...', accurate: false };
      const falseClue = getPublicTraitClue(randoChar);
      return { success: true, text: `🙏 The spirits whisper: something about ${falseClue}...`, accurate: false };
    }
  }

  // ── Town Watch: Count night actions on your floor
  performTownWatch(playerId, qteScore) {
    const room = this.g.manor.getPlayerRoom(playerId);
    if (!room) return { success: false, text: 'Could not determine your location.' };

    const floor = room.floor;
    const floorInfo = this.g.manor.floors[floor];

    // Count all night actions on this floor (kills, investigations, barricades, patrols)
    let actionCount = 0;
    // Count kills on this floor
    if (this.g.nightActions) {
      Object.values(this.g.nightActions).forEach(victimId => {
        const vRoom = this.g.manor.playerLocations.get(victimId);
        const vRoomData = vRoom ? this.g.manor.getRoom(vRoom) : null;
        if (vRoomData && vRoomData.floor === floor) actionCount++;
      });
    }
    // Add some random noise for other actions (barricades, patrols, etc.)
    actionCount += Math.floor(Math.random() * 3);
    // Cap at 3+ for large lobbies
    const capped = actionCount >= 3 ? '3+' : String(actionCount);

    // QTE accuracy affects result precision
    if (qteScore >= 0.8) {
      return { success: true, text: `🔭 You counted precisely. ${capped} activities on ${floorInfo?.name || 'your floor'} last night.` };
    } else if (Math.abs(qteScore - 0.5) < 0.3) {
      const offset = Math.random() < 0.5 ? 1 : -1;
      const adjusted = Math.max(0, actionCount + offset);
      return { success: true, text: `🔭 You think you saw ${adjusted >= 3 ? '3+' : adjusted} movements on ${floorInfo?.name || 'your floor'}.` };
    } else {
      return { success: true, text: `🔭 The shadows were too quick. Somewhere between 0-${Math.min(actionCount + 2, 5)} activities.` };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // JESTER ABILITIES
  // ═══════════════════════════════════════════════════════════

  // ── Crocodile Tears: Flag a fake save for next morning
  activateCrocodileTears(playerId) {
    this.activeEffects[playerId].add('crocodile_tears');
    return { success: true, text: '🐊 You\'ll fake a doctor save tomorrow morning...' };
  }

  hasCrocodileTears(playerId) {
    return this.activeEffects[playerId]?.has('crocodile_tears') || false;
  }

  // ═══════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════

  // ── Get available abilities for display ─────────────────────
  getAvailableAbilities(playerId) {
    const player = this.g.players.find(p => p.id === playerId);
    if (!player?.role) return [];

    const defs = ABILITY_DEFS[player.role] || [];
    return defs.map(d => ({
      ...d,
      charges: this.getCharges(playerId, d.id),
      canUse: this.canUse(playerId, d.id).allowed,
    }));
  }

  // ── Render ability buttons HTML ────────────────────────────
  renderAbilityButtons(playerId) {
    const abilities = this.getAvailableAbilities(playerId);
    if (!abilities.length) return '';

    return abilities.map(a => {
      const disabled = !a.canUse ? 'disabled' : '';
      const chargeText = a.maxUses < 10 ? `${a.charges}/${a.maxUses}` : '';
      return `<button class="ability-btn ${disabled ? 'ability-disabled' : ''}" data-ability="${a.id}" ${disabled}>
        <span class="ability-icon">${a.icon}</span>
        <span class="ability-name">${a.name}</span>
        ${chargeText ? `<span class="ability-charges">${chargeText}</span>` : ''}
      </button>`;
    }).join('');
  }

  // ── Serialize for network ──────────────────────────────────
  serialize() {
    const effects = {};
    Object.entries(this.activeEffects).forEach(([pid, set]) => {
      effects[pid] = [...set];
    });
    return { charges: this.charges, activeEffects: effects, hasForged: this.hasForged };
  }

  // ── Deserialize from network ───────────────────────────────
  deserialize(data) {
    if (!data) return;
    this.charges = data.charges || {};
    this.hasForged = data.hasForged || {};
    Object.entries(data.activeEffects || {}).forEach(([pid, arr]) => {
      this.activeEffects[pid] = new Set(arr);
    });
  }

  // ── Static: Get all ability definitions ────────────────────
  static get DEFS() { return ABILITY_DEFS; }
}
