// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Vote-to-Kick + Host Privileges (Season 2)
// Democratic kick system + host panel with pause/ban/transfer
// ═══════════════════════════════════════════════════════════════

export default class Moderation {
  constructor(game) {
    this.g = game;
    this.kickCharges = {};    // { playerId: count }
    this.activeKickVote = null;
    this.bans = new Set();
    this.pauseUsed = false;
    this.isPaused = false;
  }

  // ── Vote-to-Kick ─────────────────────────────────────────────

  canInitiateKick(reporterId, targetId) {
    const g = this.g;
    if (g.phase === 'night' || g.phase === 'verdict') return { ok: false, reason: 'Cannot kick during this phase' };
    if (reporterId === targetId) return { ok: false, reason: 'Cannot kick yourself' };
    if (g.isHost && targetId === g.myId) return { ok: false, reason: 'Cannot kick the host. Use Transfer Host.' };
    if (this.activeKickVote) return { ok: false, reason: 'A kick vote is already in progress' };
    if ((this.kickCharges[reporterId] || 0) >= 1) return { ok: false, reason: 'You already used your kick vote this match' };
    return { ok: true };
  }

  initiateKick(reporterId, targetId, reason) {
    const check = this.canInitiateKick(reporterId, targetId);
    if (!check.ok) return check;

    this.kickCharges[reporterId] = (this.kickCharges[reporterId] || 0) + 1;
    this.activeKickVote = {
      reporter: reporterId,
      target: targetId,
      reason: reason || 'Unspecified',
      votes: {}, // { playerId: 'allow' | 'deny' }
      startTime: Date.now(),
      timeout: 15000,
    };
    return { ok: true, vote: this.activeKickVote };
  }

  castKickVote(playerId, decision) {
    if (!this.activeKickVote) return false;
    if (playerId === this.activeKickVote.target) return false; // can't vote on own kick
    this.activeKickVote.votes[playerId] = decision; // 'allow' or 'deny'
    return true;
  }

  resolveKickVote() {
    if (!this.activeKickVote) return null;
    const vote = this.activeKickVote;
    const aliveCount = this.g.players.filter(p => p.alive).length;
    const allowCount = Object.values(vote.votes).filter(v => v === 'allow').length;
    const threshold = Math.ceil(aliveCount * 0.6);
    const passed = allowCount >= threshold;

    this.activeKickVote = null;
    return {
      passed,
      target: vote.target,
      allowCount,
      threshold,
      reason: vote.reason,
    };
  }

  // ── Host Privileges ───────────────────────────────────────────

  canBan(targetId) {
    const banned = this.bans.size;
    const total = this.g.players.length;
    if (banned >= Math.floor(total * 0.25)) return { ok: false, reason: 'Cannot ban >25% of lobby' };
    if (targetId === this.g.myId && this.g.isHost) return { ok: false, reason: 'Cannot ban yourself' };
    return { ok: true };
  }

  ban(targetId) {
    const check = this.canBan(targetId);
    if (!check.ok) return check;
    this.bans.add(targetId);
    return { ok: true };
  }

  isBanned(playerId) { return this.bans.has(playerId); }

  canPause() {
    if (this.pauseUsed) return { ok: false, reason: 'Pause already used this match' };
    return { ok: true };
  }

  pause() {
    const check = this.canPause();
    if (!check.ok) return check;
    this.pauseUsed = true;
    this.isPaused = true;
    return { ok: true, duration: 60000 };
  }

  unpause() { this.isPaused = false; }

  transferHost(newHostId) {
    if (!this.g.players.find(p => p.id === newHostId)) return { ok: false, reason: 'Player not found' };
    return { ok: true, newHost: newHostId };
  }

  // ── Host Auto-Migration ───────────────────────────────────────

  getAutoMigrationCandidate() {
    // Find player with longest connection time (first in list as proxy)
    const candidates = this.g.players.filter(p => p.id !== this.g.myId && p.alive);
    return candidates.length ? candidates[0].id : null;
  }

  // ── Spectate Punishment ───────────────────────────────────────

  canSpectate(targetId, confirmers) {
    if (!confirmers || confirmers.length < 2) return { ok: false, reason: 'Requires 2 other players to confirm' };
    return { ok: true };
  }

  // ── Emergency Skip ────────────────────────────────────────────

  canEmergencySkip() {
    if (this.g.accusation?.isDefenseActive?.()) return { ok: false, reason: 'Blocked during active accusation defense' };
    return { ok: true };
  }

  // ── Render Host Panel HTML ────────────────────────────────────

  renderHostPanel() {
    const g = this.g;
    if (!g.isHost) return '';

    const playerOpts = g.players
      .filter(p => p.id !== g.myId && p.alive)
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join('');

    return `<div class="host-panel">
      <div class="host-panel-title">🛡 HOST PANEL</div>
      <div class="host-panel-grid">
        <button class="btn btn-sm btn-out host-action" data-action="pause" ${this.pauseUsed ? 'disabled' : ''}>
          ⏸ Pause ${this.pauseUsed ? '(Used)' : ''}
        </button>
        <button class="btn btn-sm btn-out host-action" data-action="skip">⏭ Emergency Skip</button>
        <div class="host-action-row">
          <select class="host-select" id="hostTargetSelect">${playerOpts}</select>
          <button class="btn btn-sm btn-out host-action" data-action="kick">👢 Kick</button>
          <button class="btn btn-sm btn-out host-action" data-action="ban">🚫 Ban</button>
        </div>
        <button class="btn btn-sm btn-out host-action" data-action="transfer">👑 Transfer Host</button>
      </div>
    </div>`;
  }

  // ── Render Kick Vote UI ───────────────────────────────────────

  renderKickVote() {
    if (!this.activeKickVote) return '';
    const v = this.activeKickVote;
    const reporter = this.g.players.find(p => p.id === v.reporter)?.name || 'Someone';
    const target = this.g.players.find(p => p.id === v.target)?.name || 'Someone';

    return `<div class="kick-vote-panel">
      <div class="kick-vote-title">⚠ KICK VOTE</div>
      <div class="kick-vote-desc">${reporter} wants to remove ${target}</div>
      <div class="kick-vote-reason">Reason: ${v.reason}</div>
      <div class="kick-vote-actions">
        <button class="btn btn-sm btn-red kick-vote-btn" data-vote="allow">✅ Allow</button>
        <button class="btn btn-sm btn-out kick-vote-btn" data-vote="deny">❌ Deny</button>
      </div>
    </div>`;
  }
}
