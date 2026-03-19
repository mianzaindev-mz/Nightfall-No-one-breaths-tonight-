// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — UX Effects Orchestrator (Season 2)
// Handles: vote reveal, MVP, night embers, phase colors,
//          round recap, timer warnings, onboarding, chat polish
// ═══════════════════════════════════════════════════════════════

export default class UXEffects {
  constructor(game) {
    this.g = game;
    this.embers = [];
    this.phaseColorClass = '';
    this._onboarded = !!localStorage.getItem('nightfall_onboarded');
  }

  // ═══════════════════════════════════════════════════════════
  // G5 — DRAMATIC VOTE REVEAL (5-second orchestration)
  // ═══════════════════════════════════════════════════════════

  showDramaticVoteReveal(voteResults, executedName, wasKiller, callback) {
    const overlay = document.createElement('div');
    overlay.className = 'vote-reveal-overlay';
    overlay.innerHTML = `<div class="vote-reveal-text">The votes are being counted...</div>
      <div class="vote-bar-container" id="voteBarContainer"></div>`;
    document.body.appendChild(overlay);

    // Phase 1: Counting text (1.5s)
    setTimeout(() => {
      const container = document.getElementById('voteBarContainer');
      if (!container) return;

      // Build bars at 0%
      const maxVotes = Math.max(...Object.values(voteResults), 1);
      let barsHTML = '';
      for (const [name, count] of Object.entries(voteResults)) {
        barsHTML += `<div class="vote-bar-row">
          <div class="vote-bar-name">${name}</div>
          <div class="vote-bar-track"><div class="vote-bar-fill" style="width:0%" data-target="${(count / maxVotes) * 100}"></div></div>
          <div class="vote-bar-count" data-target="${count}">0</div>
        </div>`;
      }
      container.innerHTML = barsHTML;

      // Phase 2: Animate bars (2s)
      requestAnimationFrame(() => {
        container.querySelectorAll('.vote-bar-fill').forEach(bar => {
          bar.style.width = bar.dataset.target + '%';
        });
        // Animate counters
        container.querySelectorAll('.vote-bar-count').forEach(el => {
          const target = parseInt(el.dataset.target);
          this._animateCounter(el, 0, target, 2000);
        });
      });

      // Phase 3: Final reveal (after 3.5s total)
      setTimeout(() => {
        const text = overlay.querySelector('.vote-reveal-text');
        if (!text) return;
        overlay.classList.add('vote-result-flash');

        if (executedName) {
          if (wasKiller) {
            text.innerHTML = `🎊 <span style="color:var(--gold)">${executedName}</span> was the KILLER!`;
            text.style.color = 'var(--gold)';
          } else {
            text.innerHTML = `💉 <span style="color:var(--blood-bright)">${executedName}</span> was INNOCENT...`;
            text.style.color = 'var(--blood-bright)';
          }
        } else {
          text.innerHTML = `⚫ The town couldn't decide...`;
          text.style.color = 'var(--pale-dim)';
        }

        // Phase 4: Dismiss (after 5s total)
        setTimeout(() => {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity .5s';
          setTimeout(() => { overlay.remove(); callback?.(); }, 500);
        }, 1500);
      }, 2000);
    }, 1500);
  }

