// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — QTE Engine v5
// 6 QTE Types • Unverified evidence • Detective verification QTE
// False evidence is NOT auto-revealed — requires detective QTE
// ═══════════════════════════════════════════════════════════════

import audio from './audio.js';
import { getPublicTraitClue, getHiddenTraitClue, getFalsePublicTraitClue } from './avatar.js';

// ── DIFFICULTY ───────────────────────────────────────────────
export function getKillDifficulty(killCount) {
  if (killCount <= 0) return { level: 1, label: 'Dangerous' };
  if (killCount === 1) return { level: 2, label: 'Reckless' };
  if (killCount === 2) return { level: 3, label: 'Frenzied' };
  return { level: 4, label: 'Unhinged' };
}

export function getInvestigateDifficulty(isDetective) {
  if (isDetective) return { level: 1, label: 'Trained' };
  return { level: 2, label: 'Amateur' };
}

export function getVerifyDifficulty() {
  return { level: 1, label: 'Forensic Analysis' };
}

// ── EVIDENCE FORMATTING ──────────────────────────────────────
// Evidence starts UNVERIFIED (grey ?) until detective verifies it
export function formatEvidence(text, status = 'unverified', accuracyPct = null, isFalse = false) {
  if (status === 'verified') {
    let color, label;
    if (accuracyPct >= 70) { color = '#4caf50'; label = 'Reliable'; }
    else if (accuracyPct >= 30) { color = '#f9a825'; label = 'Uncertain'; }
    else { color = '#e53935'; label = 'Unreliable'; }
    const warn = (accuracyPct < 70 || isFalse) ? ' <span class="evidence-warn" title="This evidence may be unreliable">⚠</span>' : '';
    return `<span class="acc-circle" style="background:${color}" title="${accuracyPct}% — ${label}" data-acc="${accuracyPct}"></span>${warn} ${text}`;
  }
  // Unverified — grey circle with ?
  return `<span class="acc-circle acc-unverified" title="Unverified — Detective can verify this evidence">?</span> ${text}`;
}

// ── KILL CLUE GENERATION ─────────────────────────────────────
// Killer ALWAYS drops evidence. Better QTE = smaller/vaguer evidence.
// Worse QTE = bigger, more revealing evidence.
// RARE: perfect kill (no evidence) or perfect evidence (ultra-detailed).
export function generateKillClue(killerCharacter, score, killCount, allCharacters = null, killerId = null) {
  // ★ PERFECT KILL — 5% chance on near-flawless QTE: absolutely zero evidence
  if (score >= 0.98 && Math.random() < 0.05) {
    return { strength: 'none', text: null, isFalse: false };
  }

  // ★ PERFECT EVIDENCE — 3% chance on terrible QTE: ultra-detailed, damning
  if (score < 0.3 && Math.random() < 0.03) {
    const h = killerCharacter.hidden;
    const details = [
      `A witness clearly saw ${getPublicTraitClue(killerCharacter)} flee the scene. They smelled ${h.perfume.toLowerCase()} and noticed ${h.mark.toLowerCase()}.`,
      `Unmistakable evidence: ${h.secretItem.toLowerCase()} was dropped at the scene. The attacker had ${h.mark.toLowerCase()} and walked with ${h.walkStyle.toLowerCase().replace(/,.*/, '')}.`,
      `Multiple witnesses confirm: the killer had ${h.mark.toLowerCase()}, was ${h.habit.toLowerCase()}, and their voice was ${h.voice.toLowerCase()}.`,
    ];
    return { strength: 'perfect', text: details[Math.floor(Math.random() * details.length)], isFalse: false };
  }

  // Determine if this evidence is secretly FALSE
  const falseChance = score >= 1.0 ? 0.10 : score >= 0.7 ? 0.20 : score >= 0.4 ? 0.35 : 0.55;
  const isFalse = Math.random() < falseChance && allCharacters;

  // PERFECT QTE (≥0.95): tiny trace evidence — ambiguous, hard to use
  if (score >= 0.95) {
    const trace = [
      'A faint, unidentifiable scent lingered near the victim.',
      'A single thread was found — too small to identify.',
      'The victim\'s expression suggests they recognized their attacker.',
      'A barely-visible smudge was found on the door handle.',
      'The floorboards creaked in a pattern suggesting a single attacker.',
    ];
    return { strength: 'trace', text: trace[Math.floor(Math.random() * trace.length)], isFalse: false };
  }

  // GREAT QTE (≥0.7): small witness clue, possibly false
  if (score >= 0.7) {
    let clue;
    if (isFalse && allCharacters) clue = getFalsePublicTraitClue(allCharacters, killerId);
    else clue = getPublicTraitClue(killerCharacter);
    return { strength: 'small', text: `Witnesses reported seeing ${clue} near the scene.`, isFalse: !!isFalse };
  }

  // MEDIUM QTE (≥0.4): physical evidence left behind
  if (score >= 0.4) {
    if (isFalse && allCharacters) {
      const fc = getFalsePublicTraitClue(allCharacters, killerId);
      return { strength: 'medium', text: `A witness claims they saw ${fc} fleeing the area.`, isFalse: true };
    }
    const phys = [
      'A torn piece of fabric was found clutched by the victim.',
      'Droplets of something dark found trailing from the scene.',
      'The killer left scratches on the door frame during a struggle.',
      'Faint footprints suggest someone fled hastily.',
      'The window was left ajar — the killer may have entered from outside.',
    ];
    return { strength: 'medium', text: phys[Math.floor(Math.random() * phys.length)], isFalse: false };
  }

  // BAD QTE (<0.4): strong, revealing evidence
  if (isFalse && allCharacters) {
    const fc = getFalsePublicTraitClue(allCharacters, killerId);
    return { strength: 'large', text: `Unconfirmed reports suggest ${fc} was near the crime scene.`, isFalse: true };
  }
  const hidden = getHiddenTraitClue(killerCharacter);
  return { strength: 'large', text: `Crime scene evidence: ${hidden}.`, isFalse: false };
}

// ── MULTI-CLUE PER KILL ─────────────────────────────────────
// Each kill drops 2-4 evidence pieces. Worse QTE = more clues dropped.
// Perfect kill still produces 0 clues.
// B4: roomData (optional) adds location-specific kill flavor text.
export function generateKillClues(killerCharacter, score, killCount, allCharacters = null, killerId = null, roomData = null) {
  // Perfect kill — no evidence at all
  if (score >= 0.98 && Math.random() < 0.05) {
    return [];
  }
  // Determine clue count based on QTE performance
  let clueCount;
  if (score >= 0.9) clueCount = 2;
  else if (score >= 0.6) clueCount = 2 + (Math.random() < 0.4 ? 1 : 0); // 2-3
  else if (score >= 0.3) clueCount = 3;
  else clueCount = 3 + (Math.random() < 0.5 ? 1 : 0); // 3-4

  const clues = [];
  for (let i = 0; i < clueCount; i++) {
    // Vary QTE score slightly for each clue to get diverse strengths
    const variedScore = Math.max(0, Math.min(1, score + (Math.random() - 0.5) * 0.3));
    const clue = generateKillClue(killerCharacter, variedScore, killCount, allCharacters, killerId);
    if (clue.text) clues.push(clue);
  }

  // B4: Inject location-specific kill flavor if room data is available
  if (roomData?.killFlavor?.length && clues.length > 0) {
    const flavor = roomData.killFlavor[Math.floor(Math.random() * roomData.killFlavor.length)];
    // Replace the first generic clue with a location-specific one
    clues[0] = { ...clues[0], text: flavor, roomId: roomData.id };
  }

  return clues;
}

