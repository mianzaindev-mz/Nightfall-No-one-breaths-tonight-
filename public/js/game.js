// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Game State Machine
// Integrates: QTE kills, universal investigation, personas
// ═══════════════════════════════════════════════════════════════

import { assignRoles, getRoleInfo } from './roles.js';
import { assignPersonas, generateKillClue, generateInvestClue, runQTE, getKillDifficulty, getInvestigateDifficulty } from './qte.js';
import audio from './audio.js';
import chat from './chat.js';
import * as ui from './ui.js';

export default class Game {
  constructor(network, canvasCtrl) {
    this.net = network;
    this.canvasCtrl = canvasCtrl;

    // Identity
    this.myId = 'P' + Math.random().toString(36).slice(2, 9);
    this.myName = '';
    this.myAvatar = '🧙';
    this.isHost = false;

    // Room
    this.lobbyCode = '';
    this.players = [];

    // State
    this.phase = 'lobby';
    this.round = 0;
    this.myRole = null;
    this.settings = { dayTime: 60, nightTime: 45, detTime: 30, doctor: false, jester: false, hideVotes: true };

    // Personas — Map<playerId, {name, icon, trait, item}>
    this.personas = new Map();
    this.myPersona = null;

    // Night
    this.nightActions = {};
    this.doctorTarget = null;
    this.clue = null;
    this.killClues = [];        // clues from QTE failures
    this.investigationClues = []; // clues from player investigations
    this.detDone = false;

    // Kill tracking for QTE difficulty
    this.killCounts = {};       // killerId -> number of kills

    // Day
    this.killedId = null;
    this.savedId = null;
    this.votes = {};
    this.selVote = null;
    this.voted = false;
    this.readySet = new Set();
    this.jesterWinner = null;

    // Timers
    this.dayInterval = null;
    this.nightTimeout = null;
    this.lastWordsTimeout = null;
    this.lastDoctorSelf = false;

    // Stats
    this.stats = JSON.parse(localStorage.getItem('nf_stats') || '{"games":0,"wins":0}');

    this._setupNetHandlers();
  }

