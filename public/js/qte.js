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
// Evidence drops but we DON'T know if it's true or false
// False chance is baked in silently (only host knows the truth)
export function generateKillClue(killerCharacter, score, killCount, allCharacters = null, killerId = null) {
  // Perfect kill + lucky: no evidence at all
  if (score >= 1.0 && Math.random() > 0.3) {
    return { strength: 'none', text: null, isFalse: false };
  }

  // Determine if this evidence is secretly FALSE
  // Worse QTE = higher false evidence chance: perfect=10%, good=20%, med=35%, bad=55%
  const falseChance = score >= 1.0 ? 0.10 : score >= 0.7 ? 0.20 : score >= 0.4 ? 0.35 : 0.55;
  const isFalse = Math.random() < falseChance && allCharacters;

  // Strong evidence (high score but not perfect)
  if (score >= 0.7) {
    let clue;
    if (isFalse && allCharacters) clue = getFalsePublicTraitClue(allCharacters, killerId);
    else clue = getPublicTraitClue(killerCharacter);
    return { strength: 'medium', text: `Witnesses reported seeing ${clue} near the scene.`, isFalse: !!isFalse };
  }

  // Medium evidence
  if (score >= 0.4) {
    if (isFalse && allCharacters) {
      const fc = getFalsePublicTraitClue(allCharacters, killerId);
      return { strength: 'medium', text: `A witness claims they saw ${fc} fleeing the area.`, isFalse: true };
    }
    const vague = [
      'The killer left scratches on the door frame during a struggle.',
      'Droplets of something dark found trailing from the scene.',
      'A torn piece of fabric was found clutched by the victim.',
      'Faint footprints suggest someone fled hastily.',
      'The window was left ajar — the killer may have entered from outside.',
    ];
    return { strength: 'medium', text: vague[Math.floor(Math.random() * vague.length)], isFalse: false };
  }

  // Bad QTE = strong chance of false evidence
  if (isFalse && allCharacters) {
    const fc = getFalsePublicTraitClue(allCharacters, killerId);
    return { strength: 'weak', text: `Unconfirmed reports suggest ${fc} was near the crime scene.`, isFalse: true };
  }
  const hidden = getHiddenTraitClue(killerCharacter);
  return { strength: 'strong', text: `Crime scene evidence: ${hidden}.`, isFalse: false };
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

// ── VERIFICATION RESULT ──────────────────────────────────────
// Detective verifies a piece of evidence. QTE score determines how
// accurately the detective can assess the evidence.
export function computeVerification(score, evidenceIsFalse) {
  // score = 0.0 to 1.0 from QTE
  // Returns { accuracyPct, verdictText, detectedFalse }
  let min, max;
  if (score >= 0.9)      { min = 80; max = 100; }
  else if (score >= 0.7) { min = 60; max = 85; }
  else if (score >= 0.4) { min = 30; max = 60; }
  else                   { min = 5;  max = 30; }
  const accuracyPct = Math.round(min + Math.random() * (max - min));

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

  return { accuracyPct, verdictText, detectedFalse };
}

// ── QTE TYPE SELECTION (6 types) ─────────────────────────────
const QTE_TYPES = ['keys', 'circles', 'pattern', 'rapid', 'color', 'reaction'];
function pickQTEType() { return QTE_TYPES[Math.floor(Math.random() * QTE_TYPES.length)]; }

export function runQTE(container, difficulty, type = 'kill') {
  const qt = pickQTEType();
  switch (qt) {
    case 'circles':  return runCircleHuntQTE(container, difficulty, type);
    case 'pattern':  return runPatternMemoryQTE(container, difficulty, type);
    case 'rapid':    return runRapidTapQTE(container, difficulty, type);
    case 'color':    return runColorMatchQTE(container, difficulty, type);
    case 'reaction': return runReactionTimeQTE(container, difficulty, type);
    default:         return runKeySequenceQTE(container, difficulty, type);
  }
}

// ═════════════════════════════════════════════════════════════
// TYPE 1: KEY SEQUENCE
// ═════════════════════════════════════════════════════════════
const QTE_KEYS = ['W','A','S','D'];
const QTE_ARROWS = { W:'↑', A:'←', S:'↓', D:'→' };
const QTE_MOBILE = ['↑','←','↓','→'];
const QTE_MMAP = { '↑':'W','←':'A','↓':'S','→':'D' };
function getKeyParams(lv){if(lv<=1)return{keys:3,timePerKey:1100};if(lv===2)return{keys:4,timePerKey:900};if(lv===3)return{keys:5,timePerKey:700};return{keys:6,timePerKey:550};}

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
function getCircleParams(lv){if(lv<=1)return{rounds:8,spawnTime:1400,redChance:.3,maxActive:4};if(lv===2)return{rounds:12,spawnTime:1000,redChance:.35,maxActive:5};if(lv===3)return{rounds:16,spawnTime:750,redChance:.4,maxActive:6};return{rounds:20,spawnTime:550,redChance:.45,maxActive:8};}

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
function getPatternParams(lv){if(lv<=1)return{length:4,showTime:2000,symbols:5};if(lv===2)return{length:5,showTime:1500,symbols:6};if(lv===3)return{length:6,showTime:1200,symbols:7};return{length:8,showTime:900,symbols:8};}

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
function getRapidParams(lv){if(lv<=1)return{target:12,timeLimit:3500};if(lv===2)return{target:18,timeLimit:3000};if(lv===3)return{target:25,timeLimit:2500};return{target:35,timeLimit:2200};}

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
function getColorParams(lv){if(lv<=1)return{rounds:4,showTime:1200,colors:4};if(lv===2)return{rounds:6,showTime:900,colors:5};if(lv===3)return{rounds:8,showTime:700,colors:5};return{rounds:10,showTime:500,colors:6};}

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
function getReactionParams(lv){if(lv<=1)return{rounds:3,threshold:600};if(lv===2)return{rounds:4,threshold:450};if(lv===3)return{rounds:5,threshold:350};return{rounds:6,threshold:280};}

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
