// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — UI Module
// ═══════════════════════════════════════════════════════════════

import { AVATARS, getRoleInfo } from './roles.js';

// ── Utilities ────────────────────────────────────────────────
export function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

let toastTimer = null;
export function toast(msg, err = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ── Connection Status ────────────────────────────────────────
export function updateConnStatus(status) {
  const dot = document.querySelector('#connStatus .dot');
  const text = document.getElementById('connText');
  if (!dot || !text) return;
  dot.className = 'dot ' + ({ connected: 'dok', connecting: 'dwt', disconnected: 'derr' }[status] || 'derr');
  text.textContent = status.toUpperCase();
}

// ── Sound Toggle ─────────────────────────────────────────────
export function updateSoundToggle(muted) {
  const btn = document.getElementById('soundToggle');
  if (btn) btn.textContent = muted ? '🔇' : '🔊';
}

// ── Avatar Grid ──────────────────────────────────────────────
export function renderAvatarGrid(selectedAvatar, onSelect) {
  const grid = document.getElementById('avatarGrid');
  if (!grid) return;
  grid.innerHTML = AVATARS.map((a, i) =>
    `<div class="avatar-option${a === selectedAvatar ? ' selected' : ''}" data-idx="${i}" role="button" tabindex="0" aria-label="Select avatar ${a}">${a}</div>`
  ).join('');
  grid.onclick = (e) => {
    const opt = e.target.closest('.avatar-option');
    if (opt) {
      const idx = parseInt(opt.dataset.idx);
      onSelect(AVATARS[idx]);
    }
  };
}

// ── Lobby ────────────────────────────────────────────────────
export function renderLobby(players, myId, isHost, onKick) {
  const ul = document.getElementById('lList');
  if (!ul) return;
  ul.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'pitem' + (p.disconnected ? ' pdisconnected' : '');
    let badges = '';
    if (i === 0 || p.isHost) badges += '<span class="badge bh">HOST</span>';
    if (p.id === myId) badges += '<span class="badge by">YOU</span>';
    let kickBtn = '';
    if (isHost && p.id !== myId) {
      kickBtn = `<button class="btn-danger" data-kick="${p.id}" aria-label="Kick ${esc(p.name)}" style="font-family:var(--font-mono)">✕</button>`;
    }
    li.innerHTML = `<div class="pav">${p.avatar || '👤'}</div><div class="pnm">${esc(p.name)}${p.disconnected ? ' <span class="muted" style="font-size:.7rem">(disconnected)</span>' : ''}</div>${badges}${kickBtn}`;
    ul.appendChild(li);
  });

  // Kick handler
  if (isHost && onKick) {
    ul.querySelectorAll('[data-kick]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        onKick(btn.dataset.kick);
      };
    });
  }

  document.getElementById('pcnt').textContent = players.length;
  const sb = document.getElementById('startBtn');
  if (sb) sb.disabled = players.length < 4;
  const lMsg = document.getElementById('lMsg');
  if (lMsg) lMsg.textContent = players.length < 4 ? `Need ${4 - players.length} more` : 'Ready!';

  // Show settings button for host only
  const settingsBtn = document.getElementById('btnSettings');
  if (settingsBtn) settingsBtn.style.display = isHost ? 'inline-flex' : 'none';

  // Toggle host/guest controls
  document.getElementById('hCtrl').style.display = isHost ? 'block' : 'none';
  document.getElementById('gCtrl').style.display = isHost ? 'none' : 'block';
}