  // ── Network Handlers ───────────────────────────────────────
  _setupNetHandlers() {
    const n = this.net;

    n.on('CREATED', d => {
      this.lobbyCode = d.code;
      this.isHost = true;
      this.players = [{ id: this.myId, name: this.myName, avatar: this.myAvatar, alive: true, role: null, disconnected: false, isHost: true }];
      this._showLobby();
    });

    n.on('JOINED', d => {
      this.lobbyCode = d.code;
      this.isHost = (d.hostId === this.myId);
      n.roomCode = d.code;
      n.getPlayers();
      this._showLobby();
    });

    n.on('JOIN_FAIL', d => { ui.toast(d.reason || 'Failed to join', true); });
    n.on('RECONNECTED', d => {
      this.lobbyCode = d.code;
      this.isHost = (d.hostId === this.myId);
      n.roomCode = d.code;
      ui.toast('Reconnected!');
      n.getPlayers();
    });

    n.on('PLAYER_LIST', d => {
      this.players = d.players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar || '👤',
        alive: p.alive !== undefined ? p.alive : true,
        role: p.role || null, disconnected: !p.connected,
        isHost: p.id === d.hostId
      }));
      this.isHost = d.hostId === this.myId;
      this._renderLobby();
    });

    n.on('PLAYER_JOINED', d => {
      if (!this.players.find(p => p.id === d.playerId)) {
        this.players.push({ id: d.playerId, name: d.name, avatar: '👤', alive: true, role: null, disconnected: false });
      }
      this._renderLobby();
      ui.toast(`${d.name} joined`);
    });

    n.on('PLAYER_LEFT', d => {
      this.players = this.players.filter(p => p.id !== d.playerId);
      this._renderLobby();
      ui.toast(`${d.name} left`);
    });

    n.on('PLAYER_DISCONNECTED', d => {
      const p = this.players.find(x => x.id === d.playerId);
      if (p) p.disconnected = true;
      this._renderLobby();
    });

    n.on('PLAYER_RECONNECTED', d => {
      const p = this.players.find(x => x.id === d.playerId);
      if (p) p.disconnected = false;
      this._renderLobby();
    });

    n.on('HOST_CHANGED', d => {
      this.isHost = (d.newHostId === this.myId);
      this.players.forEach(p => p.isHost = (p.id === d.newHostId));
      this._renderLobby();
      ui.toast(`${d.name} is the new host`);
    });

    // ── Game Messages (relayed) ──
    n.on('PL', d => {
      d.pl.forEach(u => {
        let p = this.players.find(x => x.id === u.id);
        if (p) Object.assign(p, u);
        else this.players.push({ ...u, disconnected: false });
      });
      this._renderLobby();
    });

    // Role assignment — each player gets ONLY their own role + persona map
    n.on('ROLE', d => {
      this.round = d.round || 1;
      this.phase = 'role';
      this.myRole = d.role;
      d.publicPlayers.forEach(u => {
        let p = this.players.find(x => x.id === u.id);
        if (p) { p.alive = true; p.avatar = u.avatar || p.avatar; }
      });
      const me = this.players.find(p => p.id === this.myId);
      if (me) me.role = d.role;
      this.settings = d.settings || this.settings;

      // Rebuild personas from data
      this.personas = new Map();
      if (d.personas) {
        d.personas.forEach(({ id, persona }) => this.personas.set(id, persona));
      }
      this.myPersona = this.personas.get(this.myId);
      this.killCounts = {};

      this._showRole(d.allies || []);
    });

    n.on('NIGHT', d => { this.phase = 'night'; this.round = d.round; this._showNight(d.dur); });

    n.on('DAY', d => { this._onDay(d); });

    n.on('VOTE_UPDATE', d => { this.votes = d.votes || {}; this._renderVotes(); });

    n.on('VERDICT', d => { this._onVerdict(d); });

    n.on('GAMEOVER', d => { this._onGameOver(d); });

    n.on('READY', d => {
      if (this.isHost) { this.readySet.add(d._from); this._checkReady(); }
    });

    // Kill action from killer (with QTE score)
    n.on('KILL_ACTION', d => {
      if (this.isHost) {
        this.nightActions[d._from] = d.targetId;
        // Store QTE clue from killer's performance
        if (d.killClue && d.killClue.text) {
          this.killClues.push(d.killClue.text);
        }
        this._checkNightDone();
      }
    });

    // Investigation result from any player
    n.on('INVEST_RESULT', d => {
      if (this.isHost && d.clue) {
        this.investigationClues.push({ playerId: d._from, clue: d.clue });
      }
    });

    n.on('DOC_PROTECT', d => {
      if (this.isHost) this.doctorTarget = d.targetId;
    });

    n.on('VOTE', d => {
      if (this.isHost) {
        this.votes[d._from] = d.targetId;
        this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes });
        this._checkVoteDone();
      }
    });

    n.on('CHAT', d => { chat.addMessage(d.name, d.text, d.chatType || 'normal'); audio.play('chat'); });
    n.on('LAST_WORDS', d => { chat.addMessage(d.name, d.text, 'last-words'); });
    n.on('KICKED', d => {
      if (d.targetId === this.myId) {
        ui.toast('You were kicked from the lobby', true);
        ui.show('s-land');
        this.phase = 'lobby';
        this.players = [];
      }
    });
    n.on('SETTINGS', d => { this.settings = d.settings; });
  }

  // ── Create / Join Lobby ────────────────────────────────────
  createLobby(name, avatar) {
    this.myName = name;
    this.myAvatar = avatar;
    this.net.createRoom(this.myId, name);
  }

  joinLobby(name, avatar, code) {
    this.myName = name;
    this.myAvatar = avatar;
    this.net.joinRoom(this.myId, name, code);
  }

  // ── Lobby ──────────────────────────────────────────────────
  _showLobby() {
    ui.show('s-lobby');
    document.getElementById('lCode').textContent = this.lobbyCode;
    this._renderLobby();
  }

  _renderLobby() {
    if (this.phase !== 'lobby') return;
    ui.renderLobby(this.players, this.myId, this.isHost, (kickId) => this.kickPlayer(kickId));
  }

  kickPlayer(playerId) {
    if (!this.isHost) return;
    this.net.relay({ t: 'KICKED', targetId: playerId });
    this.players = this.players.filter(p => p.id !== playerId);
    this._renderLobby();
  }

  // ── Host Start ─────────────────────────────────────────────
  hostStart() {
    if (!this.isHost || this.players.length < 4) return;
    const roleMap = assignRoles(this.players, this.settings);
    roleMap.forEach(r => {
      const p = this.players.find(x => x.id === r.id);
      if (p) { p.role = r.role; p.alive = true; }
    });

    // Assign random personas for this game
    const personaMap = assignPersonas(this.players.map(p => p.id));
    this.personas = personaMap;
    this.myPersona = personaMap.get(this.myId);

    // Serialize personas for network
    const personaData = [];
    personaMap.forEach((persona, id) => personaData.push({ id, persona }));

    this.phase = 'role';
    this.round = 1;
    this.readySet = new Set();
    this.jesterWinner = null;
    this.killCounts = {};

    const publicPlayers = this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));

    // Send each player ONLY their own role (anti-cheat)
    this.players.forEach(p => {
      const allies = (p.role === 'killer')
        ? this.players.filter(x => x.role === 'killer' && x.id !== p.id).map(x => x.name)
        : [];

      if (p.id === this.myId) {
        this.myRole = p.role;
        this._showRole(allies);
      } else {
        this.net.relay({
          t: 'ROLE', role: p.role, allies, publicPlayers,
          round: this.round, settings: this.settings,
          personas: personaData
        }, p.id);
      }
    });
  }

  // ── Role Screen ────────────────────────────────────────────
  _showRole(allies) {
    ui.show('s-role');
    ui.renderRole(this.myRole, allies, this.myPersona);
    audio.play(this.myRole === 'killer' ? 'bad' : 'good');
    ui.hideRoleReminder();
  }

  pressReady() {
    document.getElementById('readyBtn').disabled = true;
    document.getElementById('readyBtn').textContent = 'Waiting...';
    if (this.isHost) { this.readySet.add(this.myId); this._checkReady(); }
    else this.net.relay({ t: 'READY' });
  }

  _checkReady() {
    if (this.readySet.size >= this.players.filter(p => !p.disconnected).length) this._beginNight();
  }

  // ── Night ──────────────────────────────────────────────────
  _beginNight() {
    if (!this.isHost) return;
    this.phase = 'night';
    this.nightActions = {};
    this.doctorTarget = null;
    this.killClues = [];
    this.investigationClues = [];
    this.detDone = false;
    this.clue = null;
    this.readySet = new Set();
    this.savedId = null;

    const dur = this.settings.nightTime * 1000;
    this.net.relay({ t: 'NIGHT', round: this.round, dur });
    this._showNight(dur);

    clearTimeout(this.nightTimeout);
    this.nightTimeout = setTimeout(() => {
      if (this.phase === 'night') this._resolveNight();
    }, dur);
  }

  _showNight(dur) {
    this.phase = 'night';
    if (this.canvasCtrl) this.canvasCtrl.setNightPulse(1);

    const ov = document.getElementById('nightOv');
    ov.classList.add('on');
    document.getElementById('nBig').textContent = `NIGHT ${this.round}`;
    document.getElementById('nSm').textContent = 'DARKNESS SWALLOWS THE TOWN';
    audio.play('night');
    const killerCount = this.players.filter(p => p.role === 'killer' && p.alive).length;
    setTimeout(() => audio.play('kill', Math.max(1, killerCount)), 3000);

    const me = this.players.find(p => p.id === this.myId);
    const alive = this.players.filter(p => p.alive && p.id !== this.myId);

    if (!me || !me.alive) {
      ui.renderNightCivilianUI();
      return;
    }

    if (this.myRole === 'killer') {
      // ── KILLER: Select target, then QTE ──
      this._showKillerNight(alive);
    } else if (this.myRole === 'doctor') {
      // ── DOCTOR: Protect someone, then investigate ──
      this._showDoctorNight(alive);
    } else {
      // ── CIVILIAN / DETECTIVE: Investigate via QTE ──
      this._showInvestigatorNight(alive);
    }
  }

  // ── Killer Night: Pick target → QTE kill ───────────────────
  _showKillerNight(alive) {
    const kl = ui.renderNightKillerUI(alive);
    if (!kl) return;

    kl.onclick = async (e) => {
      const btn = e.target.closest('.bplayer');
      if (!btn || btn.disabled) return;

      // Lock selection
      kl.querySelectorAll('.bplayer').forEach(b => { b.disabled = true; b.style.opacity = b === btn ? '1' : '.25'; });
      const tid = btn.dataset.pid;
      audio.haptic([100]);

      // Count how many kills this killer has made
      const myKills = this.killCounts[this.myId] || 0;
      const diff = getKillDifficulty(myKills);

      // Run QTE in the kCfm area
      const qteContainer = document.getElementById('kCfm');
      if (qteContainer) {
        qteContainer.style.display = 'block';
        qteContainer.innerHTML = '';
        const score = await runQTE(qteContainer, diff, 'kill');

        // Generate clue from QTE performance
        const killerPersona = this.personas.get(this.myId);
        const killClue = generateKillClue(killerPersona, score, myKills);

        // Send kill action + QTE result to host
        if (this.isHost) {
          this.nightActions[this.myId] = tid;
          if (killClue.text) this.killClues.push(killClue.text);
          this.killCounts[this.myId] = myKills + 1;
          this._checkNightDone();
        } else {
          this.net.relay({ t: 'KILL_ACTION', targetId: tid, killClue });
        }
      }
    };
  }

  // ── Doctor Night: Protect + investigate ────────────────────
  _showDoctorNight(alivePlayers) {
    const canProtectSelf = !this.lastDoctorSelf;
    const targets = this.players.filter(p => p.alive).map(p => ({
      ...p, isSelf: p.id === this.myId
    }));
    const dl = ui.renderNightDoctorUI(targets, !canProtectSelf);
    if (!dl) return;

    dl.onclick = async (e) => {
      const btn = e.target.closest('.bdet');
      if (!btn || btn.disabled) return;
      dl.querySelectorAll('.bdet').forEach(b => { b.disabled = true; b.style.opacity = b === btn ? '1' : '.25'; });
      document.getElementById('docCfm').style.display = 'block';
      const tid = btn.dataset.pid;
      this.lastDoctorSelf = (tid === this.myId);
      if (this.isHost) this.doctorTarget = tid;
      else this.net.relay({ t: 'DOC_PROTECT', targetId: tid });
      audio.haptic([50]);

      // Doctor also gets to investigate (with detective-level QTE)
      setTimeout(() => this._startInvestigationQTE(true), 1500);
    };
  }

  // ── Investigator Night (Civilian / Detective): pick target → QTE ──
  _showInvestigatorNight(alive) {
    const area = document.getElementById('nAct');
    if (!area) return;

    const isDetective = this.myRole === 'detective';
    const title = isDetective ? '🔍 Investigate a Suspect' : '🔎 Search for Clues';
    const titleColor = isDetective ? 'var(--det-bright)' : 'var(--gold)';
    const subtitle = isDetective
      ? 'Your training gives you an edge — easier investigation.'
      : 'You can investigate, but it\'s harder without training.';

    area.innerHTML =
      `<div style="color:${titleColor};font-family:var(--font-display);font-size:1rem;margin-bottom:4px">${title}</div>` +
      `<div class="muted tc" style="font-size:.75rem;margin-bottom:14px">${subtitle}</div>` +
      `<div id="investList"></div>` +
      `<div id="investQTE" style="display:none"></div>` +
      `<div id="investResult" style="display:none" class="cluebox"></div>`;

    const il = document.getElementById('investList');
    alive.forEach(p => {
      const persona = this.personas.get(p.id);
      const b = document.createElement('button');
      b.className = 'bdet';
      if (!isDetective) { b.style.borderColor = 'rgba(201,168,76,.3)'; b.style.background = 'rgba(201,168,76,.05)'; }
      b.innerHTML = `<span>${persona ? persona.icon : '👤'} ${persona ? persona.name : ui.esc(p.name)}</span>`;
      b.dataset.pid = p.id;
      il.appendChild(b);
    });

    il.onclick = async (e) => {
      const btn = e.target.closest('.bdet');
      if (!btn || btn.disabled) return;
      il.querySelectorAll('.bdet').forEach(b => b.disabled = true);
      const tid = btn.dataset.pid;
      il.style.display = 'none';

      // Run investigation QTE
      const diff = getInvestigateDifficulty(isDetective);
      const qteArea = document.getElementById('investQTE');
      qteArea.style.display = 'block';
      const score = await runQTE(qteArea, diff, 'investigate');

      // Generate investigation clue
      const targetPersona = this.personas.get(tid);
      const target = this.players.find(p => p.id === tid);
      const result = generateInvestClue(targetPersona, target?.role, score);

      // Show result to investigator
      const resEl = document.getElementById('investResult');
      if (resEl) {
        resEl.innerHTML = result.text;
        resEl.style.display = 'block';
      }

      // Send to host (detective results are stronger)
      if (this.isHost) {
        this.investigationClues.push({ playerId: this.myId, clue: result.text });
      } else {
        this.net.relay({ t: 'INVEST_RESULT', clue: result.text });
      }
    };
  }

  // ── Investigation QTE for Doctor (after protecting) ────────
  _startInvestigationQTE(isDetective) {
    const area = document.getElementById('nAct');
    if (!area) return;
    const alive = this.players.filter(p => p.alive && p.id !== this.myId);

    // Append investigation UI after doctor protection
    const div = document.createElement('div');
    div.style.marginTop = '20px';
    div.innerHTML =
      `<div style="color:var(--det-bright);font-family:var(--font-display);font-size:.9rem;margin-bottom:8px">🔍 Also Investigate</div>` +
      `<div id="docInvestList"></div>` +
      `<div id="docInvestQTE" style="display:none"></div>` +
      `<div id="docInvestResult" style="display:none" class="cluebox"></div>`;
    area.appendChild(div);

    const il = document.getElementById('docInvestList');
    alive.forEach(p => {
      const persona = this.personas.get(p.id);
      const b = document.createElement('button');
      b.className = 'bdet';
      b.innerHTML = `<span>${persona ? persona.icon : '👤'} ${persona ? persona.name : ui.esc(p.name)}</span>`;
      b.dataset.pid = p.id;
      il.appendChild(b);
    });

    il.onclick = async (e) => {
      const btn = e.target.closest('.bdet');
      if (!btn || btn.disabled) return;
      il.querySelectorAll('.bdet').forEach(b => b.disabled = true);
      il.style.display = 'none';

      const diff = getInvestigateDifficulty(isDetective);
      const qteArea = document.getElementById('docInvestQTE');
      qteArea.style.display = 'block';
      const score = await runQTE(qteArea, diff, 'investigate');

      const tid = btn.dataset.pid;
      const targetPersona = this.personas.get(tid);
      const target = this.players.find(p => p.id === tid);
      const result = generateInvestClue(targetPersona, target?.role, score);

      const resEl = document.getElementById('docInvestResult');
      if (resEl) { resEl.innerHTML = result.text; resEl.style.display = 'block'; }

      if (this.isHost) {
        this.investigationClues.push({ playerId: this.myId, clue: result.text });
      } else {
        this.net.relay({ t: 'INVEST_RESULT', clue: result.text });
      }
    };
  }

  _checkNightDone() {
    const killers = this.players.filter(p => p.alive && p.role === 'killer');
    if (killers.every(k => this.nightActions[k.id])) {
      clearTimeout(this.nightTimeout);
      // Wait a moment for investigations to come in
      setTimeout(() => this._resolveNight(), 2000);
    }
  }

  // ── Resolve Night ──────────────────────────────────────────
  _resolveNight() {
    if (!this.isHost) return;

    const vs = Object.values(this.nightActions);
    let killedId = null;
    let savedId = null;

    if (vs.length) {
      const freq = {};
      vs.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      const vic = this.players.find(p => p.id === top);

      if (vic && vic.alive) {
        if (this.doctorTarget === top) {
          savedId = top;
        } else {
          vic.alive = false;
          killedId = top;
        }
      }
    }

    this.round++;
    this.killedId = killedId;
    this.savedId = savedId;

    // Combine all clues for the day
    const allClues = [...this.killClues];

    const payload = {
      t: 'DAY',
      round: this.round,
      killedId, savedId,
      killClues: allClues,
      investigationClues: this.investigationClues,
      pa: this.players.map(p => ({ id: p.id, alive: p.alive }))
    };
    this.net.relay(payload);
    this._onDay(payload);
  }

  // ── Day ────────────────────────────────────────────────────
  _onDay(d) {
    d.pa.forEach(u => {
      const p = this.players.find(x => x.id === u.id);
      if (p) p.alive = u.alive;
    });

    this.phase = 'day';
    this.killedId = d.killedId;
    this.savedId = d.savedId;
    this.votes = {};
    this.selVote = null;
    this.voted = false;

    if (this.canvasCtrl) this.canvasCtrl.setNightPulse(0);
    document.getElementById('nightOv').classList.remove('on');
    ui.show('s-day');
    audio.play('day');

    // Death announcement
    ui.hideDeathAnnounce();
    ui.hideDoctorSave();
    if (d.killedId) {
      const v = this.players.find(p => p.id === d.killedId);
      const vPersona = this.personas.get(d.killedId);
      const displayName = vPersona ? `${vPersona.icon} ${vPersona.name} (${v?.name || 'Unknown'})` : (v?.name || 'Unknown');
      ui.showDeathAnnounce(displayName);
      ui.addLog(`Night ${this.round - 1}: ${displayName} was murdered.`, 'lk');
    } else if (d.savedId) {
      const sv = this.players.find(p => p.id === d.savedId);
      const svPersona = this.personas.get(d.savedId);
      const displayName = svPersona ? `${svPersona.icon} ${svPersona.name}` : (sv?.name || 'Someone');
      ui.showDoctorSave(displayName);
      ui.addLog(`Night ${this.round - 1}: ${displayName} was attacked but saved by the Doctor!`, 'lc');
      audio.play('save');
    } else {
      ui.addLog(`Night ${this.round - 1}: No one died.`, 'ls');
    }

    // Show QTE-generated kill clues (from killer mistakes)
    ui.hideClue();
    if (d.killClues && d.killClues.length > 0) {
      const clueHtml = d.killClues.map(c =>
        `<div class="evidence-box"><span class="evidence-label">🔍 CRIME SCENE EVIDENCE</span>${c}</div>`
      ).join('');
      ui.showClue(clueHtml);
    }

    // Show investigation clues (each player sees their own + public summary)
    if (d.investigationClues && d.investigationClues.length > 0) {
      d.investigationClues.forEach(ic => {
        const investigator = this.players.find(p => p.id === ic.playerId);
        const iName = investigator?.name || 'Someone';
        ui.addLog(`${iName}'s investigation: ${ic.clue.replace(/<[^>]*>/g, '')}`, 'lc');
      });
    }

    // Chips
    const al = this.players.filter(p => p.alive).length;
    ui.renderDayHeader(this.round - 1, al, this.players.length);

    // Role + persona reminder
    ui.showRoleReminder(this.myRole);

    // Votes
    this._renderVotes();

    // Dead state
    const me = this.players.find(p => p.id === this.myId);
    const isDead = me && !me.alive;
    document.getElementById('deadMsg').style.display = isDead ? 'block' : 'none';
    document.getElementById('cvBtn').style.display = 'none';

    // Last words
    const lwPanel = document.getElementById('lastWordsPanel');
    if (d.killedId === this.myId && lwPanel) {
      lwPanel.style.display = 'block';
      let lwTime = 10;
      ui.updateTimer('lwTimer', lwTime);
      clearTimeout(this.lastWordsTimeout);
      const lwIv = setInterval(() => {
        lwTime--;
        ui.updateTimer('lwTimer', lwTime);
        if (lwTime <= 0) { clearInterval(lwIv); lwPanel.style.display = 'none'; }
      }, 1000);
      this.lastWordsTimeout = setTimeout(() => { clearInterval(lwIv); lwPanel.style.display = 'none'; }, 10000);
    } else if (lwPanel) {
      lwPanel.style.display = 'none';
    }

    // Chat
    if (isDead) {
      chat.addMessage('', 'You are dead. You can watch but not speak.', 'system');
      chat.setEnabled(false);
    } else {
      chat.setEnabled(true);
    }

    // Day timer
    let tl = this.settings.dayTime || 60;
    ui.updateTimer('dTimer', tl);
    document.getElementById('dTimer').classList.remove('urg');
    clearInterval(this.dayInterval);
    this.dayInterval = setInterval(() => {
      tl--;
      ui.updateTimer('dTimer', tl);
      if (tl <= 0) { clearInterval(this.dayInterval); if (this.isHost) this._closeVote(); }
    }, 1000);
  }

  _renderVotes() {
    const me = this.players.find(p => p.id === this.myId);
    const isDead = me && !me.alive;

    // Use personas in vote display
    const displayPlayers = this.players.map(p => {
      const persona = this.personas.get(p.id);
      return {
        ...p,
        displayName: persona ? `${persona.icon} ${persona.name}` : p.name,
        displayAvatar: persona ? persona.icon : (p.avatar || '👤')
      };
    });

    const c = ui.renderVotes(displayPlayers, this.myId, this.votes, this.selVote, this.voted, isDead, this.settings.hideVotes);
    if (c) {
      c.onclick = (e) => {
        const btn = e.target.closest('.bplayer');
        if (!btn || btn.disabled) return;
        this._pickVote(btn.dataset.pid);
      };
    }
  }

  _pickVote(id) {
    if (this.voted) return;
    this.selVote = id;
    audio.play('vote');
    this._renderVotes();
    document.getElementById('cvBtn').style.display = 'flex';
    const p = this.players.find(x => x.id === id);
    const persona = this.personas.get(id);
    const name = persona ? `${persona.icon} ${persona.name}` : p?.name;
    document.getElementById('vStatus').textContent = 'Selected: ' + name;
  }

  confirmVote() {
    if (!this.selVote || this.voted) return;
    this.voted = true;
    document.getElementById('cvBtn').style.display = 'none';
    document.getElementById('vStatus').textContent = '✓ Vote cast';
    if (this.isHost) {
      this.votes[this.myId] = this.selVote;
      this.net.relay({ t: 'VOTE_UPDATE', votes: this.votes });
      this._checkVoteDone();
    } else {
      this.net.relay({ t: 'VOTE', targetId: this.selVote });
    }
    audio.haptic([40]);
  }

  _checkVoteDone() {
    const aliveCount = this.players.filter(p => p.alive).length;
    if (Object.keys(this.votes).length >= aliveCount) {
      clearInterval(this.dayInterval);
      this._closeVote();
    }
  }

  _closeVote() {
    if (!this.isHost) return;
    const tally = {};
    Object.values(this.votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    let exId = null;
    if (sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1])) exId = sorted[0][0];

    let isJester = false;
    if (exId) {
      const p = this.players.find(x => x.id === exId);
      if (p) {
        if (p.role === 'jester') { isJester = true; this.jesterWinner = p.name; }
        p.alive = false;
      }
    }

    const w = this._checkWin();
    if (w) {
      const payload = {
        t: 'GAMEOVER', winner: w,
        players: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, role: p.role })),
        tally, exId, isJester, jesterWinner: this.jesterWinner,
        personas: Array.from(this.personas.entries()).map(([id, p]) => ({ id, persona: p }))
      };
      this.net.relay(payload);
      this._onGameOver(payload);
    } else {
      const payload = {
        t: 'VERDICT', tally, exId, isJester,
        pa: this.players.map(p => ({ id: p.id, alive: p.alive, role: p.role })),
        jesterWinner: this.jesterWinner
      };
      this.net.relay(payload);
      this._onVerdict(payload);
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

  // ── Verdict ────────────────────────────────────────────────
  _onVerdict(d) {
    d.pa.forEach(u => {
      const p = this.players.find(x => x.id === u.id);
      if (p) { p.alive = u.alive; p.role = u.role || p.role; }
    });
    this.phase = 'verdict';
    ui.show('s-verdict');
    ui.hideRoleReminder();

    const ex = d.exId ? this.players.find(p => p.id === d.exId) : null;
    ui.renderVerdict(ex, d.isJester);
    if (ex) {
      const isK = ex.role === 'killer';
      ui.addLog(`${ex.name} executed — ${d.isJester ? 'the Jester! They win!' : isK ? 'a killer!' : 'innocent.'}`, 'lv');
      audio.play(d.isJester ? 'jester' : isK ? 'bad' : 'good');
    }
    ui.renderVoteBars(d.tally, this.players);

    let vc = 6;
    document.getElementById('vcT').textContent = vc;
    const t = setInterval(() => {
      vc--;
      document.getElementById('vcT').textContent = vc;
      if (vc <= 0) { clearInterval(t); if (this.isHost) this._beginNight(); }
    }, 1000);
  }

  // ── Game Over ──────────────────────────────────────────────
  _onGameOver(d) {
    clearInterval(this.dayInterval);
    clearTimeout(this.nightTimeout);
    document.getElementById('nightOv').classList.remove('on');
    if (d.players) this.players = d.players;
    this.phase = 'over';
    ui.show('s-over');
    ui.hideRoleReminder();
    if (this.canvasCtrl) this.canvasCtrl.setNightPulse(0);

    const kw = d.winner === 'killers';
    ui.renderGameOver(d.winner, this.players, d.jesterWinner);
    audio.play(kw ? 'bad' : 'good');

    // Stats
    const me = this.players.find(p => p.id === this.myId);
    this.stats.games++;
    if (me) {
      if (me.role === 'jester' && d.jesterWinner === me.name) this.stats.wins++;
      else if (me.role === 'killer' && kw) this.stats.wins++;
      else if (me.role !== 'killer' && me.role !== 'jester' && !kw) this.stats.wins++;
    }
    localStorage.setItem('nf_stats', JSON.stringify(this.stats));
    ui.renderStats(this.stats);
  }

  // ── Back to Lobby ──────────────────────────────────────────
  backToLobby() {
    this.phase = 'lobby';
    this.players.forEach(p => { p.role = null; p.alive = true; });
    this.myRole = null;
    this.selVote = null;
    this.voted = false;
    this.jesterWinner = null;
    this.lastDoctorSelf = false;
    this.personas = new Map();
    this.myPersona = null;
    this.killCounts = {};
    chat.clear();
    ui.clearLog();
    this._showLobby();
    if (this.isHost) {
      this.net.relay({ t: 'PL', pl: this.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: true })) });
    }
  }

  // ── Chat ───────────────────────────────────────────────────
  sendChat(text) {
    if (!text.trim()) return;
    const me = this.players.find(p => p.id === this.myId);
    if (me && !me.alive) return;
    chat.addMessage(this.myName, text, 'normal');
    this.net.relay({ t: 'CHAT', name: this.myName, text, chatType: 'normal' });
  }

  sendLastWords(text) {
    if (!text.trim()) return;
    chat.addMessage(this.myName, text, 'last-words');
    this.net.relay({ t: 'LAST_WORDS', name: this.myName, text });
    document.getElementById('lastWordsPanel').style.display = 'none';
    clearTimeout(this.lastWordsTimeout);
  }

  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.isHost) this.net.relay({ t: 'SETTINGS', settings: this.settings });
  }

  getStats() { return this.stats; }
}
