// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Main Entry Point
// Wires together: Network, Game, UI, Audio, Canvas, Chat
// ═══════════════════════════════════════════════════════════════

import Network from './network.js';
import Game from './game.js';
import audio from './audio.js';
import chat from './chat.js';
import { initCanvas } from './canvas.js';
import { AVATARS } from './roles.js';
import * as ui from './ui.js';

// ── Initialize ───────────────────────────────────────────────
const net = new Network();
const canvasCtrl = initCanvas();
const game = new Game(net, canvasCtrl);

let selectedAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

// ── Connect to Server ────────────────────────────────────────
net.on('status', (status) => {
  ui.updateConnStatus(status);
});
net.connect();

// ── Init Audio on First Click ────────────────────────────────
document.addEventListener('click', () => {
  audio.init();
  audio.resume();
}, { once: true });

// ── Sound Toggle ─────────────────────────────────────────────
ui.updateSoundToggle(audio.isMuted());
document.getElementById('soundToggle').addEventListener('click', () => {
  const muted = audio.toggleMute();
  ui.updateSoundToggle(muted);
  // G14: Update equalizer bar state
  const eq = document.querySelector('.audio-eq');
  if (eq) eq.classList.toggle('paused', muted);
});
// G14: Audio equalizer bars
(function addEqualizer() {
  const toggle = document.getElementById('soundToggle');
  if (!toggle) return;
  const eq = document.createElement('span');
  eq.className = 'audio-eq' + (audio.isMuted() ? ' paused' : '');
  for (let i = 0; i < 5; i++) { const b = document.createElement('span'); b.className = 'audio-eq-bar'; eq.appendChild(b); }
  toggle.appendChild(eq);
})();

// ── Avatar Selection ─────────────────────────────────────────
function onAvatarSelect(avatar) {
  selectedAvatar = avatar;
  ui.renderAvatarGrid(selectedAvatar, onAvatarSelect);
}
ui.renderAvatarGrid(selectedAvatar, onAvatarSelect);

// ── App Settings Modal ───────────────────────────────────────
document.getElementById('btnAppSettings').addEventListener('click', () => {
  document.getElementById('appSettingsModal').classList.add('open');
  syncBodyLock();
});
document.getElementById('appSettingsClose').addEventListener('click', () => {
  document.getElementById('appSettingsModal').classList.remove('open');
  syncBodyLock();
});
// Tab switching (future-proof for more tabs)
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

// ── Game Stats ───────────────────────────────────────────────
ui.renderStats(game.getStats());

// ── Landing Buttons ──────────────────────────────────────────
document.getElementById('btnCreate').addEventListener('click', () => {
  const raw = document.getElementById('iName').value.trim();
  const name = raw.replace(/<[^>]*>/g, '').slice(0, 20);
  if (!name) { ui.toast('Enter your name first', true); return; }
  if (name.length < 1 || name.length > 20) { ui.toast('Name must be 1-20 characters', true); return; }
  if (net.status !== 'connected') { ui.toast('Not connected to server', true); return; }
  game.createLobby(name, selectedAvatar);
});

document.getElementById('btnJoin').addEventListener('click', () => {
  const raw = document.getElementById('iName').value.trim();
  const name = raw.replace(/<[^>]*>/g, '').slice(0, 20);
  const code = document.getElementById('iCode').value.trim().toUpperCase();
  if (!name) { ui.toast('Enter your name first', true); return; }
  if (name.length < 1 || name.length > 20) { ui.toast('Name must be 1-20 characters', true); return; }
  if (!code || code.length < 4) { ui.toast('Enter a valid lobby code', true); return; }
  if (net.status !== 'connected') { ui.toast('Not connected to server', true); return; }
  game.joinLobby(name, selectedAvatar, code);
});

