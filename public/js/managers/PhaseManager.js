// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Phase Manager
// Extracted from game.js (Lines 331–1414)
// Orchestrates all phase start/stop transitions and timers
// ═══════════════════════════════════════════════════════════════

import { generateKillClue, generateKillClues, generateInvestClue, generateSnoopClue, generateTraitInvestResult, computeVerification, formatEvidence, runQTE, getKillDifficulty, getInvestigateDifficulty, getVerifyDifficulty } from '../qte.js';
import { assignRoles, getRoleInfo } from '../roles.js';
import { assignCharacters, getPublicDesc, getHiddenDesc } from '../avatar.js';
import audio from '../audio.js';
import chat from '../chat.js';
import * as ui from '../ui.js';

export default class PhaseManager {
  /**
   * @param {import('../game.js').default} game
   */
  constructor(game) {
    this.g = game;
  }

  // ══════════════════════════════════════════════════════════
  // HOST START — role assignment + character generation
  // ══════════════════════════════════════════════════════════
  hostStart() {
    const g = this.g;
    if (!g.isHost || g.players.length < 4) return;
    const roleMap = assignRoles(g.players, g.settings);
    roleMap.forEach(r => { const p = g.players.find(x => x.id === r.id); if (p) { p.role = r.role; p.alive = true; } });
    const { personas, characters } = assignCharacters(g.players.map(p => p.id));
    g._hostPersonas = personas; g._hostCharacters = characters;
    g.charData = {};
    personas.forEach((persona, id) => { g.charData[id] = { persona, pub: characters.get(id).pub }; });
    g.charData[g.myId].hidden = characters.get(g.myId).hidden;
    g.myPersona = personas.get(g.myId);
    g.myCharacter = { pub: characters.get(g.myId).pub, hidden: characters.get(g.myId).hidden };
    g.phase = 'role'; g.round = 1; g.readySet = new Set(); g.jesterWinner = null; g.killCounts = {};
    g.abilities.initAll(); // Season 2: Initialize ability charges for all players
    const publicPlayers = g.players.map(p => ({ id: p.id }));
    g.players.forEach(p => {
      const allies = p.role === 'killer' ? g.players.filter(x => x.role === 'killer' && x.id !== p.id).map(x => personas.get(x.id).name) : [];
      const cd = {};
      personas.forEach((persona, id) => { cd[id] = { persona, pub: characters.get(id).pub }; if (id === p.id) cd[id].hidden = characters.get(id).hidden; });
      if (p.id === g.myId) { g.myRole = p.role; g._showRole(allies); }
      else g.net.relay({ t: 'ROLE', role: p.role, allies, publicPlayers, round: g.round, settings: g.settings, charData: cd }, p.id);
    });
  }

  // ══════════════════════════════════════════════════════════
  // GRACE PERIOD (60s socializing pre-game)
  // ══════════════════════════════════════════════════════════
  beginGrace() {
    const g = this.g;
    if (!g.isHost) return;
    g.skipVotes = new Set(); g.mySkipVoted = false;
    const dur = 60000;
    const payload = { t: 'GRACE', dur, round: g.round, pa: g.players.map(p => ({ id: p.id })) };
    g.net.relay(payload);
    g._onGrace(payload);
  }

  // ══════════════════════════════════════════════════════════
  // NIGHT PHASE — killer strikes
  // ══════════════════════════════════════════════════════════
  beginNight() {
    const g = this.g;
    if (!g.isHost) return;
    g.phase = 'night'; g.nightActions = {}; g.doctorTarget = null;
    g.killClues = []; g.investigationClues = [];
    g.readySet = new Set(); g.savedId = null;
    g.suspicionVotes = {}; g.mySuspicionVotes = new Set();
    g.whispersUsed = 0; g.ghostClueUsed = false;
    g.abilities.clearRoundEffects(); // Season 2: Reset active ability effects
    g.ux?.setPhaseColor('night'); // Season 2: Phase ambient color
    g.ux?.spawnEmbers(); // Season 2: Night atmosphere
    g.ux?.showPhaseTransitionBar(); // Season 2: Transition bar
    g.currentNightEvent = g.settings.nightEvents !== false ? g._rollNightEvent() : null;

    // ── Season 2: Assign Manor locations ──
    const alivePlayers = g.players.filter(p => p.alive).map(p => p.id);
    const locations = g.manor.assignLocations(alivePlayers);
    const locObj = {};
    locations.forEach((roomId, pid) => { locObj[pid] = roomId; });
    g.playerLocations = locObj; // Store on game instance for room info display

    // ── Season 2: Evidence Decay ──
    const decayWarnings = g.round > 1 ? g.evidence.ageAndWarn() : [];
    if (decayWarnings.length > 0) {
      g.net.relay({ t: 'EVIDENCE_DECAY', warnings: decayWarnings, round: g.round });
    }

    const dur = g.settings.nightTime * 1000;
    const nightPayload = { t: 'NIGHT', round: g.round, dur, locations: locObj, decayWarnings };
    if (g.currentNightEvent) {
      nightPayload.event = g.currentNightEvent;
      g.net.relay({ t: 'NIGHT_EVENT', event: g.currentNightEvent });
    }
    g.net.relay(nightPayload);
    g._showNight(dur);
    clearTimeout(g.nightTimeout);
    g.nightTimeout = setTimeout(() => { if (g.phase === 'night') this.resolveNight(); }, dur);
    g.roundRecap[g.round] = { events: [], evidence: [], votes: {}, locations: locObj };
    if (g.currentNightEvent) g.roundRecap[g.round].events.push(`🌩 Night Event: ${g.currentNightEvent.name}`);
    if (decayWarnings.length > 0) g.roundRecap[g.round].events.push(`⚠ ${decayWarnings.length} evidence item(s) decaying`);

    // Season 2: Major Recap check (every 5 rounds)
    if (g.chronicle?.shouldShowMajorRecap?.()) {
      const recapHtml = g.chronicle.renderMajorRecap();
      g.net.relay({ t: 'MAJOR_RECAP', html: recapHtml });
    }

    setTimeout(() => g._botNightActions(), 1000);
  }