// ── INVESTIGATION CLUE GENERATION ────────────────────────────
export function generateInvestClue(targetCharacter, targetPersona, targetRole, score, isDetective) {
  const isKiller = targetRole === 'killer';
  // Vague false chance regardless of score — adds uncertainty
  const isFalse = Math.random() < 0.15;

  if (score < 0.3) {
    return { success: false, text: `Your investigation of ${targetPersona.name} was inconclusive.`, isFalse: false };
  }

  if (score < 0.7) {
    if (isFalse) {
      if (isKiller) return { success: true, text: `${targetPersona.name} appears to have a reasonable alibi.`, isFalse: true };
      return { success: true, text: `Something about ${targetPersona.name} doesn't sit right...`, isFalse: true };
    }
    if (isKiller) return { success: true, text: `Something about ${targetPersona.name} doesn't sit right. Their alibi has gaps...`, isFalse: false };
    return { success: true, text: `${targetPersona.name} seems uneasy, but nothing concrete.`, isFalse: false };
  }

  // High score
  if (isDetective && isKiller) return { success: true, text: `🔍 Strong evidence: ${targetPersona.name} — ${getHiddenTraitClue(targetCharacter)}. Highly suspicious.`, isStrong: true, isFalse: !!isFalse };
  if (isKiller) return { success: true, text: `Suspicious behavior: ${getPublicTraitClue(targetCharacter)} matches crime scene evidence.`, isStrong: true, isFalse: !!isFalse };
  if (isFalse) return { success: true, text: `${targetPersona.name} was acting nervous and evasive...`, isFalse: true };
  return { success: true, text: `${targetPersona.name} has a solid alibi. Appears innocent.`, isFalse: false };
}

// ── SNOOPING CLUE GENERATION (Killer Counter-Intel) ─────────
// When someone investigates, the killer gets a hint about who was snooping.
// Better QTE = more thorough investigation = more visible to killer (risk/reward).
export function generateSnoopClue(investigatorCharacter, investigatorPersona, score) {
  // Failed investigation — no snooping detected
  if (score < 0.3) return null;

  // Vague: someone was asking questions
  if (score < 0.6) {
    const vague = [
      'Someone was asking questions tonight...',
      'You sense someone has been investigating...',
      'Footsteps echoed near the crime scene...',
      'A faint presence was felt near the evidence...',
    ];
    return { level: 'vague', text: `👁 ${vague[Math.floor(Math.random() * vague.length)]}` };
  }

  // Moderate: public trait hint
  if (score < 0.85) {
    const trait = getPublicTraitClue(investigatorCharacter);
    const moderate = [
      `Someone with ${trait} was seen snooping around.`,
      `A figure matching ${trait} was spotted near the crime scene.`,
      `Witnesses noticed ${trait} lurking near the evidence.`,
    ];
    return { level: 'moderate', text: `👁 ${moderate[Math.floor(Math.random() * moderate.length)]}` };
  }

  // Bold: persona name mentioned
  if (score < 0.98) {
    return { level: 'bold', text: `👁 A figure resembling ${investigatorPersona.name} was seen investigating the crime scene.` };
  }

  // Perfect QTE: 5% chance of near-identifying giveaway
  if (Math.random() < 0.05) {
    return { level: 'critical', text: `⚠ ${investigatorPersona.name} was caught red-handed investigating the crime scene!` };
  }
  // 95% of the time, still just bold
  return { level: 'bold', text: `👁 A figure resembling ${investigatorPersona.name} was seen investigating nearby.` };
}

// ── DETECTIVE HIDDEN TRAIT INVESTIGATION ─────────────────────
// Detective spends a match-limited action to reveal hidden traits of a target.
// Better QTE score = more traits revealed with higher accuracy.
export function generateTraitInvestResult(targetCharacter, score) {
  const hidden = targetCharacter.hidden;
  if (!hidden) return { success: false, traits: [], text: 'Investigation failed — no data found.' };

  const traitKeys = ['perfume', 'mark', 'walkStyle', 'voice', 'habit', 'secretItem'];
  const traitLabels = { perfume: 'Scent', mark: 'Distinguishing Mark', walkStyle: 'Gait', voice: 'Voice', habit: 'Nervous Habit', secretItem: 'Hidden Possession' };

  if (score < 0.25) {
    return { success: false, traits: [], text: 'Your investigation was inconclusive. No hidden traits discovered.' };
  }

  // Shuffle trait keys for randomness
  const shuffled = [...traitKeys].sort(() => Math.random() - 0.5);
  const revealed = [];

  if (score >= 0.8) {
    // Excellent: reveal 2 traits clearly
    revealed.push({ key: shuffled[0], label: traitLabels[shuffled[0]], value: hidden[shuffled[0]] });
    revealed.push({ key: shuffled[1], label: traitLabels[shuffled[1]], value: hidden[shuffled[1]] });
  } else if (score >= 0.5) {
    // Good: reveal 1 trait clearly, 1 vague
    revealed.push({ key: shuffled[0], label: traitLabels[shuffled[0]], value: hidden[shuffled[0]] });
    revealed.push({ key: shuffled[1], label: traitLabels[shuffled[1]], value: '(unclear — something about their ' + traitLabels[shuffled[1]].toLowerCase() + '...)' });
  } else {
    // Mediocre: reveal 1 trait only
    revealed.push({ key: shuffled[0], label: traitLabels[shuffled[0]], value: hidden[shuffled[0]] });
  }

  const text = revealed.map(t => `${t.label}: ${t.value}`).join(' • ');
  return { success: true, traits: revealed, text: `🕵 Discovered: ${text}` };
}

