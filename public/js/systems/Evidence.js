// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Evidence Decay System (Season 2)
// Tracks age of evidence, applies accuracy ceiling decay,
// generates UI warnings, and manages the evidence ledger.
// ═══════════════════════════════════════════════════════════════

// ── DECAY TABLE ──────────────────────────────────────────────
// Each entry: { maxAge, ceiling, status, badge, cssClass }
const DECAY_TIERS = [
  { maxAge: 0, ceiling: 100, status: 'FRESH',    badge: '🔴', cssClass: 'ev-fresh',    color: '#4caf50' },
  { maxAge: 1, ceiling: 85,  status: 'AGING',    badge: '🟠', cssClass: 'ev-aging',    color: '#ff9800' },
  { maxAge: 2, ceiling: 70,  status: 'FADING',   badge: '🟡', cssClass: 'ev-fading',   color: '#f9a825' },
  { maxAge: 3, ceiling: 55,  status: 'COLD',     badge: '⚪', cssClass: 'ev-cold',     color: '#9e9e9e' },
  { maxAge: 4, ceiling: 40,  status: 'DEGRADED', badge: '⬛', cssClass: 'ev-degraded', color: '#e53935' },
  { maxAge: 5, ceiling: 20,  status: 'FADED',    badge: '💀', cssClass: 'ev-faded',    color: '#b71c1c' },
];

const DECAY_FLOOR = 20; // Evidence never drops below 20% accuracy ceiling

// ── WARNING MESSAGES ─────────────────────────────────────────
const DECAY_WARNINGS = {
  FADING:   { icon: '⚠', msg: 'Evidence aging! Verify soon before details fade.',     level: 'warn' },
  COLD:     { icon: '🥶', msg: 'Evidence going cold! Only 55% accuracy ceiling left.', level: 'warn' },
  DEGRADED: { icon: '🔴', msg: 'CRITICAL: Evidence nearly lost. Accuracy at 40%.',     level: 'critical' },
  FADED:    { icon: '💀', msg: 'Evidence severely degraded. Only 20% ceiling remains.', level: 'urgent' },
};

export default class Evidence {
  /**
   * @param {import('../game.js').default} game
   */
  constructor(game) {
    this.g = game;
  }

  // ── Get decay tier for a given age ─────────────────────────
  getTier(age) {
    // Find the matching tier (ages beyond 5 use the FADED tier)
    for (let i = DECAY_TIERS.length - 1; i >= 0; i--) {
      if (age >= DECAY_TIERS[i].maxAge) return DECAY_TIERS[i];
    }
    return DECAY_TIERS[0];
  }

  // ── Get accuracy ceiling for evidence given current round ──
  getCeiling(evidence) {
    const age = this.g.round - evidence.round;
    const tier = this.getTier(age);
    return Math.max(tier.ceiling, DECAY_FLOOR);
  }

  // ── Get decay info for a single piece of evidence ──────────
  getDecayInfo(evidence) {
    const age = Math.max(0, this.g.round - evidence.round);
    const tier = this.getTier(age);
    return {
      age,
      ceiling: Math.max(tier.ceiling, DECAY_FLOOR),
      status: tier.status,
      badge: tier.badge,
      cssClass: tier.cssClass,
      color: tier.color,
    };
  }

  // ── Cap verification accuracy by decay ceiling ─────────────
  // finalAccuracy = min(qteScore, agingCeiling)
  capAccuracy(qteScorePct, evidence) {
    const ceiling = this.getCeiling(evidence);
    return Math.min(qteScorePct, ceiling);
  }

  // ── Age all evidence (call at start of each new round) ─────
  // Returns array of warning objects for evidence that crossed decay thresholds
  ageAndWarn() {
    const warnings = [];
    const currentRound = this.g.round;

    this.g.evidenceLedger.forEach(ev => {
      const age = currentRound - ev.round;
      const tier = this.getTier(age);
      const prevAge = age - 1;
      const prevTier = prevAge >= 0 ? this.getTier(prevAge) : null;

      // Check if evidence just crossed into a new warning tier
      if (prevTier && prevTier.status !== tier.status && DECAY_WARNINGS[tier.status]) {
        const warn = DECAY_WARNINGS[tier.status];
        warnings.push({
          evidenceId: ev.id,
          evidenceText: ev.text,
          ...warn,
          tier: tier.status,
          ceiling: Math.max(tier.ceiling, DECAY_FLOOR),
        });
      }
    });

    return warnings;
  }

  // ── Get summary counts for Resource HUD ────────────────────
  // Returns { total, verified, unverified, aging: { warn, critical } }
  getSummary() {
    const ledger = this.g.evidenceLedger;
    const total = ledger.length;
    const verified = ledger.filter(e => e.status === 'verified').length;
    const unverified = total - verified;

    let warnCount = 0;
    let criticalCount = 0;

    ledger.forEach(ev => {
      if (ev.status === 'verified') return; // verified evidence doesn't need warning
      const age = this.g.round - ev.round;
      if (age >= 4) criticalCount++;
      else if (age >= 2) warnCount++;
    });

    return { total, verified, unverified, aging: { warn: warnCount, critical: criticalCount } };
  }

  // ── Format evidence text with decay overlay ────────────────
  // Returns HTML string with decay-appropriate styling
  formatWithDecay(evidence) {
    const info = this.getDecayInfo(evidence);
    const truncated = this._applyTextDecay(evidence.text, info.age);

    return `<span class="ev-decay-badge ${info.cssClass}" title="${info.status} — ${info.ceiling}% max accuracy">${info.badge}</span> `
      + `<span class="ev-text-decayed" style="opacity:${this._getOpacity(info.age)}">${truncated}</span>`;
  }

  // ── Apply text obscuring based on age ──────────────────────
  // Older evidence gets words replaced with [???]
  _applyTextDecay(text, age) {
    if (age <= 1) return text; // Fresh/Aging: full text

    const words = text.split(' ');
    if (words.length <= 3) return text; // Too short to obscure

    // Percentage of words to obscure
    let obscurePct;
    if (age === 2) obscurePct = 0.15;      // FADING: ~15% words obscured
    else if (age === 3) obscurePct = 0.35;  // COLD: ~35% obscured
    else if (age === 4) obscurePct = 0.55;  // DEGRADED: ~55% obscured
    else obscurePct = 0.75;                  // FADED: ~75% obscured

    const count = Math.floor(words.length * obscurePct);
    // Deterministic obscuring based on evidence ID (so it doesn't change each render)
    const indices = new Set();
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);
    for (let i = 0; i < count && indices.size < words.length - 1; i++) {
      seed = (seed * 31 + 7) % words.length;
      if (seed > 0) indices.add(seed); // never obscure first word
    }

    return words.map((w, i) => indices.has(i) ? '<span class="ev-obscured">[???]</span>' : w).join(' ');
  }

  // ── Opacity for decayed text ───────────────────────────────
  _getOpacity(age) {
    if (age <= 1) return 1;
    if (age === 2) return 0.85;
    if (age === 3) return 0.7;
    if (age === 4) return 0.55;
    return 0.4;
  }

  // ── Static constants for external use ──────────────────────
  static get DECAY_TIERS() { return DECAY_TIERS; }
  static get DECAY_FLOOR() { return DECAY_FLOOR; }
  static get DECAY_WARNINGS() { return DECAY_WARNINGS; }
}
