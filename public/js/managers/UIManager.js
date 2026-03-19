// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — UI Manager
// Extracted from game.js (Lines 1467–1942)
// Handles dramatic overlays, mood notifications, game hub,
// resource HUD, and other pure rendering logic
// ═══════════════════════════════════════════════════════════════

import { formatEvidence } from '../qte.js';
import { getPublicDesc, getHiddenDesc } from '../avatar.js';
import { getRoleInfo } from '../roles.js';
import audio from '../audio.js';
import chat from '../chat.js';
import * as ui from '../ui.js';

export default class UIManager {
  /**
   * @param {import('../game.js').default} game
   */
  constructor(game) {
    this.g = game;
  }

  // ══════════════════════════════════════════════════════════
  // DRAMATIC DEATH REVEAL OVERLAY
  // ══════════════════════════════════════════════════════════
  showDramaticDeath(player, isJester) {
    const g = this.g;
    const roleConfigs = {
      killer:    { icon: '☠', title: 'THE DARKNESS RETREATS', subtitle: 'The killer has been unmasked.', color: '#e53935', glow: 'rgba(229,57,53,.3)', message: `${player._displayName || player.name} was the KILLER all along!` },
      detective: { icon: '🔍', title: 'THE EYES GO DARK', subtitle: 'The detective has fallen.', color: '#42a5f5', glow: 'rgba(66,165,245,.3)', message: `${player._displayName || player.name} was the DETECTIVE — who will seek the truth now?` },
      doctor:    { icon: '💊', title: 'NO ONE CAN SAVE THEM NOW', subtitle: 'The doctor is gone.', color: '#66bb6a', glow: 'rgba(102,187,106,.3)', message: `${player._displayName || player.name} was the DOCTOR — the killer roams free.` },
      jester:    { icon: '🃏', title: 'CHAOS WINS', subtitle: 'The fool laughs last.', color: '#ab47bc', glow: 'rgba(171,71,188,.3)', message: `${player._displayName || player.name} was the JESTER — and you fell for it!` },
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
    setTimeout(() => { overlay.classList.add('dd-fadeout'); setTimeout(() => overlay.remove(), 600); }, 4000);
    overlay.onclick = () => { overlay.classList.add('dd-fadeout'); setTimeout(() => overlay.remove(), 600); };
  }

  // ══════════════════════════════════════════════════════════
  // MOOD-BASED NOTIFICATIONS
  // ══════════════════════════════════════════════════════════
  showMoodNotification(score, type, accuracy = null) {
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
    const notif = document.createElement('div');
    notif.className = `mood-notif ${moodClass}`;
    notif.innerHTML = `<div class="mood-text">${msg}</div>`;
    if (accuracy !== null) notif.innerHTML += `<div class="mood-detail">Analysis accuracy: ${accuracy}%</div>`;
    document.body.appendChild(notif);
    setTimeout(() => { notif.classList.add('mood-fadeout'); setTimeout(() => notif.remove(), 600); }, 3500);
  }

  // ══════════════════════════════════════════════════════════
  // RESOURCE HUD (persistent top bar during phases)
  // ══════════════════════════════════════════════════════════
  renderResourceHUD() {
    const g = this.g;
    const el = document.getElementById('resourceHUD');
    if (!el) return;
    if (g.phase === 'lobby' || g.phase === 'over') { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const maxActions = g._getMyMaxActions();
    let html = `<span class="rh-item">🔎 Actions: ${g.myActionsUsed || 0}/${maxActions}</span>`;
    if (g.myRole === 'killer') {
      html += `<span class="rh-item">🗡 Chat: ${g.teamChatUsed}/3</span>`;
      html += `<span class="rh-item">🔨 Forge: ${g.forgesUsed}/1</span>`;
    } else if (g.myRole === 'detective') {
      html += `<span class="rh-item">🔍 Chat: ${g.teamChatUsed}/3</span>`;
      html += `<span class="rh-item">🕵 Traits: ${g.traitInvestsUsed}/3</span>`;
    }
    el.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════
  // GAME HUB (unified modal: Players, Evidence, Dossier, Suspicion)
  // ══════════════════════════════════════════════════════════
  openGameHub(startTab = 'players') {
    const g = this.g;
    const existing = document.getElementById('gameHubModal');
    if (existing) { existing.remove(); return; }
    const modal = document.createElement('div');
    modal.id = 'gameHubModal';
    modal.className = 'overlay-modal';
    const tabs = [
      { key: 'players', label: '👥 Players', forAll: true },
      { key: 'evidence', label: '🗂 Evidence', forAll: true },
      { key: 'accuse', label: '⚖ Accuse', forAll: true },
      { key: 'chronicle', label: '📜 Chronicle', forAll: true },
      { key: 'dossier', label: '🕵 Dossier', forAll: false, roles: ['detective'] },
      { key: 'suspicion', label: '📊 Suspicion', forAll: true },
      { key: 'host', label: '🛡 Host', forAll: false, hostOnly: true },
    ];
    let html = `<div class="modal-card gh-card"><div class="gh-header"><div class="gh-title">📋 GAME HUB</div><div class="gh-tabs">`;
    tabs.forEach(tab => {
      if (!tab.forAll && tab.hostOnly && !g.isHost) return;
      if (!tab.forAll && !tab.hostOnly && (!tab.roles || !tab.roles.includes(g.myRole))) return;
      html += `<button class="gh-tab${tab.key === startTab ? ' gh-tab-active' : ''}" data-tab="${tab.key}">${tab.label}</button>`;
    });
    html += `</div></div><div class="gh-body" id="ghBody"></div><button class="btn btn-sm btn-out gh-close" id="ghClose">Close</button></div>`;
    modal.innerHTML = html;
    document.body.appendChild(modal);
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
    if (tab === 'players') this._renderPlayers(body);
    else if (tab === 'evidence') this._renderEvidence(body);
    else if (tab === 'accuse') this._renderAccuse(body);
    else if (tab === 'chronicle') this._renderChronicle(body);
    else if (tab === 'dossier') this._renderDossier(body);
    else if (tab === 'suspicion') this._renderSuspicion(body);
    else if (tab === 'host') this._renderHostPanel(body);
  }

  _renderPlayers(body) {
    const g = this.g;
    let html = '<div class="gh-section-title">👥 PLAYERS</div>';
    g.players.forEach(p => {
      const persona = g.charData[p.id]?.persona;
      const icon = persona?.icon || '❓';
      const name = persona?.name || p.name;
      const alive = p.alive;
      const roleStr = !alive ? ` — <span class="gh-role-tag">${p.role || 'unknown'}</span>` : '';
      const statusClass = alive ? 'gh-alive' : 'gh-dead';
      const executedLabel = (!alive && g.voteHistory.some(vh => vh.exId === p.id)) ? '<span class="gh-executed">EXECUTED</span>' : '';
      const killedLabel = (!alive && !executedLabel) ? '<span class="gh-killed">KILLED</span>' : '';
      // Alibi: show room assignment if available
      const roomId = g.playerLocations?.[p.id];
      const roomData = roomId ? g.manor?.getRoom(roomId) : null;
      const roomLabel = (roomData && alive) ? `<span class="gh-room-tag room-tooltip-trigger" title="${roomData.desc || ''} (Floor ${roomData.floor})">${roomData.icon} ${roomData.name}</span>` : '';
      // Accusation badge
      const accuseBadge = g.accusation?.isAccused?.(p.id) ? '<span class="gh-accuse-badge">🔴</span>' : '';
      // Trait viewer icon
      const traitBtn = g.charData[p.id]?.pub ? `<button class="gh-trait-btn" data-pid="${p.id}" title="View traits">🔍</button>` : '';
      // Report icon (only for other alive players)
      const reportBtn = (alive && p.id !== g.myId) ? `<button class="gh-report-btn" data-pid="${p.id}" title="Report this player">⚠</button>` : '';
      // "You" badge for own row
      const isMe = p.id === g.myId;
      const youBadge = isMe ? '<span class="gh-you-badge">YOU</span>' : '';
      const selfClass = isMe ? ' gh-player-self' : '';
      html += `<div class="gh-player-wrap"><div class="gh-player ${statusClass}${selfClass}"><span class="gh-player-icon">${icon}</span><span class="gh-player-name">${name}</span>${youBadge}${accuseBadge}${roomLabel}${executedLabel}${killedLabel}${roleStr}<span class="gh-player-actions">${traitBtn}${reportBtn}</span></div><div class="gh-trait-panel" id="ghTrait-${p.id}" style="display:none"></div></div>`;
    });
    body.innerHTML = html;

    // Wire trait viewer buttons
    body.querySelectorAll('.gh-trait-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pid = btn.dataset.pid;
        const panel = document.getElementById(`ghTrait-${pid}`);
        if (!panel) return;

        // Toggle panel
        if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }

        const pubData = g.charData[pid]?.pub;
        if (!pubData) { panel.innerHTML = '<div class="muted" style="padding:6px">No trait data available.</div>'; panel.style.display = 'block'; return; }

        // Build public traits
        const pubLabels = { hairStyle: '💇 Hair', hairColor: '🎨 Hair Color', outfit: '👔 Outfit', outfitColor: '🎨 Outfit Color', shoes: '👟 Shoes', accessory: '💍 Accessory' };
        let traitHtml = '<div class="gh-trait-section"><div class="gh-trait-section-title">👁 PUBLIC TRAITS</div>';
        Object.entries(pubLabels).forEach(([key, label]) => {
          const val = pubData[key];
          if (val) traitHtml += `<div class="gh-trait-row"><span class="gh-trait-label">${label}</span><span class="gh-trait-value">${val}</span></div>`;
        });
        traitHtml += '</div>';

        // Build hidden traits section
        const hiddenLabels = { perfume: '🌸 Scent', mark: '🔖 Mark', walkStyle: '🚶 Walk', voice: '🗣 Voice', habit: '🤏 Habit', secretItem: '🔒 Secret Item' };
        const isMe = pid === g.myId;
        const hiddenData = isMe ? g.charData[pid]?.hidden : null;
        const dossierTraits = g.dossier?.[pid] || [];

        traitHtml += '<div class="gh-trait-section"><div class="gh-trait-section-title">🔒 HIDDEN TRAITS</div>';
        if (isMe && hiddenData) {
          // Show own hidden traits
          Object.entries(hiddenLabels).forEach(([key, label]) => {
            const val = hiddenData[key];
            if (val) traitHtml += `<div class="gh-trait-row"><span class="gh-trait-label">${label}</span><span class="gh-trait-value">${val}</span></div>`;
          });
        } else if (dossierTraits.length > 0) {
          // Detective has discovered some traits
          dossierTraits.forEach(t => {
            traitHtml += `<div class="gh-trait-row"><span class="gh-trait-label">${t.label}</span><span class="gh-trait-value">${t.value}</span></div>`;
          });
          const remaining = Object.keys(hiddenLabels).length - dossierTraits.length;
          if (remaining > 0) traitHtml += `<div class="gh-trait-locked">🔒 ${remaining} more hidden trait${remaining > 1 ? 's' : ''} — requires investigation</div>`;
        } else {
          // No hidden traits visible
          traitHtml += '<div class="gh-trait-locked">🔒 Hidden traits require Detective investigation to reveal</div>';
        }
        traitHtml += '</div>';

        panel.innerHTML = traitHtml;
        panel.style.display = 'block';
      };
    });

    // Wire report buttons
    body.querySelectorAll('.gh-report-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pid = btn.dataset.pid;
        const reasons = ['AFK', 'Trolling', 'Harassment', 'Spam', 'Cheating'];
        const sel = prompt(`Report ${g._pname(pid)}\nReason:\n${reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nEnter number (1-5):`);
        if (sel && parseInt(sel) >= 1 && parseInt(sel) <= 5) {
          const reason = reasons[parseInt(sel) - 1];
          const result = g.moderation?.initiateKick?.(g.myId, pid, reason);
          if (result?.ok) {
            ui.addLog(`⚠ You reported ${g._pname(pid)} for ${reason}. Vote in progress.`, 'ls');
          } else {
            ui.addLog(`❌ ${result?.reason || 'Cannot report right now'}`, 'ls');
          }
        }
      };
    });
  }

  _renderEvidence(body, filter = 'all') {
    const g = this.g;
    let filtered = [...g.evidenceLedger];
    if (filter === 'verified') filtered = filtered.filter(e => e.status === 'verified');
    else if (filter === 'unverified') filtered = filtered.filter(e => e.status === 'unverified');
    else if (['trace','small','medium','large','perfect'].includes(filter)) filtered = filtered.filter(e => e.strength === filter);
    const byRound = {};
    filtered.forEach(e => { if (!byRound[e.round]) byRound[e.round] = []; byRound[e.round].push(e); });
    const totalVerified = g.evidenceLedger.filter(e => e.status === 'verified').length;
    const filters = [
      { key: 'all', label: '🗂 All' }, { key: 'verified', label: '✅ Verified' }, { key: 'unverified', label: '❓ Unverified' },
      { key: 'trace', label: '💨 Trace' }, { key: 'small', label: '🔹 Small' }, { key: 'medium', label: '🔸 Medium' },
      { key: 'large', label: '🔴 Strong' }, { key: 'perfect', label: '⭐ Perfect' },
    ];
    let html = '<div class="gh-section-title">🗂 EVIDENCE</div>';
    html += `<div class="eb-filters">${filters.map(f => `<button class="eb-filter-btn${filter === f.key ? ' eb-filter-active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}</div>`;
    html += `<div class="eb-stats"><span>🗂 ${g.evidenceLedger.length} total</span><span>✅ ${totalVerified} verified</span><span>❓ ${g.evidenceLedger.length - totalVerified} unverified</span></div>`;
    if (!filtered.length) {
      html += `<div class="muted" style="padding:20px;text-align:center">${filter === 'all' ? 'No evidence collected yet.' : `No ${filter} evidence found.`}</div>`;
    }
    Object.entries(byRound).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([round, evs]) => {
      const rv = evs.filter(e => e.status === 'verified').length;
      html += `<div class="eb-round"><div class="eb-round-header">Night ${round} <span class="eb-round-count">${evs.length} clue${evs.length > 1 ? 's' : ''}${rv ? `, ${rv} verified` : ''}</span></div>`;
      evs.forEach(e => {
        const statusIcon = e.status === 'verified' ? (e.accuracyPct >= 70 ? '🟢' : e.accuracyPct >= 30 ? '🟡' : '🔴') : '❓';
        const statusLabel = e.status === 'verified' ? `${e.accuracyPct}%` : 'Unverified';
        const sourceLabel = e.source === 'crime-scene' ? '🔍 Crime Scene' : e.source === 'forged' ? '🔨 Forged' : '🔎 Investigation';
        const strengthMap = { none: { label: 'No Evidence', color: '#555' }, trace: { label: 'Trace', color: '#888' }, small: { label: 'Small', color: '#42a5f5' }, medium: { label: 'Medium', color: '#f9a825' }, large: { label: 'Strong', color: '#e53935' }, perfect: { label: '★ Perfect', color: '#ffd700' } };
        const str = strengthMap[e.strength] || strengthMap.medium;
        const strengthBadge = e.strength ? `<span class="eb-strength" style="color:${str.color};border-color:${str.color}">${str.label}</span>` : '';
        const crossRef = g._hasEvidenceCrossRef(e) ? '<span class="eb-cross-ref">✨ MATCH</span>' : '';
        // Evidence decay age
        const age = (g.round || 1) - (e.round || 1);
        const decayClass = age <= 0 ? 'ev-fresh' : age === 1 ? 'ev-aging' : age === 2 ? 'ev-fading' : age === 3 ? 'ev-cold' : age <= 5 ? 'ev-degraded' : 'ev-expired';
        const decayLabel = age <= 0 ? '🔴 FRESH' : age === 1 ? '🟠 AGING' : age === 2 ? '🟡 FADING' : age === 3 ? '⚪ COLD' : age <= 5 ? '⬛ DEGRADED' : '💀 EXPIRED';
        const decayBadge = `<span class="eb-decay-badge" style="font-size:.55rem;opacity:.7;margin-left:4px">${decayLabel}</span>`;
        html += `<div class="eb-evidence ${decayClass}"><div class="eb-evidence-header">${statusIcon} <span class="eb-status">${statusLabel}</span>${strengthBadge}${decayBadge}${crossRef}<span class="eb-source">${sourceLabel}</span></div><div class="eb-text">${e.text}</div>${e.verdictText ? `<div class="eb-verdict">${e.verdictText}</div>` : ''}</div>`;
      });
      html += `</div>`;
    });
    body.innerHTML = html;
    body.querySelectorAll('.eb-filter-btn').forEach(btn => {
      btn.onclick = () => this._renderEvidence(body, btn.dataset.filter);
    });
  }

  _renderDossier(body) {
    const g = this.g;
    let html = '<div class="gh-section-title">🕵 DETECTIVE\'S DOSSIER</div>';
    html += `<div class="muted" style="font-size:.7rem;margin-bottom:8px">Hidden traits you've discovered. Only you can see this.</div>`;
    const entries = Object.entries(g.dossier);
    if (!entries.length) {
      html += `<div class="muted" style="padding:20px;text-align:center">No hidden traits discovered yet.<br><span style="font-size:.7rem">Use "🕵 Investigate Traits" during investigation phase. (${3 - g.traitInvestsUsed}/3 remaining)</span></div>`;
    }
    entries.forEach(([pid, traits]) => {
      const persona = g.charData[pid]?.persona;
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

  _renderSuspicion(body) {
    const g = this.g;
    let html = '<div class="gh-section-title">📊 SUSPICION & ACTIVITY</div>';
    if (Object.keys(g.suspicionVotes).length > 0) {
      html += '<div class="gh-sub-title">Suspicion Levels</div>';
      Object.entries(g.suspicionVotes).forEach(([tid, v]) => {
        const total = v.up + v.down;
        const pct = total ? Math.round((v.down / total) * 100) : 0;
        const name = g._pname(tid);
        const bar = `<div class="gh-sus-bar"><div class="gh-sus-fill" style="width:${pct}%"></div></div>`;
        html += `<div class="gh-sus-row"><span class="gh-sus-name">${name}</span>${bar}<span class="gh-sus-pct">${pct}%</span></div>`;
      });
    }
    const kSus = g.teamSuspicionCounters.killer || 0;
    const dSus = g.teamSuspicionCounters.detective || 0;
    if (kSus > 0 || dSus > 0) {
      html += '<div class="gh-sub-title">Private Activity Detected</div>';
      if (kSus >= 6) html += `<div class="gh-activity-alert">💭 ${kSus >= 20 ? 'A secret alliance is clearly operating!' : kSus >= 15 ? 'A group has been talking in private repeatedly...' : kSus >= 10 ? 'Hushed whispers can be heard from a corner...' : 'Some guests seem to be exchanging glances...'}</div>`;
      if (dSus >= 6) html += `<div class="gh-activity-alert">💭 ${dSus >= 20 ? 'Investigators are clearly coordinating!' : dSus >= 15 ? 'Multiple people have been sharing notes privately...' : dSus >= 10 ? 'Someone has been passing notes under the table...' : 'A few guests seem unusually well-informed...'}</div>`;
    }
    if (g.voteHistory.length > 0) {
      html += '<div class="gh-sub-title">Vote History</div>';
      g.voteHistory.forEach(vh => {
        const exPlayer = vh.exId ? g.players.find(p => p.id === vh.exId) : null;
        html += `<div class="gh-vote-round">Round ${vh.round}${exPlayer ? ` — ${g._pname(vh.exId)} executed` : ' — No execution'}</div>`;
      });
    }
    if (!Object.keys(g.suspicionVotes).length && !g.voteHistory.length && kSus < 6 && dSus < 6) {
      html += `<div class="muted" style="padding:20px;text-align:center">No suspicion data yet.</div>`;
    }
    // Social Deduction Heatmap
    if (g.voteHistory.length > 0) {
      html += '<div class="gh-sub-title">📊 Vote Heatmap</div>';
      const voters = g.players.filter(p => g.charData[p.id]);
      html += '<div class="heatmap-grid">';
      // Header row
      html += '<div class="heatmap-cell heatmap-corner"></div>';
      g.voteHistory.forEach(vh => { html += `<div class="heatmap-cell heatmap-header">R${vh.round}</div>`; });
      // Player rows
      voters.forEach(voter => {
        html += `<div class="heatmap-cell heatmap-row-label">${g._pname(voter.id)}</div>`;
        g.voteHistory.forEach(vh => {
          const vote = vh.votes?.[voter.id];
          let cls = 'heatmap-skip';
          let label = '—';
          if (vote && vote !== 'SKIP') {
            const target = g.players.find(p => p.id === vote);
            const wasKiller = target?.role === 'killer';
            cls = wasKiller ? 'heatmap-correct' : 'heatmap-wrong';
            label = g._pname(vote).split(' ').pop()?.slice(0, 3) || '?';
          }
          html += `<div class="heatmap-cell ${cls}" title="${vote === 'SKIP' ? 'Skipped' : vote ? g._pname(vote) : 'No vote'}">${label}</div>`;
        });
      });
      html += '</div>';
      html += '<div class="heatmap-legend"><span class="heatmap-legend-item"><span class="heatmap-dot heatmap-correct"></span>Voted Killer</span><span class="heatmap-legend-item"><span class="heatmap-dot heatmap-wrong"></span>Voted Innocent</span><span class="heatmap-legend-item"><span class="heatmap-dot heatmap-skip"></span>Skip/No Vote</span></div>';
    }
    body.innerHTML = html;
  }

  // ══════════════════════════════════════════════════════════
  // ACCUSE TAB — Accusation Board + File Accusation Flow
  // ══════════════════════════════════════════════════════════
  _renderAccuse(body) {
    const g = this.g;
    const charges = g.accusation?.getChargesRemaining?.(g.myId) ?? 2;
    const badge = g.accusation?.getBadge?.(g.myId);
    const badgeStr = badge === 'sharp' ? ' ⭐ Sharp Eye' : badge === 'false' ? ' ❌ False Accuser' : '';

    let html = '<div class="gh-section-title">⚖ ACCUSATION BOARD</div>';
    html += `<div class="accuse-charges">Charges remaining: <strong>${charges}/2</strong>${badgeStr}</div>`;

    // File new accusation button
    if (charges > 0) {
      html += `<button class="btn btn-sm btn-red accuse-file-btn" id="ghFileAccuse" style="margin:8px 0;width:100%">📋 File New Accusation</button>`;
    }

    // Existing accusations
    html += g.accusation?.renderBoard?.() || '<div class="muted" style="padding:12px;text-align:center">No accusations filed yet.</div>';

    body.innerHTML = html;

    // Wire file accusation button
    const fileBtn = document.getElementById('ghFileAccuse');
    if (fileBtn) {
      fileBtn.onclick = () => this._showFileAccusationForm(body);
    }

    // Wire endorse/dismiss buttons
    body.querySelectorAll('.accuse-btn').forEach(btn => {
      btn.onclick = () => {
        const accId = btn.dataset.acc;
        const isEndorse = btn.dataset.vote === 'endorse';
        g.accusation?.vote?.(accId, g.myId, isEndorse);
        this._renderAccuse(body); // Re-render
      };
    });
  }

  _showFileAccusationForm(body) {
    const g = this.g;
    const suspects = g.players.filter(p => p.alive && p.id !== g.myId);
    const evidence = g.evidenceLedger || [];

    let html = '<div class="gh-section-title">📋 FILE ACCUSATION</div>';
    html += '<div class="accuse-form">';

    // Suspect select
    html += '<label class="accuse-label">Select Suspect:</label>';
    html += '<select id="accuseSuspect" class="accuse-select">';
    suspects.forEach(p => {
      html += `<option value="${p.id}">${g._pname(p.id)}</option>`;
    });
    html += '</select>';

    // Evidence checkboxes (pick 1-2)
    html += '<label class="accuse-label">Link Evidence (1-2 pieces):</label>';
    html += '<div class="accuse-ev-list" style="max-height:120px;overflow-y:auto">';
    evidence.forEach((e, i) => {
      html += `<label class="accuse-ev-item"><input type="checkbox" class="accuse-ev-check" data-eid="${e.id || i}" /> ${e.text.slice(0, 50)}${e.text.length > 50 ? '...' : ''}</label>`;
    });
    html += '</div>';

    // Statement
    html += '<label class="accuse-label">Statement (optional, max 100 chars):</label>';
    html += '<input type="text" id="accuseStatement" class="accuse-input" maxlength="100" placeholder="I believe they are the killer because..." />';

    // Buttons
    html += '<div style="display:flex;gap:8px;margin-top:8px">';
    html += '<button class="btn btn-sm btn-red" id="accuseSubmit" style="flex:1">⚖ Submit Accusation</button>';
    html += '<button class="btn btn-sm btn-out" id="accuseCancel" style="flex:1">Cancel</button>';
    html += '</div></div>';

    body.innerHTML = html;

    document.getElementById('accuseCancel').onclick = () => this._renderAccuse(body);
    document.getElementById('accuseSubmit').onclick = () => {
      const suspectId = document.getElementById('accuseSuspect').value;
      const checked = [...body.querySelectorAll('.accuse-ev-check:checked')].map(c => c.dataset.eid);
      const statement = document.getElementById('accuseStatement')?.value || '';

      if (checked.length < 1) { ui.addLog('❌ Must link at least 1 piece of evidence', 'ls'); return; }
      if (checked.length > 2) { ui.addLog('❌ Maximum 2 evidence pieces', 'ls'); return; }

      const result = g.accusation?.fileAccusation?.(g.myId, suspectId, checked, statement);
      if (result?.success) {
        ui.addLog(`⚖ You accused ${g._pname(suspectId)}!`, 'ls');
        this._renderAccuse(body);
      } else {
        ui.addLog(`❌ ${result?.errors?.join(', ') || 'Failed to file accusation'}`, 'ls');
      }
    };
  }

  // ══════════════════════════════════════════════════════════
  // CHRONICLE TAB — Decaying Match Log
  // ══════════════════════════════════════════════════════════
  _renderChronicle(body) {
    const g = this.g;
    body.innerHTML = g.chronicle?.renderChronicle?.() || '<div class="muted" style="padding:20px;text-align:center">📜 No events recorded yet.</div>';
  }

  // ══════════════════════════════════════════════════════════
  // HOST PANEL TAB — Host-only controls
  // ══════════════════════════════════════════════════════════
  _renderHostPanel(body) {
    const g = this.g;
    if (!g.isHost) { body.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Host only.</div>'; return; }

    body.innerHTML = g.moderation?.renderHostPanel?.() || '<div class="muted">Host panel unavailable.</div>';

    // Wire host action buttons
    body.querySelectorAll('.host-action').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        const targetId = document.getElementById('hostTargetSelect')?.value;
        switch (action) {
          case 'pause': {
            const r = g.moderation?.pause?.();
            if (r?.ok) ui.addLog('⏸ Game paused for 60s', 'ls');
            else ui.addLog(`❌ ${r?.reason}`, 'ls');
            break;
          }
          case 'skip': {
            const r = g.moderation?.canEmergencySkip?.();
            if (r?.ok) ui.addLog('⏭ Emergency skip requested', 'ls');
            else ui.addLog(`❌ ${r?.reason}`, 'ls');
            break;
          }
          case 'kick': {
            if (!targetId) return;
            const r = g.moderation?.initiateKick?.(g.myId, targetId, 'Host decision');
            if (r?.ok) ui.addLog(`👢 Kick vote started for ${g._pname(targetId)}`, 'ls');
            else ui.addLog(`❌ ${r?.reason}`, 'ls');
            break;
          }
          case 'ban': {
            if (!targetId) return;
            const r = g.moderation?.ban?.(targetId);
            if (r?.ok) ui.addLog(`🚫 ${g._pname(targetId)} has been banned`, 'ls');
            else ui.addLog(`❌ ${r?.reason}`, 'ls');
            break;
          }
          case 'transfer': {
            if (!targetId) return;
            if (confirm(`Transfer host to ${g._pname(targetId)}? This is irreversible!`)) {
              const r = g.moderation?.transferHost?.(targetId);
              if (r?.ok) {
                g.hostId = r.newHost;
                ui.addLog(`👑 Host transferred to ${g._pname(targetId)}`, 'ls');
              }
            }
            break;
          }
        }
        this._renderHostPanel(body); // Re-render
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  // NIGHT EVENT BANNER
  // ══════════════════════════════════════════════════════════
  showNightEvent(event) {
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
  // SUSPICION ESCALATION MESSAGES
  // ══════════════════════════════════════════════════════════
  checkSuspicionEscalation(team) {
    const g = this.g;
    const count = g.teamSuspicionCounters[team] || 0;
    const msgs = {
      6: '💭 Some guests seem to be exchanging glances...',
      10: '💭 Hushed whispers can be heard from a corner of the room...',
      15: '💭 A group of people have been seen talking in private repeatedly...',
      20: '⚠ There is clearly a secret alliance forming among certain guests!',
    };
    if (msgs[count]) {
      g.net.relay({ t: 'SUSPICION_MSG', text: msgs[count] });
      chat.addMessage('', msgs[count], 'system');
      ui.addLog(msgs[count], 'ls');
    }
  }
}