// ── Role Reveal ──────────────────────────────────────────────
export function renderRole(roleKey, allyList = [], persona = null) {
  const info = getRoleInfo(roleKey);
  let extra = '';
  if (roleKey === 'killer' && allyList.length > 0) {
    extra = `<div style="color:var(--blood-bright);font-size:.85rem;margin-top:8px">Fellow killers: ${allyList.map(n => esc(n)).join(', ')}</div>`;
  }
  let personaHtml = '';
  if (persona) {
    personaHtml = `<div class="persona-badge" style="margin:0 auto 14px;justify-content:center"><span class="persona-icon">${persona.icon}</span><span>Your identity this game: <span class="persona-name">${esc(persona.name)}</span></span></div>`;
  }
  const nightAction = roleKey === 'killer'
    ? '<div class="muted tc mt8" style="font-size:.8rem">🗡 At night: select a victim, then complete a QTE to attack. Sloppy kills leave clues!</div>'
    : roleKey === 'doctor'
    ? '<div class="muted tc mt8" style="font-size:.8rem">🩺 At night: protect a player, then investigate a suspect via QTE.</div>'
    : '<div class="muted tc mt8" style="font-size:.8rem">🔎 At night: investigate a suspect via QTE. Better accuracy = better clues!</div>';

  document.getElementById('rContent').innerHTML =
    personaHtml +
    `<span class="role-icon">${info.icon}</span>` +
    `<div class="role-nm" style="color:${info.color}">${info.name}</div>` +
    `<p class="role-desc">${info.desc}</p>${extra}${nightAction}`;
  document.getElementById('readyBtn').disabled = false;
  document.getElementById('readyBtn').textContent = 'I Am Ready';
}

// ── Role Reminder ────────────────────────────────────────────
export function showRoleReminder(roleKey) {
  const info = getRoleInfo(roleKey);
  const el = document.getElementById('roleReminder');
  const icon = document.getElementById('roleReminderIcon');
  const text = document.getElementById('roleReminderText');
  if (!el || !icon || !text) return;
  icon.textContent = info.icon;
  text.textContent = info.name;
  el.style.borderColor = info.color;
  el.classList.remove('hidden');
}

export function hideRoleReminder() {
  const el = document.getElementById('roleReminder');
  if (el) el.classList.add('hidden');
}

// ── Day Screen ───────────────────────────────────────────────
export function renderDayHeader(round, alive, total) {
  const chips = document.getElementById('dChips');
  if (chips) chips.innerHTML = `<span class="chip cr">Round ${round}</span><span class="chip ca">Alive: ${alive}</span><span class="chip cd">Dead: ${total - alive}</span>`;
}

export function showDeathAnnounce(name) {
  const el = document.getElementById('dAnnounce');
  const nameEl = document.getElementById('dName');
  if (el && nameEl) { nameEl.textContent = name; el.style.display = 'block'; }
  makeSplat();
  screenShake();
}

export function hideDeathAnnounce() {
  const el = document.getElementById('dAnnounce');
  if (el) el.style.display = 'none';
}

export function showDoctorSave(name) {
  const el = document.getElementById('dSaved');
  const nameEl = document.getElementById('dSavedName');
  if (el && nameEl) { nameEl.textContent = name; el.style.display = 'block'; }
}

export function hideDoctorSave() {
  const el = document.getElementById('dSaved');
  if (el) el.style.display = 'none';
}

export function showClue(clueHtml) {
  const cb = document.getElementById('cBox');
  const ct = document.getElementById('cText');
  if (cb && ct) { ct.innerHTML = clueHtml; cb.style.display = 'block'; }
}

export function hideClue() {
  const cb = document.getElementById('cBox');
  if (cb) cb.style.display = 'none';
}

// ── Vote Rendering ───────────────────────────────────────────
export function renderVotes(players, myId, votes, selectedId, voted, isDead, hideVotes = true) {
  const c = document.getElementById('vList');
  if (!c) return;
  c.innerHTML = '';
  players.filter(p => p.alive && p.id !== myId).forEach(p => {
    const vc = Object.values(votes).filter(v => v === p.id).length;
    const b = document.createElement('button');
    b.className = 'bplayer' + (selectedId === p.id ? ' sel' : '');
    b.id = 'vb' + p.id;
    b.disabled = isDead || voted;
    const voteTxt = (!hideVotes && vc > 0) ? `🗳 ${vc}` : '';
    b.innerHTML = `<span>${p.avatar || '👤'} ${esc(p.name)}</span><span style="color:var(--pale-dim);font-size:.85rem">${voteTxt}</span>`;
    b.dataset.pid = p.id;
    c.appendChild(b);
  });
  return c;
}

