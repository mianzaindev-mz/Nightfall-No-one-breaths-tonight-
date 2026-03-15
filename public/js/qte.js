// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — QTE (Quick Time Event) Engine
// Used for: Killer kill attempts & Player investigations
// ═══════════════════════════════════════════════════════════════

import audio from './audio.js';

// ── Game Personas ────────────────────────────────────────────
// Each game gives every player a unique themed identity.
// Clues reference these personas, not real names.
const PERSONA_POOL = [
  { name: 'The Rose',        icon: '🌹', trait: 'a faint scent of roses',         item: 'a torn petal' },
  { name: 'The Raven',       icon: '🐦‍⬛', trait: 'the sound of beating wings',     item: 'a black feather' },
  { name: 'The Clockmaker',  icon: '⏱',  trait: 'the faint ticking of a clock',   item: 'a broken gear' },
  { name: 'The Alchemist',   icon: '⚗',  trait: 'a bitter chemical smell',        item: 'a vial of strange liquid' },
  { name: 'The Lantern',     icon: '🏮', trait: 'a fading warm glow',             item: 'a smear of candle wax' },
  { name: 'The Phantom',     icon: '👻', trait: 'a sudden chill in the air',      item: 'a wisp of cold mist' },
  { name: 'The Serpent',     icon: '🐍', trait: 'a soft hissing sound',           item: 'a shed scale' },
  { name: 'The Moth',        icon: '🦋', trait: 'a flutter of dusty wings',       item: 'traces of wing dust' },
  { name: 'The Bell',        icon: '🔔', trait: 'a distant ringing',              item: 'a cracked bell fragment' },
  { name: 'The Thorn',       icon: '🌿', trait: 'scratches on the doorframe',     item: 'a sharp thorn' },
  { name: 'The Mirror',      icon: '🪞', trait: 'a glint of reflected light',     item: 'a shard of glass' },
  { name: 'The Ink',         icon: '🖋',  trait: 'dark smudges on the wall',       item: 'an ink-stained cloth' },
  { name: 'The Ember',       icon: '🔥', trait: 'the smell of smoke',             item: 'a still-warm ember' },
  { name: 'The Mask',        icon: '🎭', trait: 'an eerie painted smile',         item: 'a chip of porcelain' },
  { name: 'The Key',         icon: '🗝',  trait: 'the click of a turning lock',    item: 'a bent key' },
  { name: 'The Owl',         icon: '🦉', trait: 'a silent shadow overhead',       item: 'a downy feather' },
];

/**
 * Assign random personas to players for the current game.
 * Returns a Map: playerId -> persona object
 */
export function assignPersonas(playerIds) {
  const shuffled = [...PERSONA_POOL].sort(() => Math.random() - 0.5);
  const map = new Map();
  playerIds.forEach((id, i) => {
    map.set(id, shuffled[i % shuffled.length]);
  });
  return map;
}

// ── QTE Keys ─────────────────────────────────────────────────
const QTE_KEYS = ['W', 'A', 'S', 'D'];
const QTE_ARROWS = { W: '↑', A: '←', S: '↓', D: '→' };
const QTE_KEY_MOBILE = ['↑', '←', '↓', '→'];
const QTE_KEY_MAP_MOBILE = { '↑': 'W', '←': 'A', '↓': 'S', '→': 'D' };

// ── QTE Difficulty Profiles ──────────────────────────────────
function getKillDifficulty(killCount) {
  // Escalating difficulty per kill
  if (killCount <= 0) return { keys: 2, timePerKey: 1800, label: 'Easy' };
  if (killCount === 1) return { keys: 3, timePerKey: 1400, label: 'Medium' };
  if (killCount === 2) return { keys: 4, timePerKey: 1100, label: 'Hard' };
  return { keys: 5, timePerKey: 850, label: 'Deadly' };
}

function getInvestigateDifficulty(isDetective) {
  // Detective gets much easier QTE
  if (isDetective) return { keys: 2, timePerKey: 2200, label: 'Trained' };
  return { keys: 3, timePerKey: 1500, label: 'Amateur' };
}