// ── Lobby Buttons ────────────────────────────────────────────
document.getElementById('btnCopy').addEventListener('click', () => {
  const code = document.getElementById('lCode').textContent;
  navigator.clipboard?.writeText(code).then(() => ui.toast('Copied!')).catch(() => ui.toast(code));
});

document.getElementById('lCode').addEventListener('click', () => {
  const code = document.getElementById('lCode').textContent;
  navigator.clipboard?.writeText(code).then(() => ui.toast('Copied!')).catch(() => ui.toast(code));
});

document.getElementById('startBtn').addEventListener('click', () => {
  game.hostStart();
});

// ── Role Screen ──────────────────────────────────────────────
document.getElementById('readyBtn').addEventListener('click', () => {
  game.pressReady();
});

// ── Day Screen — Vote ────────────────────────────────────────
document.getElementById('cvBtn').addEventListener('click', () => {
  game.confirmVote();
});
document.getElementById('skipVoteBtn').addEventListener('click', () => {
  game.skipVote();
});

// ── Day Screen — Chat ────────────────────────────────────────
function sendChatMsg() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  game.sendChat(input.value);
  input.value = '';
  input.focus();
}

document.getElementById('btnChat').addEventListener('click', sendChatMsg);
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMsg();
});

// ── Last Words ───────────────────────────────────────────────
function sendLastWords() {
  const input = document.getElementById('lastWordsInput');
  if (!input) return;
  game.sendLastWords(input.value);
  input.value = '';
}

document.getElementById('btnLastWords').addEventListener('click', sendLastWords);
document.getElementById('lastWordsInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendLastWords();
});

// ── Game Over — Play Again ───────────────────────────────────
document.getElementById('btnPlayAgain').addEventListener('click', () => {
  game.backToLobby();
});

// ── Bot Controls ─────────────────────────────────────────────
document.getElementById('addBotBtn').addEventListener('click', () => game.addBot());
document.getElementById('rmBotBtn').addEventListener('click', () => game.removeBot());

// ── Settings Modal ───────────────────────────────────────────
document.getElementById('btnSettings').addEventListener('click', () => {
  // Populate current settings
  document.getElementById('setDayTime').value = game.settings.dayTime;
  document.getElementById('setNightTime').value = game.settings.nightTime;
  document.getElementById('setInvestTime').value = game.settings.investTime || 40;
  document.getElementById('setDoctor').checked = game.settings.doctor;
  document.getElementById('setJester').checked = game.settings.jester;
  document.getElementById('setHideVotes').checked = game.settings.hideVotes;
  // Optional features
  document.getElementById('setWhispers').checked = game.settings.whispers !== false;
  document.getElementById('setGhostClues').checked = game.settings.ghostClues !== false;
  document.getElementById('setNightEvents').checked = game.settings.nightEvents !== false;
  document.getElementById('setSuspicion').checked = game.settings.suspicion !== false;
  document.getElementById('settingsModal').classList.add('open');
});

document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('open');
});

document.getElementById('settingsSave').addEventListener('click', () => {
  game.updateSettings({
    dayTime: parseInt(document.getElementById('setDayTime').value),
    nightTime: parseInt(document.getElementById('setNightTime').value),
    investTime: parseInt(document.getElementById('setInvestTime').value),
    doctor: document.getElementById('setDoctor').checked,
    jester: document.getElementById('setJester').checked,
    hideVotes: document.getElementById('setHideVotes').checked,
    whispers: document.getElementById('setWhispers').checked,
    ghostClues: document.getElementById('setGhostClues').checked,
    nightEvents: document.getElementById('setNightEvents').checked,
    suspicion: document.getElementById('setSuspicion').checked,
  });
  document.getElementById('settingsModal').classList.remove('open');
  ui.toast('Settings saved');
});


// ── Rules Modal ──────────────────────────────────────────────
document.getElementById('btnRules').addEventListener('click', () => {
  document.getElementById('rulesModal').classList.add('open');
});