// ── Verdict ──────────────────────────────────────────────────
export function renderVerdict(executedPlayer, isJester = false) {
  const vc = document.getElementById('vContent');
  if (!vc) return;
  if (!executedPlayer) {
    vc.innerHTML = `<div class="muted tc" style="font-family:var(--font-display)">No consensus — no execution this round.</div>`;
    return;
  }

  if (isJester) {
    vc.innerHTML =
      `<div class="tc" style="margin-bottom:14px">` +
      `<div style="font-size:3rem;margin-bottom:10px">${executedPlayer.avatar || '👤'}</div>` +
      `<div style="font-family:var(--font-display);font-size:1.2rem">${esc(executedPlayer.name)} was executed</div>` +
      `<div style="margin-top:8px;color:#ff9800">🤡 THEY WERE THE JESTER — They win!</div></div>`;
  } else {
    const isk = executedPlayer.role === 'killer';
    vc.innerHTML =
      `<div class="tc" style="margin-bottom:14px">` +
      `<div style="font-size:3rem;margin-bottom:10px">${executedPlayer.avatar || '👤'}</div>` +
      `<div style="font-family:var(--font-display);font-size:1.2rem">${esc(executedPlayer.name)} was executed</div>` +
      `<div style="margin-top:8px;color:${isk ? 'var(--blood-bright)' : '#81c784'}">` +
      `${isk ? '☠ A KILLER' : '😇 INNOCENT'}</div></div>`;
  }
}

export function renderVoteBars(tally, players) {
  const bb = document.getElementById('vBars');
  if (!bb) return;
  bb.innerHTML = '<label class="lbl mb8">Vote Breakdown</label>';
  const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
  Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([id, cnt]) => {
    const p = players.find(x => x.id === id);
    if (!p) return;
    const pct = Math.round(cnt / total * 100);
    bb.innerHTML += `<div class="vbw"><div class="vbr"><span>${p.avatar || '👤'} ${esc(p.name)}</span><span>${cnt} vote${cnt !== 1 ? 's' : ''}</span></div><div class="vbt"><div class="vbf" style="width:${pct}%"></div></div></div>`;
  });
}

// ── Game Over ────────────────────────────────────────────────
export function renderGameOver(winner, players, jesterWinner = null) {
  const kw = winner === 'killers';
  let bannerHtml = `<div class="win-txt ${kw ? 'wk' : 'wc'}">${kw ? '🗡 THE KILLERS WIN' : '⚖ JUSTICE PREVAILS'}</div>` +
    `<div class="tagline">${kw ? 'The town has fallen into darkness' : 'The killer has been brought to justice'}</div>`;

  if (jesterWinner) {
    bannerHtml += `<div class="tagline" style="color:#ff9800;margin-top:8px">🤡 ${esc(jesterWinner)} also wins as the Jester!</div>`;
  }

  document.getElementById('oBanner').innerHTML = bannerHtml;

  document.getElementById('fReveal').innerHTML = players.map(p => {
    const info = getRoleInfo(p.role);
    return `<div class="pitem" style="padding:11px 8px;border-bottom:1px solid rgba(255,255,255,.05)">` +
      `<div class="pav">${p.avatar || '👤'}</div>` +
      `<div class="pnm" style="${!p.alive ? 'text-decoration:line-through;opacity:.45' : ''}">${esc(p.name)}</div>` +
      `<span class="badge" style="background:${info.color === '#81c784' ? 'rgba(76,175,80,.12)' : info.color === 'var(--blood-bright)' ? 'rgba(139,0,0,.2)' : info.color === 'var(--det-bright)' ? 'rgba(26,107,138,.2)' : 'rgba(200,150,50,.12)'};color:${info.color};border:1px solid ${info.color === '#81c784' ? 'rgba(76,175,80,.4)' : 'currentColor'}">${info.name}</span></div>`;
  }).join('');

  spawnParticles(kw ? '🗡' : '⚖');
}

// ── Night Overlay ────────────────────────────────────────────
export function renderNightKillerUI(alivePlayers) {
  const area = document.getElementById('nAct');
  if (!area) return;
  area.innerHTML =
    `<div style="color:var(--blood-bright);font-family:var(--font-display);font-size:1rem;margin-bottom:14px">Choose Your Victim</div>` +
    `<div id="kList"></div>` +
    `<div id="kCfm" class="muted tc" style="display:none;margin-top:10px;font-size:.85rem">☠ Target locked — await dawn</div>`;
  const kl = document.getElementById('kList');
  alivePlayers.forEach(p => {
    const b = document.createElement('button');
    b.className = 'bplayer';
    b.innerHTML = `<span>${p.avatar || '👤'} ${esc(p.name)}</span>`;
    b.dataset.pid = p.id;
    kl.appendChild(b);
  });
  return kl;
}