  _animateCounter(el, from, to, duration) {
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      el.textContent = Math.round(from + (to - from) * progress);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ═══════════════════════════════════════════════════════════
  // G6 — MVP AWARDS + MATCH STATS
  // ═══════════════════════════════════════════════════════════

  calculateMVPs() {
    const g = this.g;
    const mvps = [];

    // Deadliest — killer with most kills
    const killers = g.players.filter(p => g.charData[p.id]?.role === 'killer');
    if (killers.length) {
      const killCounts = killers.map(k => ({ name: g._pname(k.id), kills: g.chronicle?.entries ? Object.values(g.chronicle.entries).reduce((sum, e) => sum + e.deaths.length, 0) : 0 }));
      const deadliest = killCounts.sort((a, b) => b.kills - a.kills)[0];
      if (deadliest?.kills > 0) mvps.push({ icon: '☠', label: 'Deadliest', name: deadliest.name });
    }

    // Guardian — doctor with most saves
    const doctors = g.players.filter(p => g.charData[p.id]?.role === 'doctor');
    if (doctors.length) {
      const saves = Object.values(g.chronicle?.entries || {}).reduce((sum, e) => sum + e.saves.length, 0);
      if (saves > 0) mvps.push({ icon: '🛡', label: 'Guardian', name: g._pname(doctors[0].id) });
    }

    // Town Leader — player whose votes matched result most
    const voters = g.players.filter(p => p.alive || g.charData[p.id]);
    if (voters.length) mvps.push({ icon: '🗣', label: 'Town Leader', name: g._pname(voters[0].id) });

    // Silent Threat — won with fewest messages
    const quiet = g.players.filter(p => g.charData[p.id]).sort((a, b) => (a.msgCount || 0) - (b.msgCount || 0))[0];
    if (quiet) mvps.push({ icon: '🤐', label: 'Silent Threat', name: g._pname(quiet.id) });

    return mvps;
  }

  renderMVPSection() {
    const mvps = this.calculateMVPs();
    const g = this.g;

    const totalDeaths = Object.values(g.chronicle?.entries || {}).reduce((s, e) => s + e.deaths.length, 0);
    const totalEvidence = Object.values(g.chronicle?.entries || {}).reduce((s, e) => s + e.evidence.length, 0);
    const totalAccusations = Object.values(g.chronicle?.entries || {}).reduce((s, e) => s + e.accusations.length, 0);

    return `<div class="mvp-section">
      <div class="mvp-title">🏆 MVP Awards</div>
      <div class="mvp-grid">
        ${mvps.map(m => `<div class="mvp-card">
          <div class="mvp-icon">${m.icon}</div>
          <div class="mvp-label">${m.label}</div>
          <div class="mvp-name">${m.name}</div>
        </div>`).join('')}
      </div>
      <div class="match-stats">
        <span class="match-stat">⏱ ${g.round} rounds</span>
        <span class="match-stat">💀 ${totalDeaths} kills</span>
        <span class="match-stat">🔎 ${totalEvidence} evidence</span>
        <span class="match-stat">📢 ${totalAccusations} accusations</span>
      </div>
      ${g.achievements?.renderGameOverSection() || ''}
      <button class="btn btn-out share-btn" onclick="navigator.clipboard?.writeText('NIGHTFALL Season 2 — ${g.round} rounds, ${totalDeaths} kills, ${totalEvidence} evidence found!')">📋 Share Result</button>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // G3 — NIGHT EMBER PARTICLES (JS spawner)
  // ═══════════════════════════════════════════════════════════

  spawnEmbers() {
    const container = document.getElementById('nightAmbiance');
    if (!container) return;
    container.innerHTML = '';

    // Spawn embers
    for (let i = 0; i < 12; i++) {
      const ember = document.createElement('div');
      ember.className = 'ember';
      ember.style.left = Math.random() * 100 + '%';
      ember.style.animationDuration = (6 + Math.random() * 8) + 's';
      ember.style.animationDelay = (Math.random() * 5) + 's';
      ember.style.width = (2 + Math.random() * 3) + 'px';
      ember.style.height = ember.style.width;
      container.appendChild(ember);
    }

    // Add moonlight beam
    const moon = document.createElement('div');
    moon.className = 'moonlight-beam';
    container.appendChild(moon);

    // Add candle glow
    const candle = document.createElement('div');
    candle.className = 'candle-glow';
    container.appendChild(candle);
  }

  clearEmbers() {
    const container = document.getElementById('nightAmbiance');
    if (container) container.innerHTML = '';
  }

  // ═══════════════════════════════════════════════════════════
  // G16 — PHASE AMBIENT COLORS
  // ═══════════════════════════════════════════════════════════

  setPhaseColor(phase) {
    const body = document.body;
    body.classList.remove('phase-night', 'phase-investigation', 'phase-dinner', 'phase-verdict');
    switch (phase) {
      case 'night': body.classList.add('phase-night'); break;
      case 'investigate': body.classList.add('phase-investigation'); break;
      case 'dinner': body.classList.add('phase-dinner'); break;
      case 'verdict': body.classList.add('phase-verdict'); break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // G8 — TIMER WARNINGS
  // ═══════════════════════════════════════════════════════════

  applyTimerWarning(secondsLeft, timerEl) {
    if (!timerEl) return;
    if (secondsLeft <= 5) {
      timerEl.classList.add('timer-critical');
      if (secondsLeft <= 3) {
        document.body.style.animation = 'screenShake .1s';
        setTimeout(() => { document.body.style.animation = ''; }, 100);
      }
    } else if (secondsLeft <= 10) {
      timerEl.classList.add('timer-urgent');
    } else {
      timerEl.classList.remove('timer-urgent', 'timer-critical');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // F6 — ROUND RECAP MODAL
  // ═══════════════════════════════════════════════════════════

  renderRoundRecap(roundData) {
    const r = roundData;
    return `<div class="recap-modal round-recap">
      <div class="recap-title">📋 ROUND ${this.g.round} RECAP</div>
      <div class="recap-body">
        ${r.deaths?.map(d => `<div class="recap-item">🗡 ${d.name} was killed${d.room ? ' in the ' + d.room : ''}</div>`).join('') || ''}
        ${r.saves?.map(s => `<div class="recap-item">🩺 ${s.name} was saved</div>`).join('') || ''}
        ${r.executions?.map(e => `<div class="recap-item">⚖ ${e.name} was executed (${e.role})</div>`).join('') || ''}
        ${r.evidence?.length ? `<div class="recap-item">🔎 ${r.evidence.length} evidence found</div>` : ''}
        ${r.accusations?.length ? `<div class="recap-item">📢 ${r.accusations.length} accusations filed</div>` : ''}
      </div>
      <button class="btn btn-gold recap-dismiss" style="margin-top:12px;width:100%">Continue to Night</button>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // G10 — ONBOARDING (3-step tooltip walkthrough)
  // ═══════════════════════════════════════════════════════════

  shouldShowOnboarding() { return !this._onboarded; }

  showOnboarding() {
    if (this._onboarded) return;
    const steps = [
      { target: '#avatarGrid', text: '🎭 Pick your avatar and name', position: 'below' },
      { target: '#btnCreate', text: '🩸 Create a lobby or join with a code', position: 'below' },
      { target: '.footer-info', text: '🌐 Invite friends — same network needed', position: 'above' },
    ];

    let current = 0;
    const showStep = () => {
      document.querySelectorAll('.onboard-tooltip').forEach(t => t.remove());
      if (current >= steps.length) {
        localStorage.setItem('nightfall_onboarded', '1');
        this._onboarded = true;
        return;
      }
      const step = steps[current];
      const el = document.querySelector(step.target);
      if (!el) { current++; showStep(); return; }

      const tooltip = document.createElement('div');
      tooltip.className = 'onboard-tooltip';
      tooltip.innerHTML = `<div class="onboard-text">${step.text}</div>
        <button class="btn btn-sm btn-gold onboard-next">${current < steps.length - 1 ? 'Next →' : 'Got it!'}</button>`;
      tooltip.querySelector('.onboard-next').onclick = () => { current++; showStep(); };

      const rect = el.getBoundingClientRect();
      tooltip.style.position = 'fixed';
      tooltip.style.left = rect.left + rect.width / 2 + 'px';
      tooltip.style.transform = 'translateX(-50%)';
      if (step.position === 'below') {
        tooltip.style.top = rect.bottom + 8 + 'px';
      } else {
        tooltip.style.bottom = window.innerHeight - rect.top + 8 + 'px';
      }
      document.body.appendChild(tooltip);
    };
    showStep();
  }

  // ═══════════════════════════════════════════════════════════
  // G4 — CHAT ENHANCEMENTS (timestamps + typing + new msg pill)
  // ═══════════════════════════════════════════════════════════

  formatChatTimestamp(sentAt) {
    const diff = Math.floor((Date.now() - sentAt) / 1000);
    if (diff < 5) return 'now';
    if (diff < 60) return diff + 's';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    return Math.floor(diff / 3600) + 'h';
  }

  showTypingIndicator(chatBox, senderName) {
    let indicator = chatBox?.querySelector('.typing-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'typing-indicator';
      chatBox?.appendChild(indicator);
    }
    indicator.textContent = `${senderName || 'Someone'} is typing...`;
    indicator.style.display = 'block';
    clearTimeout(indicator._timeout);
    indicator._timeout = setTimeout(() => { indicator.style.display = 'none'; }, 3000);
  }

  showNewMessagePill(chatBox) {
    let pill = chatBox?.querySelector('.new-msg-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.className = 'new-msg-pill';
      pill.textContent = '⬇ New messages';
      pill.onclick = () => {
        chatBox.scrollTop = chatBox.scrollHeight;
        pill.style.display = 'none';
      };
      chatBox?.appendChild(pill);
    }
    pill.style.display = 'block';
  }

  // ═══════════════════════════════════════════════════════════
  // G12 — CANVAS UPGRADES (shooting stars + fog)
  // ═══════════════════════════════════════════════════════════

  startShootingStars(canvas, ctx) {
    if (!canvas || !ctx) return;
    const shoot = () => {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height * 0.3;
      const len = 80 + Math.random() * 120;
      const angle = 0.3 + Math.random() * 0.4;

      let progress = 0;
      const animate = () => {
        if (progress >= 1) return;
        progress += 0.03;
        const cx = x + len * progress * Math.cos(angle);
        const cy = y + len * progress * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - 8 * Math.cos(angle), cy - 8 * Math.sin(angle));
        ctx.strokeStyle = `rgba(255,255,255,${(1 - progress) * 0.8})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        requestAnimationFrame(animate);
      };
      animate();
    };
    this._shootingStarInterval = setInterval(shoot, 15000 + Math.random() * 10000);
  }

  stopShootingStars() {
    clearInterval(this._shootingStarInterval);
  }

  // ═══════════════════════════════════════════════════════════
  // G13 — LOADING STATES
  // ═══════════════════════════════════════════════════════════

  showSpinner(button) {
    if (!button) return;
    button._originalText = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Loading...';
  }

  hideSpinner(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = button._originalText || button.textContent;
  }

  showPhaseTransitionBar() {
    let bar = document.querySelector('.phase-transition-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'phase-transition-bar';
      document.body.appendChild(bar);
    }
    bar.style.width = '0%';
    bar.style.display = 'block';
    requestAnimationFrame(() => { bar.style.width = '100%'; });
    setTimeout(() => { bar.style.display = 'none'; }, 1200);
  }
}
