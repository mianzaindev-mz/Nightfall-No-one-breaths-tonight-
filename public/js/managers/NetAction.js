// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — NetAction Manager
// Extracted from game.js (Lines 122–243)
// Registers ALL websocket event handlers and routes them to Game
// ═══════════════════════════════════════════════════════════════

import audio from '../audio.js';
import chat from '../chat.js';
import * as ui from '../ui.js';

export default class NetAction {
  /**
   * @param {import('../game.js').default} game — the Game instance (state + methods)
   */
  constructor(game) {
    this.game = game;
    this._registerAll();
  }

  _registerAll() {
    const g = this.game;
    const n = g.net;

    // ── Lobby lifecycle ──────────────────────────────
    n.on('CREATED', d => {
      g.lobbyCode = d.code; g.isHost = true;
      g.players = [{ id: g.myId, name: g.myName, avatar: g.myAvatar, alive: true, role: null, disconnected: false, isHost: true }];
      g._showLobby();
    });

    n.on('JOINED', d => {
      g.lobbyCode = d.code; g.isHost = (d.hostId === g.myId);
      n.roomCode = d.code; n.getPlayers(); g._showLobby();
    });

    n.on('JOIN_FAIL', d => ui.toast(d.reason || 'Failed to join', true));

    n.on('RECONNECTED', d => {
      g.lobbyCode = d.code; g.isHost = (d.hostId === g.myId);
      n.roomCode = d.code; ui.toast('Reconnected!'); n.getPlayers();
    });

    n.on('PLAYER_LIST', d => {
      g.players = d.players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar || '👤',
        alive: p.alive !== undefined ? p.alive : true,
        role: p.role || null, disconnected: !p.connected,
        isHost: p.id === d.hostId
      }));
      g.isHost = d.hostId === g.myId;
      g._renderLobby();
    });

    n.on('PLAYER_JOINED', d => {
      if (!g.players.find(p => p.id === d.playerId))
        g.players.push({ id: d.playerId, name: d.name, avatar: d.avatar || '👤', alive: true, role: null, disconnected: false });
      g._renderLobby(); ui.toast(`${d.name} joined`); audio.play('chat');
    });

    n.on('PLAYER_LEFT', d => {
      g.players = g.players.filter(p => p.id !== d.playerId);
      g._renderLobby(); ui.toast(`${d.name} left`);
    });

    n.on('PLAYER_DISCONNECTED', d => {
      const p = g.players.find(x => x.id === d.playerId);
      if (p) p.disconnected = true; g._renderLobby();
    });

    n.on('PLAYER_RECONNECTED', d => {
      const p = g.players.find(x => x.id === d.playerId);
      if (p) p.disconnected = false; g._renderLobby();
    });

    n.on('HOST_CHANGED', d => {
      g.isHost = (d.newHostId === g.myId);
      g.players.forEach(p => p.isHost = p.id === d.newHostId);
      g._renderLobby(); ui.toast(`${d.name} is the new host`);
    });

    n.on('PL', d => {
      d.pl.forEach(u => {
        let p = g.players.find(x => x.id === u.id);
        if (p) Object.assign(p, u);
        else g.players.push({ ...u, disconnected: false });
      });
      g._renderLobby();
    });

    // ── Phase transitions ────────────────────────────
    n.on('ROLE', d => {
      g.round = d.round || 1; g.phase = 'role'; g.myRole = d.role;
      g.charData = d.charData || {};
      g.myPersona = g.charData[g.myId]?.persona;
      g.myCharacter = { pub: g.charData[g.myId]?.pub, hidden: g.charData[g.myId]?.hidden };
      d.publicPlayers.forEach(u => { let p = g.players.find(x => x.id === u.id); if (p) p.alive = true; });
      const me = g.players.find(p => p.id === g.myId); if (me) me.role = d.role;
      g.settings = d.settings || g.settings; g.killCounts = {};
      g._showRole(d.allies || []);
    });

    n.on('NIGHT', d => { g.phase = 'night'; g.round = d.round; g.playerLocations = d.locations || {}; g._showNight(d.dur); });
    n.on('GRACE', d => { g._onGrace(d); });

    n.on('SKIP_VOTE', d => {
      if (g.isHost) {
        g.skipVotes.add(d._from);
        const alive = g.players.filter(p => p.alive && !p.disconnected).length;
        const needed = Math.ceil(alive * 0.7);
        g.net.relay({ t: 'SKIP_UPDATE', count: g.skipVotes.size, needed });
        if (g.skipVotes.size >= needed) g._triggerSkip();
      }
    });

    n.on('SKIP_UPDATE', d => { g._updateSkipUI(d.count, d.needed); });
    n.on('INVESTIGATE', d => { g._onInvestigate(d); });
    n.on('DINNER', d => { g._onDinner(d); });
    n.on('VOTE_UPDATE', d => { g.votes = d.votes || {}; g._renderVotes(); });
    n.on('VERDICT', d => { g._onVerdict(d); });
    n.on('GAMEOVER', d => { g._onGameOver(d); });

    n.on('READY', d => {
      if (g.isHost) { g.readySet.add(d._from); g._checkReady(); }
    });

    // ── Night actions ────────────────────────────────
    n.on('KILL_ACTION', d => {
      if (!g.isHost) return;
      // Check for target overlap — warn killers
      const existingKillers = Object.entries(g.nightActions)
        .filter(([kid, tid]) => tid === d.targetId && kid !== d._from);
      if (existingKillers.length > 0) {
        const targetName = g._pname(d.targetId);
        const warningText = `⚠ WARNING: Multiple killers targeting ${targetName}! Consider splitting targets.`;
        g.players.forEach(p => {
          if (p.role === 'killer' && !p._isBot) {
            // FIX: use relay with toPlayerId instead of the non-existent sendTo
            g.net.relay({ t: 'TEAM_CHAT', team: 'killer', name: '⚠ System', text: warningText }, p.id);
          }
        });
        if (g.myRole === 'killer') chat.addMessage('⚠ System', warningText, 'team-killer', 'killer');
      }
      g.nightActions[d._from] = d.targetId;
      if (d.killClues?.length)
        d.killClues.forEach(c => { if (c.text) g.killClues.push({ text: c.text, accuracyPct: c.accuracyPct, isFalse: c.isFalse, strength: c.strength }); });
      else if (d.killClue?.text)
        g.killClues.push({ text: d.killClue.text, accuracyPct: d.killClue.accuracyPct, isFalse: d.killClue.isFalse, strength: d.killClue.strength });
      g.killCounts[d._from] = (g.killCounts[d._from] || 0) + 1;
      g._checkNightDone();
    });

    n.on('INVEST_RESULT', d => {
      if (g.isHost && d.clue)
        g.investigationClues.push({ playerId: d._from, clue: d.clue, isFalse: d.isFalse || false });
    });

    // ── Democratic investigation ─────────────────────
    n.on('INVEST_REQUEST', d => { g._onInvestRequest(d); });
    n.on('INVEST_VOTE', d => { if (g.isHost) g._onInvestVote(d); });
    n.on('INVEST_DECISION', d => { g._onInvestDecision(d); });

    // ── Killer intel ──────────────────────────────────
    n.on('SNOOP_ALERT', d => { if (g.myRole === 'killer') g._showSnoopAlert(d); });

    // ── Team chat ─────────────────────────────────────
    n.on('TEAM_CHAT', d => {
      if (g.isHost) {
        const team = d.team;
        g.teamSuspicionCounters[team] = (g.teamSuspicionCounters[team] || 0) + 1;
        g._checkSuspicionEscalation(team);
        g.players.forEach(p => {
          if (p.role === team && p.id !== d._from && !p._isBot) {
            g.net.relay({ t: 'TEAM_CHAT', team: d.team, name: d.name, text: d.text }, p.id);
          }
        });
        if (g.myRole === team) chat.addMessage(d.name, d.text, `team-${team}`, team);
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
        if (!g.evidenceLedger.find(e => e.id === d.evidence.id)) {
          g.evidenceLedger.push(d.evidence);
        }
      }
    });

    // ── Doctor / Vote / Chat / Misc ──────────────────
    n.on('DOC_PROTECT', d => { if (g.isHost) g.doctorTarget = d.targetId; });

    n.on('VOTE', d => {
      if (g.isHost) {
        g.votes[d._from] = d.targetId;
        g.net.relay({ t: 'VOTE_UPDATE', votes: g.votes });
        g._checkVoteDone();
      }
    });

    n.on('CHAT', d => { chat.addMessage(d.persona || d.name, d.text, d.chatType || 'normal'); audio.play('chat'); });
    n.on('LAST_WORDS', d => { chat.addMessage(d.persona || d.name, d.text, 'last-words'); });
    n.on('WHISPER', d => { g._onWhisper(d); });
    n.on('WHISPER_NOTICE', d => { chat.addMessage('', `💬 ${d.senderName} whispered to ${d.receiverName}`, 'system'); });
    n.on('GHOST_CLUE', d => { chat.addMessage('👻 Ghost', d.text, 'ghost'); ui.addLog(`👻 Ghost clue: "${d.text}"`, 'lc'); audio.play('ghost'); });

    n.on('SUSPICION_VOTE', d => {
      if (g.isHost) {
        if (!g.suspicionVotes[d.targetId]) g.suspicionVotes[d.targetId] = { up: 0, down: 0 };
        g.suspicionVotes[d.targetId][d.dir]++;
        g.net.relay({ t: 'SUSPICION_UPDATE', votes: g.suspicionVotes });
      }
    });

    n.on('SUSPICION_UPDATE', d => { g.suspicionVotes = d.votes || {}; g._renderSuspicion(); });
    n.on('NIGHT_EVENT', d => { g.currentNightEvent = d.event; g._showNightEvent(d.event); });

    n.on('KICKED', d => {
      if (d.targetId === g.myId) {
        ui.toast('You were kicked', true); ui.show('s-land');
        g.phase = 'lobby'; g.players = [];
      }
    });

    n.on('SETTINGS', d => { g.settings = d.settings; });
  }
}