// ── VERIFICATION RESULT ──────────────────────────────────────
// Detective verifies a piece of evidence. QTE score determines how
// accurately the detective can assess the evidence.
// F1: agingCeiling caps accuracy by evidence age (100% fresh → 20% floor).
export function computeVerification(score, evidenceIsFalse, agingCeiling = 100) {
  // score = 0.0 to 1.0 from QTE
  // Returns { accuracyPct, verdictText, detectedFalse }
  let min, max;
  if (score >= 0.9)      { min = 80; max = 100; }
  else if (score >= 0.7) { min = 60; max = 85; }
  else if (score >= 0.4) { min = 30; max = 60; }
  else                   { min = 5;  max = 30; }
  let accuracyPct = Math.round(min + Math.random() * (max - min));

  // F1: Cap by evidence aging ceiling — old evidence can't be fully verified
  accuracyPct = Math.min(accuracyPct, agingCeiling);

  // Can detective correctly identify false evidence?
  // Higher accuracy = higher chance of detecting falsehood
  const detectionChance = accuracyPct / 100;
  const detectedFalse = evidenceIsFalse && Math.random() < detectionChance;

  let verdictText;
  if (detectedFalse) {
    verdictText = '🔴 FABRICATED — This evidence appears to be false or planted!';
  } else if (evidenceIsFalse && !detectedFalse) {
    // False but not detected — shows as "seems credible" which is WRONG
    verdictText = accuracyPct >= 70 ? '🟢 Credible — This evidence appears genuine.' : '🟡 Inconclusive — Cannot determine reliability.';
  } else {
    // Real evidence
    if (accuracyPct >= 70) verdictText = '🟢 Credible — This evidence appears genuine.';
    else if (accuracyPct >= 30) verdictText = '🟡 Inconclusive — Cannot determine reliability.';
    else verdictText = '🟠 Uncertain — The evidence is ambiguous.';
  }

  // Add aging context to verdict if ceiling is low
  if (agingCeiling < 70) {
    verdictText += ` ⏳ Evidence degraded — accuracy capped at ${agingCeiling}%.`;
  }

  return { accuracyPct, verdictText, detectedFalse };
}

// ── QTE TYPE SELECTION (12 types) ────────────────────────────
const QTE_TYPES = ['keys', 'circles', 'pattern', 'rapid', 'color', 'reaction', 'heartbeat', 'search', 'shadow', 'wire', 'lockpick', 'memory'];
function pickQTEType() { return QTE_TYPES[Math.floor(Math.random() * QTE_TYPES.length)]; }

export function runQTE(container, difficulty, type = 'kill') {
  const qt = pickQTEType();
  const qteRunner = () => {
    switch (qt) {
      case 'circles':   return runCircleHuntQTE(container, difficulty, type);
      case 'pattern':   return runPatternMemoryQTE(container, difficulty, type);
      case 'rapid':     return runRapidTapQTE(container, difficulty, type);
      case 'color':     return runColorMatchQTE(container, difficulty, type);
      case 'reaction':  return runReactionTimeQTE(container, difficulty, type);
      case 'heartbeat': return runHeartbeatQTE(container, difficulty, type);
      case 'search':    return runRoomSearchQTE(container, difficulty, type);
      case 'shadow':    return runShadowDodgeQTE(container, difficulty, type);
      case 'wire':      return runWireCutQTE(container, difficulty, type);
      case 'lockpick':  return runLockpickQTE(container, difficulty, type);
      case 'memory':    return runMemoryMatchQTE(container, difficulty, type);
      default:          return runKeySequenceQTE(container, difficulty, type);
    }
  };
  return showQTECountdown(container, type, difficulty, qt).then(qteRunner);
}

// ── QTE PREP COUNTDOWN (5 seconds) ──────────────────────────
function showQTECountdown(container, type, difficulty, qteType) {
  return new Promise(resolve => {
    const ac = type === 'kill' ? 'var(--blood-bright)' : type === 'verify' ? 'var(--gold)' : 'var(--det-bright)';
    const lb = type === 'kill' ? '🗡 KILL QTE' : type === 'verify' ? '🔬 VERIFY QTE' : '🔍 INVESTIGATE QTE';
    const typeNames = { keys:'Key Sequence', circles:'Circle Hunt', pattern:'Pattern Memory', rapid:'Rapid Tap', color:'Color Match', reaction:'Reaction Time', heartbeat:'Heartbeat Sync', search:'Room Search', shadow:'Shadow Dodge', wire:'Wire Cut', lockpick:'Lockpick', memory:'Memory Match' };
    const typeName = typeNames[qteType] || 'Challenge';
    let count = 5;
    function render() {
      container.innerHTML = `<div class="qte-wrapper" style="text-align:center">
        <div style="font-size:.7rem;color:var(--pale-dim);letter-spacing:.15em;margin-bottom:6px">${lb}</div>
        <div style="font-size:.65rem;color:${ac};opacity:.7;margin-bottom:12px">${difficulty.label} • ${typeName}</div>
        <div style="font-size:3.5rem;font-family:var(--font-display);color:${ac};text-shadow:0 0 30px ${ac};animation:pu .8s infinite">${count}</div>
        <div style="font-size:.9rem;color:var(--gold);margin-top:12px;letter-spacing:.1em">GET READY</div>
        <div style="margin-top:16px;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden">
          <div id="qteCountdownBar" style="height:100%;width:100%;background:${ac};transition:width 1s linear"></div>
        </div>
      </div>`;
    }
    render();
    const iv = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(iv);
        container.innerHTML = `<div class="qte-wrapper" style="text-align:center">
          <div style="font-size:2rem;color:var(--gold);font-family:var(--font-display);animation:pu .3s 2">⚡ GO!</div>
        </div>`;
        audio.tone(800, 'sine', 0.15, 0.12);
        audio.haptic([50, 30, 50]);
        setTimeout(resolve, 600);
      } else {
        render();
        audio.tone(300 + (5 - count) * 80, 'sine', 0.08, 0.08);
        audio.haptic([30]);
        const bar = document.getElementById('qteCountdownBar');
        if (bar) { bar.style.width = ((count / 5) * 100) + '%'; }
      }
    }, 1000);
    // Start the bar animation immediately
    setTimeout(() => {
      const bar = document.getElementById('qteCountdownBar');
      if (bar) bar.style.width = '80%';
    }, 50);
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 1: KEY SEQUENCE
// ═════════════════════════════════════════════════════════════
const QTE_KEYS = ['W','A','S','D'];
const QTE_ARROWS = { W:'↑', A:'←', S:'↓', D:'→' };
const QTE_MOBILE = ['↑','←','↓','→'];
const QTE_MMAP = { '↑':'W','←':'A','↓':'S','→':'D' };
function getKeyParams(lv){if(lv<=1)return{keys:2,timePerKey:1400};if(lv===2)return{keys:3,timePerKey:1100};if(lv===3)return{keys:4,timePerKey:900};return{keys:5,timePerKey:700};}

function runKeySequenceQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{keys:kc,timePerKey:tpk}=getKeyParams(difficulty.level);
    const seq=[];for(let i=0;i<kc;i++)seq.push(QTE_KEYS[Math.floor(Math.random()*4)]);
    let idx=0,hits=0,timer=null,done=false;
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 STRIKE':type==='verify'?'🔬 VERIFY':'🔍 INVESTIGATE';
    function render(){const kh=seq.map((k,i)=>{let c='qte-key';if(i<idx)c+=i<hits?' qte-hit':' qte-miss';else if(i===idx)c+=' qte-active';return`<div class="${c}">${QTE_ARROWS[k]}</div>`;}).join('');const mb=QTE_MOBILE.map(k=>`<button class="qte-mobile-btn" data-key="${QTE_MMAP[k]}">${k}</button>`).join('');container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Key Sequence</div><div class="qte-sequence">${kh}</div><div class="qte-timer-bar"><div class="qte-timer-fill" id="qteTimerFill" style="background:${ac}"></div></div><div class="qte-mobile-keys">${mb}</div><div class="qte-hint">Press the keys — fast!</div></div>`;container.querySelectorAll('.qte-mobile-btn').forEach(b=>{b.ontouchstart=b.onclick=e=>{e.preventDefault();processKey(b.dataset.key);};});}
    function startTimer(){const f=document.getElementById('qteTimerFill');if(f){f.style.transition=`width ${tpk}ms linear`;f.style.width='0%';f.offsetHeight;f.style.width='100%';}clearTimeout(timer);timer=setTimeout(()=>{idx++;audio.play('bad');audio.haptic([100,50,100]);if(idx>=kc)finish();else{render();startTimer();}},tpk);}
    function processKey(key){if(done||idx>=kc)return;if(key.toUpperCase()===seq[idx]){hits++;audio.tone(600+hits*100,'sine',0.1,0.12);audio.haptic([30]);}else{audio.play('bad');audio.haptic([100,50,100]);}clearTimeout(timer);idx++;if(idx>=kc)finish();else{render();startTimer();}}
    function finish(){if(done)return;done=true;clearTimeout(timer);document.removeEventListener('keydown',onKey);showResult(container,hits/kc,type,resolve);}
    function onKey(e){const k=e.key.toUpperCase();if(['W','A','S','D','ARROWUP','ARROWDOWN','ARROWLEFT','ARROWRIGHT'].includes(k)){e.preventDefault();processKey({ARROWUP:'W',ARROWDOWN:'S',ARROWLEFT:'A',ARROWRIGHT:'D'}[k]||k);}}
    document.addEventListener('keydown',onKey);render();setTimeout(()=>startTimer(),400);
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 2: CIRCLE HUNT
// ═════════════════════════════════════════════════════════════
function getCircleParams(lv){if(lv<=1)return{rounds:6,spawnTime:1600,redChance:.25,maxActive:3};if(lv===2)return{rounds:9,spawnTime:1200,redChance:.3,maxActive:4};if(lv===3)return{rounds:12,spawnTime:900,redChance:.35,maxActive:5};return{rounds:16,spawnTime:700,redChance:.4,maxActive:6};}

function runCircleHuntQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{rounds,spawnTime:st,redChance:rc,maxActive:ma}=getCircleParams(difficulty.level);
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 STRIKE':type==='verify'?'🔬 VERIFY':'🔍 INVESTIGATE';
    let spawned=0,hits=0,misses=0,done=false,circles=[],si=null;
    container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Circle Hunt</div><div class="qte-circle-arena" id="qteArena"></div><div class="qte-hint">Tap ⚪ — Avoid 🔴 — Don't miss!</div></div>`;
    const arena=document.getElementById('qteArena');if(!arena){resolve(0);return;}
    function spawn(){if(done||spawned>=rounds){clearInterval(si);setTimeout(finish,st+200);return;}if(circles.length>=ma)return;const isRed=Math.random()<rc;const c=document.createElement('div');c.className=`qte-circle ${isRed?'qte-circle-red':'qte-circle-white'}`;c.style.left=(8+Math.random()*78)+'%';c.style.top=(8+Math.random()*74)+'%';c.style.animationDuration=(st*.85)+'ms';const cid=spawned;const h=e=>{e.preventDefault();e.stopPropagation();if(done)return;c.removeEventListener('click',h);c.removeEventListener('touchstart',h);if(isRed){misses++;c.classList.add('qte-circle-burst-bad');audio.play('bad');audio.haptic([100,50,100]);}else{hits++;c.classList.add('qte-circle-burst');audio.tone(500+hits*80,'sine',0.08,0.1);audio.haptic([30]);}circles=circles.filter(x=>x.id!==cid);setTimeout(()=>c.remove(),300);};c.addEventListener('click',h);c.addEventListener('touchstart',h);const et=setTimeout(()=>{if(done||!c.parentNode)return;if(!isRed){misses++;c.classList.add('qte-circle-fade');}circles=circles.filter(x=>x.id!==cid);setTimeout(()=>c.remove(),300);},st*.8);circles.push({id:cid,el:c,timer:et});arena.appendChild(c);spawned++;}
    function finish(){if(done)return;done=true;clearInterval(si);circles.forEach(c=>{clearTimeout(c.timer);c.el.remove();});showResult(container,hits/Math.max(1,hits+misses),type,resolve);}
    setTimeout(()=>{spawn();si=setInterval(spawn,st*.5);},400);
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 3: PATTERN MEMORY
// ═════════════════════════════════════════════════════════════
const PAT_SYM=['◆','●','▲','■','★','♦','⬟','◎'];const PAT_CLR=['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#e67e22','#1abc9c','#fd79a8'];
function getPatternParams(lv){if(lv<=1)return{length:3,showTime:2500,symbols:4};if(lv===2)return{length:4,showTime:2000,symbols:5};if(lv===3)return{length:5,showTime:1500,symbols:6};return{length:6,showTime:1200,symbols:7};}

function runPatternMemoryQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{length:len,showTime:st,symbols:sc}=getPatternParams(difficulty.level);
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 STRIKE':type==='verify'?'🔬 VERIFY':'🔍 INVESTIGATE';
    const us=PAT_SYM.slice(0,sc),uc=PAT_CLR.slice(0,sc);
    const pat=[];for(let i=0;i<len;i++){const si=Math.floor(Math.random()*sc);pat.push({symbol:us[si],color:uc[si],index:si});}
    let phase='show',ii=0,hits=0,done=false;
    function renderShow(){container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Pattern Memory</div><div class="qte-pattern-display">${pat.map(p=>`<div class="qte-pattern-sym" style="color:${p.color};border-color:${p.color}">${p.symbol}</div>`).join('')}</div><div class="qte-hint">Memorize this sequence!</div><div class="qte-timer-bar"><div class="qte-timer-fill" id="qteTimerFill" style="background:${ac}"></div></div></div>`;const f=document.getElementById('qteTimerFill');if(f){f.style.transition=`width ${st}ms linear`;f.style.width='0%';f.offsetHeight;f.style.width='100%';}}
    function renderInput(){const pr=pat.map((p,i)=>{if(i<ii)return`<div class="qte-pattern-sym qte-hit" style="color:${p.color};border-color:${p.color}">${p.symbol}</div>`;if(i===ii)return`<div class="qte-pattern-sym qte-active" style="border-color:var(--gold)">?</div>`;return`<div class="qte-pattern-sym" style="opacity:.25">?</div>`;}).join('');const bt=us.map((s,i)=>`<button class="qte-pattern-btn" data-si="${i}" style="color:${uc[i]};border-color:${uc[i]}">${s}</button>`).join('');container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">Recreate the pattern</div><div class="qte-pattern-display">${pr}</div><div class="qte-pattern-buttons">${bt}</div></div>`;container.querySelectorAll('.qte-pattern-btn').forEach(b=>{b.onclick=b.ontouchstart=e=>{e.preventDefault();if(!done&&phase==='input')processInput(parseInt(b.dataset.si));};});}
    function processInput(si){if(done)return;if(si===pat[ii].index){hits++;audio.tone(500+hits*100,'sine',0.08,0.1);audio.haptic([30]);}else{audio.play('bad');audio.haptic([100,50,100]);}ii++;if(ii>=len)finish();else renderInput();}
    function finish(){if(done)return;done=true;showResult(container,hits/len,type,resolve);}
    renderShow();setTimeout(()=>{phase='input';ii=0;renderInput();},st+200);
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 4: RAPID TAP
// ═════════════════════════════════════════════════════════════
function getRapidParams(lv){if(lv<=1)return{target:10,timeLimit:4000};if(lv===2)return{target:14,timeLimit:3500};if(lv===3)return{target:20,timeLimit:3000};return{target:28,timeLimit:2500};}

function runRapidTapQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{target,timeLimit}=getRapidParams(difficulty.level);
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 STRIKE':type==='verify'?'🔬 VERIFY':'🔍 INVESTIGATE';
    let taps=0,done=false;
    function render(){const pct=Math.min(100,Math.round((taps/target)*100));const bc=pct>=100?'#81c784':pct>=60?'var(--gold)':ac;container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Rapid Tap</div><div style="font-size:2.5rem;text-align:center;margin:8px 0;font-family:var(--font-mono);color:${ac}">${taps}<span style="font-size:.8rem;color:var(--pale-dim)">/${target}</span></div><div class="qte-timer-bar" style="height:12px"><div style="width:${pct}%;height:100%;background:${bc};border-radius:6px;transition:width .08s"></div></div><button class="qte-rapid-btn" id="qteRapidBtn">⚡ TAP!</button><div class="qte-timer-bar" style="margin-top:8px"><div class="qte-timer-fill" id="qteTimerFill" style="background:${ac}"></div></div><div class="qte-hint">Tap as fast as you can!</div></div>`;const btn=document.getElementById('qteRapidBtn');if(btn){const h=e=>{e.preventDefault();if(!done)doTap();};btn.addEventListener('click',h);btn.addEventListener('touchstart',h);}}
    function doTap(){if(done)return;taps++;audio.tone(400+taps*15,'sine',0.05,0.06);audio.haptic([20]);render();if(taps>=target)finish();}
    function startTimer(){const f=document.getElementById('qteTimerFill');if(f){f.style.transition=`width ${timeLimit}ms linear`;f.style.width='0%';f.offsetHeight;f.style.width='100%';}setTimeout(()=>{if(!done)finish();},timeLimit);}
    function onKey(e){if(e.key===' '||e.key==='Enter'||e.key.toUpperCase()==='F'){e.preventDefault();doTap();}}
    function finish(){if(done)return;done=true;document.removeEventListener('keydown',onKey);showResult(container,Math.min(1.0,taps/target),type,resolve);}
    document.addEventListener('keydown',onKey);render();setTimeout(()=>startTimer(),300);
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 5: COLOR MATCH
// ═════════════════════════════════════════════════════════════
const CM_COLORS=[{name:'RED',hex:'#e74c3c'},{name:'BLUE',hex:'#3498db'},{name:'GREEN',hex:'#2ecc71'},{name:'YELLOW',hex:'#f1c40f'},{name:'PURPLE',hex:'#9b59b6'},{name:'ORANGE',hex:'#e67e22'}];
function getColorParams(lv){if(lv<=1)return{rounds:3,showTime:1500,colors:4};if(lv===2)return{rounds:5,showTime:1100,colors:4};if(lv===3)return{rounds:7,showTime:850,colors:5};return{rounds:9,showTime:650,colors:6};}

function runColorMatchQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{rounds,showTime,colors:cc}=getColorParams(difficulty.level);
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 STRIKE':type==='verify'?'🔬 VERIFY':'🔍 INVESTIGATE';
    const uc=CM_COLORS.slice(0,cc);const seq=[];for(let i=0;i<rounds;i++)seq.push(Math.floor(Math.random()*cc));
    let idx=0,hits=0,done=false,st=null;
    function showC(){if(done||idx>=rounds){finish();return;}const t=uc[seq[idx]];container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Color Match (${idx+1}/${rounds})</div><div style="width:80px;height:80px;border-radius:50%;margin:12px auto;background:${t.hex};box-shadow:0 0 20px ${t.hex}80;animation:pu .4s infinite"></div><div style="text-align:center;font-family:var(--font-mono);font-size:.7rem;color:var(--pale-dim);margin-bottom:10px">MATCH THIS COLOR</div><div class="qte-pattern-buttons">${uc.map((c,i)=>`<button class="qte-pattern-btn" data-ci="${i}" style="background:${c.hex};color:#fff;border-color:${c.hex};width:48px;height:48px;font-size:.65rem">${c.name}</button>`).join('')}</div><div class="qte-timer-bar"><div class="qte-timer-fill" id="qteTimerFill" style="background:${ac}"></div></div></div>`;container.querySelectorAll('.qte-pattern-btn').forEach(b=>{b.onclick=b.ontouchstart=e=>{e.preventDefault();if(!done)processC(parseInt(b.dataset.ci));};});const f=document.getElementById('qteTimerFill');if(f){f.style.transition=`width ${showTime}ms linear`;f.style.width='0%';f.offsetHeight;f.style.width='100%';}clearTimeout(st);st=setTimeout(()=>{if(!done){idx++;if(idx>=rounds)finish();else showC();}},showTime);}
    function processC(ci){if(done)return;clearTimeout(st);if(ci===seq[idx]){hits++;audio.tone(500+hits*80,'sine',0.08,0.1);audio.haptic([30]);}else{audio.play('bad');audio.haptic([100,50,100]);}idx++;if(idx>=rounds)finish();else showC();}
    function finish(){if(done)return;done=true;clearTimeout(st);showResult(container,hits/rounds,type,resolve);}
    showC();
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 6: REACTION TIME
// ═════════════════════════════════════════════════════════════
function getReactionParams(lv){if(lv<=1)return{rounds:3,threshold:750};if(lv===2)return{rounds:3,threshold:550};if(lv===3)return{rounds:4,threshold:420};return{rounds:5,threshold:350};}

function runReactionTimeQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{rounds,threshold}=getReactionParams(difficulty.level);
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 STRIKE':type==='verify'?'🔬 VERIFY':'🔍 INVESTIGATE';
    let round=0,hits=0,done=false,waiting=false,goTime=0,rt=null;
    function next(){if(done||round>=rounds){finishAll();return;}waiting=true;container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Reaction Time (${round+1}/${rounds})</div><div id="reactionZone" class="qte-reaction-zone" style="background:rgba(255,50,50,.15);border:2px solid rgba(255,50,50,.3)"><div style="font-size:1.5rem">🔴</div><div style="font-size:.85rem;color:var(--pale-dim);margin-top:6px">Wait for green...</div></div></div>`;const z=document.getElementById('reactionZone');if(z){const h=e=>{e.preventDefault();if(!done)handleTap();};z.addEventListener('click',h);z.addEventListener('touchstart',h);}const delay=1000+Math.random()*2000;rt=setTimeout(()=>{if(done)return;waiting=false;goTime=Date.now();const z2=document.getElementById('reactionZone');if(z2){z2.style.background='rgba(50,255,50,.15)';z2.style.borderColor='rgba(50,255,50,.4)';z2.innerHTML=`<div style="font-size:1.5rem">🟢</div><div style="font-size:1rem;color:#81c784;font-family:var(--font-display);margin-top:6px">TAP NOW!</div>`;}setTimeout(()=>{if(!done&&goTime&&Date.now()-goTime>=threshold*1.5){round++;next();}},threshold*1.5);},delay);}
    function handleTap(){if(done)return;clearTimeout(rt);if(waiting){audio.play('bad');audio.haptic([100,50,100]);const z=document.getElementById('reactionZone');if(z)z.innerHTML=`<div style="color:var(--blood-bright);font-size:.9rem;font-family:var(--font-display)">❌ TOO EARLY!</div>`;round++;setTimeout(()=>next(),800);}else{const ms=Date.now()-goTime;const good=ms<=threshold;if(good){hits++;audio.tone(600+hits*100,'sine',0.1,0.12);audio.haptic([30]);const z=document.getElementById('reactionZone');if(z)z.innerHTML=`<div style="color:#81c784;font-size:.9rem;font-family:var(--font-display)">⚡ ${ms}ms</div>`;}else{audio.play('bad');audio.haptic([100,50,100]);const z=document.getElementById('reactionZone');if(z)z.innerHTML=`<div style="color:var(--gold);font-size:.9rem;font-family:var(--font-display)">🐢 ${ms}ms — too slow</div>`;}round++;setTimeout(()=>next(),900);}}
    function onKey(e){if(e.key===' '||e.key==='Enter'||e.key.toUpperCase()==='F'){e.preventDefault();handleTap();}}
    function finishAll(){if(done)return;done=true;clearTimeout(rt);document.removeEventListener('keydown',onKey);showResult(container,hits/rounds,type,resolve);}
    document.addEventListener('keydown',onKey);next();
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 7: HEARTBEAT PULSE (Season 2 — Kill themed)
// Player must tap in sync with a heartbeat rhythm.
// ═════════════════════════════════════════════════════════════
function getHeartbeatParams(lv){if(lv<=1)return{beats:5,bpm:55,window:400};if(lv===2)return{beats:6,bpm:65,window:300};if(lv===3)return{beats:8,bpm:80,window:220};return{beats:10,bpm:95,window:170};}

function runHeartbeatQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{beats,bpm,window:win}=getHeartbeatParams(difficulty.level);
    const interval=60000/bpm;
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 HEARTBEAT':'🔍 PULSE SCAN';
    let beatIdx=0,hits=0,done=false,beatTimer=null,started=false;
    function render(pulse=false){
      const pct=Math.round((beatIdx/beats)*100);
      const heartClass=pulse?'qte-heart-pulse':'';
      container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Heartbeat Sync (${beatIdx}/${beats})</div><div class="qte-heart ${heartClass}" id="qteHeart" style="font-size:4rem;text-align:center;cursor:pointer;user-select:none;transition:transform .15s">❤️</div><div class="qte-timer-bar" style="margin-top:12px;height:8px"><div style="width:${pct}%;height:100%;background:${ac};border-radius:4px;transition:width .2s"></div></div><div class="qte-hint">Tap the heart on each beat!</div></div>`;
      const heart=document.getElementById('qteHeart');
      if(heart){const h=e=>{e.preventDefault();handleTap();};heart.addEventListener('click',h);heart.addEventListener('touchstart',h);}
    }
    function doBeat(){
      if(done||beatIdx>=beats){finish();return;}
      // Visual pulse
      const heart=document.getElementById('qteHeart');
      if(heart){heart.style.transform='scale(1.4)';setTimeout(()=>{if(heart)heart.style.transform='scale(1)';},150);}
      audio.tone(200+(beatIdx%2)*50,'sine',0.15,0.1);
      const beatTime=Date.now();
      // Store for timing check
      container._lastBeatTime=beatTime;
      beatIdx++;
      if(beatIdx<beats)beatTimer=setTimeout(doBeat,interval);
      else setTimeout(finish,win+100);
    }
    function handleTap(){
      if(done)return;
      const now=Date.now();
      const lastBeat=container._lastBeatTime||0;
      const diff=Math.abs(now-lastBeat);
      if(diff<=win){hits++;audio.tone(600+hits*80,'sine',0.08,0.1);audio.haptic([30]);const h=document.getElementById('qteHeart');if(h)h.style.color='#4caf50';}
      else{audio.play('bad');audio.haptic([60]);const h=document.getElementById('qteHeart');if(h)h.style.color='#e53935';}
      setTimeout(()=>{const h=document.getElementById('qteHeart');if(h)h.style.color='';},200);
    }
    function onKey(e){if(e.key===' '||e.key==='Enter'){e.preventDefault();handleTap();}}
    function finish(){if(done)return;done=true;clearTimeout(beatTimer);document.removeEventListener('keydown',onKey);showResult(container,hits/beats,type,resolve);}
    document.addEventListener('keydown',onKey);render();setTimeout(()=>{started=true;doBeat();},800);
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 8: ROOM SEARCH (Season 2 — Investigation themed)
// Grid of tiles, player must tap highlighted ones before they fade.
// ═════════════════════════════════════════════════════════════
function getSearchParams(lv){if(lv<=1)return{gridSize:3,rounds:4,showTime:1500,decoys:1};if(lv===2)return{gridSize:3,rounds:6,showTime:1100,decoys:1};if(lv===3)return{gridSize:4,rounds:8,showTime:850,decoys:2};return{gridSize:4,rounds:10,showTime:650,decoys:3};}

function runRoomSearchQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const{gridSize:gs,rounds,showTime:st,decoys:dc}=getSearchParams(difficulty.level);
    const ac=type==='kill'?'var(--blood-bright)':type==='verify'?'var(--gold)':'var(--det-bright)';
    const lb=type==='kill'?'🗡 HUNT':type==='verify'?'🔬 ANALYZE':'🔍 ROOM SEARCH';
    const clueIcons=['🔍','📎','🧤','🔑','📝','💊','🗡','📸'];
    let roundIdx=0,hits=0,misses=0,done=false;
    function doRound(){
      if(done||roundIdx>=rounds){finish();return;}
      // Build grid
      const cells=gs*gs;
      const targetCell=Math.floor(Math.random()*cells);
      const decoyCells=new Set();
      while(decoyCells.size<Math.min(dc,cells-1)){const d=Math.floor(Math.random()*cells);if(d!==targetCell)decoyCells.add(d);}
      const icon=clueIcons[roundIdx%clueIcons.length];
      let gridHtml='';
      for(let i=0;i<cells;i++){
        const isTarget=i===targetCell;
        const isDecoy=decoyCells.has(i);
        const cls=isTarget?'qte-search-cell qte-search-target':isDecoy?'qte-search-cell qte-search-decoy':'qte-search-cell';
        const content=isTarget?icon:isDecoy?'❌':'';
        gridHtml+=`<div class="${cls}" data-idx="${i}" data-type="${isTarget?'target':isDecoy?'decoy':'empty'}">${content}</div>`;
      }
      container.innerHTML=`<div class="qte-wrapper"><div class="qte-label" style="color:${ac}">${lb}</div><div class="qte-difficulty">${difficulty.label} • Room Search (${roundIdx+1}/${rounds})</div><div class="qte-search-grid" style="display:grid;grid-template-columns:repeat(${gs},1fr);gap:4px;max-width:${gs*56}px;margin:10px auto">${gridHtml}</div><div class="qte-timer-bar"><div class="qte-timer-fill" id="qteTimerFill" style="background:${ac}"></div></div><div class="qte-hint">Find the ${icon} — avoid ❌!</div></div>`;
      // Timer bar
      const f=document.getElementById('qteTimerFill');
      if(f){f.style.transition=`width ${st}ms linear`;f.style.width='0%';f.offsetHeight;f.style.width='100%';}
      // Wire clicks
      container.querySelectorAll('.qte-search-cell').forEach(cell=>{
        const h=e=>{e.preventDefault();if(done)return;const t=cell.dataset.type;
          if(t==='target'){hits++;cell.classList.add('qte-search-found');audio.tone(600+hits*60,'sine',0.08,0.1);audio.haptic([30]);clearTimeout(roundTimer);roundIdx++;setTimeout(doRound,400);}
          else if(t==='decoy'){misses++;cell.classList.add('qte-search-wrong');audio.play('bad');audio.haptic([80]);}
          else{cell.style.opacity='.3';}
        };cell.addEventListener('click',h);cell.addEventListener('touchstart',h);
      });
      const roundTimer=setTimeout(()=>{if(!done){misses++;roundIdx++;doRound();}},st);
    }
    function finish(){if(done)return;done=true;showResult(container,hits/Math.max(1,hits+misses),type,resolve);}
    doRound();
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 9: SHADOW DODGE — dodge appearing danger zones
// ═════════════════════════════════════════════════════════════
function runShadowDodgeQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const lv = difficulty.level || difficulty;
    const rounds = lv <= 1 ? 3 : lv <= 3 ? 4 : 5;
    const baseTime = lv <= 1 ? 2500 : lv <= 3 ? 1800 : 1200;
    let hits = 0, done = false, round = 0;
    const c = type === 'kill' ? 'var(--blood-bright)' : '#81c784';

    container.innerHTML = `<div class="qte-wrapper">
      <div class="qte-title" style="color:${c}">👤 SHADOW DODGE</div>
      <div class="qte-sub">Click the safe zone before the shadow consumes it!</div>
      <div id="sdArea" style="position:relative;width:100%;height:180px;border:1px solid rgba(201,168,76,.15);border-radius:8px;overflow:hidden;background:rgba(0,0,0,.3)"></div>
      <div class="muted qte-counter" id="sdCount">0/${rounds}</div>
    </div>`;

    const area = document.getElementById('sdArea');
    function doRound() {
      if (done || round >= rounds) { finish(); return; }
      round++;
      // Place safe zone
      const safeX = 20 + Math.random() * 60;
      const safeY = 20 + Math.random() * 60;
      area.innerHTML = `<div id="sdSafe" style="position:absolute;left:${safeX}%;top:${safeY}%;width:40px;height:40px;border-radius:50%;background:rgba(100,200,100,.3);border:2px solid rgba(100,200,100,.6);cursor:pointer;transition:all .3s"></div>`;
      // Start shadow creeping in
      const shadow = document.createElement('div');
      shadow.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0);transition:background ' + (baseTime / 1000) + 's linear;pointer-events:none';
      area.appendChild(shadow);
      requestAnimationFrame(() => { shadow.style.background = 'rgba(0,0,0,.85)'; });

      const safe = document.getElementById('sdSafe');
      let clicked = false;
      if (safe) safe.onclick = () => {
        if (clicked) return;
        clicked = true;
        hits++;
        safe.style.background = 'rgba(100,200,100,.6)';
        safe.style.transform = 'scale(1.3)';
        document.getElementById('sdCount').textContent = `${hits}/${rounds}`;
        setTimeout(doRound, 400);
      };
      setTimeout(() => { if (!clicked && !done) { area.innerHTML = '<div style="text-align:center;padding:20px;color:#ff5252">💀 Caught!</div>'; setTimeout(doRound, 500); } }, baseTime);
    }
    function finish() { if (done) return; done = true; showResult(container, hits / rounds, type, resolve); }
    doRound();
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 10: WIRE CUT — pick the correct wire each step
// ═════════════════════════════════════════════════════════════
function runWireCutQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const lv = difficulty.level || difficulty;
    const steps = lv <= 1 ? 3 : lv <= 3 ? 4 : 5;
    const colors = ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#ab47bc', '#ff7043'];
    let hits = 0, done = false, step = 0;
    const c = type === 'kill' ? 'var(--blood-bright)' : '#81c784';

    container.innerHTML = `<div class="qte-wrapper">
      <div class="qte-title" style="color:${c}">✂ WIRE CUT</div>
      <div class="qte-sub">Cut the highlighted wire!</div>
      <div id="wcArea" style="display:flex;flex-direction:column;gap:6px;padding:8px"></div>
      <div class="muted qte-counter" id="wcCount">0/${steps}</div>
    </div>`;

    function doStep() {
      if (done || step >= steps) { finish(); return; }
      step++;
      const area = document.getElementById('wcArea');
      const shuffled = colors.sort(() => Math.random() - 0.5).slice(0, 4);
      const correct = Math.floor(Math.random() * shuffled.length);
      area.innerHTML = shuffled.map((col, i) =>
        `<div class="wire-btn" data-idx="${i}" style="height:20px;border-radius:4px;background:${col};cursor:pointer;border:2px solid ${i === correct ? 'white' : 'transparent'};opacity:${i === correct ? '1' : '.5'};transition:all .2s"></div>`
      ).join('');
      let clicked = false;
      area.onclick = (e) => {
        const btn = e.target.closest('.wire-btn');
        if (!btn || clicked) return;
        clicked = true;
        if (parseInt(btn.dataset.idx) === correct) {
          hits++;
          btn.style.boxShadow = '0 0 12px rgba(100,200,100,.6)';
        } else {
          btn.style.opacity = '.2';
          area.querySelector(`[data-idx="${correct}"]`).style.boxShadow = '0 0 12px rgba(255,100,100,.6)';
        }
        document.getElementById('wcCount').textContent = `${hits}/${steps}`;
        setTimeout(doStep, 500);
      };
      // Timeout
      setTimeout(() => { if (!clicked && !done) { clicked = true; setTimeout(doStep, 300); } }, lv <= 1 ? 3500 : lv <= 3 ? 2500 : 1800);
    }
    function finish() { if (done) return; done = true; showResult(container, hits / steps, type, resolve); }
    doStep();
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 11: LOCKPICK — stop the moving bar in the sweet spot
// ═════════════════════════════════════════════════════════════
function runLockpickQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const lv = difficulty.level || difficulty;
    const steps = lv <= 1 ? 3 : lv <= 3 ? 4 : 5;
    const sweetSize = lv <= 1 ? 35 : lv <= 3 ? 26 : 18; // % width
    const speed = lv <= 1 ? 1.2 : lv <= 3 ? 1.7 : 2.5; // px per frame
    let hits = 0, done = false, step = 0;
    const c = type === 'kill' ? 'var(--blood-bright)' : '#81c784';

    container.innerHTML = `<div class="qte-wrapper">
      <div class="qte-title" style="color:${c}">🔓 LOCKPICK</div>
      <div class="qte-sub">Click when the bar is in the green zone!</div>
      <div id="lpArea" style="position:relative;height:30px;border:1px solid rgba(201,168,76,.2);border-radius:4px;overflow:hidden;cursor:pointer;background:rgba(0,0,0,.3)"></div>
      <div class="muted qte-counter" id="lpCount">0/${steps}</div>
    </div>`;

    function doStep() {
      if (done || step >= steps) { finish(); return; }
      step++;
      const area = document.getElementById('lpArea');
      const sweetStart = 20 + Math.random() * (60 - sweetSize);
      area.innerHTML = `<div style="position:absolute;left:${sweetStart}%;width:${sweetSize}%;height:100%;background:rgba(100,200,100,.2);border-left:2px solid rgba(100,200,100,.5);border-right:2px solid rgba(100,200,100,.5)"></div>
        <div id="lpBar" style="position:absolute;left:0;width:4px;height:100%;background:var(--gold);transition:none"></div>`;
      const bar = document.getElementById('lpBar');
      let pos = 0, dir = 1, animId, clicked = false;
      function animate() {
        pos += speed * dir;
        if (pos >= 96) dir = -1;
        if (pos <= 0) dir = 1;
        bar.style.left = pos + '%';
        if (!clicked && !done) animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);
      area.onclick = () => {
        if (clicked) return;
        clicked = true;
        cancelAnimationFrame(animId);
        if (pos >= sweetStart && pos <= sweetStart + sweetSize) {
          hits++;
          bar.style.background = '#4caf50';
        } else {
          bar.style.background = '#e53935';
        }
        document.getElementById('lpCount').textContent = `${hits}/${steps}`;
        setTimeout(doStep, 500);
      };
    }
    function finish() { if (done) return; done = true; showResult(container, hits / steps, type, resolve); }
    doStep();
  });
}

