// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Game State Machine v5
// Flow: Role → Grace → Night → Investigation → Dinner → Verdict
// Detective verification + investigation limits + bots
// ═══════════════════════════════════════════════════════════════

import { assignRoles, getRoleInfo } from './roles.js';
import { assignCharacters, getPublicDesc, getHiddenDesc } from './avatar.js';
import { generateKillClue, generateKillClues, generateInvestClue, generateSnoopClue, generateTraitInvestResult, computeVerification, formatEvidence, runQTE, getKillDifficulty, getInvestigateDifficulty, getVerifyDifficulty } from './qte.js';
import audio from './audio.js';
import chat from './chat.js';
import * as ui from './ui.js';

export default class Game {
  constructor(network, canvasCtrl) {
    this.net = network;
    this.canvasCtrl = canvasCtrl;
    this.myId = 'P' + Math.random().toString(36).slice(2, 9);
    this.myName = '';
    this.myAvatar = '🧙';
    this.isHost = false;
    this.lobbyCode = '';
    this.players = [];
    // Phases: lobby, role, grace, night, investigate, dinner, verdict, over
    this.phase = 'lobby';
    this.round = 0;
    this.myRole = null;
    this.settings = { dayTime: 60, nightTime: 30, investTime: 40, doctor: false, jester: false, hideVotes: true, whispers: true, ghostClues: true, nightEvents: true, suspicion: true };

    // Characters
    this.charData = {};
    this.myPersona = null;
    this.myCharacter = null;
    this._hostCharacters = null;
    this._hostPersonas = null;

    // Night
    this.nightActions = {};
    this.doctorTarget = null;
    this.killClues = [];
    this.investigationClues = [];
    this.killedId = null;
    this.savedId = null;
    this.killCounts = {};

    // Day
    this.votes = {};
    this.selVote = null;
    this.voted = false;
    this.readySet = new Set();
    this.jesterWinner = null;
    this.skipVotes = new Set();
    this.mySkipVoted = false;

    // Timers
    this.dayInterval = null;
    this.nightTimeout = null;
    this.investTimeout = null;
    this.investInterval = null;
    this.lastWordsTimeout = null;
    this.graceInterval = null;
    this.lastDoctorSelf = false;

    // Investigation limits
    this.myActionsUsed = 0;
    this.civilianActionsUsed = 0;
    this.evidenceLedger = [];

    // Voting History
    this.voteHistory = []; // { round, votes: { playerId: targetId }, tally, exId }

    // Whispering
    this.whispersUsed = 0;
    this.maxWhispers = 2;

    // Ghost Clues
    this.ghostClueUsed = false;

    // Night Events
    this.currentNightEvent = null;

    // Suspicion
    this.suspicionVotes = {}; // { targetId: { up: count, down: count } }
    this.mySuspicionVotes = new Set();

    // Round Recap
    this.roundRecap = {}; // { round: { events: [] } }

    // Last Stand
    this.lastStandActive = false;

    // Bots
    this.bots = [];

    // Detective tracking
    this.detectiveDead = false;

    // Democratic investigation
    this.investigationRequests = []; // { id, playerId, allows:[], denies:[], status }
    this.pendingInvestRequest = null; // current request being voted on

    // Team chat
    this.teamChatUsed = 0; // per-phase counter
    this.teamSuspicionCounters = { killer: 0, detective: 0 }; // cumulative match total

    // Killer forging
    this.forgesUsed = 0; // 1 per match

    // Detective trait investigation
    this.traitInvestsUsed = 0; // 3 per match
    this.dossier = {}; // { playerId: [{ key, label, value }] }

    // Max lobby
    this.maxLobbySize = 30;

    this.stats = JSON.parse(localStorage.getItem('nf_stats') || '{"games":0,"wins":0}');
    this._setupNetHandlers();
  }

  _pname(pid) { const d = this.charData[pid]; return d ? `${d.persona.icon} ${d.persona.name}` : '???'; }