// ── Clue Generation ──────────────────────────────────────────
/**
 * Generate a clue based on QTE performance.
 * @param {Object} killerPersona - the killer's persona
 * @param {number} score - 0.0 (total fail) to 1.0 (perfect)
 * @param {number} killCount - how many kills so far
 */
export function generateKillClue(killerPersona, score, killCount) {
  if (score >= 1.0) {
    // Perfect kill — NO clues
    return { strength: 'none', text: null };
  }
  if (score >= 0.7) {
    // Minor clue — very vague
    const vague = [
      'The attack happened swiftly, but something felt... off.',
      'A faint disturbance was noticed near the scene.',
      'The killer was careful, but not careful enough to leave nothing.',
    ];
    return { strength: 'weak', text: vague[Math.floor(Math.random() * vague.length)] };
  }
  if (score >= 0.4) {
    // Medium clue — references persona trait
    return {
      strength: 'medium',
      text: `Witnesses reported ${killerPersona.trait} near the scene of the crime.`
    };
  }
  // Strong clue — references persona item
  return {
    strength: 'strong',
    text: `Evidence found at the scene: ${killerPersona.item}. The killer is getting sloppy.`
  };
}

/**
 * Generate investigation result based on QTE performance.
 * @param {Object} targetPersona - investigated player's persona
 * @param {string} targetRole - actual role of the target
 * @param {number} score - 0.0 to 1.0
 */
export function generateInvestClue(targetPersona, targetRole, score) {
  const isKiller = targetRole === 'killer';

  if (score < 0.3) {
    // Failed investigation — inconclusive
    return {
      success: false,
      text: `Your investigation of ${targetPersona.name} was inconclusive. You couldn't find anything useful.`
    };
  }
  if (score < 0.7) {
    // Partial — vague hint
    if (isKiller) {
      return {
        success: true,
        text: `Something about ${targetPersona.name} doesn't sit right. Their alibi has gaps...`
      };
    }
    return {
      success: true,
      text: `${targetPersona.name} seems uneasy, but nothing concrete stands out.`
    };
  }
  // Good investigation — clear result
  if (isKiller) {
    return {
      success: true,
      text: `Strong evidence suggests ${targetPersona.name} (${targetPersona.icon}) is connected to the murders. They may be the killer.`
    };
  }
  return {
    success: true,
    text: `${targetPersona.name} (${targetPersona.icon}) appears to have a solid alibi. Likely innocent.`
  };
}

// ── QTE Runner ───────────────────────────────────────────────
/**
 * Run a QTE sequence inside a container element.
 * Returns a Promise that resolves with the score (0.0–1.0).
 */