// ═════════════════════════════════════════════════════════════
// TYPE 12: MEMORY MATCH — flip and match emoji pairs
// ═════════════════════════════════════════════════════════════
function runMemoryMatchQTE(container, difficulty, type) {
  return new Promise(resolve => {
    const lv = difficulty.level || difficulty;
    const pairCount = lv <= 1 ? 3 : lv <= 3 ? 4 : 5;
    const showTime = lv <= 1 ? 3500 : lv <= 3 ? 2500 : 1800;
    const maxTime = lv <= 1 ? 15000 : lv <= 3 ? 12000 : 9000;
    const emojis = ['🗡', '🔪', '💊', '🔦', '🕯', '🗝', '📿', '🩸', '☠', '🎭'];
    const chosen = emojis.sort(() => Math.random() - 0.5).slice(0, pairCount);
    const cards = [...chosen, ...chosen].sort(() => Math.random() - 0.5);
    let matched = 0, flipped = [], locked = false, done = false;
    const c = type === 'kill' ? 'var(--blood-bright)' : '#81c784';

    container.innerHTML = `<div class="qte-wrapper">
      <div class="qte-title" style="color:${c}">🃏 MEMORY MATCH</div>
      <div class="qte-sub">Memorize the cards, then match the pairs!</div>
      <div id="mmGrid" style="display:grid;grid-template-columns:repeat(${Math.min(pairCount, 4)},1fr);gap:6px;padding:8px"></div>
      <div class="muted qte-counter" id="mmCount">0/${pairCount}</div>
    </div>`;

    const grid = document.getElementById('mmGrid');
    // Show cards face-up first
    cards.forEach((emoji, i) => {
      const card = document.createElement('div');
      card.className = 'mm-card';
      card.dataset.idx = i;
      card.dataset.emoji = emoji;
      card.textContent = emoji;
      card.style.cssText = 'min-height:40px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;border:1px solid rgba(201,168,76,.2);border-radius:4px;cursor:pointer;background:rgba(0,0,0,.3);transition:all .3s';
      grid.appendChild(card);
    });

    // Hide after preview
    setTimeout(() => {
      grid.querySelectorAll('.mm-card').forEach(c => { c.textContent = '❓'; c.style.background = 'rgba(201,168,76,.05)'; });
      // Start timer
      const timeout = setTimeout(() => { if (!done) { done = true; showResult(container, matched / pairCount, type, resolve); } }, maxTime);

      grid.onclick = (e) => {
        const card = e.target.closest('.mm-card');
        if (!card || locked || done || card.classList.contains('matched') || flipped.includes(card)) return;
        card.textContent = card.dataset.emoji;
        card.style.background = 'rgba(201,168,76,.1)';
        flipped.push(card);

        if (flipped.length === 2) {
          locked = true;
          if (flipped[0].dataset.emoji === flipped[1].dataset.emoji) {
            matched++;
            flipped.forEach(c => { c.classList.add('matched'); c.style.borderColor = 'rgba(100,200,100,.5)'; });
            document.getElementById('mmCount').textContent = `${matched}/${pairCount}`;
            flipped = [];
            locked = false;
            if (matched >= pairCount) { clearTimeout(timeout); done = true; showResult(container, 1, type, resolve); }
          } else {
            setTimeout(() => {
              flipped.forEach(c => { c.textContent = '❓'; c.style.background = 'rgba(201,168,76,.05)'; });
              flipped = [];
              locked = false;
            }, 600);
          }
        }
      };
    }, showTime);
  });
}

