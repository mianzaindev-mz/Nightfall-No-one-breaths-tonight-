// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Game State Machine v5
// Flow: Role → Grace → Night → Investigation → Dinner → Verdict
// Detective verification + investigation limits + bots
// ═══════════════════════════════════════════════════════════════

import { assignRoles, getRoleInfo } from './roles.js';
import { assignCharacters, getPublicDesc, getHiddenDesc } from './avatar.js';
import { generateKillClue, generateInvestClue, computeVerification, formatEvidence, runQTE, getKillDifficulty, getInvestigateDifficulty, getVerifyDifficulty } from './qte.js';
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
    this.settings = { dayTime: 60, nightTime: 30, investTime: 40, doctor: false, jester: false, hideVotes: true };

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
        this.nightActions[d._from] = d.targetId;
        if (d.killClue?.text) this.killClues.push({ text: d.killClue.text, accuracyPct: d.killClue.accuracyPct, isFalse: d.killClue.isFalse });
        this.killCounts[d._from] = (this.killCounts[d._from] || 0) + 1;
        this._checkNightDone();
      }
    });
    n.on('INVEST_RESULT', d => { if (this.isHost && d.clue) this.investigationClues.push({ playerId: d._from, clue: d.clue, isFalse: d.isFalse || false }); });
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

  _showRole(allies) { ui.show('s-role'); ui.renderRole(this.myRole, allies, this.myPersona, this.myCharacter); audio.play(this.myRole === 'killer' ? 'bad' : 'good'); ui.hideRoleReminder(); }

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
    this.mySkipVoted = true;
    const btn = document.getElementById('btnSkip');
    if (btn) { btn.disabled = true; btn.textContent = '✓ Voted to skip'; }
    if (this.isHost) {
      this.skipVotes.add(this.myId);
      const alive = this.players.filter(p => p.alive && !p.disconnected).length;
      const needed = Math.ceil(alive * 0.7);
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

    // Show Town Board button
    const tbBtn = document.getElementById('btnTownBoard');
    if (tbBtn) tbBtn.style.display = 'inline-flex';

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
    this.currentNightEvent = this._rollNightEvent();
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

    if (this.myRole === 'killer') this._showKillerNight(alive);
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
        const killClue = generateKillClue(killerChar, score, myKills, allChars, this.myId);
        if (this.isHost) { this.nightActions[this.myId] = tid; if (killClue.text) this.killClues.push({ text: killClue.text, accuracyPct: killClue.accuracyPct, isFalse: killClue.isFalse }); this.killCounts[this.myId] = myKills + 1; this._checkNightDone(); }
        else this.net.relay({ t: 'KILL_ACTION', targetId: tid, killClue });
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
    const vs = Object.values(this.nightActions);
    let killedId = null, savedId = null;
    if (vs.length) {
      const freq = {}; vs.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      const vic = this.players.find(p => p.id === top);
      if (vic && vic.alive) { if (this.doctorTarget === top) savedId = top; else { vic.alive = false; killedId = top; } }
    }
    this.killedId = killedId; this.savedId = savedId;
    // Transition to INVESTIGATION phase (lights on)
    const investDur = (this.settings.investTime || 40) * 1000;
    // Add kill clues to evidence ledger as UNVERIFIED
    this.killClues.forEach(c => {
      this.evidenceLedger.push({ id: 'ev-' + Math.random().toString(36).slice(2,8), text: c.text, isFalse: c.isFalse, status: 'unverified', accuracyPct: null, verdictText: null, source: 'crime-scene', round: this.round });
    });
    const payload = { t: 'INVESTIGATE', round: this.round, killedId, savedId, evidence: this.evidenceLedger.filter(e => e.round === this.round && e.source === 'crime-scene').map(e => ({ id: e.id, text: e.text })), dur: investDur, pa: this.players.map(p => ({ id: p.id, alive: p.alive })) };
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
    this.skipVotes = new Set(); this.mySkipVoted = false;
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
          this.evidenceLedger.push({ id: e.id, text: e.text, isFalse: false, status: 'unverified', accuracyPct: null, verdictText: null, source: 'crime-scene', round: this.round });
        }
      });
    }

    const al = this.players.filter(p => p.alive).length;
    ui.renderDayHeader(this.round, al, this.players.length);

    const h2 = document.querySelector('#s-day h2');
    if (h2) { h2.textContent = '🔦 LIGHTS ON — INVESTIGATE'; h2.style.color = 'var(--det-bright)'; }

    // Death announcement
    ui.hideDeathAnnounce(); ui.hideDoctorSave();
    if (d.killedId) { ui.showDeathAnnounce(this._pname(d.killedId)); ui.addLog(`Night ${this.round}: ${this._pname(d.killedId)} was found dead.`, 'lk'); }
    else if (d.savedId) { ui.showDoctorSave(this._pname(d.savedId)); ui.addLog(`Night ${this.round}: ${this._pname(d.savedId)} was saved!`, 'lc'); audio.play('save'); }
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
    if (me && me.alive && !me._isBot) this._showSuspicionUI();

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
    return this.myRole === 'detective' ? 2 : 1;
  }

  _canCivilianAct() {
    if (this.myRole === 'detective' || this.myRole === 'killer') return true;
    return this.civilianActionsUsed < 3;
  }

  _renderInvestigationUI(logArea) {
    const isDet = this.myRole === 'detective';
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

    // Option 1: Investigate a suspect
    html += `<div style="margin-bottom:6px"><div class="evidence-label" style="margin-bottom:4px">🔎 INVESTIGATE A SUSPECT</div><div id="investList"></div></div>`;

    // Option 2: Verify evidence (detective + civilians can both do this but detective is better)
    if (unverified.length > 0) {
      html += `<div style="margin-top:8px"><div class="evidence-label" style="margin-bottom:4px">${isDet ? '🔬 VERIFY EVIDENCE (trained)' : '🔬 VERIFY EVIDENCE (amateur)'}</div><div id="verifyList"></div></div>`;
    }

    html += `<div id="investQTE" style="display:none"></div><div id="investResult" style="display:none" class="evidence-box"></div>`;
    investDiv.innerHTML = html;
    logArea.parentNode.insertBefore(investDiv, logArea);

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
    this.evidenceLedger.push({ id: evId, text: result.text, isFalse: result.isFalse, status: 'unverified', accuracyPct: null, verdictText: null, source: 'investigation', round: this.round });

    const resEl = document.getElementById('investResult');
    if (resEl) { resEl.innerHTML = `<span class="evidence-label">🔎 INVESTIGATION REPORT</span>${formatEvidence(result.text, 'unverified')}`; resEl.style.display = 'block'; }
    this.myActionsUsed++;
    if (!isDet && this.myRole !== 'killer') this.civilianActionsUsed++;

    if (this.isHost) this.investigationClues.push({ playerId: this.myId, clue: result.text, isFalse: result.isFalse });
    else this.net.relay({ t: 'INVEST_RESULT', clue: result.text, isFalse: result.isFalse });

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
    const isDet = this.myRole === 'detective';
    const il = document.getElementById('investList'); if (il) il.style.display = 'none';
    const vl = document.getElementById('verifyList'); if (vl) vl.style.display = 'none';
    const diff = getVerifyDifficulty();
    // Civilians get harder verification
    if (!isDet) { diff.level = 2; diff.label = 'Amateur Forensics'; }
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
    if (!isDet && this.myRole !== 'killer') this.civilianActionsUsed++;

    const investSkip = document.getElementById('investSkipArea'); if (investSkip) investSkip.remove();

    // Re-render if more actions available
    const logArea = document.getElementById('dLog');
    if (this.myActionsUsed < this._getMyMaxActions() && this._canCivilianAct() && logArea) {
      setTimeout(() => this._renderInvestigationUI(logArea), 2000);
    }
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

    const h2 = document.querySelector('#s-day h2');
    if (h2) { h2.textContent = '🍽 DINNER — DISCUSSION & VOTE'; h2.style.color = 'var(--gold)'; }

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
      if (!this.ghostClueUsed) {
        chat.addMessage('', '👻 You are dead. You may leave ONE cryptic 3-word clue for the living.', 'system');
        chat.setEnabled(false);
        this._showGhostClueInput();
      } else {
        chat.addMessage('', 'You are dead. Observe in silence.', 'system');
        chat.setEnabled(false);
      }
    } else {
      chat.setEnabled(true);
      chat.addMessage('', '🍽 Take your seat. Discuss what you found.', 'system');
      // Whisper button
      this._showWhisperUI();
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
    const dp = this.players.map(p => ({ ...p, name: this._pname(p.id), avatar: this.charData[p.id]?.persona?.icon || '❓' }));
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
    document.getElementById('vStatus').textContent = '✓ Vote cast';
    if (this.isHost) { this.votes[this.myId] = this.selVote; this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes }); this._checkVoteDone(); }
    else this.net.relay({ t: 'VOTE', targetId: this.selVote });
    audio.haptic([40]);
  }

  _checkVoteDone() { if (Object.keys(this.votes).length >= this.players.filter(p => p.alive).length) { clearInterval(this.dayInterval); this._closeVote(); } }

  _closeVote() {
    if (!this.isHost) return;
    const tally = {}; Object.values(this.votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    let exId = null;
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
      const payload = { t: 'VERDICT', tally, exId, isJester, pa: this.players.map(p => ({ id: p.id, alive: p.alive, role: p.role })), jesterWinner: this.jesterWinner, voteHistory: this.voteHistory, recap: this.roundRecap[this.round] };
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
      ui.addLog(`${this._pname(d.exId)} was executed. They were: ${roleLabel}`, 'lv');
      audio.play(d.isJester ? 'jester' : ex.role === 'killer' ? 'bad' : 'good');
    }
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
    this._hostCharacters = null; this._hostPersonas = null; this.killCounts = {};
    this.evidenceLedger = []; this.myActionsUsed = 0; this.civilianActionsUsed = 0;
    this.voteHistory = []; this.whispersUsed = 0; this.ghostClueUsed = false;
    this.currentNightEvent = null; this.suspicionVotes = {}; this.mySuspicionVotes = new Set();
    this.roundRecap = {}; this.lastStandActive = false;
    clearInterval(this.graceInterval);
    chat.clear(); ui.clearLog(); this._showLobby();
    if (this.isHost) this.net.relay({ t: 'PL', pl: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: true })) });
  }

  sendChat(text) {
    if (!text.trim()) return;
    if (this.phase !== 'dinner' && this.phase !== 'grace') { ui.toast('Chat is only available during socializing & dinner', true); return; }
    const me = this.players.find(p => p.id === this.myId);
    if (me && !me.alive) return;
    const pname = this.myPersona ? `${this.myPersona.icon} ${this.myPersona.name}` : this.myName;
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

  updateSettings(s) { this.settings = { ...this.settings, ...s }; if (this.isHost) this.net.relay({ t: 'SETTINGS', settings: this.settings }); }

  getTownBoardData() {
    const board = [];
    Object.entries(this.charData).forEach(([id, data]) => {
      const p = this.players.find(x => x.id === id);
      board.push({ id, persona: data.persona, pub: getPublicDesc({ pub: data.pub }), hidden: data.hidden ? getHiddenDesc({ hidden: data.hidden }) : null, alive: p ? p.alive : true, isMe: id === this.myId });
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
      chat.addMessage('', `👻 Your ghost clue: "${words.join(' ')}"`, 'ghost');
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
    const chatPanel = document.getElementById('chatPanel');
    if (!chatPanel) return;
    let ebBtn = document.getElementById('evidenceBoardBtn');
    if (ebBtn) return;
    ebBtn = document.createElement('button');
    ebBtn.id = 'evidenceBoardBtn';
    ebBtn.className = 'btn btn-sm btn-out';
    ebBtn.style.cssText = 'font-size:.7rem;padding:3px 10px;margin:4px 4px 4px 0';
    ebBtn.textContent = `📋 Evidence Board (${this.evidenceLedger.length})`;
    ebBtn.onclick = () => this._openEvidenceBoard();
    chatPanel.insertBefore(ebBtn, chatPanel.firstChild);
  }

  _openEvidenceBoard() {
    const existing = document.getElementById('evidenceBoardModal');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'evidenceBoardModal';
    modal.className = 'overlay-modal';
    const byRound = {};
    this.evidenceLedger.forEach(e => { if (!byRound[e.round]) byRound[e.round] = []; byRound[e.round].push(e); });
    let html = `<div class="modal-card" style="max-width:500px;max-height:80vh;overflow-y:auto"><div class="recap-title">📋 EVIDENCE BOARD</div>`;
    if (!this.evidenceLedger.length) { html += `<div class="muted" style="padding:12px;text-align:center">No evidence collected yet.</div>`; }
    Object.entries(byRound).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([round, evs]) => {
      html += `<div class="eb-round"><div class="eb-round-header">Night ${round}</div>`;
      evs.forEach(e => {
        const statusIcon = e.status === 'verified'
          ? (e.accuracyPct >= 70 ? '🟢' : e.accuracyPct >= 30 ? '🟡' : '🔴')
          : '❓';
        const statusLabel = e.status === 'verified' ? `${e.accuracyPct}%` : 'Unverified';
        const sourceLabel = e.source === 'crime-scene' ? '🔍 Crime Scene' : '🔎 Investigation';
        html += `<div class="eb-evidence"><span class="eb-status">${statusIcon} ${statusLabel}</span><span class="eb-source">${sourceLabel}</span><div class="eb-text">${e.text}</div>${e.verdictText ? `<div class="eb-verdict">${e.verdictText}</div>` : ''}</div>`;
      });
      html += `</div>`;
    });
    html += `<button class="btn btn-sm btn-out" id="ebClose" style="margin-top:8px;width:100%">Close</button></div>`;
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('ebClose').onclick = () => modal.remove();
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
        if (killClue.text) this.killClues.push({ text: killClue.text, isFalse: killClue.isFalse });
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
