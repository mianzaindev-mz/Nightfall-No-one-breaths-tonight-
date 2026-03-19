// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Democratic Accusation Board (Season 2)
// Handles filing, endorsing, and resolving accusations.
// Accusations require linked evidence and >50% endorsement.
// ═══════════════════════════════════════════════════════════════

export default class Accusation {
  /**
   * @param {import('../game.js').default} game
   */
  constructor(game) {
    this.g = game;
    this.accusations = [];       // { id, accuserId, suspectId, evidence: [], statement, endorsers: Set, dismissers: Set, active: false, round }
    this.chargesUsed = {};       // playerId -> count (max 2 per match)
    this.phaseCharges = {};      // playerId -> count (max 1 per phase)
    this.cooldowns = {};         // suspectId -> round they were last accused
    this.badges = {};            // playerId -> 'sharp' | 'false' | null
  }

  // ── CONSTANTS ──────────────────────────────────────────────
  static get MAX_PER_MATCH() { return 2; }
  static get MAX_PER_PHASE() { return 1; }
  static get MAX_EVIDENCE() { return 2; }
  static get MIN_EVIDENCE() { return 1; }
  static get FINAL_ROUND_EVIDENCE() { return 2; } // Last round requires 2 evidence
  static get ENDORSEMENT_THRESHOLD() { return 0.5; } // >50% of alive
  static get COOLDOWN_PHASES() { return 2; }      // Can't re-accuse same target within 2 phases
  static get DEFENSE_DURATION() { return 15000; }  // 15 seconds
  static get STATEMENT_MAX_LEN() { return 100; }

  // ── Reset per-phase charges (call at start of each dinner phase) ──
  resetPhaseCharges() {
    this.phaseCharges = {};
  }

  // ── Check if a player can file an accusation ───────────────
  canAccuse(accuserId, suspectId) {
    const g = this.g;
    const errors = [];

    // Self-accusation blocked
    if (accuserId === suspectId) errors.push('Cannot accuse yourself');

    // Dead players can't accuse
    const accuser = g.players.find(p => p.id === accuserId);
    if (!accuser || !accuser.alive) errors.push('Dead players cannot accuse');

    // Can't accuse dead players
    const suspect = g.players.find(p => p.id === suspectId);
    if (!suspect || !suspect.alive) errors.push('Cannot accuse a dead player');

    // Max accusations per match
    const used = this.chargesUsed[accuserId] || 0;
    if (used >= Accusation.MAX_PER_MATCH) errors.push('No accusation charges remaining (max 2 per match)');

    // Max per phase
    const phaseUsed = this.phaseCharges[accuserId] || 0;
    if (phaseUsed >= Accusation.MAX_PER_PHASE) errors.push('Already accused this phase (max 1 per phase)');

    // Re-accuse cooldown
    const lastAccusedRound = this.cooldowns[suspectId];
    if (lastAccusedRound && (g.round - lastAccusedRound) < Accusation.COOLDOWN_PHASES) {
      errors.push(`${g._pname(suspectId)} was recently accused. Wait ${Accusation.COOLDOWN_PHASES - (g.round - lastAccusedRound)} more phase(s).`);
    }

    return { allowed: errors.length === 0, errors };
  }

  // ── File an accusation ─────────────────────────────────────
  // evidenceIds = array of evidence IDs from the ledger (1-2 pieces)
  // statement = optional string (max 100 chars)
  fileAccusation(accuserId, suspectId, evidenceIds, statement = '') {
    const g = this.g;
    const check = this.canAccuse(accuserId, suspectId);
    if (!check.allowed) return { success: false, errors: check.errors };

    // Validate evidence count
    const isFinalRound = this._isFinalDay();
    const minEv = isFinalRound ? Accusation.FINAL_ROUND_EVIDENCE : Accusation.MIN_EVIDENCE;
    if (evidenceIds.length < minEv) return { success: false, errors: [`Must link at least ${minEv} evidence piece(s)${isFinalRound ? ' (final round requirement)' : ''}`] };
    if (evidenceIds.length > Accusation.MAX_EVIDENCE) return { success: false, errors: ['Maximum 2 evidence pieces per accusation'] };

    // Validate evidence exists
    const linkedEvidence = evidenceIds.map(id => g.evidenceLedger.find(e => e.id === id)).filter(Boolean);
    if (linkedEvidence.length !== evidenceIds.length) return { success: false, errors: ['Invalid evidence ID'] };

    // Truncate statement
    const stmt = (statement || '').slice(0, Accusation.STATEMENT_MAX_LEN);

    const accusation = {
      id: 'acc-' + Math.random().toString(36).slice(2, 8),
      accuserId,
      suspectId,
      evidence: linkedEvidence.map(e => ({ id: e.id, text: e.text })),
      statement: stmt,
      endorsers: new Set([accuserId]), // Auto-endorse own accusation
      dismissers: new Set(),
      active: false,
      round: g.round,
    };

    this.accusations.push(accusation);
    this.chargesUsed[accuserId] = (this.chargesUsed[accuserId] || 0) + 1;
    this.phaseCharges[accuserId] = (this.phaseCharges[accuserId] || 0) + 1;
    this.cooldowns[suspectId] = g.round;

    // Check if immediately active (unlikely with 1 endorsement)
    this._checkThreshold(accusation);

    return { success: true, accusation };
  }