  checkNightDone() {
    const g = this.g;
    const killers = g.players.filter(p => p.alive && p.role === 'killer');
    if (killers.every(k => g.nightActions[k.id])) {
      clearTimeout(g.nightTimeout);
      setTimeout(() => this.resolveNight(), 1500);
    }
  }

  resolveNight() {
    const g = this.g;
    if (!g.isHost) return;
    const killedIds = []; let savedIds = [];
    const killerTargets = {};

    // ── Fallback: if nightActions is empty but killers exist, force a random kill ──
    // This prevents 'no one died' rounds caused by relay message drops
    const livingKillers = g.players.filter(p => p.alive && p.role === 'killer');
    if (livingKillers.length > 0 && Object.keys(g.nightActions).length === 0) {
      const possibleTargets = g.players.filter(p => p.alive && p.role !== 'killer');
      if (possibleTargets.length > 0) {
        const randomTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
        const randomKiller = livingKillers[Math.floor(Math.random() * livingKillers.length)];
        g.nightActions[randomKiller.id] = randomTarget.id;
        // Fallback clue (relay was lost so no QTE data)
        g.killClues.push({ text: 'The killer struck swiftly — witnesses heard a struggle.', isFalse: false, strength: 'medium' });
      }
    }

    Object.entries(g.nightActions).forEach(([killerId, targetId]) => {
      killerTargets[targetId] = (killerTargets[targetId] || []);
      killerTargets[targetId].push(killerId);
    });
    Object.entries(killerTargets).forEach(([targetId, killerIds]) => {
      const vic = g.players.find(p => p.id === targetId);
      if (vic && vic.alive) {
        if (g.doctorTarget === targetId) savedIds.push(targetId);
        else { vic.alive = false; killedIds.push(targetId); }
      }
    });
    g.killedIds = killedIds; g.savedIds = savedIds;
    g.killedId = killedIds[0] || null; g.savedId = savedIds[0] || null;
    killedIds.forEach(kid => {
      const killedPlayer = g.players.find(p => p.id === kid);
      if (killedPlayer && killedPlayer.role === 'detective') g.detectiveDead = true;
    });
    const investDur = (g.settings.investTime || 40) * 1000;
    g.killClues.forEach(c => {
      g.evidenceLedger.push({
        id: 'ev-' + Math.random().toString(36).slice(2, 8),
        text: c.text, isFalse: c.isFalse, status: 'unverified',
        accuracyPct: null, verdictText: null, source: 'crime-scene',
        round: g.round, strength: c.strength || 'medium'
      });
    });
    const payload = {
      t: 'INVESTIGATE', round: g.round, killedIds, savedIds,
      killedId: killedIds[0] || null, savedId: savedIds[0] || null,
      detectiveDead: g.detectiveDead,
      evidence: g.evidenceLedger.filter(e => e.round === g.round && e.source === 'crime-scene')
        .map(e => ({ id: e.id, text: e.text, strength: e.strength })),
      dur: investDur,
      pa: g.players.map(p => ({ id: p.id, alive: p.alive }))
    };
    g.net.relay(payload);
    g._onInvestigate(payload);

    // Season 2: Chronicle auto-recording
    killedIds.forEach(kid => {
      const kp = g.players.find(p => p.id === kid);
      const roomId = g.playerLocations?.[kid];
      const roomData = roomId ? g.manor?.getRoom(roomId) : null;
      g.chronicle?.record?.('death', {
        name: g._pname(kid),
        room: roomData?.name || null,
        floor: roomData ? g.manor?.getFloorInfo(roomId)?.name : null
      });
    });
    savedIds.forEach(sid => {
      g.chronicle?.record?.('save', { name: g._pname(sid) });
    });
    g.killClues.forEach(c => {
      g.chronicle?.record?.('evidence', { text: c.text, source: 'crime-scene' });
    });
  }

