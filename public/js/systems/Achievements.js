// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Achievement System (Season 2)
// Tracks & awards achievements per player in localStorage
// ═══════════════════════════════════════════════════════════════

const ACHIEVEMENTS = {
  perfectMurder:   { icon: '☠', name: 'Perfect Murder', desc: 'Kill with 0 evidence clues' },
  eagleEye:        { icon: '🦅', name: 'Eagle Eye', desc: 'Find killer in Round 1' },
  guardianAngel:   { icon: '👼', name: 'Guardian Angel', desc: 'Save 3+ players in one match' },
  lastBreath:      { icon: '🫁', name: 'Last Breath', desc: 'Win as final surviving civilian' },
  puppetMaster:    { icon: '🎭', name: 'Puppet Master', desc: 'Win as Jester' },
  sharpEye:        { icon: '🎯', name: 'Sharp Eye', desc: 'Accuse correctly → killer executed' },
  silentKiller:    { icon: '🤐', name: 'Silent Killer', desc: 'Win as killer with 0 chat messages' },
  townHero:        { icon: '🏅', name: 'Town Hero', desc: 'Voted correctly every round' },
  barricadeHero:   { icon: '🚪', name: 'Barricade Hero', desc: 'Survive a kill via barricade' },
  prayerAnswered:  { icon: '🙏', name: 'Prayer Answered', desc: 'Share a hint that matches the killer' },
  arsonist:        { icon: '🔥', name: 'Arsonist', desc: 'Successfully destroy evidence as killer' },
  coldCaseCracker: { icon: '🧩', name: 'Cold Case Cracker', desc: 'Reopen evidence leading to conviction' },
};

export default class Achievements {
  constructor() {
    this.sessionAchievements = []; // Achievements earned THIS match
    this._load();
  }

  _load() {
    try {
      this.data = JSON.parse(localStorage.getItem('nightfall_achievements') || '{}');
    } catch { this.data = {}; }
  }

  _save() {
    try { localStorage.setItem('nightfall_achievements', JSON.stringify(this.data)); } catch {}
  }

  // Award an achievement (idempotent — won't double-award)
  award(key) {
    if (!ACHIEVEMENTS[key]) return;
    if (!this.data[key]) {
      this.data[key] = { earned: true, date: new Date().toISOString(), count: 0 };
    }
    this.data[key].count = (this.data[key].count || 0) + 1;
    this._save();

    if (!this.sessionAchievements.includes(key)) {
      this.sessionAchievements.push(key);
    }
    return ACHIEVEMENTS[key];
  }

  // Check if earned
  has(key) { return !!this.data[key]?.earned; }

  // Get all earned achievements
  getAll() {
    return Object.entries(this.data)
      .filter(([, v]) => v.earned)
      .map(([k, v]) => ({ ...ACHIEVEMENTS[k], key: k, count: v.count, date: v.date }));
  }

  // Get achievements earned this match
  getSessionAchievements() {
    return this.sessionAchievements.map(k => ACHIEVEMENTS[k]).filter(Boolean);
  }

  // Render badges for landing page stats bar
  renderBadges() {
    const earned = this.getAll();
    if (!earned.length) return '<div class="achievement-empty">No achievements yet — play to unlock!</div>';
    return `<div class="achievement-badges">
      ${earned.map(a => `<span class="achievement-badge" title="${a.name}: ${a.desc}">${a.icon}</span>`).join('')}
    </div>`;
  }

  // Render achievement toast for newly earned
  renderToast(key) {
    const a = ACHIEVEMENTS[key];
    if (!a) return '';
    return `<div class="achievement-toast">
      <span class="achievement-toast-icon">${a.icon}</span>
      <div>
        <div class="achievement-toast-title">🏆 Achievement Unlocked!</div>
        <div class="achievement-toast-name">${a.name}</div>
        <div class="achievement-toast-desc">${a.desc}</div>
      </div>
    </div>`;
  }

  // Render full achievement list for Game Over
  renderGameOverSection() {
    const session = this.getSessionAchievements();
    if (!session.length) return '';
    return `<div class="achievement-section">
      <div class="achievement-section-title">🏆 ACHIEVEMENTS UNLOCKED</div>
      ${session.map(a => `<div class="achievement-row">
        <span class="achievement-row-icon">${a.icon}</span>
        <span class="achievement-row-name">${a.name}</span>
        <span class="achievement-row-desc">${a.desc}</span>
      </div>`).join('')}
    </div>`;
  }

  // Reset session (call at start of each match)
  resetSession() { this.sessionAchievements = []; }
}