export function runQTE(container, difficulty, type = 'kill') {
  return new Promise((resolve) => {
    const { keys: keyCount, timePerKey } = difficulty;
    const sequence = [];
    for (let i = 0; i < keyCount; i++) {
      sequence.push(QTE_KEYS[Math.floor(Math.random() * QTE_KEYS.length)]);
    }

    let currentIdx = 0;
    let hits = 0;
    let misses = 0;
    let timer = null;
    let resolved = false;

    const accentColor = type === 'kill' ? 'var(--blood-bright)' : 'var(--det-bright)';
    const accentBg = type === 'kill' ? 'rgba(139,0,0,.15)' : 'rgba(41,168,212,.15)';
    const typeLabel = type === 'kill' ? '🗡 STRIKE' : '🔍 INVESTIGATE';

    function render() {
      const keysHtml = sequence.map((k, i) => {
        let cls = 'qte-key';
        if (i < currentIdx) cls += hits > i - misses ? ' qte-hit' : ' qte-miss';
        else if (i === currentIdx) cls += ' qte-active';
        return `<div class="${cls}">${QTE_ARROWS[k]}</div>`;
      }).join('');

      const progressPct = Math.round((currentIdx / keyCount) * 100);
      const mobileButtons = QTE_KEY_MOBILE.map(k =>
        `<button class="qte-mobile-btn" data-key="${QTE_KEY_MAP_MOBILE[k]}">${k}</button>`
      ).join('');

      container.innerHTML =
        `<div class="qte-wrapper">` +
          `<div class="qte-label" style="color:${accentColor}">${typeLabel}</div>` +
          `<div class="qte-difficulty">${difficulty.label}</div>` +
          `<div class="qte-sequence">${keysHtml}</div>` +
          `<div class="qte-timer-bar"><div class="qte-timer-fill" id="qteTimerFill" style="background:${accentColor}"></div></div>` +
          `<div class="qte-progress" style="color:${accentColor}">${progressPct}%</div>` +
          `<div class="qte-mobile-keys">${mobileButtons}</div>` +
          `<div class="qte-hint">Press the keys shown above</div>` +
        `</div>`;

      // Mobile button listeners
      container.querySelectorAll('.qte-mobile-btn').forEach(btn => {
        btn.ontouchstart = btn.onclick = (e) => {
          e.preventDefault();
          processKey(btn.dataset.key);
        };
      });
    }

    function startTimer() {
      const fill = document.getElementById('qteTimerFill');
      if (!fill) return;
      fill.style.transition = `width ${timePerKey}ms linear`;
      fill.style.width = '0%';
      // Force reflow
      fill.offsetHeight;
      fill.style.width = '100%';

      clearTimeout(timer);
      timer = setTimeout(() => {
        // Time ran out for this key
        misses++;
        audio.play('bad');
        audio.haptic([100, 50, 100]);
        currentIdx++;
        if (currentIdx >= keyCount) finish();
        else { render(); startTimer(); }
      }, timePerKey);
    }

    function processKey(key) {
      if (resolved || currentIdx >= keyCount) return;
      const expected = sequence[currentIdx];

      if (key.toUpperCase() === expected) {
        hits++;
        audio.tone(600 + hits * 100, 'sine', 0.1, 0.12);
        audio.haptic([30]);
      } else {
        misses++;
        audio.play('bad');
        audio.haptic([100, 50, 100]);
      }

      clearTimeout(timer);
      currentIdx++;
      if (currentIdx >= keyCount) {
        finish();
      } else {
        render();
        startTimer();
      }
    }

    function finish() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      const score = hits / keyCount;

      // Show result
      const passed = score >= 0.5;
      const resultColor = passed ? (type === 'kill' ? 'var(--blood-bright)' : '#81c784') : 'var(--pale-dim)';
      const resultText = type === 'kill'
        ? (score >= 1 ? '☠ CLEAN KILL' : score >= 0.5 ? '🗡 MESSY KILL' : '💨 BOTCHED ATTEMPT')
        : (score >= 0.7 ? '🔍 EVIDENCE FOUND' : score >= 0.3 ? '🔎 PARTIAL FINDINGS' : '❌ INCONCLUSIVE');

      container.innerHTML =
        `<div class="qte-wrapper">` +
          `<div class="qte-result" style="color:${resultColor}">${resultText}</div>` +
          `<div class="qte-score">${Math.round(score * 100)}% accuracy</div>` +
        `</div>`;

      if (passed && type === 'kill') audio.play('kill');
      else if (passed) audio.play('good');
      else audio.tone(150, 'sawtooth', 0.4, 0.15);

      // Resolve after brief display
      setTimeout(() => resolve(score), 1500);

      // Clean up keyboard listener
      document.removeEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
      const k = e.key.toUpperCase();
      if (['W', 'A', 'S', 'D', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(k)) {
        e.preventDefault();
        const mapped = { ARROWUP: 'W', ARROWDOWN: 'S', ARROWLEFT: 'A', ARROWRIGHT: 'D' }[k] || k;
        processKey(mapped);
      }
    }

    // Start
    document.addEventListener('keydown', onKeyDown);
    render();
    // Small delay before starting timer so player can see the sequence
    setTimeout(() => startTimer(), 600);
  });
}

// Export difficulty getters
export { getKillDifficulty, getInvestigateDifficulty };