export function renderNightDetectiveUI(alivePlayers, timerSec) {
  const area = document.getElementById('nAct');
  if (!area) return;
  area.innerHTML =
    `<div style="color:var(--det-bright);font-family:var(--font-display);font-size:1rem;margin-bottom:4px">🔍 Investigate a Suspect</div>` +
    `<div class="timer" id="dtmr" style="font-size:1.4rem">${timerSec}</div>` +
    `<div id="dList"></div>` +
    `<div id="dRes" style="display:none" class="cluebox"></div>`;
  const dl = document.getElementById('dList');
  alivePlayers.forEach(p => {
    const b = document.createElement('button');
    b.className = 'bdet';
    b.innerHTML = `<span>${p.avatar || '👤'} ${esc(p.name)}</span>`;
    b.dataset.pid = p.id;
    dl.appendChild(b);
  });
  return dl;
}

export function renderNightDoctorUI(alivePlayers, cantProtectSelf) {
  const area = document.getElementById('nAct');
  if (!area) return;
  area.innerHTML =
    `<div style="color:#81c784;font-family:var(--font-display);font-size:1rem;margin-bottom:14px">🩺 Protect a Player</div>` +
    `<div id="docList"></div>` +
    `<div id="docCfm" class="muted tc" style="display:none;margin-top:10px;font-size:.85rem;color:#81c784">🩺 Protection applied — await dawn</div>`;
  const dl = document.getElementById('docList');
  alivePlayers.forEach(p => {
    const b = document.createElement('button');
    b.className = 'bdet';
    b.style.borderColor = 'rgba(76,175,80,.3)';
    b.style.background = 'rgba(76,175,80,.05)';
    b.innerHTML = `<span>${p.avatar || '👤'} ${esc(p.name)}${cantProtectSelf && p.isSelf ? ' <span class="muted" style="font-size:.7rem">(blocked)</span>' : ''}</span>`;
    b.dataset.pid = p.id;
    if (cantProtectSelf && p.isSelf) b.disabled = true;
    dl.appendChild(b);
  });
  return dl;
}

export function renderNightCivilianUI() {
  const area = document.getElementById('nAct');
  if (!area) return;
  area.innerHTML =
    `<div class="muted tc" style="font-size:1.05rem;line-height:1.8">The night is long and full of terror.<br>` +
    `<span style="color:rgba(255,255,255,.2);font-size:.85rem">Wait for the dawn...</span></div>` +
    `<div style="font-size:3rem;text-align:center;margin-top:20px;animation:pu 2.5s infinite">😴</div>`;
}

// ── Timer ────────────────────────────────────────────────────
export function updateTimer(elementId, seconds) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = seconds;
    el.classList.toggle('urg', seconds <= 10);
  }
}

// ── Log ──────────────────────────────────────────────────────
export function addLog(txt, cls = 'ls') {
  const log = document.getElementById('dLog');
  if (!log) return;
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = txt;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

export function clearLog() {
  const log = document.getElementById('dLog');
  if (log) log.innerHTML = '';
}

// ── Effects ──────────────────────────────────────────────────
export function makeSplat() {
  const el = document.createElement('div');
  el.className = 'splat';
  el.style.left = (25 + Math.random() * 50) + 'vw';
  el.style.top = (20 + Math.random() * 40) + 'vh';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

export function screenShake() {
  document.body.classList.add('screen-shake');
  setTimeout(() => document.body.classList.remove('screen-shake'), 500);
}

export function spawnParticles(emoji = '⚖', count = 20) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = emoji;
    p.style.left = Math.random() * 100 + 'vw';
    p.style.bottom = '-20px';
    p.style.animationDuration = (3 + Math.random() * 4) + 's';
    p.style.animationDelay = (Math.random() * 2) + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 8000);
  }
}

// ── Game Stats ───────────────────────────────────────────────
export function renderStats(stats) {
  const bar = document.getElementById('statsBar');
  if (!bar || !stats) return;
  bar.innerHTML = `<div class="stat-item">Games: <span class="stat-value">${stats.games || 0}</span></div>` +
    `<div class="stat-item">Wins: <span class="stat-value">${stats.wins || 0}</span></div>`;
}
