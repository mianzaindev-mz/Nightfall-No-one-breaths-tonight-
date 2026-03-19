// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Match Chronicle (Season 2)
// A persistent game log with detail decay across rounds.
// Older events fade from memory — the town forgets.
// ═══════════════════════════════════════════════════════════════

// Detail levels by round age
// 0-1: FULL, 2-3: PARTIAL, 4-5: VAGUE, 6+: SKELETAL
const DETAIL_LEVELS = [
  { maxAge: 1, level: 'full',     opacity: 1,    icon: '📋' },
  { maxAge: 3, level: 'partial',  opacity: 0.7,  icon: '📄' },
  { maxAge: 5, level: 'vague',    opacity: 0.45, icon: '📃' },
  { maxAge: 99, level: 'skeletal', opacity: 0.25, icon: '👻' },
];

export default class Chronicle {
  /**
   * @param {import('../game.js').default} game
   */
  constructor(game) {
    this.g = game;
    this.entries = {}; // { round: { deaths:[], saves:[], votes:{}, evidence:[], accusations:[], barricades:[], executions:[] } }
  }

  // ── Get detail level for a round ───────────────────────────
  getDetailLevel(round) {
    const age = this.g.round - round;
    for (const d of DETAIL_LEVELS) {
      if (age <= d.maxAge) return d;
    }
    return DETAIL_LEVELS[DETAIL_LEVELS.length - 1];
  }

  // ── Record an event for the current round ──────────────────
  record(type, data) {
    const r = this.g.round;
    if (!this.entries[r]) this.entries[r] = { deaths: [], saves: [], votes: {}, evidence: [], accusations: [], barricades: [], executions: [], events: [] };
    const entry = this.entries[r];

    switch (type) {
      case 'death':
        entry.deaths.push({ name: data.name, room: data.room || null, floor: data.floor || null });
        break;
      case 'save':
        entry.saves.push({ name: data.name });
        break;
      case 'vote':
        entry.votes = data; // { results: {name: count}, executed: name|null, wasKiller: bool }
        break;
      case 'execution':
        entry.executions.push({ name: data.name, role: data.role });
        break;
      case 'evidence':
        entry.evidence.push({ text: data.text, source: data.source });
        break;
      case 'accusation':
        entry.accusations.push({ accuser: data.accuser, suspect: data.suspect, active: data.active });
        break;
      case 'barricade':
        entry.barricades.push({ floor: data.floor });
        break;
      case 'event':
        entry.events.push(data.text);
        break;
    }
  }

  // ── Render a single round entry with decay ─────────────────
  _renderRound(round) {
    const entry = this.entries[round];
    if (!entry) return '';
    const detail = this.getDetailLevel(round);
    const level = detail.level;
    const g = this.g;

    let items = [];

    // DEATHS
    if (entry.deaths.length) {
      if (level === 'full') {
        entry.deaths.forEach(d => items.push(`🗡 ${d.name} was killed${d.room ? ` in the ${d.room}` : ''}`));
      } else if (level === 'partial') {
        entry.deaths.forEach(d => items.push(`🗡 ${d.name} was killed${d.floor ? ` somewhere on ${d.floor}` : ''}`));
      } else if (level === 'vague') {
        items.push(`🗡 Someone died`);
      } else {
        items.push(`🗡 ${entry.deaths.length} death(s)`);
      }
    }

    // SAVES
    if (entry.saves.length) {
      if (level === 'full' || level === 'partial') {
        entry.saves.forEach(s => items.push(`🩺 ${s.name} was saved`));
      } else if (level === 'vague') {
        items.push(`🩺 Someone was saved`);
      }
      // skeletal: omitted
    }

    // EXECUTIONS
    if (entry.executions.length) {
      if (level === 'full') {
        entry.executions.forEach(e => items.push(`⚖ ${e.name} was executed (${e.role})`));
      } else if (level === 'partial') {
        entry.executions.forEach(e => items.push(`⚖ ${e.name} was executed`));
      } else if (level === 'vague') {
        items.push(`⚖ An execution occurred`);
      } else {
        items.push(`⚖ ${entry.executions.length} execution(s)`);
      }
    }

    // EVIDENCE
    if (entry.evidence.length) {
      if (level === 'full') {
        items.push(`🔎 ${entry.evidence.length} evidence found`);
      } else if (level === 'partial') {
        items.push(`🔎 Evidence found`);
      } else if (level === 'vague') {
        items.push(`🔎 Some evidence was found`);
      }
      // skeletal: omitted
    }

    // ACCUSATIONS
    if (entry.accusations.length && (level === 'full' || level === 'partial')) {
      entry.accusations.forEach(a => items.push(`📢 ${a.accuser} accused ${a.suspect}${a.active ? ' (ACTIVE)' : ''}`));
    }

    // BARRICADES
    if (entry.barricades.length && level === 'full') {
      entry.barricades.forEach(b => items.push(`🚪 Someone barricaded on ${b.floor}`));
    }

    // EVENTS
    if (entry.events.length && (level === 'full' || level === 'partial')) {
      entry.events.forEach(e => items.push(e));
    }

    if (!items.length) items.push('📝 No notable events');

    const decayClass = level === 'partial' ? ' chronicle-decayed-partial' : level === 'vague' ? ' chronicle-decayed-vague' : level === 'skeletal' ? ' chronicle-decayed-skeletal' : '';
    const cssClass = `chronicle-round chronicle-${level}${decayClass}`;
    return `<div class="${cssClass}">
      <div class="chronicle-round-header" data-round="${round}">
        ${detail.icon} <span class="chronicle-round-num">Round ${round}</span>
        <span class="chronicle-detail-tag">${level.toUpperCase()}</span>
      </div>
      <div class="chronicle-round-body">
        ${items.map(i => `<div class="chronicle-item">${i}</div>`).join('')}
      </div>
    </div>`;
  }