// ═════════════════════════════════════════════════════════════
// RESULT DISPLAY
// ═════════════════════════════════════════════════════════════
function showResult(container, score, type, resolve) {
  const pct = Math.round(score * 100);
  const passed = score >= 0.5;
  const color = passed ? (type === 'kill' ? 'var(--blood-bright)' : type === 'verify' ? 'var(--gold)' : '#81c784') : 'var(--pale-dim)';
  let text;
  if (type === 'kill') text = score >= 1 ? '☠ CLEAN KILL' : score >= 0.7 ? '🗡 MESSY' : score >= 0.5 ? '💀 SLOPPY' : '💨 BOTCHED';
  else if (type === 'verify') text = score >= 0.7 ? '🔬 THOROUGH ANALYSIS' : score >= 0.4 ? '🔬 PARTIAL ANALYSIS' : '🔬 INCONCLUSIVE';
  else text = score >= 0.7 ? '🔍 CLEAR FINDINGS' : score >= 0.4 ? '🔎 PARTIAL' : '❌ UNRELIABLE';

  container.innerHTML = `<div class="qte-wrapper"><div class="qte-result" style="color:${color}">${text}</div><div class="qte-score">${pct}% performance</div></div>`;
  if (passed && type === 'kill') audio.play('kill'); else if (passed) audio.play('good'); else audio.tone(150,'sawtooth',0.4,0.15);
  setTimeout(() => resolve(score), 1800);
}