  // ── Endorse or Dismiss ─────────────────────────────────────
  vote(accusationId, playerId, isEndorse) {
    const acc = this.accusations.find(a => a.id === accusationId);
    if (!acc) return false;

    // Target can't dismiss their own accusation
    if (playerId === acc.suspectId) return false;

    // Dead players can't vote
    const player = this.g.players.find(p => p.id === playerId);
    if (!player || !player.alive) return false;

    if (isEndorse) {
      acc.endorsers.add(playerId);
      acc.dismissers.delete(playerId);
    } else {
      acc.dismissers.add(playerId);
      acc.endorsers.delete(playerId);
    }

    this._checkThreshold(acc);
    return true;
  }

  // ── Check if accusation crosses threshold ──────────────────
  _checkThreshold(acc) {
    const aliveCount = this.g.players.filter(p => p.alive).length;
    const threshold = Math.floor(aliveCount * Accusation.ENDORSEMENT_THRESHOLD) + 1; // >50%
    acc.active = acc.endorsers.size >= threshold;
  }

  // ── Get active accusations (those that crossed threshold) ──
  getActiveAccusations() {
    return this.accusations.filter(a => a.active);
  }

  // ── Get all accusations for display ────────────────────────
  getAllAccusations() {
    return this.accusations;
  }

  // ── Get accusations for a specific phase/round ─────────────
  getAccusationsForRound(round) {
    return this.accusations.filter(a => a.round === round);
  }

  // ── Check if a player has an active accusation against them ─
  isAccused(playerId) {
    return this.accusations.some(a => a.suspectId === playerId && a.active);
  }

  // ── Resolve after execution — apply badges ─────────────────
  resolveExecution(executedId) {
    const executedPlayer = this.g.players.find(p => p.id === executedId);
    if (!executedPlayer) return;

    const activeAccusations = this.accusations.filter(a => a.suspectId === executedId && a.active);

    activeAccusations.forEach(acc => {
      if (executedPlayer.role === 'killer') {
        // Correct accusation — Sharp Eye badge
        this.badges[acc.accuserId] = 'sharp';
        // Refresh charges
        this.chargesUsed[acc.accuserId] = 0;
      } else if (executedPlayer.role === 'jester') {
        // Jester execution — no penalty for accuser
        // (they correctly identified suspicious behavior)
      } else {
        // Innocent executed — False Accuser badge
        this.badges[acc.accuserId] = 'false';
        // Lose all remaining charges
        this.chargesUsed[acc.accuserId] = Accusation.MAX_PER_MATCH;
      }
    });
  }

  // ── Get remaining charges for a player ─────────────────────
  getChargesRemaining(playerId) {
    return Math.max(0, Accusation.MAX_PER_MATCH - (this.chargesUsed[playerId] || 0));
  }

  // ── Get badge for a player ─────────────────────────────────
  getBadge(playerId) {
    return this.badges[playerId] || null;
  }

  // ── Check if it's the final day (for evidence requirement) ─
  _isFinalDay() {
    const g = this.g;
    const aliveKillers = g.players.filter(p => p.alive && p.role === 'killer').length;
    const aliveOthers = g.players.filter(p => p.alive && p.role !== 'killer' && p.role !== 'jester').length;
    // Final day: killers are 1 kill away from winning
    return aliveKillers >= aliveOthers - 1;
  }

  // ── Render accusation board HTML ───────────────────────────
  renderBoard() {
    const g = this.g;
    if (!this.accusations.length) {
      return '<div class="accuse-panel"><div class="accuse-header">⚖ Accusation Board</div><div style="text-align:center;color:var(--pale-dim);font-size:.75rem;padding:12px">No accusations filed yet.</div></div>';
    }

    let html = '<div class="accuse-panel"><div class="accuse-header">⚖ Accusation Board</div>';

    this.accusations.forEach(acc => {
      const suspectName = g._pname(acc.suspectId);
      const accuserName = g._pname(acc.accuserId);
      const activeClass = acc.active ? ' active' : '';
      const activeBadge = acc.active ? '<span class="accuse-badge-active">ACTIVE</span>' : '';
      const aliveCount = g.players.filter(p => p.alive).length;

      html += `<div class="accuse-card${activeClass}">`;
      html += `<div class="accuse-suspect">⚖ ${accuserName} accuses ${suspectName} ${activeBadge}</div>`;
      html += '<div class="accuse-evidence-list">';
      acc.evidence.forEach(e => { html += `<div>📎 ${e.text.slice(0, 60)}${e.text.length > 60 ? '...' : ''}</div>`; });
      html += '</div>';
      if (acc.statement) html += `<div class="accuse-statement">"${acc.statement}"</div>`;
      html += `<div class="accuse-votes">`;
      html += `<button class="accuse-btn accuse-btn-endorse" data-acc="${acc.id}" data-vote="endorse">👍 Endorse</button>`;
      html += `<button class="accuse-btn accuse-btn-dismiss" data-acc="${acc.id}" data-vote="dismiss">👎 Dismiss</button>`;
      html += `<span class="accuse-count">👍 ${acc.endorsers.size} / ${Math.floor(aliveCount * Accusation.ENDORSEMENT_THRESHOLD) + 1} needed</span>`;
      html += '</div></div>';
    });

    html += '</div>';
    return html;
  }

  // ── Serialize for network broadcast ────────────────────────
  serialize() {
    return this.accusations.map(a => ({
      ...a,
      endorsers: [...a.endorsers],
      dismissers: [...a.dismissers],
    }));
  }

  // ── Deserialize from network ───────────────────────────────
  deserialize(data) {
    if (!data) return;
    this.accusations = data.map(a => ({
      ...a,
      endorsers: new Set(a.endorsers),
      dismissers: new Set(a.dismissers),
    }));
  }
}