document.getElementById('rulesClose').addEventListener('click', () => {
  document.getElementById('rulesModal').classList.remove('open');
});

document.getElementById('rulesOk').addEventListener('click', () => {
  document.getElementById('rulesModal').classList.remove('open');
});

// ── Town Board Modal (guarded — A4 fix) ─────────────────────
document.getElementById('btnTownBoard')?.addEventListener('click', () => {
  const boardData = game.getTownBoardData();
  ui.renderTownBoard(boardData);
  document.getElementById('townBoardModal')?.classList.add('open');
});

document.getElementById('townBoardClose')?.addEventListener('click', () => {
  document.getElementById('townBoardModal')?.classList.remove('open');
});

document.getElementById('townBoardOk')?.addEventListener('click', () => {
  document.getElementById('townBoardModal')?.classList.remove('open');
});

// ── Evidence Window (guarded — A4 fix) ──────────────────────
document.getElementById('btnEvidenceWindow')?.addEventListener('click', () => {
  game.renderEvidenceWindow();
  document.getElementById('evidenceWindowModal')?.classList.add('open');
});

document.getElementById('evidenceWindowClose')?.addEventListener('click', () => {
  document.getElementById('evidenceWindowModal')?.classList.remove('open');
});

document.getElementById('evidenceWindowOk')?.addEventListener('click', () => {
  document.getElementById('evidenceWindowModal')?.classList.remove('open');
});

// ── Modal Body Scroll Lock ───────────────────────────────────
function syncBodyLock() {
  const anyOpen = document.querySelector('.modal-overlay.open');
  document.body.classList.toggle('modal-open', !!anyOpen);
}

// Watch all modal overlays for open/close
const observer = new MutationObserver(syncBodyLock);
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
      syncBodyLock();
    }
  });
});

// ── Keyboard Shortcuts ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (document.getElementById('s-land')?.classList.contains('active')) {
      const c = document.getElementById('iCode').value.trim();
      c ? document.getElementById('btnJoin').click() : document.getElementById('btnCreate').click();
    }
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    syncBodyLock();
  }
});

// ── Lobby Progress Bar Updater ───────────────────────────────
function updateLobbyProgress() {
  const bar = document.getElementById('lobbyProgressBar');
  const text = document.getElementById('lobbyProgressText');
  if (!bar || !text) return;
  const count = game.players.length;
  const min = 4;
  if (count < min) {
    bar.style.width = Math.round((count / min) * 100) + '%';
    text.textContent = `Need ${min - count} more player${min - count > 1 ? 's' : ''} to start`;
    bar.classList.remove('lobby-progress-ready');
  } else {
    bar.style.width = '100%';
    text.textContent = `${count}/${count} players — Ready to start!`;
    bar.classList.add('lobby-progress-ready');
  }
}
// Hook into lobby render cycle
const origRenderLobby = game._renderLobby.bind(game);
game._renderLobby = function () { origRenderLobby(); updateLobbyProgress(); };

// ── PWA Install Prompt ───────────────────────────────────────
let deferredPrompt = null;
if (!localStorage.getItem('nf_pwa_dismissed')) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.createElement('div');
    banner.className = 'pwa-banner';
    banner.innerHTML = `<span>📲 Install NightFall as an app for the best experience</span>
      <div class="pwa-banner-actions">
        <button class="btn btn-sm btn-gold" id="pwaBtnInstall">Install</button>
        <button class="btn btn-sm btn-out" id="pwaBtnDismiss">Later</button>
      </div>`;
    document.body.appendChild(banner);
    document.getElementById('pwaBtnInstall').onclick = () => {
      deferredPrompt?.prompt();
      deferredPrompt?.userChoice?.then(() => { banner.remove(); deferredPrompt = null; });
    };
    document.getElementById('pwaBtnDismiss').onclick = () => {
      banner.remove();
      localStorage.setItem('nf_pwa_dismissed', '1');
    };
  });
}
