// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Dynamic Difficulty Scaling (Season 2)
// QTE difficulty + dinner timer scale per round based on lobby size
// ═══════════════════════════════════════════════════════════════

const TIERS = {
  small:  { kill: 3, invest: 3, timer: 5, timerFloor: 30 }, // 4-10 players
  medium: { kill: 2, invest: 2, timer: 3, timerFloor: 35 }, // 11-20 players
  large:  { kill: 1.5, invest: 1.5, timer: 2, timerFloor: 40 }, // 21-30 players
};
const CAPS = { kill: 15, invest: 10 };

export default class Difficulty {
  constructor(game) {
    this.g = game;
  }

  getTier() {
    const n = this.g.players?.length || 6;
    if (n <= 10) return 'small';
    if (n <= 20) return 'medium';
    return 'large';
  }

  // Returns current scaling values for this round
  getScaling() {
    const tier = this.getTier();
    const t = TIERS[tier];
    const round = this.g.round || 1;
    const r = round - 1;

    return {
      killBonus: Math.min(t.kill * r, CAPS.kill),
      investBonus: Math.min(t.invest * r, CAPS.invest),
      dinnerTime: Math.max((this.g.settings?.dayTime || 60) - t.timer * r, t.timerFloor),
      tier,
      round,
    };
  }

  // Get kill QTE difficulty modifier (0 to +15%)
  getKillDifficulty(roomDifficulty = 0) {
    const s = this.getScaling();
    return s.killBonus + roomDifficulty;
  }

  // Get investigation QTE ease modifier (0 to -10%)
  getInvestigationEase(isDetective = false) {
    const s = this.getScaling();
    return -(s.investBonus) + (isDetective ? 10 : 0);
  }

  // Get adjusted dinner timer for this round
  getDinnerTimer() {
    return this.getScaling().dinnerTime * 1000;
  }

  // Status string for UI
  getStatusText() {
    const s = this.getScaling();
    return `Round ${s.round} • Kill +${s.killBonus.toFixed(1)}% • Invest -${s.investBonus.toFixed(1)}% • Timer ${s.dinnerTime}s`;
  }
}
