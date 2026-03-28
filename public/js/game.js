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
import NetAction from './managers/NetAction.js';
import PhaseManager from './managers/PhaseManager.js';
import UIManager from './managers/UIManager.js';
import Manor from './systems/Manor.js';
import Evidence from './systems/Evidence.js';
import Accusation from './components/Accusation.js';
import Abilities from './systems/Abilities.js';
import Chronicle from './components/Chronicle.js';
import Difficulty from './systems/Difficulty.js';
import Moderation from './systems/Moderation.js';
import Achievements from './systems/Achievements.js';
import UXEffects from './systems/UXEffects.js';

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

    // ── Season 2 Systems ──
    this.manor = new Manor();
    this.evidence = new Evidence(this);
    this.accusation = new Accusation(this);
    this.abilities = new Abilities(this);
    this.chronicle = new Chronicle(this);
    this.difficulty = new Difficulty(this);
    this.moderation = new Moderation(this);
    this.achievements = new Achievements();
    this.ux = new UXEffects(this);
    this.killerChatLog = []; // For wiretap ability

    // ── Manager Delegation (Season 2 Architecture) ──
    this.uiManager = new UIManager(this);
    this.phaseManager = new PhaseManager(this);
    this.netAction = new NetAction(this);  // registers all websocket handlers

    // Attempt state restoration from sessionStorage on reload
    this._tryRestoreState();
  }

  _pname(pid) { const d = this.charData[pid]; return d ? `${d.persona.icon} ${d.persona.name}` : '???'; }

  // ── NETWORK HANDLERS ───────────────────────────────────────
  // Moved to managers/NetAction.js — registered automatically in constructor

  // ── LOBBY ──────────────────────────────────────────────────
  createLobby(name, avatar) { this.myName = name; this.myAvatar = avatar; this.net.createRoom(this.myId, name); }
  joinLobby(name, avatar, code) { this.myName = name; this.myAvatar = avatar; this.net.joinRoom(this.myId, name, code); }
  _showLobby() { ui.show('s-lobby'); document.getElementById('lCode').textContent = this.lobbyCode; this._renderLobby(); }
  _renderLobby() { if (this.phase !== 'lobby') return; ui.renderLobby(this.players, this.myId, this.isHost, id => this.kickPlayer(id)); }
  kickPlayer(id) { if (!this.isHost) return; this.net.relay({ t: 'KICKED', targetId: id }); this.players = this.players.filter(p => p.id !== id); this._renderLobby(); }

  // ── HOST START ─────────────────────────────────────────────
  hostStart() { this.phaseManager.hostStart(); }

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
  _beginGrace() { this.phaseManager.beginGrace(); }

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
  _beginNight() { this.phaseManager.beginNight(); }

  _showNight(dur) {
    this.phase = 'night'; this._saveState(); audio.setAmbience('night');
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
      // Night-phase abilities (Disguise, Evidence Destroy)
      const nAct = document.getElementById('nAct');
      if (nAct) this._renderAbilityBar(nAct, 'night');
    }
    else if (this.myRole === 'doctor') {
      this._showDoctorNight(alive);
      // Night-phase abilities (Patrol)
      const nAct = document.getElementById('nAct');
      if (nAct) this._renderAbilityBar(nAct, 'night');
    }
    else {
      // Civilians/Detective: Night activities (Listen/Barricade/Pray) or passive wait
      const area = document.getElementById('nAct');
      const myRoom = this.manor?.getRoom(this.playerLocations?.[this.myId]);
      const roomInfo = myRoom ? `<div style="color:var(--gold);font-size:.75rem;margin-bottom:8px;font-family:var(--font-display);letter-spacing:.1em">${myRoom.icon} ${myRoom.name}</div><div class="room-ambiance">${myRoom.ambiance || ''}</div>` : '';

      // Charge tracking: 2 per match, 1 per night
      if (typeof this.nightCharges === 'undefined') this.nightCharges = 2;
      if (typeof this.nightChargeUsedThisRound === 'undefined') this.nightChargeUsedThisRound = false;
      this.nightChargeUsedThisRound = false; // Reset each night
      const canAct = this.nightCharges > 0 && !this.nightChargeUsedThisRound && this.myRole !== 'detective';

      if (area) {
        let actionsHtml = '';
        if (canAct) {
          actionsHtml = `<div class="night-actions-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px">
            <button class="btn btn-sm btn-out night-act-btn" data-act="listen" style="padding:10px 4px">
              <div style="font-size:1.5rem">👂</div>
              <div style="font-size:.65rem;margin-top:2px">LISTEN</div>
              <div style="font-size:.55rem;color:var(--pale-dim)">Hear nearby</div>
            </button>
            <button class="btn btn-sm btn-out night-act-btn" data-act="barricade" style="padding:10px 4px">
              <div style="font-size:1.5rem">🚪</div>
              <div style="font-size:.65rem;margin-top:2px">BARRICADE</div>
              <div style="font-size:.55rem;color:var(--pale-dim)">Block door</div>
            </button>
            <button class="btn btn-sm btn-out night-act-btn" data-act="pray" style="padding:10px 4px">
              <div style="font-size:1.5rem">🙏</div>
              <div style="font-size:.65rem;margin-top:2px">PRAY</div>
              <div style="font-size:.55rem;color:var(--pale-dim)">Cryptic hint</div>
            </button>
          </div>
          <div class="muted tc" style="font-size:.6rem;margin-top:6px">🌙 Night Actions: ${this.nightCharges}/2 remaining</div>`;
        } else {
          actionsHtml = `<div class="muted tc" style="font-size:.85rem;line-height:1.8;margin-top:8px">💤 The lights are out...<br>` +
            `<span style="color:rgba(255,255,255,.15);font-size:.75rem">${this.nightCharges <= 0 ? 'No night actions remaining.' : 'Wait for the lights to come back on.'}</span></div>` +
            `<div style="font-size:3rem;text-align:center;margin-top:12px;animation:pu 2.5s infinite">🕯</div>`;
        }
        area.innerHTML = roomInfo + actionsHtml;

        // Wire activity buttons
        area.querySelectorAll('.night-act-btn').forEach(btn => {
          btn.onclick = async () => {
            if (this.nightChargeUsedThisRound) return;
            this.nightChargeUsedThisRound = true;
            this.nightCharges--;
            const act = btn.dataset.act;
            area.querySelectorAll('.night-act-btn').forEach(b => { b.disabled = true; b.style.opacity = b === btn ? '1' : '.2'; });

            // QTE container
            const qteDiv = document.createElement('div');
            qteDiv.style.cssText = 'margin-top:12px';
            area.appendChild(qteDiv);

            const score = await runQTE(qteDiv, 1, 'investigate');

            // Process result based on activity type
            let resultText = '';
            if (act === 'listen') {
              resultText = this._processListen(score);
            } else if (act === 'barricade') {
              resultText = this._processBarricade(score);
            } else if (act === 'pray') {
              resultText = this._processPray(score);
            }

            // Store result for morning announcement
            if (!this.pendingNightResults) this.pendingNightResults = [];
            this.pendingNightResults.push({ act, text: resultText });

            // Show result
            area.innerHTML = roomInfo +
              `<div style="text-align:center;margin-top:16px">
                <div style="font-size:1.2rem;margin-bottom:8px">${act === 'listen' ? '👂' : act === 'barricade' ? '🚪' : '🙏'}</div>
                <div style="color:var(--gold);font-size:.8rem;line-height:1.5">${resultText}</div>
                <div class="muted" style="font-size:.6rem;margin-top:8px">🌙 Night Actions: ${this.nightCharges}/2 remaining</div>
              </div>`;
          };
        });
      }
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
        // B4: Get room data for location-specific kill flavor
        const victimRoom = this.manor?.getRoom(this.playerLocations?.[tid]);
        const killClues = generateKillClues(killerChar, score, myKills, allChars, this.myId, victimRoom);
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

  _checkNightDone() { this.phaseManager.checkNightDone(); }

  // ── Civilian Night Activity Processors ────────────────────
  _processListen(score) {
    const myRoomId = this.playerLocations?.[this.myId];
    if (!myRoomId || !this.manor) return '🔇 Silence surrounds you.';
    const soundRange = this.manor.getSoundRange(myRoomId);
    // Check if any killer targeted someone in an adjacent room
    const killerTargets = Object.values(this.nightActions || {});
    let heard = null;
    for (const targetId of killerTargets) {
      const targetRoom = this.playerLocations?.[targetId];
      if (targetRoom && soundRange.includes(targetRoom)) {
        const roomData = this.manor.getRoom(targetRoom);
        heard = roomData;
        break;
      }
    }
    if (score >= 0.7 && heard) {
      return `🔊 You heard a violent struggle from the ${heard.name}!`;
    } else if (score >= 0.4 && heard) {
      return '🔊 You heard a faint disturbance nearby...';
    } else if (score < 0.4 && heard) {
      return '🫨 You shifted and the floorboard creaked. Something happened, but you couldn\'t hear clearly.';
    }
    return '🔇 The night was silent around you.';
  }

  _processBarricade(score) {
    // QTE determines barricade strength
    let blockChance, msg;
    if (score >= 0.8) {
      blockChance = 0.4;
      msg = '🚪 The door holds firm. 40% block chance tonight.';
    } else if (score >= 0.5) {
      blockChance = 0.3;
      msg = '🚪 The barricade is up. 30% block chance.';
    } else {
      blockChance = 0.15;
      msg = '🚪 The barricade is weak. Only 15% block chance.';
    }
    this.myBarricadeChance = blockChance;
    // Chronicle record
    const myRoom = this.manor?.getRoom(this.playerLocations?.[this.myId]);
    const floor = myRoom ? this.manor.getFloorInfo(this.playerLocations[this.myId])?.name : 'unknown floor';
    this.chronicle?.record?.('barricade', { floor });
    return msg;
  }

  _processPray(score) {
    // Find killer(s) and get one of their public traits
    const killers = this.players.filter(p => p.alive && p.role === 'killer');
    if (!killers.length) return '🙏 The spirits are silent.';
    const killer = killers[Math.floor(Math.random() * killers.length)];
    const killerChar = this.charData?.[killer.id]?.persona;
    if (!killerChar) return '🙏 A cold wind is your only answer.';

    // Get public traits from the character
    const traits = [];
    if (killerChar.skinTone) traits.push(`skin appears ${killerChar.skinTone}`);
    if (killerChar.hairStyle) traits.push(`hair is ${killerChar.hairStyle}`);
    if (killerChar.accessories?.length) traits.push(`wears ${killerChar.accessories[0]}`);
    if (killerChar.clothing) traits.push(`is dressed in ${killerChar.clothing}`);
    if (killerChar.icon) traits.push(`their presence feels like ${killerChar.icon}`);

    if (!traits.length) return '🙏 The spirits whisper something unintelligible...';

    const trait = traits[Math.floor(Math.random() * traits.length)];

    // Accuracy: QTE-dependent (50-80%)
    const isAccurate = Math.random() < (score >= 0.8 ? 0.8 : score >= 0.5 ? 0.7 : 0.5);

    if (isAccurate) {
      const templates = [
        `The spirits whisper: the darkness's ${trait}.`,
        `A chill reveals: the killer's ${trait}.`,
        `The candle flickers toward someone whose ${trait}.`
      ];
      return '🙏 ' + templates[Math.floor(Math.random() * templates.length)];
    } else {
      // Misleading — pick a random non-killer's trait
      const innocents = this.players.filter(p => p.alive && p.role !== 'killer');
      if (innocents.length) {
        const decoy = innocents[Math.floor(Math.random() * innocents.length)];
        const decoyChar = this.charData?.[decoy.id]?.persona;
        if (decoyChar) {
          const decoyTraits = [];
          if (decoyChar.skinTone) decoyTraits.push(`skin appears ${decoyChar.skinTone}`);
          if (decoyChar.hairStyle) decoyTraits.push(`hair is ${decoyChar.hairStyle}`);
          if (decoyChar.icon) decoyTraits.push(`presence feels like ${decoyChar.icon}`);
          if (decoyTraits.length) {
            const dt = decoyTraits[Math.floor(Math.random() * decoyTraits.length)];
            return `🙏 The spirits lie: the killer's ${dt}.`;
          }
        }
      }
      return '🙏 The spirits are silent... or lying.';
    }
  }
  // ── Season 2: Ability Bar ─────────────────────────────────
  _renderAbilityBar(container, currentPhase) {
    if (!this.abilities) return;
    const abilities = this.abilities.getAvailableAbilities(this.myId)
      .filter(a => a.phase === currentPhase);
    if (!abilities.length) return;

    const bar = document.createElement('div');
    bar.className = 'ability-bar';
    bar.innerHTML = `<div class="ability-bar-label">⚡ ABILITIES</div><div class="ability-bar-btns">${abilities.map(a => {
      const dis = !a.canUse ? 'disabled' : '';
      const chargeText = a.maxUses < 10 ? `${a.charges}/${a.maxUses}` : '';
      return `<button class="ability-btn ${dis ? 'ability-disabled' : ''}" data-ability="${a.id}" ${dis} title="${a.desc}">
        <span class="ability-icon">${a.icon}</span>
        <span class="ability-name">${a.name}</span>
        ${chargeText ? `<span class="ability-charges">${chargeText}</span>` : ''}
      </button>`;
    }).join('')}</div>`;
    container.prepend(bar);

    // Wire ability buttons
    bar.querySelectorAll('.ability-btn:not([disabled])').forEach(btn => {
      btn.onclick = async () => {
        const abilityId = btn.dataset.ability;
        const result = this.abilities.useAbility(this.myId, abilityId);
        if (!result.allowed) { ui.addLog(`❌ ${result.reason}`, 'ls'); return; }
        btn.disabled = true;
        btn.classList.add('ability-disabled');
        const def = result.def;
        // Update charge display
        const chargeEl = btn.querySelector('.ability-charges');
        if (chargeEl) chargeEl.textContent = `${this.abilities.getCharges(this.myId, abilityId)}/${def.maxUses}`;
        // Show ability toast confirmation
        const toast = document.createElement('div');
        toast.className = 'ability-toast';
        toast.textContent = `${def.icon} ${def.name} activated!`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);

        // Execute ability based on type
        if (abilityId === 'wiretap') {
          const r = this.abilities.getWiretapMessage();
          ui.addLog(r.text, r.success ? 'ld' : 'ls');
        } else if (abilityId === 'cold_case') {
          const targets = this.abilities.getColdCaseTargets();
          if (targets.length === 0) { ui.addLog('🧩 No decayed evidence to restore.', 'ls'); return; }
          const qteDiv = document.createElement('div');
          qteDiv.style.cssText = 'margin:8px 0';
          container.appendChild(qteDiv);
          const score = await runQTE(qteDiv, 2, 'jigsaw');
          const r = this.abilities.restoreEvidence(targets[0].id, score >= 0.5);
          ui.addLog(r.text, r.success ? 'ld' : 'ls');
          qteDiv.remove();
        } else if (abilityId === 'autopsy') {
          const targets = this.abilities.getAutopsyTargets();
          if (targets.length === 0) { ui.addLog('🔬 No bodies to examine.', 'ls'); return; }
          const qteDiv = document.createElement('div');
          qteDiv.style.cssText = 'margin:8px 0';
          container.appendChild(qteDiv);
          const score = await runQTE(qteDiv, 2, 'slider');
          const r = this.abilities.performAutopsy(targets[0].id, score);
          ui.addLog(r.text, r.success ? 'ld' : 'ls');
          // Store discovered traits in dossier
          if (r.traits?.length) {
            if (!this.dossier) this.dossier = {};
            if (!this.dossier[targets[0].id]) this.dossier[targets[0].id] = [];
            r.traits.forEach(t => this.dossier[targets[0].id].push(t));
          }
          qteDiv.remove();
        } else if (abilityId === 'town_watch') {
          const qteDiv = document.createElement('div');
          qteDiv.style.cssText = 'margin:8px 0';
          container.appendChild(qteDiv);
          const score = await runQTE(qteDiv, 1, 'spotlight');
          const r = this.abilities.performTownWatch(this.myId, score);
          ui.addLog(r.text, r.success ? 'ld' : 'ls');
          qteDiv.remove();
        } else if (abilityId === 'disguise') {
          ui.addLog('🎭 Disguise activated. You will appear as Civilian if investigated tonight.', 'lk');
        } else if (abilityId === 'crocodile_tears') {
          const r = this.abilities.activateCrocodileTears(this.myId);
          ui.addLog(r.text, 'ls');
        } else if (abilityId === 'evidence_destroy') {
          const targets = this.abilities.getDestroyTargets();
          if (targets.length === 0) { ui.addLog('🔥 No evidence to destroy.', 'ls'); return; }
          const qteDiv = document.createElement('div');
          qteDiv.style.cssText = 'margin:8px 0';
          container.appendChild(qteDiv);
          const score = await runQTE(qteDiv, 2, 'burn');
          const r = this.abilities.destroyEvidence(targets[0].id, score >= 0.6);
          if (r.success) ui.addLog(`🔥 Evidence destroyed: ${r.destroyed}`, 'lk');
          else { ui.addLog(`🔥 Failed to destroy evidence!`, 'lk'); if (r.extraClue) ui.addLog(r.extraClue, 'ls'); }
          qteDiv.remove();
        }
      };
    });
  }

  _resolveNight() { this.phaseManager.resolveNight(); }

  // ══════════════════════════════════════════════════════════
  // PHASE 2: INVESTIGATION (Limits + Verification)
  // Detective: 2 actions | Civilians: 1 each, 3 team total
  // ══════════════════════════════════════════════════════════
  _onInvestigate(d) {
    d.pa.forEach(u => { const p = this.players.find(x => x.id === u.id); if (p) p.alive = u.alive; });
    // Show death card if I died this round
    const meAlive = d.pa.find(u => u.id === this.myId);
    if (meAlive && !meAlive.alive) this._showDeathCard(this.myId, d.deathRoom);
    this.phase = 'investigate'; this._saveState(); audio.setAmbience('investigate');
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
      this._showEventBanner('☠', `${this._pname(killedIds[0])} WAS KILLED`, 'Check the Evidence Board for clues!', 'var(--blood-bright)');
      if (killedIds.length > 1) ui.addLog(`☠ ${killedIds.length} victims tonight! The killers were busy...`, 'lk');
      if (this.detectiveDead) {
        ui.addLog('🔍 The detective has fallen... evidence can no longer be verified.', 'lk');
      }
    }
    else if (savedIds.length > 0) { ui.showDoctorSave(this._pname(savedIds[0])); ui.addLog(`Night ${this.round}: ${this._pname(savedIds[0])} was saved!`, 'lc'); audio.play('save'); this._showEventBanner('🩺', `${this._pname(savedIds[0])} WAS SAVED`, 'The Doctor protected them through the night!', '#81c784'); }
    else { ui.addLog(`Night ${this.round}: No one died.`, 'ls'); this._showEventBanner('🌙', 'A PEACEFUL NIGHT', 'No one was harmed... for now.', 'var(--pale-dim)'); }

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
      // Season 2: Ability bar for investigate-phase abilities
      this._renderAbilityBar(logArea, 'investigate');
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
      this.ux.applyTimerWarning(tl, document.getElementById('dTimer'));
      if (tl <= 5 && tl > 0) audio.play('tick');
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
    const alive = this.players.filter(p => p.alive && p.id !== this.myId);
    const unverified = this.evidenceLedger.filter(e => e.status === 'unverified');

    // Remove old
    const old = document.getElementById('investArea');
    if (old) old.remove();

    if (!canAct) return;

    const investDiv = document.createElement('div');
    investDiv.id = 'investArea';
    const acColor = isDet ? 'var(--det-bright)' : 'var(--gold)';
    const roleLabel = isDet ? '🔍 Detective' : '🔎 Civilian';

    // Room info display
    const myRoom = this.manor?.getRoom(this.playerLocations?.[this.myId]);
    let html = myRoom ? `<div style="border:1px solid rgba(201,168,76,.15);border-radius:6px;padding:6px 10px;margin-bottom:8px;background:rgba(201,168,76,.03)">
      <div style="font-family:var(--font-display);font-size:.7rem;letter-spacing:.1em;color:var(--gold)">${myRoom.name}</div>
      <div class="room-ambiance">${myRoom.ambiance || ''}</div>
    </div>` : '';
    html += `<div style="color:${acColor};font-family:var(--font-display);font-size:.9rem;margin:10px 0 6px">${roleLabel} — ${remaining} action${remaining > 1 ? 's' : ''} remaining</div>`;

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
  _beginDinner() { this.phaseManager.beginDinner(); }

  _onDinner(d) {
    d.pa.forEach(u => { const p = this.players.find(x => x.id === u.id); if (p) p.alive = u.alive; });
    this.phase = 'dinner'; this._saveState(); audio.setAmbience('dinner');
    this.votes = {}; this.selVote = null; this.voted = false;
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

    // Auto-focus chat input for discussion
    setTimeout(() => { const ci = document.getElementById('chatInput'); if (ci) ci.focus(); }, 300);

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
    this.dayInterval = setInterval(() => { tl--; ui.updateTimer('dTimer', tl); this.ux.applyTimerWarning(tl, document.getElementById('dTimer')); if (tl <= 5 && tl > 0) audio.play('tick'); if (tl <= 0) { clearInterval(this.dayInterval); if (this.isHost) this._closeVote(); } }, 1000);
  }

  _renderVotes() {
    const me = this.players.find(p => p.id === this.myId);
    const isDead = me && !me.alive;
    let dp = this.players.map(p => {
      const accused = this.accusation?.isAccused?.(p.id);
      return {
        ...p,
        name: this._pname(p.id) + (accused ? ' 🔴' : ''),
        avatar: this.charData[p.id]?.persona?.icon || '❓',
        isAccused: !!accused,
      };
    });
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

  _checkVoteDone() { if (Object.keys(this.votes).length >= this.players.filter(p => p.alive).length) { clearInterval(this.dayInterval); this.phaseManager.closeVote(); } }

  _closeVote() { this.phaseManager.closeVote(); }

  _checkWin() { return this.phaseManager.checkWin(); }

  // ══════════════════════════════════════════════════════════
  // PHASE 4: VERDICT
  // ══════════════════════════════════════════════════════════
  _onVerdict(d) {
    d.pa.forEach(u => { const p = this.players.find(x => x.id === u.id); if (p) { p.alive = u.alive; p.role = u.role || p.role; } });
    this.phase = 'verdict'; this._saveState(); audio.setAmbience('verdict');
    ui.show('s-verdict'); ui.hideRoleReminder();
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
      const bannerColor = ex.role === 'killer' ? '#81c784' : d.isJester ? 'var(--gold)' : 'var(--blood-bright)';
      const bannerTitle = ex.role === 'killer' ? 'KILLER FOUND!' : d.isJester ? 'JESTER WINS!' : 'INNOCENT EXECUTED';
      const bannerSub = ex.role === 'killer' ? `${this._pname(d.exId)} was a Killer. Justice prevails.` : d.isJester ? `${this._pname(d.exId)} tricked you all!` : `${this._pname(d.exId)} was innocent... the town has blood on its hands.`;
      this._showEventBanner('⚖', bannerTitle, bannerSub, bannerColor);

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
    const t = setInterval(() => { vc--; document.getElementById('vcT').textContent = vc; if (vc <= 0) { clearInterval(t); if (this.isHost) this.phaseManager.beginNight(); } }, 1000);
  }

  _onGameOver(d) {
    clearInterval(this.dayInterval); clearInterval(this.investInterval); clearTimeout(this.nightTimeout);
    document.getElementById('nightOv').classList.remove('on');
    if (d.players) this.players = d.players;
    this.phase = 'over'; this._clearSavedState(); audio.setAmbience(null);
    ui.show('s-over'); ui.hideRoleReminder();
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
    this.evidenceLedger = []; this.myActionsUsed = 0; this.civilianActionsUsed = 0; this.nightCharges = 2; this.pendingNightResults = []; this.myBarricadeChance = 0; this.dossier = {};
    this.voteHistory = []; this.whispersUsed = 0; this.ghostClueUsed = false;
    this.currentNightEvent = null; this.suspicionVotes = {}; this.mySuspicionVotes = new Set();
    this.roundRecap = {}; this.lastStandActive = false;
    this.detectiveDead = false; this.investigationRequests = []; this.pendingInvestRequest = null;
    this._isRevote = false; this._revoteTiedIds = null;
    this.teamChatUsed = 0; this.teamSuspicionCounters = { killer: 0, detective: 0 };
    this.forgesUsed = 0; this.traitInvestsUsed = 0; this.dossier = {};
    clearInterval(this.graceInterval); clearInterval(this.dayInterval); clearInterval(this.investInterval); clearTimeout(this.nightTimeout); clearTimeout(this.lastWordsTimeout); this._clearSavedState(); audio.setAmbience(null);
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
  _showDramaticDeath(player, isJester) { this.uiManager.showDramaticDeath(player, isJester); }

  // ══════════════════════════════════════════════════════════
  // MOOD-BASED NOTIFICATIONS
  // ══════════════════════════════════════════════════════════
  _showMoodNotification(score, type, accuracy = null) { this.uiManager.showMoodNotification(score, type, accuracy); }

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
  // STATE PERSISTENCE (sessionStorage)
  // ══════════════════════════════════════════════════════════
  _saveState() {
    try {
      const state = {
        ts: Date.now(), phase: this.phase, round: this.round, myRole: this.myRole,
        lobbyCode: this.lobbyCode, isHost: this.isHost, myId: this.myId, myName: this.myName,
        settings: this.settings, evidenceLedger: this.evidenceLedger,
        voteHistory: this.voteHistory, dossier: this.dossier,
      };
      sessionStorage.setItem('nf_gameState', JSON.stringify(state));
    } catch {}
  }

  _clearSavedState() { try { sessionStorage.removeItem('nf_gameState'); } catch {} }

  _tryRestoreState() {
    try {
      const raw = sessionStorage.getItem('nf_gameState');
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (Date.now() - s.ts > 300000) { this._clearSavedState(); return false; } // 5min expiry
      if (!s.lobbyCode || s.phase === 'lobby' || s.phase === 'over') { this._clearSavedState(); return false; }
      // Restore partial state
      this.lobbyCode = s.lobbyCode; this.myRole = s.myRole; this.isHost = s.isHost;
      this.settings = s.settings || this.settings;
      this.evidenceLedger = s.evidenceLedger || []; this.voteHistory = s.voteHistory || [];
      this.dossier = s.dossier || {};
      // Attempt to rejoin the room
      this.net.roomCode = s.lobbyCode;
      this.net.joinRoom(s.myId, s.myName, s.lobbyCode);
      ui.toast('Reconnecting to game...');
      return true;
    } catch { return false; }
  }

  // ══════════════════════════════════════════════════════════
  // CINEMATIC PHASE TRANSITION
  // ══════════════════════════════════════════════════════════
  _showPhaseTransition(phaseName, icon, callback) {
    audio.play('transition');
    const overlay = document.createElement('div');
    overlay.className = 'phase-transition-overlay';
    overlay.innerHTML = `<div class="phase-transition-icon">${icon}</div><div class="phase-transition-name">${phaseName}</div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.classList.add('phase-transition-out');
      setTimeout(() => { overlay.remove(); callback?.(); }, 400);
    }, 600);
  }

  // ══════════════════════════════════════════════════════════
  // EVENT BANNER — 3-second popup for major game events
  // ══════════════════════════════════════════════════════════
  _showEventBanner(icon, title, subtitle, color = 'var(--gold)') {
    const existing = document.querySelector('.event-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'event-banner';
    banner.innerHTML = `
      <div class="event-banner-content" style="border-color:${color}">
        <div style="font-size:2.2rem;margin-bottom:4px">${icon}</div>
        <div style="font-size:1rem;font-family:var(--font-display);color:${color};letter-spacing:.1em">${title}</div>
        <div style="font-size:.7rem;color:var(--pale-dim);margin-top:4px;max-width:280px;line-height:1.4">${subtitle}</div>
      </div>`;
    document.body.appendChild(banner);
    audio.haptic([50, 30, 50]);
    setTimeout(() => { banner.classList.add('event-banner-out'); }, 2700);
    setTimeout(() => { banner.remove(); }, 3200);
  }

  // ══════════════════════════════════════════════════════════
  // DEATH RECAP CARD
  // ══════════════════════════════════════════════════════════
  _showDeathCard(victimId, room) {
    if (victimId !== this.myId) return;
    audio.play('death');
    const persona = this.charData[victimId]?.persona;
    const roomData = room ? this.manor?.getRoom(room) : null;
    const overlay = document.createElement('div');
    overlay.className = 'death-card-overlay';
    overlay.innerHTML = `<div class="death-card">
      <div class="death-card-icon">${persona?.icon || '💀'}</div>
      <div class="death-card-title">YOU HAVE BEEN KILLED</div>
      <div class="death-card-name">${persona?.name || 'Unknown'}</div>
      <div class="death-card-details">
        ${roomData ? `<div>🏠 ${roomData.icon} ${roomData.name}</div>` : ''}
        <div>⏱ Survived ${this.round} round${this.round !== 1 ? 's' : ''}</div>
      </div>
      <div class="death-card-quote">The shadows claimed another soul...</div>
      <button class="btn btn-out death-card-dismiss">Continue as Spectator</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.death-card-dismiss').onclick = () => {
      overlay.classList.add('death-card-fade');
      setTimeout(() => overlay.remove(), 500);
    };
  }

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

  _showNightEvent(event) { this.uiManager.showNightEvent(event); }

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
    const GHOST_PHRASES = [
      'Check the evidence', 'The quiet one', 'Wrong floor entirely',
      'Trust no one', 'Watch their hands', 'Listen more carefully',
      'Not who seems', 'Evidence was forged', 'Same floor twice',
      'Follow the scent', 'Basement holds secrets', 'They lied twice',
      'Look at shoes', 'Hair gives away', 'Kitchen was suspicious',
      'Upper floor danger', 'Alibi doesn\'t match', 'Count the votes',
      'Night was loud', 'Search the library',
    ];
    const gcDiv = document.createElement('div');
    gcDiv.id = 'ghostClueArea';
    gcDiv.style.cssText = 'padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:8px;margin:6px 0';
    gcDiv.innerHTML = `<div style="font-size:.75rem;color:var(--pale-dim);margin-bottom:4px">👻 Select a cryptic clue for the living:</div>
      <select id="ghostClueSelect" class="input" style="width:100%;padding:6px;background:rgba(0,0,0,.4);color:var(--pale);border:1px solid rgba(201,168,76,.2);border-radius:6px;font-size:.8rem">
        <option value="" disabled selected>— Choose your whisper —</option>
        ${GHOST_PHRASES.map(p => `<option value="${p}">${p}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-out" id="ghostClueSend" style="margin-top:4px;width:100%">Send Ghost Clue</button>`;
    chatPanel.appendChild(gcDiv);
    document.getElementById('ghostClueSend').onclick = () => {
      const sel = document.getElementById('ghostClueSelect');
      const text = sel?.value;
      if (!text) { ui.toast('Select a clue first!', true); return; }
      this.ghostClueUsed = true;
      this.net.relay({ t: 'GHOST_CLUE', text });
      chat.addMessage('', `👻 Your message echoes through the manor... "${text}"`, 'ghost');
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
      btn.onclick = () => this.uiManager.openGameHub();
    }
    this.uiManager.renderResourceHUD();
  }

  // ══════════════════════════════════════════════════════════
  // UNIFIED GAME HUB (replaces town board + evidence + more)
  // Tabs: Players | Evidence | Dossier (det only) | Suspicion
  // ══════════════════════════════════════════════════════════
  _openGameHub(startTab = 'players') { this.uiManager.openGameHub(startTab); }
  _renderGameHubTab(tab) { this.uiManager._renderGameHubTab(tab); }
  _renderGameHubPlayers(body) { this.uiManager._renderPlayers(body); }
  _renderGameHubEvidence(body, filter) { this.uiManager._renderEvidence(body, filter); }
  _renderGameHubDossier(body) { this.uiManager._renderDossier(body); }
  _renderGameHubSuspicion(body) { this.uiManager._renderSuspicion(body); }

  // ══════════════════════════════════════════════════════════
  // SUSPICION ESCALATION — private chat usage → public msgs
  // ══════════════════════════════════════════════════════════
  _checkSuspicionEscalation(team) { this.uiManager.checkSuspicionEscalation(team); }

  // ══════════════════════════════════════════════════════════
  // RESOURCE HUD — persistent top bar
  // ══════════════════════════════════════════════════════════
  _renderResourceHUD() { this.uiManager.renderResourceHUD(); }

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