  // ── NETWORK HANDLERS ───────────────────────────────────────
  _setupNetHandlers() {
    const n = this.net;
    n.on('CREATED', d => { this.lobbyCode = d.code; this.isHost = true; this.players = [{ id: this.myId, name: this.myName, avatar: this.myAvatar, alive: true, role: null, disconnected: false, isHost: true }]; this._showLobby(); });
    n.on('JOINED', d => { this.lobbyCode = d.code; this.isHost = (d.hostId === this.myId); n.roomCode = d.code; n.getPlayers(); this._showLobby(); });
    n.on('JOIN_FAIL', d => ui.toast(d.reason || 'Failed to join', true));
    n.on('RECONNECTED', d => { this.lobbyCode = d.code; this.isHost = (d.hostId === this.myId); n.roomCode = d.code; ui.toast('Reconnected!'); n.getPlayers(); });

    n.on('PLAYER_LIST', d => {
      this.players = d.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar || '👤', alive: p.alive !== undefined ? p.alive : true, role: p.role || null, disconnected: !p.connected, isHost: p.id === d.hostId }));
      this.isHost = d.hostId === this.myId; this._renderLobby();
    });
    n.on('PLAYER_JOINED', d => { if (!this.players.find(p => p.id === d.playerId)) this.players.push({ id: d.playerId, name: d.name, avatar: '👤', alive: true, role: null, disconnected: false }); this._renderLobby(); ui.toast(`${d.name} joined`); });
    n.on('PLAYER_LEFT', d => { this.players = this.players.filter(p => p.id !== d.playerId); this._renderLobby(); ui.toast(`${d.name} left`); });
    n.on('PLAYER_DISCONNECTED', d => { const p = this.players.find(x => x.id === d.playerId); if (p) p.disconnected = true; this._renderLobby(); });
    n.on('PLAYER_RECONNECTED', d => { const p = this.players.find(x => x.id === d.playerId); if (p) p.disconnected = false; this._renderLobby(); });
    n.on('HOST_CHANGED', d => { this.isHost = (d.newHostId === this.myId); this.players.forEach(p => p.isHost = p.id === d.newHostId); this._renderLobby(); ui.toast(`${d.name} is the new host`); });
    n.on('PL', d => { d.pl.forEach(u => { let p = this.players.find(x => x.id === u.id); if (p) Object.assign(p, u); else this.players.push({ ...u, disconnected: false }); }); this._renderLobby(); });

    n.on('ROLE', d => {
      this.round = d.round || 1; this.phase = 'role'; this.myRole = d.role;
      this.charData = d.charData || {};
      this.myPersona = this.charData[this.myId]?.persona;
      this.myCharacter = { pub: this.charData[this.myId]?.pub, hidden: this.charData[this.myId]?.hidden };
      d.publicPlayers.forEach(u => { let p = this.players.find(x => x.id === u.id); if (p) p.alive = true; });
      const me = this.players.find(p => p.id === this.myId); if (me) me.role = d.role;
      this.settings = d.settings || this.settings; this.killCounts = {};
      this._showRole(d.allies || []);
    });

    n.on('NIGHT', d => { this.phase = 'night'; this.round = d.round; this._showNight(d.dur); });
    n.on('GRACE', d => { this._onGrace(d); });
    n.on('SKIP_VOTE', d => {
      if (this.isHost) {
        this.skipVotes.add(d._from);
        const alive = this.players.filter(p => p.alive && !p.disconnected).length;
        const needed = Math.ceil(alive * 0.7);
        this.net.relay({ t: 'SKIP_UPDATE', count: this.skipVotes.size, needed });
        if (this.skipVotes.size >= needed) this._triggerSkip();
      }
    });
    n.on('SKIP_UPDATE', d => { this._updateSkipUI(d.count, d.needed); });
    n.on('INVESTIGATE', d => { this._onInvestigate(d); });
    n.on('DINNER', d => { this._onDinner(d); });
    n.on('VOTE_UPDATE', d => { this.votes = d.votes || {}; this._renderVotes(); });
    n.on('VERDICT', d => { this._onVerdict(d); });
    n.on('GAMEOVER', d => { this._onGameOver(d); });
    n.on('READY', d => { if (this.isHost) { this.readySet.add(d._from); this._checkReady(); } });

    n.on('KILL_ACTION', d => {
      if (this.isHost) {
        // Check for target overlap before recording
        const existingKillers = Object.entries(this.nightActions).filter(([kid, tid]) => tid === d.targetId && kid !== d._from);
        if (existingKillers.length > 0) {
          const targetName = this._pname(d.targetId);
          const warningText = `⚠ WARNING: Multiple killers targeting ${targetName}! Consider splitting targets.`;
          // Send warning to all killers
          this.players.forEach(p => {
            if (p.role === 'killer' && !p._isBot) {
              this.net.sendTo(p.id, { t: 'TEAM_CHAT', team: 'killer', name: '⚠ System', text: warningText });
            }
          });
          // Also show to host if killer
          if (this.myRole === 'killer') chat.addMessage('⚠ System', warningText, 'team-killer', 'killer');
        }
        this.nightActions[d._from] = d.targetId;
        // Support multi-clue per kill
        if (d.killClues?.length) d.killClues.forEach(c => { if (c.text) this.killClues.push({ text: c.text, accuracyPct: c.accuracyPct, isFalse: c.isFalse, strength: c.strength }); });
        else if (d.killClue?.text) this.killClues.push({ text: d.killClue.text, accuracyPct: d.killClue.accuracyPct, isFalse: d.killClue.isFalse, strength: d.killClue.strength });
        this.killCounts[d._from] = (this.killCounts[d._from] || 0) + 1;
        this._checkNightDone();
      }
    });
    n.on('INVEST_RESULT', d => { if (this.isHost && d.clue) this.investigationClues.push({ playerId: d._from, clue: d.clue, isFalse: d.isFalse || false }); });
    // Democratic investigation handlers
    n.on('INVEST_REQUEST', d => { this._onInvestRequest(d); });
    n.on('INVEST_VOTE', d => { if (this.isHost) this._onInvestVote(d); });
    n.on('INVEST_DECISION', d => { this._onInvestDecision(d); });
    n.on('SNOOP_ALERT', d => { if (this.myRole === 'killer') this._showSnoopAlert(d); });
    // Team chat
    n.on('TEAM_CHAT', d => {
      if (this.isHost) {
        // Relay only to same-team members
        const team = d.team;
        this.teamSuspicionCounters[team] = (this.teamSuspicionCounters[team] || 0) + 1;
        this._checkSuspicionEscalation(team);
        this.players.forEach(p => {
          if (p.role === team && p.id !== d._from && !p._isBot) {
            this.net.sendTo(p.id, { t: 'TEAM_CHAT', team: d.team, name: d.name, text: d.text });
          }
        });
        // Also show to self if host is same team
        if (this.myRole === team) chat.addMessage(d.name, d.text, `team-${team}`, team);
      } else {
        chat.addMessage(d.name, d.text, `team-${d.team}`, d.team);
      }
    });
    n.on('SUSPICION_MSG', d => {
      chat.addMessage('', d.text, 'system');
      ui.addLog(d.text, 'ls');
    });
    n.on('NEW_EVIDENCE', d => {
      if (d.evidence) {
        // Only add if not already in ledger
        if (!this.evidenceLedger.find(e => e.id === d.evidence.id)) {
          this.evidenceLedger.push(d.evidence);
        }
      }
    });
    n.on('DOC_PROTECT', d => { if (this.isHost) this.doctorTarget = d.targetId; });
    n.on('VOTE', d => { if (this.isHost) { this.votes[d._from] = d.targetId; this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes }); this._checkVoteDone(); } });
    n.on('CHAT', d => { chat.addMessage(d.persona || d.name, d.text, d.chatType || 'normal'); audio.play('chat'); });
    n.on('LAST_WORDS', d => { chat.addMessage(d.persona || d.name, d.text, 'last-words'); });
    n.on('WHISPER', d => { this._onWhisper(d); });
    n.on('WHISPER_NOTICE', d => { chat.addMessage('', `💬 ${d.senderName} whispered to ${d.receiverName}`, 'system'); });
    n.on('GHOST_CLUE', d => { chat.addMessage('👻 Ghost', d.text, 'ghost'); ui.addLog(`👻 Ghost clue: "${d.text}"`, 'lc'); audio.play('ghost'); });
    n.on('SUSPICION_VOTE', d => { if (this.isHost) { if (!this.suspicionVotes[d.targetId]) this.suspicionVotes[d.targetId] = { up: 0, down: 0 }; this.suspicionVotes[d.targetId][d.dir]++; this.net.relay({ t: 'SUSPICION_UPDATE', votes: this.suspicionVotes }); } });
    n.on('SUSPICION_UPDATE', d => { this.suspicionVotes = d.votes || {}; this._renderSuspicion(); });
    n.on('NIGHT_EVENT', d => { this.currentNightEvent = d.event; this._showNightEvent(d.event); });
    n.on('KICKED', d => { if (d.targetId === this.myId) { ui.toast('You were kicked', true); ui.show('s-land'); this.phase = 'lobby'; this.players = []; } });
    n.on('SETTINGS', d => { this.settings = d.settings; });
  }

  // ── LOBBY ──────────────────────────────────────────────────
  createLobby(name, avatar) { this.myName = name; this.myAvatar = avatar; this.net.createRoom(this.myId, name); }
  joinLobby(name, avatar, code) { this.myName = name; this.myAvatar = avatar; this.net.joinRoom(this.myId, name, code); }
  _showLobby() { ui.show('s-lobby'); document.getElementById('lCode').textContent = this.lobbyCode; this._renderLobby(); }
  _renderLobby() { if (this.phase !== 'lobby') return; ui.renderLobby(this.players, this.myId, this.isHost, id => this.kickPlayer(id)); }
  kickPlayer(id) { if (!this.isHost) return; this.net.relay({ t: 'KICKED', targetId: id }); this.players = this.players.filter(p => p.id !== id); this._renderLobby(); }

  // ── HOST START ─────────────────────────────────────────────
  hostStart() {
    if (!this.isHost || this.players.length < 4) return;
    const roleMap = assignRoles(this.players, this.settings);
    roleMap.forEach(r => { const p = this.players.find(x => x.id === r.id); if (p) { p.role = r.role; p.alive = true; } });
    const { personas, characters } = assignCharacters(this.players.map(p => p.id));
    this._hostPersonas = personas; this._hostCharacters = characters;
    this.charData = {};
    personas.forEach((persona, id) => { this.charData[id] = { persona, pub: characters.get(id).pub }; });
    this.charData[this.myId].hidden = characters.get(this.myId).hidden;
    this.myPersona = personas.get(this.myId);
    this.myCharacter = { pub: characters.get(this.myId).pub, hidden: characters.get(this.myId).hidden };
    this.phase = 'role'; this.round = 1; this.readySet = new Set(); this.jesterWinner = null; this.killCounts = {};
    const publicPlayers = this.players.map(p => ({ id: p.id }));
    this.players.forEach(p => {
      const allies = p.role === 'killer' ? this.players.filter(x => x.role === 'killer' && x.id !== p.id).map(x => personas.get(x.id).name) : [];
      const cd = {};
      personas.forEach((persona, id) => { cd[id] = { persona, pub: characters.get(id).pub }; if (id === p.id) cd[id].hidden = characters.get(id).hidden; });
      if (p.id === this.myId) { this.myRole = p.role; this._showRole(allies); }
      else this.net.relay({ t: 'ROLE', role: p.role, allies, publicPlayers, round: this.round, settings: this.settings, charData: cd }, p.id);
    });
  }

  _showRole(allies) {
    ui.show('s-role'); ui.renderRole(this.myRole, allies, this.myPersona, this.myCharacter); audio.play(this.myRole === 'killer' ? 'bad' : 'good'); ui.hideRoleReminder();
    // Set team chat tabs
    chat.setTeamRole(this.myRole);
  }

  pressReady() { document.getElementById('readyBtn').disabled = true; document.getElementById('readyBtn').textContent = 'Waiting...'; if (this.isHost) { this.readySet.add(this.myId); this._checkReady(); } else this.net.relay({ t: 'READY' }); }
  _checkReady() {
    // Auto-add bot ready votes
    this.bots.forEach(bid => this.readySet.add(bid));
    if (this.readySet.size >= this.players.filter(p => !p.disconnected).length) this._beginGrace();
  }

  // ── Skip Vote System ───────────────────────────────────────
  voteSkip() {
    if (this.mySkipVoted) return;
    if (this.phase !== 'grace' && this.phase !== 'investigate') return;
    const me = this.players.find(p => p.id === this.myId);
    if (me && !me.alive) { ui.toast('Dead players cannot vote to skip', true); return; }
    this.mySkipVoted = true;
    const btn = document.getElementById('btnSkip');
    if (btn) { btn.disabled = true; btn.textContent = '✓ Voted to skip'; }
    if (this.isHost) {
      this.skipVotes.add(this.myId);
      const alive = this.players.filter(p => p.alive && !p.disconnected).length;
      const needed = Math.ceil(alive * 0.7);
      this._updateSkipUI(this.skipVotes.size, needed);
      this.net.relay({ t: 'SKIP_UPDATE', count: this.skipVotes.size, needed });
      if (this.skipVotes.size >= needed) this._triggerSkip();
    } else {
      this.net.relay({ t: 'SKIP_VOTE' });
    }
  }

  _triggerSkip() {
    if (this.phase === 'grace') {
      clearInterval(this.graceInterval);
      const gb = document.getElementById('graceBanner'); if (gb) gb.remove();
      this._beginNight();
    } else if (this.phase === 'investigate') {
      clearInterval(this.investInterval);
      this._beginDinner();
    }
  }

  _updateSkipUI(count, needed) {
    const el = document.getElementById('skipCount');
    if (el) el.textContent = `${count}/${needed} voted to skip`;
  }

  _renderSkipButton() {
    const alive = this.players.filter(p => p.alive && !p.disconnected).length;
    const needed = Math.ceil(alive * 0.7);
    return `<div style="text-align:center;margin:8px 0"><button class="btn btn-sm btn-out" id="btnSkip" style="font-size:.75rem;padding:4px 14px">⏩ Skip Phase</button><div id="skipCount" class="muted" style="font-size:.65rem;margin-top:3px">0/${needed} voted to skip</div></div>`;
  }

  // ══════════════════════════════════════════════════════════
  // GRACE PERIOD — Pre-game socializing (15s)
  // ══════════════════════════════════════════════════════════
  _beginGrace() {
    if (!this.isHost) return;
    this.skipVotes = new Set(); this.mySkipVoted = false;
    const dur = 60000;
    const payload = { t: 'GRACE', dur, round: this.round, pa: this.players.map(p => ({ id: p.id })) };
    this.net.relay(payload);
    this._onGrace(payload);
  }

  _onGrace(d) {
    this.phase = 'grace';
    this.skipVotes = new Set(); this.mySkipVoted = false;
    ui.show('s-day');
    audio.play('day');

    // Header
    const h2 = document.querySelector('#s-day h2');
    if (h2) { h2.textContent = '🏰 THE MANOR AWAKENS'; h2.style.color = 'var(--gold)'; }

    const al = this.players.length;
    ui.renderDayHeader(this.round, al, al);

    // Hide death/clue/vote UI
    ui.hideDeathAnnounce(); ui.hideDoctorSave(); ui.hideClue();
    document.getElementById('deadMsg').style.display = 'none';
    document.getElementById('cvBtn').style.display = 'none';
    document.getElementById('vList').innerHTML = '';
    const lwPanel = document.getElementById('lastWordsPanel');
    if (lwPanel) lwPanel.style.display = 'none';

    // Show Town Board + Evidence buttons
    const tbBtn = document.getElementById('btnTownBoard');
    if (tbBtn) tbBtn.style.display = 'inline-flex';
    const ewBtn = document.getElementById('btnEvidenceWindow');
    if (ewBtn) ewBtn.style.display = 'inline-flex';

    // Enable chat during grace period
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) chatPanel.style.display = 'block';
    chat.setEnabled(true);
    chat.clear();
    chat.addMessage('', '🏰 The guests have gathered in the manor. Introduce yourselves...', 'system');

    // Show persona introductions in the log
    ui.clearLog();
    this.players.forEach(p => {
      ui.addLog(`${this._pname(p.id)} has entered the manor.`, 'ls');
    });

    // Grace countdown in a banner above the log
    const logArea = document.getElementById('dLog');
    if (logArea) {
      const banner = document.createElement('div');
      banner.id = 'graceBanner';
      banner.className = 'grace-banner';
      banner.innerHTML =
        `<div class="grace-title">🕰 THE EVENING BEGINS</div>` +
        `<div class="muted" style="font-size:.75rem">Mingle, review the Town Board, and prepare yourself...</div>` +
        `<div class="grace-timer" id="graceTimer">60</div>` +
        `<div class="muted" style="font-size:.7rem">Night falls soon. The killer is among you.</div>` +
        this._renderSkipButton();
      logArea.parentNode.insertBefore(banner, logArea);
      // Wire skip button
      const skipBtn = document.getElementById('btnSkip');
      if (skipBtn) skipBtn.addEventListener('click', () => this.voteSkip());
    }

    // Role reminder
    ui.showRoleReminder(this.myRole);

    // Timer
    let tl = Math.floor((d.dur || 60000) / 1000);
    ui.updateTimer('dTimer', tl);
    document.getElementById('dTimer').classList.remove('urg');
    clearInterval(this.graceInterval);
    this.graceInterval = setInterval(() => {
      tl--;
      ui.updateTimer('dTimer', tl);
      const gt = document.getElementById('graceTimer');
      if (gt) gt.textContent = tl;
      if (tl <= 5) {
        const gt2 = document.getElementById('graceTimer');
        if (gt2) gt2.style.color = 'var(--blood-bright)';
      }
      if (tl <= 0) {
        clearInterval(this.graceInterval);
        const gb = document.getElementById('graceBanner');
        if (gb) gb.remove();
        if (this.isHost) this._beginNight();
      }
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════
  // PHASE 1: NIGHT (Lights Out — Killer Strikes)
  // ══════════════════════════════════════════════════════════
  _beginNight() {
    if (!this.isHost) return;
    this.phase = 'night'; this.nightActions = {}; this.doctorTarget = null;
    this.killClues = []; this.investigationClues = [];
    this.readySet = new Set(); this.savedId = null;
    this.suspicionVotes = {}; this.mySuspicionVotes = new Set();
    this.whispersUsed = 0; this.ghostClueUsed = false;
    // Night event
    this.currentNightEvent = this.settings.nightEvents !== false ? this._rollNightEvent() : null;
    const dur = this.settings.nightTime * 1000;
    const nightPayload = { t: 'NIGHT', round: this.round, dur };
    if (this.currentNightEvent) {
      nightPayload.event = this.currentNightEvent;
      this.net.relay({ t: 'NIGHT_EVENT', event: this.currentNightEvent });
    }
    this.net.relay(nightPayload);
    this._showNight(dur);
    clearTimeout(this.nightTimeout);
    this.nightTimeout = setTimeout(() => { if (this.phase === 'night') this._resolveNight(); }, dur);
    // Init round recap
    this.roundRecap[this.round] = { events: [], evidence: [], votes: {} };
    if (this.currentNightEvent) this.roundRecap[this.round].events.push(`🌩 Night Event: ${this.currentNightEvent.name}`);
    setTimeout(() => this._botNightActions(), 1000);
  }

  _showNight(dur) {
    this.phase = 'night';
    if (this.canvasCtrl) this.canvasCtrl.setNightPulse(1);
    document.getElementById('nightOv').classList.add('on');
    document.getElementById('nBig').textContent = `NIGHT ${this.round}`;
    document.getElementById('nSm').textContent = '🕯 LIGHTS OUT — DARKNESS SWALLOWS THE MANOR';
    audio.play('night');
    setTimeout(() => audio.play('kill', 1), 2500);

    const me = this.players.find(p => p.id === this.myId);
    const alive = this.players.filter(p => p.alive && p.id !== this.myId);
    if (!me || !me.alive) { ui.renderNightCivilianUI(); return; }

    if (this.myRole === 'killer') {
      // Filter out fellow killers (they know each other)
      const killerIds = this.players.filter(p => p.role === 'killer' && p.id !== this.myId).map(p => p.id);
      const nonKillerAlive = alive.filter(p => !killerIds.includes(p.id));
      // Show ally info
      if (killerIds.length > 0) {
        const allyNames = killerIds.map(id => this._pname(id)).join(', ');
        ui.addLog(`☠ Your fellow killer${killerIds.length > 1 ? 's' : ''}: ${allyNames}`, 'lk');
      }
      this._showKillerNight(nonKillerAlive);
    }
    else if (this.myRole === 'doctor') this._showDoctorNight(alive);
    else {
      // Civilians/Detective wait during night — investigation comes AFTER
      const area = document.getElementById('nAct');
      if (area) area.innerHTML =
        `<div class="muted tc" style="font-size:1rem;line-height:1.8">💤 The lights are out...<br>` +
        `<span style="color:rgba(255,255,255,.15);font-size:.85rem">Wait for the lights to come back on to investigate.</span></div>` +
        `<div style="font-size:3rem;text-align:center;margin-top:16px;animation:pu 2.5s infinite">🕯</div>`;
    }
  }

  _showKillerNight(alive) {
    const targets = alive.map(p => ({ id: p.id, displayName: this._pname(p.id) }));
    const kl = ui.renderNightKillerUI(targets);
    if (!kl) return;
    kl.onclick = async (e) => {
      const btn = e.target.closest('.bplayer');
      if (!btn || btn.disabled) return;
      kl.querySelectorAll('.bplayer').forEach(b => { b.disabled = true; b.style.opacity = b === btn ? '1' : '.25'; });
      const tid = btn.dataset.pid;
      audio.haptic([100]);
      const myKills = this.killCounts[this.myId] || 0;
      const diff = getKillDifficulty(myKills);
      const qteC = document.getElementById('kCfm');
      if (qteC) {
        qteC.style.display = 'block'; qteC.innerHTML = '';
        const score = await runQTE(qteC, diff, 'kill');
        const killerChar = this.myCharacter;
        // Pass all characters for potential false evidence
        const allChars = this._hostCharacters || new Map();
        const killClues = generateKillClues(killerChar, score, myKills, allChars, this.myId);
        // Kill confirmation + perfect kill feedback
        if (killClues.length === 0) {
          ui.toast('☠ Clean kill — no trace left behind.', false);
          ui.addLog('☠ Perfect kill! No evidence was left.', 'lk');
        } else {
          const strengthMsg = { trace: 'barely left a mark', small: 'left a small trace', medium: 'left some evidence', large: 'left strong evidence', perfect: 'left damning evidence' };
          const worst = killClues.reduce((a, b) => {
            const order = ['trace','small','medium','large','perfect']; return order.indexOf(a.strength) > order.indexOf(b.strength) ? a : b;
          });
          ui.toast(`🗡 Target marked. You ${strengthMsg[worst.strength] || 'left evidence'}. (${killClues.length} clue${killClues.length > 1 ? 's' : ''} dropped)`, false);
        }
        if (this.isHost) { this.nightActions[this.myId] = tid; killClues.forEach(c => this.killClues.push({ text: c.text, accuracyPct: c.accuracyPct, isFalse: c.isFalse, strength: c.strength })); this.killCounts[this.myId] = myKills + 1; this._checkNightDone(); }
        else this.net.relay({ t: 'KILL_ACTION', targetId: tid, killClues });
      }
    };
  }

  _showDoctorNight(alivePlayers) {
    const canPS = !this.lastDoctorSelf;
    const targets = this.players.filter(p => p.alive).map(p => ({ ...p, isSelf: p.id === this.myId, displayName: this._pname(p.id) }));
    const dl = ui.renderNightDoctorUI(targets, !canPS);
    if (!dl) return;
    dl.onclick = async (e) => {
      const btn = e.target.closest('.bdet');
      if (!btn || btn.disabled) return;
      dl.querySelectorAll('.bdet').forEach(b => { b.disabled = true; b.style.opacity = b === btn ? '1' : '.25'; });
      document.getElementById('docCfm').style.display = 'block';
      const tid = btn.dataset.pid;
      this.lastDoctorSelf = (tid === this.myId);
      if (this.isHost) this.doctorTarget = tid; else this.net.relay({ t: 'DOC_PROTECT', targetId: tid });
      audio.haptic([50]);
      // Doctor waits — investigation comes in the next phase
    };
  }

  _checkNightDone() {
    const killers = this.players.filter(p => p.alive && p.role === 'killer');
    if (killers.every(k => this.nightActions[k.id])) { clearTimeout(this.nightTimeout); setTimeout(() => this._resolveNight(), 1500); }
  }

  _resolveNight() {
    if (!this.isHost) return;
    // Multiple killers = multiple kills (each killer targets independently)
    const killedIds = []; let savedIds = [];
    const killerTargets = {}; // deduplicate: each unique target
    Object.entries(this.nightActions).forEach(([killerId, targetId]) => {
      killerTargets[targetId] = (killerTargets[targetId] || []);
      killerTargets[targetId].push(killerId);
    });
    Object.entries(killerTargets).forEach(([targetId, killerIds]) => {
      const vic = this.players.find(p => p.id === targetId);
      if (vic && vic.alive) {
        if (this.doctorTarget === targetId) {
          savedIds.push(targetId);
        } else {
          vic.alive = false;
          killedIds.push(targetId);
        }
      }
    });
    this.killedIds = killedIds; this.savedIds = savedIds;
    // Compat: keep single-target fields for recap
    this.killedId = killedIds[0] || null; this.savedId = savedIds[0] || null;
    // Check if detective was killed
    killedIds.forEach(kid => {
      const killedPlayer = this.players.find(p => p.id === kid);
      if (killedPlayer && killedPlayer.role === 'detective') this.detectiveDead = true;
    });
    // Transition to INVESTIGATION phase (lights on)
    const investDur = (this.settings.investTime || 40) * 1000;
    // Add kill clues to evidence ledger as UNVERIFIED
    this.killClues.forEach(c => {
      this.evidenceLedger.push({ id: 'ev-' + Math.random().toString(36).slice(2,8), text: c.text, isFalse: c.isFalse, status: 'unverified', accuracyPct: null, verdictText: null, source: 'crime-scene', round: this.round, strength: c.strength || 'medium' });
    });
    const payload = { t: 'INVESTIGATE', round: this.round, killedIds, savedIds, killedId: killedIds[0] || null, savedId: savedIds[0] || null, detectiveDead: this.detectiveDead, evidence: this.evidenceLedger.filter(e => e.round === this.round && e.source === 'crime-scene').map(e => ({ id: e.id, text: e.text, strength: e.strength })), dur: investDur, pa: this.players.map(p => ({ id: p.id, alive: p.alive })) };
    this.net.relay(payload);
    this._onInvestigate(payload);
  }

  // ══════════════════════════════════════════════════════════
  // PHASE 2: INVESTIGATION (Limits + Verification)
  // Detective: 2 actions | Civilians: 1 each, 3 team total
  // ══════════════════════════════════════════════════════════
  _onInvestigate(d) {
    d.pa.forEach(u => { const p = this.players.find(x => x.id === u.id); if (p) p.alive = u.alive; });
    this.phase = 'investigate';
    // Reset per-phase counters
    this.teamChatUsed = 0;
    this._renderResourceHUD();
    this.skipVotes = new Set(); this.mySkipVoted = false;
    this.investigationRequests = []; this.pendingInvestRequest = null;
    if (d.detectiveDead) this.detectiveDead = true;
    this.myActionsUsed = 0;
    this.civilianActionsUsed = 0;
    if (this.canvasCtrl) this.canvasCtrl.setNightPulse(0);
    document.getElementById('nightOv').classList.remove('on');
    ui.show('s-day');
    audio.play('day');

    // Add received crime scene evidence to ledger (non-host)
    if (!this.isHost && d.evidence?.length) {
      d.evidence.forEach(e => {
        if (!this.evidenceLedger.find(x => x.id === e.id)) {
          this.evidenceLedger.push({ id: e.id, text: e.text, isFalse: false, status: 'unverified', accuracyPct: null, verdictText: null, source: 'crime-scene', round: this.round, strength: e.strength || 'medium' });
        }
      });
    }

    const al = this.players.filter(p => p.alive).length;
    ui.renderDayHeader(this.round, al, this.players.length);

    const h2 = document.querySelector('#s-day h2');
    if (h2) { h2.textContent = '🔦 LIGHTS ON — INVESTIGATE'; h2.style.color = 'var(--det-bright)'; }

    // Death announcement (support multiple kills)
    ui.hideDeathAnnounce(); ui.hideDoctorSave();
    const killedIds = d.killedIds || (d.killedId ? [d.killedId] : []);
    const savedIds = d.savedIds || (d.savedId ? [d.savedId] : []);
    if (killedIds.length > 0) {
      killedIds.forEach(kid => {
        ui.showDeathAnnounce(this._pname(kid));
        ui.addLog(`Night ${this.round}: ${this._pname(kid)} was found dead.`, 'lk');
      });
      if (killedIds.length > 1) ui.addLog(`☠ ${killedIds.length} victims tonight! The killers were busy...`, 'lk');
      if (this.detectiveDead) {
        ui.addLog('🔍 The detective has fallen... evidence can no longer be verified.', 'lk');
      }
    }
    else if (savedIds.length > 0) { ui.showDoctorSave(this._pname(savedIds[0])); ui.addLog(`Night ${this.round}: ${this._pname(savedIds[0])} was saved!`, 'lc'); audio.play('save'); }
    else ui.addLog(`Night ${this.round}: No one died.`, 'ls');

    // Crime scene evidence — UNVERIFIED (grey ? circle)
    ui.hideClue();
    const crimeEvidence = this.evidenceLedger.filter(e => e.round === this.round && e.source === 'crime-scene');
    if (crimeEvidence.length > 0) {
      ui.showClue(crimeEvidence.map(e =>
        `<div class="evidence-box" id="ev-display-${e.id}"><span class="evidence-label">🔍 CRIME SCENE EVIDENCE</span>${formatEvidence(e.text, e.status, e.accuracyPct, e.isFalse)}</div>`
      ).join(''));
    }

    // Skip button
    const logAreaTop = document.getElementById('dLog');
    if (logAreaTop) {
      const skipDiv = document.createElement('div');
      skipDiv.id = 'investSkipArea';
      skipDiv.innerHTML = this._renderSkipButton();
      logAreaTop.parentNode.insertBefore(skipDiv, logAreaTop);
      const skipBtn = document.getElementById('btnSkip');
      if (skipBtn) skipBtn.addEventListener('click', () => this.voteSkip());
    }

    const tbBtn = document.getElementById('btnTownBoard');
    if (tbBtn) tbBtn.style.display = 'inline-flex';
    const ewBtn = document.getElementById('btnEvidenceWindow');
    if (ewBtn) ewBtn.style.display = 'inline-flex';

    const me = this.players.find(p => p.id === this.myId);
    const isDead = me && !me.alive;
    document.getElementById('deadMsg').style.display = isDead ? 'block' : 'none';
    document.getElementById('cvBtn').style.display = 'none';
    document.getElementById('vList').innerHTML = '';

    // Hide chat during investigation
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) chatPanel.style.display = 'none';
    chat.setEnabled(false);

    ui.showRoleReminder(this.myRole);

    // Investigation UI with LIMITS
    const logArea = document.getElementById('dLog');
    if (me && me.alive && logArea && !me._isBot) {
      this._renderInvestigationUI(logArea);
    }

    // Suspicion voting UI
    if (me && me.alive && !me._isBot && this.settings.suspicion !== false) this._showSuspicionUI();

    // Bot auto-actions during investigation
    if (this.isHost) this._botInvestigate();

    // Timer
    let tl = Math.floor((d.dur || 40000) / 1000);
    ui.updateTimer('dTimer', tl);
    document.getElementById('dTimer').classList.remove('urg');
    clearInterval(this.investInterval);
    this.investInterval = setInterval(() => {
      tl--; ui.updateTimer('dTimer', tl);
      if (tl <= 0) { clearInterval(this.investInterval); if (this.isHost) this._beginDinner(); }
    }, 1000);
  }

  _getMyMaxActions() {
    if (this.myRole === 'detective') return 2;
    // Scale civilian actions with player count
    const alive = this.players.filter(p => p.alive).length;
    if (alive >= 11) return 3;
    if (alive >= 7) return 2;
    return 1;
  }

  _canCivilianAct() {
    if (this.myRole === 'detective' || this.myRole === 'killer') return true;
    // Scale team pool with player count
    const alive = this.players.filter(p => p.alive).length;
    const teamPool = alive >= 11 ? 6 : alive >= 7 ? 4 : 3;
    return this.civilianActionsUsed < teamPool;
  }

  _renderInvestigationUI(logArea) {
    const isDet = this.myRole === 'detective';
    const isKiller = this.myRole === 'killer';
    const isCivilian = !isDet && !isKiller;
    const maxActions = this._getMyMaxActions();
    const remaining = maxActions - this.myActionsUsed;
    const canAct = remaining > 0 && this._canCivilianAct();
    const alive = this.players.filter(p => p.alive && p.id !== this.myId && !p._isBot);
    const unverified = this.evidenceLedger.filter(e => e.status === 'unverified');

    // Remove old
    const old = document.getElementById('investArea');
    if (old) old.remove();

    if (!canAct) return;

    const investDiv = document.createElement('div');
    investDiv.id = 'investArea';
    const acColor = isDet ? 'var(--det-bright)' : 'var(--gold)';
    const roleLabel = isDet ? '🔍 Detective' : '🔎 Civilian';

    let html = `<div style="color:${acColor};font-family:var(--font-display);font-size:.9rem;margin:10px 0 6px">${roleLabel} — ${remaining} action${remaining > 1 ? 's' : ''} remaining</div>`;

    // Civilians need group permission — Detective/Killer investigate directly
    if (isCivilian) {
      html += `<div style="margin-bottom:6px"><button class="btn btn-sm btn-out" id="btnRequestInvest" style="width:100%">🔎 Request Investigation (${this.myActionsUsed}/${maxActions})</button><div class="muted" style="font-size:.65rem;margin-top:3px">Other players must approve your investigation</div></div>`;
      html += `<div id="investQTE" style="display:none"></div><div id="investResult" style="display:none" class="evidence-box"></div>`;
      investDiv.innerHTML = html;
      logArea.parentNode.insertBefore(investDiv, logArea);
      const reqBtn = document.getElementById('btnRequestInvest');
      if (reqBtn) reqBtn.onclick = () => this._requestInvestigation();
      return;
    }

    // Detective/Killer: direct investigation
    html += `<div style="margin-bottom:6px"><div class="evidence-label" style="margin-bottom:4px">🔎 INVESTIGATE A SUSPECT</div><div id="investList"></div></div>`;

    // Option 2: Verify evidence — DETECTIVE ONLY (and only if detective is alive)
    if (isDet && !this.detectiveDead && unverified.length > 0) {
      html += `<div style="margin-top:8px"><div class="evidence-label" style="margin-bottom:4px">🔬 VERIFY EVIDENCE (detective only)</div><div id="verifyList"></div></div>`;
    }

    // Detective: Investigate Hidden Traits (3/match)
    if (isDet && this.traitInvestsUsed < 3) {
      html += `<div style="margin-top:8px"><button class="btn btn-sm btn-out" id="btnTraitInvest" style="width:100%">🕵 Investigate Hidden Traits (${3 - this.traitInvestsUsed}/3 left)</button></div>`;
    }

    // Killer: Forge Evidence (1/match)
    if (isKiller && this.forgesUsed < 1) {
      html += `<div style="margin-top:8px"><button class="btn btn-sm btn-out" id="btnForge" style="width:100%;border-color:rgba(229,57,53,.3);color:#e53935">🔨 Forge Evidence (${1 - this.forgesUsed}/1 left)</button></div>`;
    }
    html += `<div id="investQTE" style="display:none"></div><div id="investResult" style="display:none" class="evidence-box"></div>`;
    investDiv.innerHTML = html;
    logArea.parentNode.insertBefore(investDiv, logArea);

    // Wire forge/trait buttons
    const forgeBtn = document.getElementById('btnForge');
    if (forgeBtn) forgeBtn.onclick = () => this._forgeEvidence();
    const traitBtn = document.getElementById('btnTraitInvest');
    if (traitBtn) traitBtn.onclick = () => this._investigateTraits();

    // Populate suspect buttons
    const il = document.getElementById('investList');
    if (il) {
      alive.forEach(p => {
        const b = document.createElement('button');
        b.className = 'bdet';
        if (!isDet) { b.style.borderColor = 'rgba(201,168,76,.3)'; b.style.background = 'rgba(201,168,76,.05)'; }
        b.innerHTML = `<span>${this._pname(p.id)}</span>`;
        b.dataset.pid = p.id;
        il.appendChild(b);
      });
      il.onclick = async (e) => {
        const btn = e.target.closest('.bdet');
        if (!btn || btn.disabled) return;
        await this._doInvestigate(btn.dataset.pid);
      };
    }

    // Populate verify buttons
    const vl = document.getElementById('verifyList');
    if (vl) {
      unverified.forEach(ev => {
        const b = document.createElement('button');
        b.className = 'bdet';
        b.style.borderColor = 'rgba(201,168,76,.3)'; b.style.background = 'rgba(201,168,76,.05)';
        b.innerHTML = `<span style="font-size:.75rem">📋 "${ev.text.slice(0, 40)}..."</span>`;
        b.dataset.evid = ev.id;
        vl.appendChild(b);
      });
      vl.onclick = async (e) => {
        const btn = e.target.closest('.bdet');
        if (!btn || btn.disabled) return;
        await this._doVerify(btn.dataset.evid);
      };
    }
  }

  async _doInvestigate(tid) {
    const isDet = this.myRole === 'detective';
    const investArea = document.getElementById('investArea');
    const il = document.getElementById('investList'); if (il) il.style.display = 'none';
    const vl = document.getElementById('verifyList'); if (vl) vl.style.display = 'none';
    const diff = getInvestigateDifficulty(isDet);
    const qteArea = document.getElementById('investQTE');
    if (qteArea) { qteArea.style.display = 'block'; qteArea.innerHTML = ''; }
    const score = await runQTE(qteArea, diff, 'investigate');
    const tc = { pub: this.charData[tid]?.pub, hidden: this.charData[tid]?.hidden };
    const tp = this.charData[tid]?.persona || { name: '???' };
    const target = this.players.find(x => x.id === tid);
    const result = generateInvestClue(tc, tp, target?.role, score, isDet);

    // Add to evidence ledger as unverified
    const evId = 'ev-' + Math.random().toString(36).slice(2, 8);
    this.evidenceLedger.push({ id: evId, text: result.text, isFalse: result.isFalse, status: 'unverified', accuracyPct: null, verdictText: null, source: 'investigation', round: this.round, strength: result.isStrong ? 'large' : 'medium' });

    const resEl = document.getElementById('investResult');
    if (resEl) { resEl.innerHTML = `<span class="evidence-label">🔎 INVESTIGATION REPORT</span>${formatEvidence(result.text, 'unverified')}`; resEl.style.display = 'block'; }
    this.myActionsUsed++;
    if (!isDet && this.myRole !== 'killer') this.civilianActionsUsed++;

    // Mood-based notification with varied atmospheric fail messages
    if (!result.success) {
      const failMsgs = ['The shadows hide their secrets well...', 'Your search turned up empty — for now.', 'The evidence slipped through your fingers.', 'Nothing of value was found... this time.', 'The manor guards its secrets jealously.'];
      ui.addLog(failMsgs[Math.floor(Math.random() * failMsgs.length)], 'ls');
      this._showMoodNotification(score, 'investigate-fail');
    } else {
      this._showMoodNotification(score, 'investigate');
    }

    if (this.isHost) this.investigationClues.push({ playerId: this.myId, clue: result.text, isFalse: result.isFalse });
    else this.net.relay({ t: 'INVEST_RESULT', clue: result.text, isFalse: result.isFalse });

    // Killer counter-intel: send snooping alert
    this._sendSnoopAlert(score);

    const investSkip = document.getElementById('investSkipArea'); if (investSkip) investSkip.remove();

    // Re-render if more actions available
    const logArea = document.getElementById('dLog');
    if (this.myActionsUsed < this._getMyMaxActions() && this._canCivilianAct() && logArea) {
      setTimeout(() => this._renderInvestigationUI(logArea), 2000);
    }
  }

  async _doVerify(evId) {
    const ev = this.evidenceLedger.find(e => e.id === evId);
    if (!ev) return;
    // Only detective can verify
    if (this.myRole !== 'detective') { ui.toast('Only the detective can verify evidence', true); return; }
    if (this.detectiveDead) { ui.toast('The detective is gone... evidence can no longer be verified.', true); return; }
    const il = document.getElementById('investList'); if (il) il.style.display = 'none';
    const vl = document.getElementById('verifyList'); if (vl) vl.style.display = 'none';
    const diff = getVerifyDifficulty();
    const qteArea = document.getElementById('investQTE');
    if (qteArea) { qteArea.style.display = 'block'; qteArea.innerHTML = ''; }
    const score = await runQTE(qteArea, diff, 'verify');
    const result = computeVerification(score, ev.isFalse);
    ev.status = 'verified';
    ev.accuracyPct = result.accuracyPct;
    ev.verdictText = result.verdictText;

    const resEl = document.getElementById('investResult');
    if (resEl) {
      resEl.innerHTML = `<span class="evidence-label">🔬 VERIFICATION RESULT</span>${formatEvidence(ev.text, 'verified', result.accuracyPct, ev.isFalse && result.detectedFalse)}<div style="margin-top:6px;font-size:.75rem;color:var(--gold)">${result.verdictText}</div>`;
      resEl.style.display = 'block';
    }

    // Update evidence display if visible
    const evDisplay = document.getElementById('ev-display-' + evId);
    if (evDisplay) {
      evDisplay.innerHTML = `<span class="evidence-label">🔍 CRIME SCENE EVIDENCE</span>${formatEvidence(ev.text, 'verified', result.accuracyPct, ev.isFalse && result.detectedFalse)}`;
    }

    this.myActionsUsed++;

    // Mood-based verification notification
    this._showMoodNotification(score, 'verify', result.accuracyPct);

    const investSkip = document.getElementById('investSkipArea'); if (investSkip) investSkip.remove();

    // Re-render if more actions available
    const logArea = document.getElementById('dLog');
    if (this.myActionsUsed < this._getMyMaxActions() && this._canCivilianAct() && logArea) {
      setTimeout(() => this._renderInvestigationUI(logArea), 2000);
    }
  }

  // ══════════════════════════════════════════════════════════
  // DEMOCRATIC INVESTIGATION (Civilian Permission System)
  // ══════════════════════════════════════════════════════════

  _requestInvestigation() {
    const reqId = 'req-' + Math.random().toString(36).slice(2, 8);
    const pname = this._pname(this.myId);
    const btn = document.getElementById('btnRequestInvest');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Request Pending...'; }
    if (this.isHost) {
      const req = { id: reqId, playerId: this.myId, personaName: pname, allows: [], denies: [], status: 'pending' };
      this.investigationRequests.push(req);
      this.pendingInvestRequest = req;
      this.net.relay({ t: 'INVEST_REQUEST', reqId, playerId: this.myId, personaName: pname });
      this._onInvestRequest({ reqId, playerId: this.myId, personaName: pname });
    } else {
      this.net.relay({ t: 'INVEST_REQUEST', reqId, playerId: this.myId, personaName: pname });
    }
    // Temp enable chat for 30s to explain
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) chatPanel.style.display = 'block';
    chat.setEnabled(true);
    chat.addMessage('', `🔎 ${pname} wants to investigate! They have 30 seconds to explain why.`, 'system');
  }

  _onInvestRequest(d) {
    // Host tracks request
    if (this.isHost && !this.investigationRequests.find(r => r.id === d.reqId)) {
      this.investigationRequests.push({ id: d.reqId, playerId: d.playerId, personaName: d.personaName, allows: [], denies: [], status: 'pending' });
      this.pendingInvestRequest = this.investigationRequests.find(r => r.id === d.reqId);
    }

    // Don't show notification to the requester or dead/bot players
    const me = this.players.find(p => p.id === this.myId);
    if (d.playerId === this.myId || !me?.alive) return;

    // Show notification card to everyone else
    const stack = document.getElementById('notificationStack');
    if (!stack) return;
    const card = document.createElement('div');
    card.className = 'invest-request-card';
    card.id = `investReq-${d.reqId}`;
    card.innerHTML = `
      <div class="ir-header">🔎 Investigation Request</div>
      <div class="ir-persona">${d.personaName} wants to investigate</div>
      <div class="ir-timer" id="irTimer-${d.reqId}">30s to discuss</div>
      <div class="ir-votes" id="irVotes-${d.reqId}"></div>
      <div class="ir-actions">
        <button class="btn btn-sm ir-allow" id="irAllow-${d.reqId}">✅ Allow</button>
        <button class="btn btn-sm ir-deny" id="irDeny-${d.reqId}">❌ Deny</button>
      </div>
    `;
    stack.appendChild(card);

    document.getElementById(`irAllow-${d.reqId}`).onclick = () => {
      this._castInvestVote(d.reqId, true);
      card.querySelector('.ir-actions').innerHTML = '<div class="muted" style="font-size:.7rem">✅ You voted to allow</div>';
    };
    document.getElementById(`irDeny-${d.reqId}`).onclick = () => {
      this._castInvestVote(d.reqId, false);
      card.querySelector('.ir-actions').innerHTML = '<div class="muted" style="font-size:.7rem">❌ You voted to deny</div>';
    };

    // 30s timer
    let tl = 30;
    const timerEl = document.getElementById(`irTimer-${d.reqId}`);
    const interval = setInterval(() => {
      tl--;
      if (timerEl) timerEl.textContent = `${tl}s remaining`;
      if (tl <= 0) {
        clearInterval(interval);
        if (this.isHost) this._resolveInvestRequest(d.reqId);
      }
    }, 1000);
    card._interval = interval;

    // Enable chat temporarily for discussion
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) chatPanel.style.display = 'block';
    chat.setEnabled(true);
    chat.addMessage('', `🔎 ${d.personaName} wants to investigate! Discuss and vote.`, 'system');
    audio.play('vote');
  }

  _castInvestVote(reqId, allow) {
    if (this.isHost) {
      this._onInvestVote({ reqId, allow, _from: this.myId });
    } else {
      this.net.relay({ t: 'INVEST_VOTE', reqId, allow });
    }
  }

  _onInvestVote(d) {
    // Host only
    const req = this.investigationRequests.find(r => r.id === d.reqId);
    if (!req || req.status !== 'pending') return;
    if (d.allow) req.allows.push(d._from || this.myId);
    else req.denies.push(d._from || this.myId);
    // Broadcast vote count update
    this.net.relay({ t: 'INVEST_DECISION', reqId: d.reqId, status: 'voting', allows: req.allows.length, denies: req.denies.length });
    // Check if all alive non-requester players have voted
    const aliveVoters = this.players.filter(p => p.alive && p.id !== req.playerId && !p._isBot);
    if (req.allows.length + req.denies.length >= aliveVoters.length) {
      this._resolveInvestRequest(d.reqId);
    }
  }

  _resolveInvestRequest(reqId) {
    const req = this.investigationRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return;
    const approved = req.allows.length >= req.denies.length; // tie = approved
    req.status = approved ? 'approved' : 'denied';
    this.net.relay({ t: 'INVEST_DECISION', reqId, status: req.status, allows: req.allows.length, denies: req.denies.length, playerId: req.playerId });
  }

  _onInvestDecision(d) {
    // Update vote counts
    const votesEl = document.getElementById(`irVotes-${d.reqId}`);
    if (votesEl) votesEl.textContent = `✅ ${d.allows || 0}  /  ❌ ${d.denies || 0}`;

    if (d.status === 'voting') return; // Just a vote count update

    // Final decision
    const card = document.getElementById(`investReq-${d.reqId}`);
    const approved = d.status === 'approved';

    if (card) {
      card.querySelector('.ir-actions').innerHTML = `<div style="font-weight:bold;color:${approved ? '#66bb6a' : '#e53935'};font-size:.8rem">${approved ? '✅ APPROVED' : '❌ DENIED'} (${d.allows}/${d.allows + d.denies})</div>`;
      if (card._interval) clearInterval(card._interval);
      setTimeout(() => card.remove(), 3000);
    }

    ui.addLog(`🔎 Investigation request by ${d.playerId === this.myId ? 'you' : this._pname(d.playerId)}: ${approved ? '✅ Approved' : '❌ Denied'} (${d.allows} yes / ${d.denies} no)`, approved ? 'lc' : 'lk');

    // If I'm the requester and approved → show target selection
    if (d.playerId === this.myId) {
      if (approved) {
        const alive = this.players.filter(p => p.alive && p.id !== this.myId && !p._isBot);
        this._showCivilianTargetSelection(alive);
      } else {
        ui.toast('Your investigation request was denied.', true);
        const btn = document.getElementById('btnRequestInvest');
        if (btn) { btn.disabled = true; btn.textContent = '❌ Request Denied'; btn.style.opacity = '.4'; }
      }
    }

    // Disable chat again after decision
    setTimeout(() => {
      if (this.phase === 'investigate') {
        const chatPanel = document.getElementById('chatPanel');
        if (chatPanel) chatPanel.style.display = 'none';
        chat.setEnabled(false);
      }
    }, 2000);
  }

  _showCivilianTargetSelection(alive) {
    const investArea = document.getElementById('investArea');
    if (!investArea) return;
    let html = `<div class="evidence-label" style="margin-bottom:4px">🔎 CHOOSE A SUSPECT</div><div id="investList"></div>`;
    const targetDiv = document.createElement('div');
    targetDiv.innerHTML = html;
    investArea.appendChild(targetDiv);
    const il = document.getElementById('investList');
    if (il) {
      alive.forEach(p => {
        const b = document.createElement('button');
        b.className = 'bdet';
        b.style.borderColor = 'rgba(201,168,76,.3)'; b.style.background = 'rgba(201,168,76,.05)';
        b.innerHTML = `<span>${this._pname(p.id)}</span>`;
        b.dataset.pid = p.id;
        il.appendChild(b);
      });
      il.onclick = async (e) => {
        const btn = e.target.closest('.bdet');
        if (!btn || btn.disabled) return;
        await this._doInvestigate(btn.dataset.pid);
      };
    }
    const btn = document.getElementById('btnRequestInvest');
    if (btn) btn.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════
  // KILLER COUNTER-INTELLIGENCE (Snooping Alerts)
  // ══════════════════════════════════════════════════════════

  _sendSnoopAlert(score) {
    const myChar = this.myCharacter;
    const myPersona = this.myPersona;
    if (!myChar || !myPersona) return;
    const snoop = generateSnoopClue(myChar, myPersona, score);
    if (!snoop) return;
    // Send to host who relays only to killers
    if (this.isHost) {
      this.net.relay({ t: 'SNOOP_ALERT', text: snoop.text, level: snoop.level });
      if (this.myRole === 'killer') this._showSnoopAlert(snoop);
    } else {
      this.net.relay({ t: 'SNOOP_ALERT', text: snoop.text, level: snoop.level });
    }
  }

  _showSnoopAlert(d) {
    if (this.myRole !== 'killer') return;
    const stack = document.getElementById('notificationStack');
    if (!stack) return;
    const levelColors = { vague: '#888', moderate: '#f9a825', bold: '#ff7043', critical: '#e53935' };
    const card = document.createElement('div');
    card.className = `snoop-alert snoop-${d.level || 'vague'}`;
    card.style.borderLeftColor = levelColors[d.level] || '#888';
    card.innerHTML = `<div class="snoop-icon">🕵</div><div class="snoop-text">${d.text}</div>`;
    stack.appendChild(card);
    audio.play('chat');
    setTimeout(() => { card.classList.add('snoop-fadeout'); setTimeout(() => card.remove(), 500); }, 6000);
  }

  // ══════════════════════════════════════════════════════════
  // PHASE 3: DINNER (Discussion + Voting)
  // ══════════════════════════════════════════════════════════
  _beginDinner() {
    if (!this.isHost) return;
    this.phase = 'dinner';
    this.votes = {};
    const dur = (this.settings.dayTime || 60) * 1000;
    const payload = { t: 'DINNER', round: this.round, dur, investigationClues: this.investigationClues, pa: this.players.map(p => ({ id: p.id, alive: p.alive })) };
    this.net.relay(payload);
    this._onDinner(payload);
  }

  _onDinner(d) {
    d.pa.forEach(u => { const p = this.players.find(x => x.id === u.id); if (p) p.alive = u.alive; });
    this.phase = 'dinner'; this.votes = {}; this.selVote = null; this.voted = false;
    // Reset per-phase counters
    this.teamChatUsed = 0;
    this._renderResourceHUD();

    const h2 = document.querySelector('#s-day h2');
    if (h2) {
      if (d.revote) {
        h2.textContent = '⚡ TIE! FOCUSED REVOTE';
        h2.style.color = '#ff7043';
      } else {
        h2.textContent = '🍽 DINNER — DISCUSSION & VOTE';
        h2.style.color = 'var(--gold)';
      }
    }

    // Revote: restrict vote targets to tied candidates only
    if (d.revote) {
      this.votes = {}; this.selVote = null; this.voted = false;
      this._revoteTiedIds = d.tiedIds || [];
      const names = (d.tiedNames || d.tiedIds?.map(id => this._pname(id)) || []).join(' vs ');
      ui.addLog(`⚡ Vote tied! Focused revote between: ${names}`, 'lv');
      chat.addMessage('', `⚡ The vote is TIED! 15 seconds to decide between: ${names}`, 'system');
    } else {
      this._revoteTiedIds = null;
    }

    const ia = document.getElementById('investArea'); if (ia) ia.remove();
    const investSkip = document.getElementById('investSkipArea'); if (investSkip) investSkip.remove();
    const susDiv = document.getElementById('suspicionArea'); if (susDiv) susDiv.remove();

    // Investigation results in log
    if (d.investigationClues?.length > 0) {
      d.investigationClues.forEach(ic => {
        const cleanText = ic.clue.replace(/<[^>]*>/g, '');
        ui.addLog(`${this._pname(ic.playerId)}: ${formatEvidence(cleanText, 'unverified')}`, 'lc');
      });
    }

    // Suspicion summary in log
    if (Object.keys(this.suspicionVotes).length > 0) {
      Object.entries(this.suspicionVotes).forEach(([tid, v]) => {
        const heat = v.down > v.up ? '🔴' : v.up > v.down ? '🟢' : '⚪';
        ui.addLog(`${heat} ${this._pname(tid)}: ${v.up}👍 ${v.down}👎`, 'ls');
      });
    }

    // Enable chat at dinner
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) chatPanel.style.display = 'block';
    const me = this.players.find(p => p.id === this.myId);
    const isDead = me && !me.alive;

    if (isDead) {
      // Ghost clue for dead players
      if (!this.ghostClueUsed && this.settings.ghostClues !== false) {
        chat.addMessage('', '👻 You are dead. You may leave ONE cryptic 3-word clue for the living.', 'system');
        chat.setEnabled(false);
        this._showGhostClueInput();
      } else {
        chat.addMessage('', 'You are dead. Observe in silence.', 'system');
        chat.setEnabled(false);
      }
    } else {
      chat.setEnabled(true);
      chat.addMessage('', '🍽 The candelabras flicker as you take your seat. Someone at this table is a killer... discuss what you know.', 'system');
      // Whisper button
      if (this.settings.whispers !== false) this._showWhisperUI();
    }

    // Evidence Board button
    this._showEvidenceBoardButton();

    // Voting History button
    if (this.voteHistory.length > 0) this._showVotingHistoryButton();

    // Last words
    const lwPanel = document.getElementById('lastWordsPanel');
    if (this.killedId === this.myId && lwPanel) {
      lwPanel.style.display = 'block';
      let lwTime = 10;
      ui.updateTimer('lwTimer', lwTime);
      clearTimeout(this.lastWordsTimeout);
      const lwIv = setInterval(() => { lwTime--; ui.updateTimer('lwTimer', lwTime); if (lwTime <= 0) { clearInterval(lwIv); lwPanel.style.display = 'none'; } }, 1000);
      this.lastWordsTimeout = setTimeout(() => { clearInterval(lwIv); lwPanel.style.display = 'none'; }, 10000);
    } else if (lwPanel) lwPanel.style.display = 'none';

    this._renderVotes();

    // Show skip/abstain button for living players
    const skipVoteBtn = document.getElementById('skipVoteBtn');
    if (skipVoteBtn && !isDead) { skipVoteBtn.style.display = 'flex'; }

    // Bot auto-vote after 3s
    if (this.isHost) setTimeout(() => this._botVote(), 3000);

    // Dinner timer
    let tl = Math.floor((d.dur || 60000) / 1000);
    ui.updateTimer('dTimer', tl);
    document.getElementById('dTimer').classList.remove('urg');
    clearInterval(this.dayInterval);
    this.dayInterval = setInterval(() => { tl--; ui.updateTimer('dTimer', tl); if (tl <= 0) { clearInterval(this.dayInterval); if (this.isHost) this._closeVote(); } }, 1000);
  }

  _renderVotes() {
    const me = this.players.find(p => p.id === this.myId);
    const isDead = me && !me.alive;
    let dp = this.players.map(p => ({ ...p, name: this._pname(p.id), avatar: this.charData[p.id]?.persona?.icon || '❓' }));
    // If revote, only show tied candidates
    if (this._revoteTiedIds && this._revoteTiedIds.length) {
      dp = dp.filter(p => this._revoteTiedIds.includes(p.id));
    }
    const c = ui.renderVotes(dp, this.myId, this.votes, this.selVote, this.voted, isDead, this.settings.hideVotes);
    if (c) c.onclick = (e) => { const btn = e.target.closest('.bplayer'); if (btn && !btn.disabled) this._pickVote(btn.dataset.pid); };
  }

  _pickVote(id) {
    if (this.voted) return;
    this.selVote = id; audio.play('vote'); this._renderVotes();
    document.getElementById('cvBtn').style.display = 'flex';
    document.getElementById('vStatus').textContent = 'Selected: ' + this._pname(id);
  }

  confirmVote() {
    if (!this.selVote || this.voted) return;
    this.voted = true;
    document.getElementById('cvBtn').style.display = 'none';
    document.getElementById('skipVoteBtn').style.display = 'none';
    document.getElementById('vStatus').textContent = '✓ Vote cast';
    if (this.isHost) { this.votes[this.myId] = this.selVote; this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes }); this._checkVoteDone(); }
    else this.net.relay({ t: 'VOTE', targetId: this.selVote });
    audio.haptic([40]);
  }

  skipVote() {
    if (this.voted) return;
    this.voted = true;
    document.getElementById('cvBtn').style.display = 'none';
    document.getElementById('skipVoteBtn').style.display = 'none';
    document.getElementById('vStatus').textContent = '🚫 Abstained';
    if (this.isHost) { this.votes[this.myId] = 'SKIP'; this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes }); this._checkVoteDone(); }
    else this.net.relay({ t: 'VOTE', targetId: 'SKIP' });
    ui.toast('You abstained from voting');
  }

  _checkVoteDone() { if (Object.keys(this.votes).length >= this.players.filter(p => p.alive).length) { clearInterval(this.dayInterval); this._closeVote(); } }

  _closeVote() {
    if (!this.isHost) return;
    // Filter out SKIP votes from tally
    const tally = {};
    Object.entries(this.votes).forEach(([voterId, v]) => { if (v !== 'SKIP') tally[v] = (tally[v] || 0) + 1; });
    const skipCount = Object.values(this.votes).filter(v => v === 'SKIP').length;
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    let exId = null;
    // Check for tie
    if (sorted.length >= 2 && sorted[0][1] === sorted[1][1] && !this._isRevote) {
      // TIE — trigger focused revote
      const tiedIds = sorted.filter(([_, c]) => c === sorted[0][1]).map(([id]) => id);
      this._isRevote = true;
      const payload = { t: 'DINNER', round: this.round, revote: true, tiedIds, tiedNames: tiedIds.map(id => this._pname(id)), dur: 15000, pa: this.players.map(p => ({ id: p.id, alive: p.alive })) };
      this.votes = {};
      this.net.relay(payload);
      this._onDinner(payload);
      return;
    }
    this._isRevote = false;
    if (sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1])) exId = sorted[0][0];
    let isJester = false;
    if (exId) { const p = this.players.find(x => x.id === exId); if (p) { if (p.role === 'jester') { isJester = true; this.jesterWinner = this._pname(exId); } p.alive = false; } }
    // Track voting history
    this.voteHistory.push({ round: this.round, votes: { ...this.votes }, tally: { ...tally }, exId });
    // Track recap
    if (this.roundRecap[this.round]) {
      this.roundRecap[this.round].votes = { ...this.votes };
      if (exId) { const ep = this.players.find(x => x.id === exId); this.roundRecap[this.round].events.push(`⚔ ${this._pname(exId)} was executed. Role: ${ep?.role || 'unknown'}`); }
    }
    const w = this._checkWin();
    if (w) {
      const payload = { t: 'GAMEOVER', winner: w, players: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, role: p.role })), tally, exId, isJester, jesterWinner: this.jesterWinner, charData: this.charData, voteHistory: this.voteHistory };
      this.net.relay(payload); this._onGameOver(payload);
    } else {
      const payload = { t: 'VERDICT', tally, exId, isJester, skipCount, pa: this.players.map(p => ({ id: p.id, alive: p.alive, role: p.role })), jesterWinner: this.jesterWinner, voteHistory: this.voteHistory, recap: this.roundRecap[this.round] };
      this.net.relay(payload); this._onVerdict(payload);
    }
  }

  _checkWin() {
    const ak = this.players.filter(p => p.alive && p.role === 'killer');
    const ac = this.players.filter(p => p.alive && p.role !== 'killer' && p.role !== 'jester');
    const aj = this.players.filter(p => p.alive && p.role === 'jester');
    if (!ak.length) return 'civilians';
    if (ak.length >= ac.length + aj.length) return 'killers';
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // PHASE 4: VERDICT
  // ══════════════════════════════════════════════════════════
  _onVerdict(d) {
    d.pa.forEach(u => { const p = this.players.find(x => x.id === u.id); if (p) { p.alive = u.alive; p.role = u.role || p.role; } });
    this.phase = 'verdict'; ui.show('s-verdict'); ui.hideRoleReminder();
    if (d.voteHistory) this.voteHistory = d.voteHistory;
    const ex = d.exId ? this.players.find(p => p.id === d.exId) : null;
    if (ex) ex._displayName = this._pname(d.exId);
    ui.renderVerdict(ex, d.isJester);
    if (ex) {
      const info = getRoleInfo(ex.role);
      const roleLabel = ex.role === 'killer' ? '☠ KILLER' : ex.role === 'jester' ? '🤡 JESTER' : `😇 ${info.name.toUpperCase()} — INNOCENT`;
      const dramaMsgs = {
        killer: `The town seized ${this._pname(d.exId)} and dragged them into the light. The truth was revealed: ☠ THEY WERE THE KILLER.`,
        detective: `The town made a grave mistake. ${this._pname(d.exId)} was the DETECTIVE — the last hope for justice. Darkness closes in.`,
        doctor: `An innocent healer falls. ${this._pname(d.exId)} was the DOCTOR — now who will save the wounded?`,
        jester: `${this._pname(d.exId)} erupts in laughter as they're led away. 🤡 THE JESTER WINS! They wanted this all along.`,
        civilian: `${this._pname(d.exId)} was dragged before the crowd and executed. They were innocent... 😇 The town has blood on its hands.`,
      };
      ui.addLog(dramaMsgs[ex.role] || `${this._pname(d.exId)} was executed. They were: ${roleLabel}`, 'lv');
      audio.play(d.isJester ? 'jester' : ex.role === 'killer' ? 'bad' : 'good');

      // ── Dramatic reveal for special roles ──
      if (ex.role !== 'civilian') {
        this._showDramaticDeath(ex, d.isJester);
      }
    }
    if (d.skipCount) ui.addLog(`🚫 ${d.skipCount} player${d.skipCount > 1 ? 's' : ''} abstained`, 'ls');
    ui.renderVoteBars(d.tally, this.players.map(p => ({ ...p, name: this._pname(p.id), avatar: this.charData[p.id]?.persona?.icon || '❓' })));

    // ── Round Recap ───────────────────────────────────
    const recapEl = document.getElementById('verdictRecap');
    if (recapEl) {
      const rc = d.recap || this.roundRecap[this.round] || { events: [] };
      let rhtml = `<div class="recap-title">📜 Round ${this.round} Recap</div><div class="recap-timeline">`;
      // Night deaths
      if (this.killedId) rhtml += `<div class="recap-event recap-death">💀 ${this._pname(this.killedId)} was killed during the night</div>`;
      if (this.savedId) rhtml += `<div class="recap-event recap-save">🛡 ${this._pname(this.savedId)} was saved by the Doctor</div>`;
      // Night event
      if (this.currentNightEvent) rhtml += `<div class="recap-event recap-event-night">🌩 ${this.currentNightEvent.name}: ${this.currentNightEvent.desc}</div>`;
      // Evidence found
      const roundEvidence = this.evidenceLedger.filter(e => e.round === this.round);
      if (roundEvidence.length) rhtml += `<div class="recap-event recap-evidence">🔍 ${roundEvidence.length} piece(s) of evidence found (${roundEvidence.filter(e => e.status === 'verified').length} verified)</div>`;
      // Vote result
      rhtml += rc.events.map(e => `<div class="recap-event">${e}</div>`).join('');
      rhtml += `</div>`;
      // Vote breakdown
      if (d.tally && Object.keys(d.tally).length) {
        rhtml += `<div class="recap-votes">`;
        Object.entries(d.tally).sort((a,b) => b[1] - a[1]).forEach(([id, count]) => {
          rhtml += `<span class="recap-vote-chip">${this._pname(id)}: ${count} vote${count > 1 ? 's' : ''}</span>`;
        });
        rhtml += `</div>`;
      }
      recapEl.innerHTML = rhtml;
      recapEl.style.display = 'block';
    }

    this.round++;
    let vc = 8;
    document.getElementById('vcT').textContent = vc;
    const t = setInterval(() => { vc--; document.getElementById('vcT').textContent = vc; if (vc <= 0) { clearInterval(t); if (this.isHost) this._beginNight(); } }, 1000);
  }

  _onGameOver(d) {
    clearInterval(this.dayInterval); clearInterval(this.investInterval); clearTimeout(this.nightTimeout);
    document.getElementById('nightOv').classList.remove('on');
    if (d.players) this.players = d.players;
    this.phase = 'over'; ui.show('s-over'); ui.hideRoleReminder();
    if (this.canvasCtrl) this.canvasCtrl.setNightPulse(0);
    const kw = d.winner === 'killers';
    const revealPlayers = this.players.map(p => ({ ...p, displayName: `${this._pname(p.id)} — ${p.name}` }));
    ui.renderGameOver(d.winner, revealPlayers, d.jesterWinner);
    audio.play(kw ? 'bad' : 'good');
    const me = this.players.find(p => p.id === this.myId);
    this.stats.games++;
    if (me) { if (me.role === 'jester' && d.jesterWinner) this.stats.wins++; else if (me.role === 'killer' && kw) this.stats.wins++; else if (me.role !== 'killer' && me.role !== 'jester' && !kw) this.stats.wins++; }
    localStorage.setItem('nf_stats', JSON.stringify(this.stats));
    ui.renderStats(this.stats);
  }

  backToLobby() {
    this.phase = 'lobby'; this.players.forEach(p => { p.role = null; p.alive = true; });
    this.myRole = null; this.selVote = null; this.voted = false; this.jesterWinner = null;
    this.lastDoctorSelf = false; this.charData = {}; this.myPersona = null; this.myCharacter = null;
    this._hostCharacters = null; this._hostPersonas = null; this.killCounts = {}; this.bots = [];
    this.evidenceLedger = []; this.myActionsUsed = 0; this.civilianActionsUsed = 0;
    this.voteHistory = []; this.whispersUsed = 0; this.ghostClueUsed = false;
    this.currentNightEvent = null; this.suspicionVotes = {}; this.mySuspicionVotes = new Set();
    this.roundRecap = {}; this.lastStandActive = false;
    this.detectiveDead = false; this.investigationRequests = []; this.pendingInvestRequest = null;
    this._isRevote = false; this._revoteTiedIds = null;
    this.teamChatUsed = 0; this.teamSuspicionCounters = { killer: 0, detective: 0 };
    this.forgesUsed = 0; this.traitInvestsUsed = 0; this.dossier = {};
    clearInterval(this.graceInterval);
    chat.clear(); ui.clearLog(); this._showLobby();
    if (this.isHost) this.net.relay({ t: 'PL', pl: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: true })) });
  }

  sendChat(text) {
    if (!text.trim()) return;
    const ch = chat.getActiveChannel();
    const me = this.players.find(p => p.id === this.myId);
    if (me && !me.alive) return;
    const pname = this.myPersona ? `${this.myPersona.icon} ${this.myPersona.name}` : this.myName;

    // Team chat
    if (ch === 'killer' || ch === 'detective') {
      if (this.myRole !== ch) { ui.toast('You are not part of this team', true); return; }
      if (this.teamChatUsed >= 3) { ui.toast('Team chat limit reached for this phase (3/3)', true); return; }
      this.teamChatUsed++;
      chat.addMessage(pname, text, `team-${ch}`, ch);
      this.net.relay({ t: 'TEAM_CHAT', team: ch, name: pname, text });
      this._renderResourceHUD();
      return;
    }

    // Public chat
    if (this.phase !== 'dinner' && this.phase !== 'grace' && this.phase !== 'investigate') { ui.toast('Chat is only available during socializing, investigation & dinner', true); return; }
    chat.addMessage(pname, text, 'normal');
    this.net.relay({ t: 'CHAT', persona: pname, text, chatType: 'normal' });
  }

  sendLastWords(text) {
    if (!text.trim()) return;
    const pname = this.myPersona ? `${this.myPersona.icon} ${this.myPersona.name}` : this.myName;
    chat.addMessage(pname, text, 'last-words');
    this.net.relay({ t: 'LAST_WORDS', persona: pname, text });
    document.getElementById('lastWordsPanel').style.display = 'none';
    clearTimeout(this.lastWordsTimeout);
  }

  // ══════════════════════════════════════════════════════════
  // DRAMATIC DEATH REVEAL
  // ══════════════════════════════════════════════════════════
  _showDramaticDeath(player, isJester) {
    const roleConfigs = {
      killer: { icon: '☠', title: 'THE DARKNESS RETREATS', subtitle: 'The killer has been unmasked.', color: '#e53935', glow: 'rgba(229,57,53,.3)', message: `${player._displayName || player.name} was the KILLER all along!` },
      detective: { icon: '🔍', title: 'THE EYES GO DARK', subtitle: 'The detective has fallen.', color: '#42a5f5', glow: 'rgba(66,165,245,.3)', message: `${player._displayName || player.name} was the DETECTIVE — who will seek the truth now?` },
      doctor: { icon: '💊', title: 'NO ONE CAN SAVE THEM NOW', subtitle: 'The doctor is gone.', color: '#66bb6a', glow: 'rgba(102,187,106,.3)', message: `${player._displayName || player.name} was the DOCTOR — the killer roams free.` },
      jester: { icon: '🃏', title: 'CHAOS WINS', subtitle: 'The fool laughs last.', color: '#ab47bc', glow: 'rgba(171,71,188,.3)', message: `${player._displayName || player.name} was the JESTER — and you fell for it!` },
    };
    const config = roleConfigs[player.role] || { icon: '💀', title: 'A SOUL DEPARTS', subtitle: 'An innocent was lost.', color: '#f9a825', glow: 'rgba(249,168,37,.3)', message: `${player._displayName || player.name} was innocent.` };

    const overlay = document.createElement('div');
    overlay.className = 'dramatic-death-overlay';
    overlay.innerHTML = `
      <div class="dramatic-death-card" style="--dd-color:${config.color};--dd-glow:${config.glow}">
        <div class="dd-icon">${config.icon}</div>
        <div class="dd-title">${config.title}</div>
        <div class="dd-subtitle">${config.subtitle}</div>
        <div class="dd-divider"></div>
        <div class="dd-message">${config.message}</div>
        <div class="dd-role">${player.role.toUpperCase()}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    // Auto dismiss after 4s
    setTimeout(() => {
      overlay.classList.add('dd-fadeout');
      setTimeout(() => overlay.remove(), 600);
    }, 4000);
    // Click to dismiss early
    overlay.onclick = () => { overlay.classList.add('dd-fadeout'); setTimeout(() => overlay.remove(), 600); };
  }

  // ══════════════════════════════════════════════════════════
  // MOOD-BASED NOTIFICATIONS
  // ══════════════════════════════════════════════════════════
  _showMoodNotification(score, type, accuracy = null) {
    const msgs = {
      investigate: {
        high:   ['🌟 Breakthrough! Strong evidence found!', '🔍 Sharp eyes! Clear evidence uncovered!', '✨ Excellent work! This could change everything!'],
        medium: ['🔎 Found something... it may prove useful.', '📝 Evidence gathered — every clue matters.', '🔍 Moderate findings. Keep searching.'],
        low:    ['😞 Barely anything useful was found...', '😔 A frustrating search... very little to go on.', '💨 Almost nothing... the trail has gone cold.'],
      },
      'investigate-fail': {
        high:  ['😐 Nothing substantial despite your best effort.'],
        medium: ['😕 The search yielded nothing... try a different angle.'],
        low:   ['😞 A complete dead end. Nothing was found.', '💀 Silence. The clues elude you entirely.'],
      },
      verify: {
        high:   ['🔬 Crystal clear analysis! Evidence assessed with confidence!', '✅ Forensic precision! The truth becomes clearer!'],
        medium: ['🔬 Partial analysis... some clarity, but doubts remain.', '🧪 The forensics were inconclusive in places.'],
        low:    ['😰 The analysis was muddled... hard to trust these results.', '🔴 Uncertain findings... the evidence remains a mystery.'],
      },
    };

    const tier = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
    const pool = msgs[type]?.[tier] || msgs.investigate.medium;
    const msg = pool[Math.floor(Math.random() * pool.length)];
    const moodClass = tier === 'high' ? 'mood-celebratory' : tier === 'medium' ? 'mood-neutral' : 'mood-somber';

    // Create floating notification
    const notif = document.createElement('div');
    notif.className = `mood-notif ${moodClass}`;
    notif.innerHTML = `<div class="mood-text">${msg}</div>`;
    if (accuracy !== null) notif.innerHTML += `<div class="mood-detail">Analysis accuracy: ${accuracy}%</div>`;
    document.body.appendChild(notif);
    setTimeout(() => { notif.classList.add('mood-fadeout'); setTimeout(() => notif.remove(), 600); }, 3500);
  }

  updateSettings(s) { this.settings = { ...this.settings, ...s }; if (this.isHost) this.net.relay({ t: 'SETTINGS', settings: this.settings }); }

  getTownBoardData() {
    const board = [];
    Object.entries(this.charData).forEach(([id, data]) => {
      const p = this.players.find(x => x.id === id);
      const alive = p ? p.alive : true;
      const role = !alive ? p?.role : null;
      const deathType = !alive ? (this.voteHistory.find(vh => vh.exId === id) ? 'executed' : 'killed') : null;
      board.push({ id, persona: data.persona, pub: getPublicDesc({ pub: data.pub }), hidden: data.hidden ? getHiddenDesc({ hidden: data.hidden }) : null, alive, isMe: id === this.myId, role, deathType });
    });
    return board;
  }

  getStats() { return this.stats; }

  // ══════════════════════════════════════════════════════════
  // NIGHT EVENTS
  // ══════════════════════════════════════════════════════════
  _rollNightEvent() {
    if (Math.random() > 0.4) return null; // 40% chance of event
    const events = [
      { id: 'storm', name: '⛈ Thunderstorm', desc: 'Thunder masks all sounds — fewer evidence clues drop tonight.', effect: 'less-evidence' },
      { id: 'locked', name: '🔒 Locked Rooms', desc: 'Several rooms were locked — the killer had fewer options.', effect: 'harder-kill' },
      { id: 'witness', name: '👁 Restless Witness', desc: 'Someone was awake — a bonus clue was observed!', effect: 'bonus-clue' },
      { id: 'fog', name: '🌫 Dense Fog', desc: 'Thick fog covered the manor — evidence is harder to read.', effect: 'fog' },
      { id: 'power', name: '💡 Power Outage', desc: 'The power flickered — investigation time is shortened.', effect: 'short-invest' },
      { id: 'moon', name: '🌕 Full Moon', desc: 'The full moon illuminates everything — more evidence drops.', effect: 'more-evidence' },
      { id: 'paranoia', name: '😰 Paranoia', desc: 'Tension is high — everyone is more suspicious of each other.', effect: 'paranoia' },
    ];
    return events[Math.floor(Math.random() * events.length)];
  }

  _showNightEvent(event) {
    if (!event) return;
    const nightOv = document.getElementById('nightOv');
    if (nightOv) {
      const evBanner = document.createElement('div');
      evBanner.className = 'night-event-banner';
      evBanner.innerHTML = `<div style="font-size:1.5rem">${event.name}</div><div class="muted" style="font-size:.75rem;margin-top:4px">${event.desc}</div>`;
      nightOv.appendChild(evBanner);
      setTimeout(() => evBanner.remove(), 5000);
    }
    ui.addLog(`🌩 ${event.name} — ${event.desc}`, 'ls');
  }

  // ══════════════════════════════════════════════════════════
  // WHISPERING
  // ══════════════════════════════════════════════════════════
  _showWhisperUI() {
    const chatPanel = document.getElementById('chatPanel');
    if (!chatPanel) return;
    let wBtn = document.getElementById('whisperBtn');
    if (wBtn) return;
    wBtn = document.createElement('button');
    wBtn.id = 'whisperBtn';
    wBtn.className = 'btn btn-sm btn-out';
    wBtn.style.cssText = 'font-size:.7rem;padding:3px 10px;margin:4px 0';
    wBtn.textContent = `💬 Whisper (${this.maxWhispers - this.whispersUsed} left)`;
    wBtn.onclick = () => this._openWhisperPicker();
    chatPanel.insertBefore(wBtn, chatPanel.firstChild);
  }

  _openWhisperPicker() {
    if (this.whispersUsed >= this.maxWhispers) { ui.toast('No whispers remaining', true); return; }
    const alive = this.players.filter(p => p.alive && p.id !== this.myId && !p._isBot);
    if (!alive.length) return;
    const modal = document.createElement('div');
    modal.id = 'whisperModal';
    modal.className = 'overlay-modal';
    modal.innerHTML = `<div class="modal-card"><div class="evidence-label">💬 WHISPER TO...</div>${alive.map(p => `<button class="bdet" data-pid="${p.id}"><span>${this._pname(p.id)}</span></button>`).join('')}<div style="margin-top:8px"><input type="text" id="whisperText" class="input" placeholder="Your secret message..." maxlength="100" style="width:100%"><button class="btn btn-sm btn-gold" id="whisperSend" style="margin-top:6px;width:100%">Send Whisper</button></div><button class="btn btn-sm btn-out" id="whisperCancel" style="margin-top:4px;width:100%">Cancel</button></div>`;
    document.body.appendChild(modal);
    let targetId = null;
    modal.querySelectorAll('.bdet').forEach(b => { b.onclick = () => { modal.querySelectorAll('.bdet').forEach(x => x.classList.remove('selected')); b.classList.add('selected'); targetId = b.dataset.pid; }; });
    document.getElementById('whisperCancel').onclick = () => modal.remove();
    document.getElementById('whisperSend').onclick = () => {
      const text = document.getElementById('whisperText').value.trim();
      if (!text || !targetId) { ui.toast('Select a player and type a message', true); return; }
      this._sendWhisper(targetId, text);
      modal.remove();
    };
  }

  _sendWhisper(targetId, text) {
    this.whispersUsed++;
    const wBtn = document.getElementById('whisperBtn');
    if (wBtn) wBtn.textContent = `💬 Whisper (${this.maxWhispers - this.whispersUsed} left)`;
    if (this.whispersUsed >= this.maxWhispers && wBtn) { wBtn.disabled = true; }
    const senderName = this.myPersona ? `${this.myPersona.icon} ${this.myPersona.name}` : this.myName;
    const receiverName = this._pname(targetId);
    // Send whisper privately and announcement publicly
    this.net.relay({ t: 'WHISPER', targetId, text, senderName, receiverName });
    this.net.relay({ t: 'WHISPER_NOTICE', senderName, receiverName });
    chat.addMessage('', `💬 You whispered to ${receiverName}: "${text}"`, 'whisper');
  }

  _onWhisper(d) {
    if (d.targetId === this.myId) {
      chat.addMessage(`💬 ${d.senderName}`, d.text, 'whisper');
      audio.play('chat');
    }
  }

  // ══════════════════════════════════════════════════════════
  // GHOST CLUES
  // ══════════════════════════════════════════════════════════
  _showGhostClueInput() {
    const chatPanel = document.getElementById('chatPanel');
    if (!chatPanel) return;
    const gcDiv = document.createElement('div');
    gcDiv.id = 'ghostClueArea';
    gcDiv.style.cssText = 'padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:8px;margin:6px 0';
    gcDiv.innerHTML = `<div style="font-size:.75rem;color:var(--pale-dim);margin-bottom:4px">👻 Type exactly 3 words:</div><input type="text" id="ghostClueInput" class="input" placeholder="three word clue" style="width:100%"><button class="btn btn-sm btn-out" id="ghostClueSend" style="margin-top:4px;width:100%">Send Ghost Clue</button>`;
    chatPanel.appendChild(gcDiv);
    document.getElementById('ghostClueSend').onclick = () => {
      const text = document.getElementById('ghostClueInput').value.trim();
      const words = text.split(/\s+/);
      if (words.length !== 3) { ui.toast('Exactly 3 words!', true); return; }
      this.ghostClueUsed = true;
      this.net.relay({ t: 'GHOST_CLUE', text: words.join(' ') });
      chat.addMessage('', `👻 Your message echoes through the manor... "${words.join(' ')}"`, 'ghost');
      ui.toast('Your whisper from beyond has been delivered...');
      gcDiv.remove();
    };
  }

  // ══════════════════════════════════════════════════════════
  // SUSPICION VOTING (During Investigation)
  // ══════════════════════════════════════════════════════════
  _showSuspicionUI() {
    const logArea = document.getElementById('dLog');
    if (!logArea) return;
    const me = this.players.find(p => p.id === this.myId);
    if (!me || !me.alive) return;
    const alive = this.players.filter(p => p.alive && p.id !== this.myId && !p._isBot);
    if (!alive.length) return;
    const susDiv = document.createElement('div');
    susDiv.id = 'suspicionArea';
    susDiv.innerHTML = `<div class="evidence-label" style="margin-bottom:4px">🎯 SUSPICION VOTES</div><div id="susList">${alive.map(p => {
      const v = this.suspicionVotes[p.id] || { up: 0, down: 0 };
      const voted = this.mySuspicionVotes.has(p.id);
      return `<div class="sus-row" data-pid="${p.id}"><span style="flex:1;font-size:.8rem">${this._pname(p.id)}</span><span class="sus-count">${v.up}👍 ${v.down}👎</span>${voted ? '<span class="muted" style="font-size:.65rem">voted</span>' : `<button class="btn-sus btn-sus-up" data-pid="${p.id}" data-dir="up">👍</button><button class="btn-sus btn-sus-down" data-pid="${p.id}" data-dir="down">👎</button>`}</div>`;
    }).join('')}</div>`;
    logArea.parentNode.insertBefore(susDiv, logArea);
    susDiv.querySelectorAll('.btn-sus').forEach(b => {
      b.onclick = () => {
        const pid = b.dataset.pid;
        const dir = b.dataset.dir;
        if (this.mySuspicionVotes.has(pid)) return;
        this.mySuspicionVotes.add(pid);
        if (!this.suspicionVotes[pid]) this.suspicionVotes[pid] = { up: 0, down: 0 };
        this.suspicionVotes[pid][dir]++;
        if (this.isHost) { this.net.relay({ t: 'SUSPICION_UPDATE', votes: this.suspicionVotes }); }
        else { this.net.relay({ t: 'SUSPICION_VOTE', targetId: pid, dir }); }
        this._renderSuspicion();
      };
    });
  }

  _renderSuspicion() {
    const susList = document.getElementById('susList');
    if (!susList) return;
    const alive = this.players.filter(p => p.alive && p.id !== this.myId && !p._isBot);
    susList.innerHTML = alive.map(p => {
      const v = this.suspicionVotes[p.id] || { up: 0, down: 0 };
      const voted = this.mySuspicionVotes.has(p.id);
      return `<div class="sus-row" data-pid="${p.id}"><span style="flex:1;font-size:.8rem">${this._pname(p.id)}</span><span class="sus-count">${v.up}👍 ${v.down}👎</span>${voted ? '<span class="muted" style="font-size:.65rem">voted</span>' : `<button class="btn-sus btn-sus-up" data-pid="${p.id}" data-dir="up">👍</button><button class="btn-sus btn-sus-down" data-pid="${p.id}" data-dir="down">👎</button>`}</div>`;
    }).join('');
    susList.querySelectorAll('.btn-sus').forEach(b => {
      b.onclick = () => {
        const pid = b.dataset.pid;
        const dir = b.dataset.dir;
        if (this.mySuspicionVotes.has(pid)) return;
        this.mySuspicionVotes.add(pid);
        if (!this.suspicionVotes[pid]) this.suspicionVotes[pid] = { up: 0, down: 0 };
        this.suspicionVotes[pid][dir]++;
        if (this.isHost) this.net.relay({ t: 'SUSPICION_UPDATE', votes: this.suspicionVotes });
        else this.net.relay({ t: 'SUSPICION_VOTE', targetId: pid, dir });
        this._renderSuspicion();
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  // EVIDENCE BOARD (Cumulative)
  // ══════════════════════════════════════════════════════════
  _showEvidenceBoardButton() {
    // Show the unified Game Hub button
    const btn = document.getElementById('btnGameHub');
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.onclick = () => this._openGameHub();
    }
    this._renderResourceHUD();
  }

  // ══════════════════════════════════════════════════════════
  // UNIFIED GAME HUB (replaces town board + evidence + more)
  // Tabs: Players | Evidence | Dossier (det only) | Suspicion
  // ══════════════════════════════════════════════════════════
  _openGameHub(startTab = 'players') {
    const existing = document.getElementById('gameHubModal');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'gameHubModal';
    modal.className = 'overlay-modal';

    const tabs = [
      { key: 'players', label: '👥 Players', forAll: true },
      { key: 'evidence', label: '🗂 Evidence', forAll: true },
      { key: 'dossier', label: '🕵 Dossier', forAll: false, roles: ['detective'] },
      { key: 'suspicion', label: '📊 Suspicion', forAll: true },
    ];

    let html = `<div class="modal-card gh-card"><div class="gh-header"><div class="gh-title">📋 GAME HUB</div><div class="gh-tabs">`;
    tabs.forEach(tab => {
      if (!tab.forAll && (!tab.roles || !tab.roles.includes(this.myRole))) return;
      html += `<button class="gh-tab${tab.key === startTab ? ' gh-tab-active' : ''}" data-tab="${tab.key}">${tab.label}</button>`;
    });
    html += `</div></div><div class="gh-body" id="ghBody"></div><button class="btn btn-sm btn-out gh-close" id="ghClose">Close</button></div>`;
    modal.innerHTML = html;
    document.body.appendChild(modal);

    // Wire tabs
    modal.querySelectorAll('.gh-tab').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.gh-tab').forEach(b => b.classList.remove('gh-tab-active'));
        btn.classList.add('gh-tab-active');
        this._renderGameHubTab(btn.dataset.tab);
      };
    });
    document.getElementById('ghClose').onclick = () => modal.remove();
    this._renderGameHubTab(startTab);
  }

  _renderGameHubTab(tab) {
    const body = document.getElementById('ghBody');
    if (!body) return;
    if (tab === 'players') this._renderGameHubPlayers(body);
    else if (tab === 'evidence') this._renderGameHubEvidence(body);
    else if (tab === 'dossier') this._renderGameHubDossier(body);
    else if (tab === 'suspicion') this._renderGameHubSuspicion(body);
  }

  _renderGameHubPlayers(body) {
    let html = '<div class="gh-section-title">👥 PLAYERS</div>';
    this.players.forEach(p => {
      const persona = this.charData[p.id]?.persona;
      const icon = persona?.icon || '❓';
      const name = persona?.name || p.name;
      const alive = p.alive;
      const roleStr = !alive ? ` — <span class="gh-role-tag">${p.role || 'unknown'}</span>` : '';
      const statusClass = alive ? 'gh-alive' : 'gh-dead';
      const executedLabel = (!alive && this.voteHistory.some(vh => vh.exId === p.id)) ? '<span class="gh-executed">EXECUTED</span>' : '';
      const killedLabel = (!alive && !executedLabel) ? '<span class="gh-killed">KILLED</span>' : '';
      html += `<div class="gh-player ${statusClass}"><span class="gh-player-icon">${icon}</span><span class="gh-player-name">${name}</span>${executedLabel}${killedLabel}${roleStr}</div>`;
    });
    body.innerHTML = html;
  }

  _renderGameHubEvidence(body, filter = 'all') {
    let filtered = [...this.evidenceLedger];
    if (filter === 'verified') filtered = filtered.filter(e => e.status === 'verified');
    else if (filter === 'unverified') filtered = filtered.filter(e => e.status === 'unverified');
    else if (['trace','small','medium','large','perfect'].includes(filter)) filtered = filtered.filter(e => e.strength === filter);

    const byRound = {};
    filtered.forEach(e => { if (!byRound[e.round]) byRound[e.round] = []; byRound[e.round].push(e); });
    const totalVerified = this.evidenceLedger.filter(e => e.status === 'verified').length;

    const filters = [
      { key: 'all', label: '🗂 All' }, { key: 'verified', label: '✅ Verified' }, { key: 'unverified', label: '❓ Unverified' },
      { key: 'trace', label: '💨 Trace' }, { key: 'small', label: '🔹 Small' }, { key: 'medium', label: '🔸 Medium' },
      { key: 'large', label: '🔴 Strong' }, { key: 'perfect', label: '⭐ Perfect' },
    ];
    let html = '<div class="gh-section-title">🗂 EVIDENCE</div>';
    html += `<div class="eb-filters">${filters.map(f => `<button class="eb-filter-btn${filter === f.key ? ' eb-filter-active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}</div>`;
    html += `<div class="eb-stats"><span>🗂 ${this.evidenceLedger.length} total</span><span>✅ ${totalVerified} verified</span><span>❓ ${this.evidenceLedger.length - totalVerified} unverified</span></div>`;
    if (!filtered.length) {
      html += `<div class="muted" style="padding:20px;text-align:center">${filter === 'all' ? 'No evidence collected yet.' : `No ${filter} evidence found.`}</div>`;
    }
    Object.entries(byRound).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([round, evs]) => {
      const rv = evs.filter(e => e.status === 'verified').length;
      html += `<div class="eb-round"><div class="eb-round-header">Night ${round} <span class="eb-round-count">${evs.length} clue${evs.length > 1 ? 's' : ''}${rv ? `, ${rv} verified` : ''}</span></div>`;
      evs.forEach(e => {
        const statusIcon = e.status === 'verified' ? (e.accuracyPct >= 70 ? '🟢' : e.accuracyPct >= 30 ? '🟡' : '🔴') : '❓';
        const statusLabel = e.status === 'verified' ? `${e.accuracyPct}%` : 'Unverified';
        const sourceLabel = e.source === 'crime-scene' ? '🔍 Crime Scene' : e.source === 'forged' ? '🔨 Forged' : '🔎 Investigation';
        const strengthMap = { none: { label: 'No Evidence', color: '#555' }, trace: { label: 'Trace', color: '#888' }, small: { label: 'Small', color: '#42a5f5' }, medium: { label: 'Medium', color: '#f9a825' }, large: { label: 'Strong', color: '#e53935' }, perfect: { label: '★ Perfect', color: '#ffd700' } };
        const str = strengthMap[e.strength] || strengthMap.medium;
        const strengthBadge = e.strength ? `<span class="eb-strength" style="color:${str.color};border-color:${str.color}">${str.label}</span>` : '';
        // Cross-reference highlighting
        const crossRef = this._hasEvidenceCrossRef(e) ? '<span class="eb-cross-ref">✨ MATCH</span>' : '';
        html += `<div class="eb-evidence" style="border-left:3px solid ${str?.color || 'rgba(255,255,255,.1)'}"><div class="eb-evidence-header">${statusIcon} <span class="eb-status">${statusLabel}</span>${strengthBadge}${crossRef}<span class="eb-source">${sourceLabel}</span></div><div class="eb-text">${e.text}</div>${e.verdictText ? `<div class="eb-verdict">${e.verdictText}</div>` : ''}</div>`;
      });
      html += `</div>`;
    });
    body.innerHTML = html;
    body.querySelectorAll('.eb-filter-btn').forEach(btn => {
      btn.onclick = () => this._renderGameHubEvidence(body, btn.dataset.filter);
    });
  }

  _hasEvidenceCrossRef(evidence) {
    if (this.myRole !== 'detective' || !Object.keys(this.dossier).length) return false;
    const text = (evidence.text || '').toLowerCase();
    for (const traits of Object.values(this.dossier)) {
      for (const t of traits) {
        if (t.value && text.includes(t.value.toLowerCase().slice(0, 15))) return true;
      }
    }
    return false;
  }

  _renderGameHubDossier(body) {
    let html = '<div class="gh-section-title">🕵 DETECTIVE\'S DOSSIER</div>';
    html += `<div class="muted" style="font-size:.7rem;margin-bottom:8px">Hidden traits you've discovered. Only you can see this.</div>`;
    const entries = Object.entries(this.dossier);
    if (!entries.length) {
      html += `<div class="muted" style="padding:20px;text-align:center">No hidden traits discovered yet.<br><span style="font-size:.7rem">Use "🕵 Investigate Traits" during investigation phase. (${3 - this.traitInvestsUsed}/3 remaining)</span></div>`;
    }
    entries.forEach(([pid, traits]) => {
      const persona = this.charData[pid]?.persona;
      const icon = persona?.icon || '❓';
      const name = persona?.name || pid;
      html += `<div class="gh-dossier-entry"><div class="gh-dossier-name">${icon} ${name}</div>`;
      traits.forEach(t => {
        html += `<div class="gh-dossier-trait"><span class="gh-trait-label">${t.label}:</span> <span class="gh-trait-value">${t.value}</span></div>`;
      });
      html += `</div>`;
    });
    body.innerHTML = html;
  }

  _renderGameHubSuspicion(body) {
    let html = '<div class="gh-section-title">📊 SUSPICION & ACTIVITY</div>';
    // Suspicion meter from suspicion votes
    if (Object.keys(this.suspicionVotes).length > 0) {
      html += '<div class="gh-sub-title">Suspicion Levels</div>';
      Object.entries(this.suspicionVotes).forEach(([tid, v]) => {
        const total = v.up + v.down;
        const pct = total ? Math.round((v.down / total) * 100) : 0;
        const name = this._pname(tid);
        const bar = `<div class="gh-sus-bar"><div class="gh-sus-fill" style="width:${pct}%"></div></div>`;
        html += `<div class="gh-sus-row"><span class="gh-sus-name">${name}</span>${bar}<span class="gh-sus-pct">${pct}%</span></div>`;
      });
    }
    // Private chat activity indicators (visible to all)
    const kSus = this.teamSuspicionCounters.killer || 0;
    const dSus = this.teamSuspicionCounters.detective || 0;
    if (kSus > 0 || dSus > 0) {
      html += '<div class="gh-sub-title">Private Activity Detected</div>';
      if (kSus >= 6) html += `<div class="gh-activity-alert">💭 ${kSus >= 20 ? 'A secret alliance is clearly operating!' : kSus >= 15 ? 'A group has been talking in private repeatedly...' : kSus >= 10 ? 'Hushed whispers can be heard from a corner...' : 'Some guests seem to be exchanging glances...'}</div>`;
      if (dSus >= 6) html += `<div class="gh-activity-alert">💭 ${dSus >= 20 ? 'Investigators are clearly coordinating!' : dSus >= 15 ? 'Multiple people have been sharing notes privately...' : dSus >= 10 ? 'Someone has been passing notes under the table...' : 'A few guests seem unusually well-informed...'}</div>`;
    }
    // Vote history
    if (this.voteHistory.length > 0) {
      html += '<div class="gh-sub-title">Vote History</div>';
      this.voteHistory.forEach(vh => {
        const exPlayer = vh.exId ? this.players.find(p => p.id === vh.exId) : null;
        html += `<div class="gh-vote-round">Round ${vh.round}${exPlayer ? ` — ${this._pname(vh.exId)} executed` : ' — No execution'}</div>`;
      });
    }
    if (!Object.keys(this.suspicionVotes).length && !this.voteHistory.length && kSus < 6 && dSus < 6) {
      html += `<div class="muted" style="padding:20px;text-align:center">No suspicion data yet.</div>`;
    }
    body.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════
  // SUSPICION ESCALATION — private chat usage → public msgs
  // ══════════════════════════════════════════════════════════
  _checkSuspicionEscalation(team) {
    const count = this.teamSuspicionCounters[team] || 0;
    const msgs = {
      6: '💭 Some guests seem to be exchanging glances...',
      10: '💭 Hushed whispers can be heard from a corner of the room...',
      15: '💭 A group of people have been seen talking in private repeatedly...',
      20: '⚠ There is clearly a secret alliance forming among certain guests!',
    };
    if (msgs[count]) {
      this.net.relay({ t: 'SUSPICION_MSG', text: msgs[count] });
      chat.addMessage('', msgs[count], 'system');
      ui.addLog(msgs[count], 'ls');
    }
  }

  // ══════════════════════════════════════════════════════════
  // RESOURCE HUD — persistent top bar
  // ══════════════════════════════════════════════════════════
  _renderResourceHUD() {
    const el = document.getElementById('resourceHUD');
    if (!el) return;
    if (this.phase === 'lobby' || this.phase === 'over') { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const maxActions = this._getMyMaxActions();
    let html = `<span class="rh-item">🔎 Actions: ${this.myActionsUsed || 0}/${maxActions}</span>`;
    if (this.myRole === 'killer') {
      html += `<span class="rh-item">🗡 Chat: ${this.teamChatUsed}/3</span>`;
      html += `<span class="rh-item">🔨 Forge: ${this.forgesUsed}/1</span>`;
    } else if (this.myRole === 'detective') {
      html += `<span class="rh-item">🔍 Chat: ${this.teamChatUsed}/3</span>`;
      html += `<span class="rh-item">🕵 Traits: ${this.traitInvestsUsed}/3</span>`;
    }
    el.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════
  // KILLER EVIDENCE FORGING (1/match)
  // ══════════════════════════════════════════════════════════
  _forgeEvidence() {
    if (this.myRole !== 'killer') return;
    if (this.forgesUsed >= 1) { ui.toast('You have already used your forge this match', true); return; }
    // Show modal with alive players + public traits
    const existing = document.getElementById('forgeModal');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'forgeModal';
    modal.className = 'overlay-modal';
    const alive = this.players.filter(p => p.alive && p.id !== this.myId && p.role !== 'killer');
    let html = `<div class="modal-card" style="max-width:450px;max-height:80vh;overflow-y:auto"><div class="recap-title">🔨 FORGE EVIDENCE</div>`;
    html += `<div class="muted" style="font-size:.7rem;margin-bottom:8px">Pick a player and one of their public traits to plant as false evidence.</div>`;
    alive.forEach(p => {
      const char = this.charData[p.id]?.character;
      const persona = this.charData[p.id]?.persona;
      if (!char) return;
      const pub = char.public;
      const traits = [
        { key: 'hairStyle', label: 'Hair', val: pub.hairStyle },
        { key: 'hairColor', label: 'Hair Color', val: pub.hairColor },
        { key: 'eyeColor', label: 'Eyes', val: pub.eyeColor },
        { key: 'clothing', label: 'Clothing', val: pub.clothing },
        { key: 'accessory', label: 'Accessory', val: pub.accessory },
      ];
      html += `<div class="forge-player"><div class="forge-player-name">${persona?.icon || '❓'} ${persona?.name || p.name}</div>`;
      traits.forEach(t => {
        html += `<button class="btn btn-sm forge-trait-btn" data-pid="${p.id}" data-trait="${t.key}" data-val="${t.val}">${t.label}: ${t.val}</button>`;
      });
      html += `</div>`;
    });
    html += `<button class="btn btn-sm btn-out" id="forgeClose" style="margin-top:8px;width:100%">Cancel</button></div>`;
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('forgeClose').onclick = () => modal.remove();
    modal.querySelectorAll('.forge-trait-btn').forEach(btn => {
      btn.onclick = () => {
        const trait = btn.dataset.val;
        const texts = [
          `Witnesses reported seeing someone with ${trait} near the scene.`,
          `A figure matching description "${trait}" was spotted fleeing.`,
          `Physical evidence suggests the attacker had ${trait}.`,
        ];
        const text = texts[Math.floor(Math.random() * texts.length)];
        const forgedEvidence = { id: 'ev-' + Math.random().toString(36).slice(2,8), text, isFalse: true, status: 'unverified', accuracyPct: null, verdictText: null, source: 'forged', round: this.round, strength: 'medium' };
        this.evidenceLedger.push(forgedEvidence);
        this.forgesUsed++;
        ui.toast('🔨 Evidence forged and planted!', false);
        ui.addLog('🔨 You planted forged evidence in the crime scene.', 'lk');
        this._renderResourceHUD();
        modal.remove();
        // If host, broadcast new evidence
        if (this.isHost) {
          this.net.relay({ t: 'NEW_EVIDENCE', evidence: forgedEvidence });
        } else {
          this.net.relay({ t: 'NEW_EVIDENCE', evidence: forgedEvidence });
        }
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  // DETECTIVE HIDDEN TRAIT INVESTIGATION (3/match)
  // ══════════════════════════════════════════════════════════
  async _investigateTraits() {
    if (this.myRole !== 'detective') return;
    if (this.traitInvestsUsed >= 3) { ui.toast('You have used all 3 trait investigations this match', true); return; }
    // Show target picker
    const alive = this.players.filter(p => p.alive && p.id !== this.myId);
    const existing = document.getElementById('traitInvestModal');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'traitInvestModal';
    modal.className = 'overlay-modal';
    let html = `<div class="modal-card" style="max-width:400px"><div class="recap-title">🕵 INVESTIGATE HIDDEN TRAITS</div>`;
    html += `<div class="muted" style="font-size:.7rem;margin-bottom:8px">Pick a player to investigate their hidden traits. (${3 - this.traitInvestsUsed}/3 remaining)</div>`;
    alive.forEach(p => {
      const persona = this.charData[p.id]?.persona;
      html += `<button class="btn btn-sm btn-out forge-trait-btn" data-pid="${p.id}" style="width:100%;margin:3px 0">${persona?.icon || '❓'} ${persona?.name || p.name}</button>`;
    });
    html += `<button class="btn btn-sm btn-out" id="traitInvestClose" style="margin-top:8px;width:100%">Cancel</button></div>`;
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('traitInvestClose').onclick = () => modal.remove();
    modal.querySelectorAll('.forge-trait-btn').forEach(btn => {
      btn.onclick = async () => {
        modal.remove();
        const tid = btn.dataset.pid;
        const targetChar = this.charData[tid]?.character;
        if (!targetChar) { ui.toast('Cannot investigate — no character data', true); return; }
        // Run QTE
        const qteC = document.createElement('div');
        qteC.className = 'qte-overlay';
        qteC.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;';
        document.body.appendChild(qteC);
        const diff = getInvestigateDifficulty(true);
        const score = await runQTE(qteC, diff, 'investigate');
        qteC.remove();
        const result = generateTraitInvestResult(targetChar, score);
        this.traitInvestsUsed++;
        this._renderResourceHUD();
        if (result.success) {
          // Add to dossier
          if (!this.dossier[tid]) this.dossier[tid] = [];
          result.traits.forEach(t => {
            if (!this.dossier[tid].find(x => x.key === t.key)) this.dossier[tid].push(t);
          });
          ui.toast(result.text, false);
          ui.addLog(result.text, 'lc');
        } else {
          ui.toast(result.text, true);
          ui.addLog(result.text, 'ls');
        }
      };
    });
  }

  // ── Evidence Window (dedicated modal, like town board) ─────
  renderEvidenceWindow(filter = 'all') {
    const grid = document.getElementById('evidenceWindowGrid');
    if (!grid) return;
    this._evidenceFilter = filter;
    let filtered = [...this.evidenceLedger];
    // Apply filter
    if (filter === 'verified') filtered = filtered.filter(e => e.status === 'verified');
    else if (filter === 'unverified') filtered = filtered.filter(e => e.status === 'unverified');
    else if (['trace','small','medium','large','perfect'].includes(filter)) filtered = filtered.filter(e => e.strength === filter);

    const byRound = {};
    filtered.forEach(e => { if (!byRound[e.round]) byRound[e.round] = []; byRound[e.round].push(e); });
    const totalVerified = this.evidenceLedger.filter(e => e.status === 'verified').length;

    // Filter buttons
    const filters = [
      { key: 'all', label: '🗂 All' },
      { key: 'verified', label: '✅ Verified' },
      { key: 'unverified', label: '❓ Unverified' },
      { key: 'trace', label: '💨 Trace' },
      { key: 'small', label: '🔹 Small' },
      { key: 'medium', label: '🔸 Medium' },
      { key: 'large', label: '🔴 Strong' },
      { key: 'perfect', label: '⭐ Perfect' },
    ];
    let html = `<div class="eb-filters">${filters.map(f =>
      `<button class="eb-filter-btn${filter === f.key ? ' eb-filter-active' : ''}" data-filter="${f.key}">${f.label}</button>`
    ).join('')}</div>`;

    html += `<div class="eb-stats"><span>🗂 ${this.evidenceLedger.length} total</span><span>✅ ${totalVerified} verified</span><span>❓ ${this.evidenceLedger.length - totalVerified} unverified</span></div>`;
    if (!filtered.length) {
      html += `<div class="muted" style="padding:20px;text-align:center">${filter === 'all' ? 'No evidence collected yet.' : `No ${filter} evidence found.`}<br><span style="font-size:.7rem">Evidence is found at crime scenes and through investigation.</span></div>`;
    }
    Object.entries(byRound).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([round, evs]) => {
      const rv = evs.filter(e => e.status === 'verified').length;
      html += `<div class="eb-round"><div class="eb-round-header">Night ${round} <span class="eb-round-count">${evs.length} clue${evs.length > 1 ? 's' : ''}${rv ? `, ${rv} verified` : ''}</span></div>`;
      evs.forEach(e => {
        const statusIcon = e.status === 'verified'
          ? (e.accuracyPct >= 70 ? '🟢' : e.accuracyPct >= 30 ? '🟡' : '🔴')
          : '❓';
        const statusLabel = e.status === 'verified' ? `${e.accuracyPct}%` : 'Unverified';
        const sourceLabel = e.source === 'crime-scene' ? '🔍 Crime Scene' : '🔎 Investigation';
        const strengthMap = { none: { label: 'No Evidence', color: '#555' }, trace: { label: 'Trace', color: '#888' }, small: { label: 'Small', color: '#42a5f5' }, medium: { label: 'Medium', color: '#f9a825' }, large: { label: 'Strong', color: '#e53935' }, perfect: { label: '★ Perfect', color: '#ffd700' } };
        const str = strengthMap[e.strength] || strengthMap.medium;
        const strengthBadge = e.strength ? `<span class="eb-strength" style="color:${str.color};border-color:${str.color}">${str.label}</span>` : '';
        html += `<div class="eb-evidence" style="border-left:3px solid ${str?.color || 'rgba(255,255,255,.1)'}"><div class="eb-evidence-header">${statusIcon} <span class="eb-status">${statusLabel}</span>${strengthBadge}<span class="eb-source">${sourceLabel}</span></div><div class="eb-text">${e.text}</div>${e.verdictText ? `<div class="eb-verdict">${e.verdictText}</div>` : ''}</div>`;
      });
      html += `</div>`;
    });
    grid.innerHTML = html;
    // Wire filter buttons
    grid.querySelectorAll('.eb-filter-btn').forEach(btn => {
      btn.onclick = () => this.renderEvidenceWindow(btn.dataset.filter);
    });
  }

  // ══════════════════════════════════════════════════════════
  // VOTING HISTORY
  // ══════════════════════════════════════════════════════════
  _showVotingHistoryButton() {
    const chatPanel = document.getElementById('chatPanel');
    if (!chatPanel) return;
    let vhBtn = document.getElementById('voteHistoryBtn');
    if (vhBtn) return;
    vhBtn = document.createElement('button');
    vhBtn.id = 'voteHistoryBtn';
    vhBtn.className = 'btn btn-sm btn-out';
    vhBtn.style.cssText = 'font-size:.7rem;padding:3px 10px;margin:4px 0';
    vhBtn.textContent = `📊 Vote History (${this.voteHistory.length} rounds)`;
    vhBtn.onclick = () => this._openVotingHistory();
    chatPanel.insertBefore(vhBtn, chatPanel.firstChild);
  }

  _openVotingHistory() {
    const existing = document.getElementById('voteHistoryModal');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'voteHistoryModal';
    modal.className = 'overlay-modal';
    let html = `<div class="modal-card" style="max-width:500px;max-height:80vh;overflow-y:auto"><div class="recap-title">📊 VOTING HISTORY</div>`;
    if (!this.voteHistory.length) { html += `<div class="muted" style="padding:12px;text-align:center">No votes recorded yet.</div>`; }
    this.voteHistory.forEach(vh => {
      const exPlayer = vh.exId ? this.players.find(p => p.id === vh.exId) : null;
      html += `<div class="eb-round"><div class="eb-round-header">Round ${vh.round}${exPlayer ? ` — ${this._pname(vh.exId)} executed` : ' — No execution'}</div>`;
      Object.entries(vh.votes).forEach(([voterId, targetId]) => {
        html += `<div class="vh-vote"><span class="vh-voter">${this._pname(voterId)}</span><span class="vh-arrow">→</span><span class="vh-target">${this._pname(targetId)}</span></div>`;
      });
      html += `</div>`;
    });
    html += `<button class="btn btn-sm btn-out" id="vhClose" style="margin-top:8px;width:100%">Close</button></div>`;
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('vhClose').onclick = () => modal.remove();
  }

  // ══════════════════════════════════════════════════════════
  // BOT SYSTEM
  // ══════════════════════════════════════════════════════════
  addBot() {
    if (!this.isHost) return;
    const botId = 'BOT_' + Math.random().toString(36).slice(2, 7);
    const botNames = ['Bot Alpha', 'Bot Bravo', 'Bot Charlie', 'Bot Delta', 'Bot Echo', 'Bot Foxtrot', 'Bot Golf', 'Bot Hotel'];
    const name = botNames[this.bots.length % botNames.length];
    this.bots.push(botId);
    this.players.push({ id: botId, name, avatar: '🤖', alive: true, role: null, disconnected: false, _isBot: true });
    this._renderLobby();
    ui.toast(`${name} added`);
  }

  removeBot() {
    if (!this.isHost || !this.bots.length) return;
    const botId = this.bots.pop();
    const bot = this.players.find(p => p.id === botId);
    this.players = this.players.filter(p => p.id !== botId);
    this._renderLobby();
    if (bot) ui.toast(`${bot.name} removed`);
  }

  _botNightActions() {
    if (!this.isHost) return;
    const botPlayers = this.players.filter(p => p._isBot && p.alive);
    botPlayers.forEach(bot => {
      const alive = this.players.filter(p => p.alive && p.id !== bot.id);
      if (!alive.length) return;
      const target = alive[Math.floor(Math.random() * alive.length)];
      if (bot.role === 'killer') {
        this.nightActions[bot.id] = target.id;
        // Bot killer QTE score: random 0.3–0.8
        const score = 0.3 + Math.random() * 0.5;
        const killerChar = { pub: this.charData[bot.id]?.pub, hidden: this.charData[bot.id]?.hidden };
        const allChars = this._hostCharacters || new Map();
        const myKills = this.killCounts[bot.id] || 0;
        const killClue = generateKillClue(killerChar, score, myKills, allChars, bot.id);
        if (killClue.text) this.killClues.push({ text: killClue.text, isFalse: killClue.isFalse, strength: killClue.strength });
        this.killCounts[bot.id] = myKills + 1;
      } else if (bot.role === 'doctor') {
        this.doctorTarget = target.id;
      }
    });
    this._checkNightDone();
  }

  _botInvestigate() {
    // Bots don't actually run QTEs — they generate random results
    if (!this.isHost) return;
    const botPlayers = this.players.filter(p => p._isBot && p.alive && p.role !== 'killer');
    botPlayers.forEach(bot => {
      const alive = this.players.filter(p => p.alive && p.id !== bot.id);
      if (!alive.length) return;
      const target = alive[Math.floor(Math.random() * alive.length)];
      const score = 0.2 + Math.random() * 0.6;
      const tc = { pub: this.charData[target.id]?.pub, hidden: this.charData[target.id]?.hidden };
      const tp = this.charData[target.id]?.persona || { name: '???' };
      const tPlayer = this.players.find(x => x.id === target.id);
      const isDet = bot.role === 'detective';
      const result = generateInvestClue(tc, tp, tPlayer?.role, score, isDet);
      this.investigationClues.push({ playerId: bot.id, clue: result.text, isFalse: result.isFalse });
    });
  }

  _botVote() {
    if (!this.isHost) return;
    const botPlayers = this.players.filter(p => p._isBot && p.alive);
    const alive = this.players.filter(p => p.alive);
    botPlayers.forEach(bot => {
      const targets = alive.filter(p => p.id !== bot.id);
      if (!targets.length) return;
      const target = targets[Math.floor(Math.random() * targets.length)];
      this.votes[bot.id] = target.id;
    });
    this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes });
    this._checkVoteDone();
  }
}