  // ── Render full chronicle panel ────────────────────────────
  renderChronicle() {
    const rounds = Object.keys(this.entries).map(Number).sort((a, b) => b - a);
    if (!rounds.length) return '<div class="chronicle-empty">📜 The chronicle is empty. Events will be recorded as the game progresses.</div>';

    let html = '<div class="chronicle-panel">';
    html += '<div class="chronicle-title">📜 Match Chronicle</div>';
    rounds.forEach(r => { html += this._renderRound(r); });
    html += '</div>';
    return html;
  }

  // ── Render Major Recap modal (every 5 rounds) ──────────────
  renderMajorRecap() {
    const currentRound = this.g.round;
    const startRound = Math.max(1, currentRound - 4);
    const rounds = [];
    for (let r = currentRound; r >= startRound; r--) {
      if (this.entries[r]) rounds.push(r);
    }

    // Tallies
    let totalDeaths = 0, totalExecutions = 0, totalEvidence = 0, totalAccusations = 0;
    let innocentExecutions = 0, floorKills = {};
    Object.values(this.entries).forEach(e => {
      totalDeaths += e.deaths.length;
      totalExecutions += e.executions.length;
      totalEvidence += e.evidence.length;
      totalAccusations += e.accusations.length;
      e.executions.forEach(ex => { if (ex.role !== 'killer') innocentExecutions++; });
      e.deaths.forEach(d => { if (d.floor) floorKills[d.floor] = (floorKills[d.floor] || 0) + 1; });
    });

    // Pattern detection
    const patterns = [];
    if (innocentExecutions >= 2) patterns.push(`⚠ ${innocentExecutions} executions have been innocent so far`);
    const topFloor = Object.entries(floorKills).sort((a, b) => b[1] - a[1])[0];
    if (topFloor && topFloor[1] >= 3) patterns.push(`⚠ The killer has struck ${topFloor[0]} ${topFloor[1]}/${totalDeaths} times`);

    let html = `<div class="recap-modal major-recap">
      <div class="recap-title">📜 MAJOR RECAP — Rounds ${startRound}–${currentRound}</div>
      <div class="recap-tallies">
        <span>💀 ${totalDeaths} deaths</span>
        <span>⚖ ${totalExecutions} executions</span>
        <span>🔎 ${totalEvidence} evidence</span>
        <span>📢 ${totalAccusations} accusations</span>
      </div>`;

    if (patterns.length) {
      html += '<div class="recap-patterns">';
      patterns.forEach(p => { html += `<div class="recap-pattern">${p}</div>`; });
      html += '</div>';
    }

    rounds.forEach(r => { html += this._renderRound(r); });
    html += '<button class="btn btn-gold recap-dismiss" style="margin-top:12px;width:100%">Into the Night</button>';
    html += '</div>';
    return html;
  }

  // ── Check if major recap should show ───────────────────────
  shouldShowMajorRecap() {
    return this.g.round > 1 && (this.g.round - 1) % 5 === 0;
  }
}