  // ══════════════════════════════════════════════════════════
  // DINNER PHASE — discussion + voting
  // ══════════════════════════════════════════════════════════
  beginDinner() {
    const g = this.g;
    if (!g.isHost) return;
    g.phase = 'dinner'; g.votes = {};
    g.accusation.resetPhaseCharges(); // Season 2: Reset per-phase accusation limit
    g.ux?.setPhaseColor('dinner'); // Season 2: Phase ambient color
    g.ux?.clearEmbers(); // Season 2: Clear night atmosphere
    g.ux?.showPhaseTransitionBar(); // Season 2: Transition bar
    const dur = g.difficulty?.getDinnerTimer() || (g.settings.dayTime || 60) * 1000;
    const payload = {
      t: 'DINNER', round: g.round, dur,
      investigationClues: g.investigationClues,
      pa: g.players.map(p => ({ id: p.id, alive: p.alive }))
    };
    g.net.relay(payload);
    g._onDinner(payload);
  }

  // ══════════════════════════════════════════════════════════
  // CLOSE VOTE — tally + verdict/gameover
  // ══════════════════════════════════════════════════════════
  closeVote() {
    const g = this.g;
    if (!g.isHost) return;
    const tally = {};
    Object.entries(g.votes).forEach(([voterId, v]) => { if (v !== 'SKIP') tally[v] = (tally[v] || 0) + 1; });
    const skipCount = Object.values(g.votes).filter(v => v === 'SKIP').length;
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    let exId = null;
    // Tie → focused revote
    if (sorted.length >= 2 && sorted[0][1] === sorted[1][1] && !g._isRevote) {
      const tiedIds = sorted.filter(([_, c]) => c === sorted[0][1]).map(([id]) => id);
      g._isRevote = true;
      const payload = {
        t: 'DINNER', round: g.round, revote: true, tiedIds,
        tiedNames: tiedIds.map(id => g._pname(id)),
        dur: 15000, pa: g.players.map(p => ({ id: p.id, alive: p.alive }))
      };
      g.votes = {};
      g.net.relay(payload);
      g._onDinner(payload);
      return;
    }
    g._isRevote = false;
    // Determine execution: clear winner only if they have more votes than skip 
    if (sorted.length && (sorted.length === 1 || sorted[0][1] > (sorted[1]?.[1] || 0)) && sorted[0][1] > skipCount) {
      exId = sorted[0][0];
    }
    let isJester = false;
    if (exId) {
      const p = g.players.find(x => x.id === exId);
      if (p) {
        if (p.role === 'jester') { isJester = true; g.jesterWinner = g._pname(exId); }
        p.alive = false;
      }
    }
    g.voteHistory.push({ round: g.round, votes: { ...g.votes }, tally: { ...tally }, exId });
    if (g.roundRecap[g.round]) {
      g.roundRecap[g.round].votes = { ...g.votes };
      if (exId) {
        const ep = g.players.find(x => x.id === exId);
        g.roundRecap[g.round].events.push(`⚔ ${g._pname(exId)} was executed. Role: ${ep?.role || 'unknown'}`);
      }
    }

    // Season 2: Chronicle auto-recording (vote + execution)
    g.chronicle?.record?.('vote', {
      results: Object.fromEntries(Object.entries(tally).map(([id, c]) => [g._pname(id), c])),
      executed: exId ? g._pname(exId) : null,
      wasKiller: exId ? g.players.find(p => p.id === exId)?.role === 'killer' : false
    });
    if (exId) {
      const ep = g.players.find(p => p.id === exId);
      g.chronicle?.record?.('execution', { name: g._pname(exId), role: ep?.role || 'unknown' });
      g.accusation?.resolveExecution?.(exId); // Season 2: Apply accusation badges
    }
    const w = this.checkWin();
    if (w) {
      const payload = {
        t: 'GAMEOVER', winner: w,
        players: g.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, role: p.role })),
        tally, exId, isJester, jesterWinner: g.jesterWinner,
        charData: g.charData, voteHistory: g.voteHistory
      };
      g.net.relay(payload); g._onGameOver(payload);
    } else {
      const payload = {
        t: 'VERDICT', tally, exId, isJester, skipCount,
        pa: g.players.map(p => ({ id: p.id, alive: p.alive, role: p.role })),
        jesterWinner: g.jesterWinner, voteHistory: g.voteHistory,
        recap: g.roundRecap[g.round]
      };
      g.net.relay(payload); g._onVerdict(payload);
    }
  }

  checkWin() {
    const g = this.g;
    const ak = g.players.filter(p => p.alive && p.role === 'killer');
    const ac = g.players.filter(p => p.alive && p.role !== 'killer' && p.role !== 'jester');
    const aj = g.players.filter(p => p.alive && p.role === 'jester');
    if (!ak.length) return 'civilians';
    if (ak.length >= ac.length + aj.length) return 'killers';
    return null;
  }
}
