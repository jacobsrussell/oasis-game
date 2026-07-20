(() => {
  let user = null;
  let ws = null;
  let currentRoom = null;
  let currentGame = null;

  const api = async (url, opts = {}) => {
    const headers = { ...opts.headers };
    if (user) headers['x-user-id'] = user.id;
    if (!(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; }
    const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
    return res.json();
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showToast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    setTimeout(() => t.className = 'toast hidden', 4000);
  }

  // ===================== INIT =====================
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      $('#preloader').classList.add('hidden');
      const saved = localStorage.getItem('oasis_user');
      if (saved) {
        user = JSON.parse(saved);
        api('/api/me').then(d => {
          if (d.user) { user = d.user; localStorage.setItem('oasis_user', JSON.stringify(user)); showApp(); }
          else { localStorage.removeItem('oasis_user'); showAuth(); }
        }).catch(() => showAuth());
      } else {
        showAuth();
      }
    }, 2200);

    setupAuth();
    setupNav();
    setupWallet();
    setupChallenges();
  });

  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#app-screen').classList.add('hidden');
  }

  function showApp() {
    $('#auth-screen').classList.add('hidden');
    $('#app-screen').classList.remove('hidden');
    updateUserUI();
    connectWS();
    loadGames();
    loadOnlinePlayers();
    navigate('lobby');
  }

  // ===================== AUTH =====================
  function setupAuth() {
    $('#show-register').addEventListener('click', e => { e.preventDefault(); $('#login-form').classList.add('hidden'); $('#register-form').classList.remove('hidden'); });
    $('#show-login').addEventListener('click', e => { e.preventDefault(); $('#register-form').classList.add('hidden'); $('#login-form').classList.remove('hidden'); });

    $('#login-btn').addEventListener('click', async () => {
      const email = $('#login-email').value.trim();
      const password = $('#login-password').value;
      if (!email || !password) return showToast('Fill in all fields', 'error');
      const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (d.error) return showToast(d.error, 'error');
      user = d.user;
      localStorage.setItem('oasis_user', JSON.stringify(user));
      showApp();
    });

    $('#register-btn').addEventListener('click', async () => {
      const fullName = $('#reg-name').value.trim();
      const username = $('#reg-username').value.trim();
      const email = $('#reg-email').value.trim();
      const phone = $('#reg-phone').value.trim();
      const password = $('#reg-password').value;
      const terms = $('#reg-terms').checked;
      if (!fullName || !username || !email || !password) return showToast('Fill in all required fields', 'error');
      if (!terms) return showToast('You must agree to the Terms & Conditions', 'error');
      const d = await api('/api/register', { method: 'POST', body: JSON.stringify({ fullName, username, email, phone, password }) });
      if (d.error) return showToast(d.error, 'error');
      user = d.user;
      localStorage.setItem('oasis_user', JSON.stringify(user));
      showApp();
    });

    $('#logout-btn').addEventListener('click', () => {
      user = null;
      localStorage.removeItem('oasis_user');
      if (ws) ws.close();
      showAuth();
    });
  }

  // ===================== NAV =====================
  function setupNav() {
    $$('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        navigate(link.dataset.section);
        $('#sidebar').classList.remove('open');
      });
    });
    $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  }

  function navigate(section) {
    $$('.section').forEach(s => s.classList.remove('active'));
    $$('.nav-link').forEach(l => l.classList.remove('active'));
    const el = $(`#section-${section}`);
    if (el) el.classList.add('active');
    const nav = $(`.nav-link[data-section="${section}"]`);
    if (nav) nav.classList.add('active');

    if (section === 'wallet') loadWallet();
    if (section === 'challenges') loadChallenges();
    if (section === 'matches') loadMatches();
    if (section === 'leaderboard') loadLeaderboard();
    if (section === 'profile') loadProfile();
    if (section === 'admin') loadAdmin();
  }

  // ===================== WEBSOCKET =====================
  function connectWS() {
    if (ws) ws.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', userId: user.id }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleWSMessage(msg);
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'online_count':
        $('#online-count').textContent = `${msg.count} player${msg.count !== 1 ? 's' : ''} online`;
        if ($('#online-badge')) $('#online-badge').textContent = `● ${msg.count}`;
        break;

      case 'challenge_received':
        showToast(`⚔️ ${msg.challenge.challengerName} challenged you to ${msg.challenge.gameName} for R${msg.challenge.amount}!`, 'success');
        loadChallenges();
        break;

      case 'challenge_accepted':
        showToast(`✅ Challenge accepted! Room: ${msg.roomId.slice(0, 8)}`, 'success');
        currentRoom = msg.roomId;
        currentGame = msg.game;
        startGame(msg.game, msg.roomId, msg.pot, msg.opponent);
        break;

      case 'challenge_declined':
        showToast('Challenge declined', 'error');
        loadChallenges();
        break;

      case 'match_found':
        if (msg.freePlay) {
          showToast(`🎮 Free Play vs ${msg.opponent}! No money at stake.`, 'success');
        } else {
          showToast(`⚡ Match found! vs ${msg.opponent} for R${msg.pot}`, 'success');
        }
        currentRoom = msg.roomId;
        currentGame = msg.game;
        startGame(msg.game, msg.roomId, msg.pot, msg.opponent);
        break;

      case 'opponent_scored': showToast('Opponent finished! Waiting...', ''); break;

      case 'match_over':
        if (msg.freePlay) {
          if (msg.won === true) showToast(`🏆 You beat the Bot! Nice win!`, 'success');
          else if (msg.won === false) showToast(`💀 Bot wins this round! Try again!`, 'error');
          else showToast(`🤝 Draw! Well played!`, '');
        } else {
          if (msg.won === true) showToast(`🏆 You won R${msg.amount}!`, 'success');
          else if (msg.won === false) showToast(`💔 You lost. Better luck next time!`, 'error');
          else showToast(`🤝 Draw! R${msg.amount} refunded.`, '');
        }
        currentRoom = null;
        setTimeout(() => { navigate('lobby'); loadWallet(); }, 2000);
        break;

      case 'deposit_approved': showToast(`💰 Deposit of R${msg.amount} approved!`, 'success'); loadWallet(); break;
      case 'withdrawal_approved': showToast(`✅ Withdrawal of R${msg.amount} approved!`, 'success'); loadWallet(); break;

      case 'chat': break;
    }
  }

  // ===================== GAMES =====================
  const GAMES = [];
  async function loadGames() {
    const d = await api('/api/games');
    GAMES.length = 0;
    GAMES.push(...d.games);
    renderGames();
  }

  function renderGames() {
    const grid = $('#games-grid');
    grid.innerHTML = GAMES.map(g => `
      <div class="game-card" data-game="${g.id}">
        <div class="gc-icon">${g.icon}</div>
        <div class="gc-name">${g.name}</div>
        <div class="gc-desc">${g.desc}</div>
        <div class="gc-meta">
          <span class="gc-bet">R${g.minBet} - R${g.maxBet.toLocaleString()}</span>
          <span>${g.players} players</span>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="gc-play" onclick="window.oasisFreePlay('${g.id}')">🎮 FREE PLAY</button>
          <button class="gc-play" onclick="window.oasisPlay('${g.id}')" style="background:var(--accent);color:#000">💰 BET & PLAY</button>
        </div>
      </div>
    `).join('');
  }

  window.oasisFreePlay = async (gameId) => {
    const d = await api('/api/freeplay', { method: 'POST', body: JSON.stringify({ gameId }) });
    if (d.error) return showToast(d.error, 'error');
    window._freePlayMode = true;
  };

  window.oasisPlay = (gameId) => {
    const game = GAMES.find(g => g.id === gameId);
    if (!game) return;
    showPlayModal(game);
  };

  function showPlayModal(game) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h2>${game.icon} ${game.name}</h2>
        <p style="color:var(--text2);margin-bottom:1.5rem">${game.desc}</p>
        <div class="form-group">
          <label>Bet Amount (R${game.minBet} - R${game.maxBet.toLocaleString()})</label>
          <input type="number" id="modal-bet" min="${game.minBet}" max="${game.maxBet}" value="${game.minBet}" placeholder="Enter amount">
        </div>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">Your balance: R${user.balance.toFixed(2)}</p>
        <button class="btn-primary" onclick="window.oasisQuickMatch('${game.id}')">⚡ Quick Match</button>
        <p style="text-align:center;color:var(--text-muted);margin:0.8rem 0">— or challenge a specific player —</p>
        <div class="form-group">
          <label>Challenge Username</label>
          <input type="text" id="modal-challenge-user" placeholder="Enter opponent's username">
        </div>
        <button class="btn-secondary" onclick="window.oasisSendChallenge('${game.id}')">Send Challenge</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  window.oasisQuickMatch = async (gameId) => {
    const amount = parseFloat($('#modal-bet').value);
    if (!amount) return showToast('Enter a bet amount', 'error');
    const d = await api('/api/quickmatch', { method: 'POST', body: JSON.stringify({ gameId, amount }) });
    if (d.error) return showToast(d.error, 'error');
    document.querySelector('.modal-overlay')?.remove();
    if (d.matched) {
      showToast(`Match found! vs ${d.opponent}`, 'success');
    } else {
      showToast('Searching for opponent...', '');
      navigate('lobby');
    }
    loadWallet();
  };

  window.oasisSendChallenge = async (gameId) => {
    const amount = parseFloat($('#modal-bet').value);
    const targetUsername = $('#modal-challenge-user')?.value?.trim();
    if (!targetUsername) return showToast('Enter opponent username', 'error');
    if (!amount) return showToast('Enter a bet amount', 'error');
    const d = await api('/api/challenge', { method: 'POST', body: JSON.stringify({ targetUsername, gameId, amount }) });
    if (d.error) return showToast(d.error, 'error');
    document.querySelector('.modal-overlay')?.remove();
    showToast('Challenge sent!', 'success');
    loadWallet();
  };

  // ===================== GAME ARENA =====================
  let gameCleanup = null;
  function startGame(gameId, roomId, pot, opponent) {
    navigate('game');
    if (gameCleanup) { gameCleanup(); gameCleanup = null; }
    if (window.tetrisInterval) { clearInterval(window.tetrisInterval); window.tetrisInterval = null; }
    const arena = $('#game-arena');
    const isFreePlay = window._freePlayMode;
    const g = GAMES.find(g => g.id === gameId);
    arena.innerHTML = `
      <div style="width:100%;max-width:600px;margin:0 auto">
        <div class="game-header">
          <h2>${g?.icon || '🎮'} ${g?.name || gameId}</h2>
          <div class="pot">${isFreePlay ? '🎮 Free Play' : 'Pot: R' + pot}</div>
          <div class="opponent">vs ${opponent}</div>
        </div>
        <div id="game-area"></div>
      </div>
    `;
    window._freePlayMode = false;

    const gameArea = $('#game-area');
    const sendScore = (score) => {
      if (currentRoom) ws.send(JSON.stringify({ type: 'game_score', roomId: currentRoom, score }));
    };

    const games = {
      'pac-man': () => gamePacMan(gameArea, sendScore),
      'frogger': () => gameFrogger(gameArea, sendScore),
      'asteroids': () => gameAsteroids(gameArea, sendScore),
      'galaga': () => gameGalaga(gameArea, sendScore),
      'centipede': () => gameCentipede(gameArea, sendScore),
      'defender': () => gameDefender(gameArea, sendScore),
      'tetris': () => gameTetris(gameArea, sendScore),
      'arkanoid': () => gameArkanoid(gameArea, sendScore),
      'donkey-kong': () => gameDonkeyKong(gameArea, sendScore),
      'space-invaders': () => gameSpaceInvaders(gameArea, sendScore),
      'snake': () => gameSnake(gameArea, sendScore),
      'flappy-bird': () => gameFlappyBird(gameArea, sendScore),
      'qbert': () => gameQbert(gameArea, sendScore),
      'dig-dug': () => gameDigDug(gameArea, sendScore),
    };
    if (games[gameId]) gameCleanup = games[gameId]();
  }


  // ==================== 1. PAC-MAN ====================

  // ===================== RETRO AUDIO ENGINE =====================
  const SFX = {
    _ctx: null,
    _get() { if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)(); return this._ctx; },
    _osc(type, freq, dur, vol = 0.15) {
      try {
        const c = this._get(), o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
        o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
      } catch(e) {}
    },
    _noise(dur, vol = 0.1) {
      try {
        const c = this._get(), sz = c.sampleRate * dur, buf = c.createBuffer(1, sz, c.sampleRate);
        const d = buf.getChannelData(0); for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
        const s = c.createBufferSource(), g = c.createGain();
        s.buffer = buf; g.gain.setValueAtTime(vol, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
        s.connect(g); g.connect(c.destination); s.start();
      } catch(e) {}
    },
    chomp() { this._osc('sine', 400, 0.06); setTimeout(() => this._osc('sine', 300, 0.06), 60); },
    score() { this._osc('sine', 880, 0.08); setTimeout(() => this._osc('sine', 1100, 0.12), 70); },
    die() { for (let i = 0; i < 6; i++) setTimeout(() => this._osc('sawtooth', 400 - i * 50, 0.06, 0.2), i * 50); },
    hit() { this._noise(0.08, 0.2); this._osc('square', 150, 0.08, 0.2); },
    shoot() { this._osc('square', 880, 0.04, 0.12); this._osc('sawtooth', 600, 0.03, 0.08); },
    jump() { this._osc('sine', 250, 0.05); setTimeout(() => this._osc('sine', 500, 0.08), 40); },
    flap() { this._osc('sine', 350, 0.04, 0.1); setTimeout(() => this._osc('sine', 450, 0.03, 0.08), 30); },
    collect() { this._osc('sine', 660, 0.06); setTimeout(() => this._osc('sine', 880, 0.08), 50); },
    explode() { this._noise(0.25, 0.25); this._osc('sawtooth', 60, 0.3, 0.2); },
    powerup() { this._osc('sine', 440, 0.08); setTimeout(() => this._osc('sine', 660, 0.08), 80); setTimeout(() => this._osc('sine', 880, 0.12), 160); },
    win() { [523,659,784,1047].forEach((f,i) => setTimeout(() => this._osc('sine', f, 0.15), i * 100)); },
    bounce() { this._osc('sine', 300, 0.04, 0.1); },
    dig() { this._noise(0.06, 0.12); },
    inflate() { this._osc('sine', 200, 0.1, 0.15); setTimeout(() => this._osc('sine', 250, 0.12, 0.15), 80); },
  };

  // ===================== PARTICLE SYSTEM =====================
  class Particles {
    constructor() { this.list = []; }
    add(x, y, count, opts = {}) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (opts.speed || 3) * (0.5 + Math.random());
        this.list.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: opts.life || 25 + Math.random() * 15, maxLife: opts.life || 40,
          size: opts.size || 2 + Math.random() * 3, color: opts.colors ? opts.colors[Math.floor(Math.random() * opts.colors.length)] : (opts.color || '#ffcc00'),
          gravity: opts.gravity || 0, shrink: opts.shrink !== false
        });
      }
    }
    update() {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.life--;
        if (p.shrink) p.size *= 0.96;
        if (p.life <= 0) this.list.splice(i, 1);
      }
    }
    draw(ctx) {
      for (const p of this.list) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 4;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    clear() { this.list = []; }
  }

  // ===================== SCREEN SHAKE =====================
  class Shake {
    constructor() { this.intensity = 0; this.decay = 0.9; }
    trigger(i = 6) { this.intensity = i; }
    apply(ctx, w, h) {
      if (this.intensity > 0.5) {
        const dx = (Math.random() - 0.5) * this.intensity;
        const dy = (Math.random() - 0.5) * this.intensity;
        ctx.translate(dx, dy);
        this.intensity *= this.decay;
      } else this.intensity = 0;
    }
  }

  // ===================== DRAW HELPERS =====================
  function drawGlow(ctx, x, y, r, color, alpha = 0.6) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.shadowColor = color; ctx.shadowBlur = r;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawStar(ctx, x, y, spikes, outerR, innerR, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (i * Math.PI) / spikes - Math.PI / 2;
      i === 0 ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath(); ctx.fill();
  }
  function drawText(ctx, text, x, y, size = 14, color = '#fff', align = 'left', stroke = true) {
    ctx.font = `bold ${size}px monospace`; ctx.textAlign = align;
    if (stroke) { ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(text, x, y); }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }


  // ==================== 1. PAC-MAN ====================
  function gamePacMan(area, sendScore) {
    const W = 400, H = 400, CS = 20;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS = W / CS, ROWS = H / CS;
    const maze = [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
      [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,0,1],
      [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,0,1],
      [1,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,1],
      [1,1,1,1,0,1,1,1,2,1,2,1,1,1,0,1,1,1,1],
      [2,2,2,1,0,1,0,0,0,0,0,0,0,1,0,1,2,2,2],
      [1,1,1,1,0,1,0,1,1,9,1,1,0,1,0,1,1,1,1],
      [0,0,0,0,0,0,0,1,9,9,9,1,0,0,0,0,0,0,0],
      [1,1,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,1,1],
      [2,2,2,1,0,1,0,0,0,0,0,0,0,1,0,1,2,2,2],
      [1,1,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,1,1],
      [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
      [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,0,1],
      [1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1],
      [1,1,0,1,0,1,0,1,1,1,1,1,0,1,0,1,0,1,1],
      [1,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,0,1],
      [1,0,1,1,1,1,1,1,0,1,0,1,1,1,1,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ];
    let dotMap = maze.map(r => r.map(c => c === 0 ? 1 : 0));
    let pac = { x: 9, y: 15, dir: 0, nextDir: 0, mouth: 0, mouthDir: 1 };
    const GHOST_COLORS = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];
    let ghosts = [
      { x: 9, y: 9, dir: 0, color: GHOST_COLORS[0], mode: 'chase' },
      { x: 8, y: 9, dir: 1, color: GHOST_COLORS[1], mode: 'chase' },
      { x: 10, y: 9, dir: 3, color: GHOST_COLORS[2], mode: 'chase' },
      { x: 9, y: 8, dir: 2, color: GHOST_COLORS[3], mode: 'scatter' },
    ];
    let score = 0, lives = 3, level = 1, over = false, frame = 0, scared = 0;
    let totalDots = 0;
    dotMap.forEach(r => r.forEach(c => { if (c) totalDots++; }));
    const DIR = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    const canMove = (x, y) => {
      if (x < 0 || x >= COLS) return y === 10;
      if (y < 0 || y >= ROWS) return false;
      return maze[y][x] !== 1;
    };
    const kH = (e) => {
      if (over) return;
      const m = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
      if (m[e.code] !== undefined) { pac.nextDir = m[e.code]; e.preventDefault(); }
    };
    document.addEventListener('keydown', kH);
    let touchSX = 0, touchSY = 0;
    cvs.addEventListener('touchstart', (e) => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; }, { passive: true });
    cvs.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
      if (Math.abs(dx) + Math.abs(dy) < 15) return;
      pac.nextDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    }, { passive: true });

    const loop = setInterval(() => {
      if (over) return; frame++;
      if (frame % 6 === 0) {
        const nx = pac.x + DIR[pac.nextDir].x, ny = pac.y + DIR[pac.nextDir].y;
        if (canMove(nx, ny)) pac.dir = pac.nextDir;
        const mx = pac.x + DIR[pac.dir].x, my = pac.y + DIR[pac.dir].y;
        if (canMove(mx, my)) { pac.x = mx; pac.y = my; }
        if (pac.x < 0) pac.x = COLS - 1; else if (pac.x >= COLS) pac.x = 0;
        if (dotMap[pac.y] && dotMap[pac.y][pac.x]) {
          dotMap[pac.y][pac.x] = 0; score += 10; totalDots--;
          SFX.chomp();
          if (totalDots <= 0) { SFX.win(); score += 1000; setTimeout(() => { over = true; clearInterval(loop); sendScore(score); }, 500); return; }
        }
        pac.mouth += pac.mouthDir * 0.3;
        if (pac.mouth > 0.8 || pac.mouth < 0) pac.mouthDir *= -1;
      }
      if (scared > 0) scared--;
      for (const g of ghosts) {
        if (frame % 8 === 0) {
          const dirs = [0, 1, 2, 3].filter(d => {
            const nx = g.x + DIR[d].x, ny = g.y + DIR[d].y;
            return canMove(nx, ny) && d !== (g.dir + 2) % 4;
          });
          if (dirs.length > 0) {
            if (scared > 0) g.dir = dirs[Math.floor(Math.random() * dirs.length)];
            else {
              let best = dirs[0], bestD = Infinity;
              for (const d of dirs) {
                const nx = g.x + DIR[d].x, ny = g.y + DIR[d].y;
                const dist = Math.abs(nx - pac.x) + Math.abs(ny - pac.y);
                if (dist < bestD) { bestD = dist; best = d; }
              }
              g.dir = best;
            }
          }
        }
        if (frame % 8 === 0) {
          const nx = g.x + DIR[g.dir].x, ny = g.y + DIR[g.dir].y;
          if (canMove(nx, ny)) { g.x = nx; g.y = ny; }
          if (g.x < 0) g.x = COLS - 1; else if (g.x >= COLS) g.x = 0;
        }
        if (g.x === pac.x && g.y === pac.y) {
          if (scared > 0) { score += 200; g.x = 9; g.y = 9; SFX.explode(); }
          else { lives--; SFX.die(); if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; } pac.x = 9; pac.y = 15; pac.dir = 0; }
        }
      }
      // DRAW
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (maze[r][c] === 1) {
          ctx.fillStyle = '#1a1aff';
          ctx.shadowColor = '#3333ff'; ctx.shadowBlur = 3;
          ctx.fillRect(c * CS, r * CS, CS, CS);
          ctx.shadowBlur = 0;
        }
        if (dotMap[r] && dotMap[r][c]) {
          ctx.fillStyle = '#ffcc00';
          ctx.shadowColor = '#ffcc00'; ctx.shadowBlur = 4;
          ctx.beginPath(); ctx.arc(c * CS + CS / 2, r * CS + CS / 2, 3, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      // Pac-Man
      const px = pac.x * CS + CS / 2, py = pac.y * CS + CS / 2;
      const angle = pac.dir === 0 ? -Math.PI / 2 : pac.dir === 1 ? 0 : pac.dir === 2 ? Math.PI / 2 : Math.PI;
      ctx.fillStyle = '#ffff00';
      ctx.shadowColor = '#ffff00'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(px, py, CS / 2 - 1, angle + pac.mouth, angle + Math.PI * 2 - pac.mouth); ctx.lineTo(px, py); ctx.fill();
      ctx.shadowBlur = 0;
      // Ghosts
      for (const g of ghosts) {
        const gx = g.x * CS + CS / 2, gy = g.y * CS + CS / 2;
        const isScared = scared > 0;
        ctx.fillStyle = isScared ? (scared < 30 && frame % 10 < 5 ? '#fff' : '#2222ff') : g.color;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(gx, gy - 2, CS / 2 - 1, Math.PI, 0);
        ctx.lineTo(gx + CS / 2 - 1, gy + CS / 2 - 1);
        for (let i = 0; i < 3; i++) {
          const fx = gx + CS / 2 - 1 - i * (CS - 2) / 3;
          ctx.quadraticCurveTo(fx - (CS - 2) / 6, gy + CS / 2 - 6, fx - (CS - 2) / 3, gy + CS / 2 - 1);
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (!isScared) {
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(gx - 3, gy - 4, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(gx + 3, gy - 4, 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#111';
          ctx.beginPath(); ctx.arc(gx - 3 + DIR[g.dir].x * 1.5, gy - 4 + DIR[g.dir].y * 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(gx + 3 + DIR[g.dir].x * 1.5, gy - 4 + DIR[g.dir].y * 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      drawText(ctx, `🟡 Score: ${score}`, 4, 16, 13, '#ffff00');
      for (let i = 0; i < lives; i++) {
        ctx.fillStyle = '#ffff00'; ctx.beginPath();
        ctx.arc(W - 20 - i * 22, 14, 7, 0.3, Math.PI * 2 - 0.3); ctx.lineTo(W - 20 - i * 22, 14); ctx.fill();
      }
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 2. FROGGER ====================
  function gameFrogger(area, sendScore) {
    const W = 400, H = 400, CS = 25;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let frog = { x: W / 2, y: H - 30, w: 20, h: 20 };
    let cars = [], logs = [], score = 0, over = false, frame = 0, maxDist = 0;
    const ROW_H = 30;
    const carColors = ['#ff3333', '#ff8800', '#3388ff', '#ffff00', '#ff44ff', '#44ffaa'];
    for (let i = 0; i < 5; i++) {
      const speed = 1.5 + Math.random() * 2.5;
      const dir = i % 2 === 0 ? 1 : -1;
      const count = 2 + Math.floor(Math.random() * 2);
      for (let j = 0; j < count; j++) {
        cars.push({ y: H - 30 - (i + 1) * ROW_H, x: Math.random() * W, w: 30 + Math.random() * 20, h: 16, speed: speed * dir, color: carColors[i % carColors.length] });
      }
    }
    for (let i = 0; i < 5; i++) {
      const speed = 1 + Math.random() * 1.5;
      const dir = i % 2 === 0 ? -1 : 1;
      const count = 1 + Math.floor(Math.random() * 2);
      for (let j = 0; j < count; j++) {
        logs.push({ y: 40 + i * ROW_H, x: Math.random() * W, w: 60 + Math.random() * 40, h: 18, speed: speed * dir });
      }
    }
    const particles = new Particles();
    const kH = (e) => {
      if (over) return;
      SFX.jump();
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { frog.y -= CS; e.preventDefault(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { frog.y += CS; e.preventDefault(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { frog.x -= CS; e.preventDefault(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { frog.x += CS; e.preventDefault(); }
    };
    document.addEventListener('keydown', kH);
    let touchSX = 0, touchSY = 0;
    cvs.addEventListener('touchstart', (e) => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; }, { passive: true });
    cvs.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
      SFX.jump();
      if (Math.abs(dx) > Math.abs(dy)) frog.x += dx > 0 ? CS : -CS;
      else frog.y += dy > 0 ? CS : -CS;
    }, { passive: true });

    const loop = setInterval(() => {
      if (over) return; frame++;
      for (const c of cars) { c.x += c.speed; if (c.x > W + 50) c.x = -c.w - 10; if (c.x < -c.w - 50) c.x = W + 10; }
      for (const l of logs) { l.x += l.speed; if (l.x > W + 50) l.x = -l.w - 10; if (l.x < -l.w - 50) l.x = W + 10; }
      frog.x = Math.max(5, Math.min(W - 5, frog.x));
      for (const c of cars) {
        if (Math.abs(frog.x - c.x) < c.w / 2 + 8 && Math.abs(frog.y - c.y) < c.h / 2 + 8) {
          SFX.explode(); particles.add(frog.x, frog.y, 20, { colors: ['#ff4444', '#ff8800', '#ffff00'], speed: 4 });
          over = true; clearInterval(loop); sendScore(score); return;
        }
      }
      let onLog = false;
      for (const l of logs) {
        if (Math.abs(frog.y - l.y) < l.h && frog.x > l.x - l.w / 2 - 8 && frog.x < l.x + l.w / 2 + 8) {
          frog.x += l.speed; onLog = true; break;
        }
      }
      if (frog.y > 30 && frog.y < 170 && !onLog) {
        SFX.die(); particles.add(frog.x, frog.y, 15, { colors: ['#4488ff', '#88ccff'], speed: 3 });
        over = true; clearInterval(loop); sendScore(score); return;
      }
      if (frog.y < 25) { score += 200; SFX.win(); frog.y = H - 30; frog.x = W / 2; }
      const dist = Math.max(0, (H - 30 - frog.y) / (H - 60));
      if (dist > maxDist) { score += Math.floor((dist - maxDist) * 50); maxDist = dist; }
      particles.update();
      // DRAW
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2a2a1a';
      for (let r = 0; r < 5; r++) ctx.fillRect(0, H - 30 - (r + 1) * ROW_H, W, ROW_H);
      ctx.fillStyle = '#001133';
      for (let r = 0; r < 5; r++) ctx.fillRect(0, 40 + r * ROW_H, W, ROW_H);
      for (const l of logs) {
        ctx.fillStyle = '#5a3a1a';
        ctx.shadowColor = '#3a2a0a'; ctx.shadowBlur = 3;
        ctx.fillRect(l.x - l.w / 2, l.y - l.h / 2, l.w, l.h);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#7a5a2a';
        for (let i = 0; i < l.w; i += 15) ctx.fillRect(l.x - l.w / 2 + i, l.y - l.h / 2 + 3, 10, l.h - 6);
      }
      for (const c of cars) {
        ctx.fillStyle = c.color;
        ctx.shadowColor = c.color; ctx.shadowBlur = 4;
        ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#aaddff';
        ctx.fillRect(c.x - c.w / 2 + c.w - 6, c.y - 3, 4, 6);
        ctx.fillRect(c.x - c.w / 2 + 2, c.y - 3, 4, 6);
      }
      const fx = frog.x, fy = frog.y;
      ctx.fillStyle = '#22cc44';
      ctx.shadowColor = '#22cc44'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(fx, fy - 5, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(fx - 10, fy - 2, 20, 14);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(fx - 3, fy - 7, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(fx + 3, fy - 7, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(fx - 3, fy - 7, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(fx + 3, fy - 7, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#22aa33';
      ctx.fillRect(fx - 14, fy + 6, 6, 4); ctx.fillRect(fx + 8, fy + 6, 6, 4);
      ctx.fillRect(fx - 12, fy - 10, 5, 5); ctx.fillRect(fx + 7, fy - 10, 5, 5);
      particles.draw(ctx);
      drawText(ctx, `🐸 Score: ${score}`, 4, 16, 13, '#44ff44');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 3. ASTEROIDS ====================
  function gameAsteroids(area, sendScore) {
    const W = 400, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let ship = { x: W / 2, y: H / 2, angle: 0, vx: 0, vy: 0, thrust: 0, invuln: 60 };
    let bullets = [], asteroids = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, over = false, frame = 0, level = 1;
    const makeAsteroid = (x, y, size) => {
      const verts = [];
      const n = 8 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = size * (0.7 + Math.random() * 0.3);
        verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return { x, y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, size, verts, rot: 0, rotSpeed: (Math.random() - 0.5) * 0.05 };
    };
    const spawnWave = () => {
      for (let i = 0; i < 3 + level; i++) {
        let x, y;
        do { x = Math.random() * W; y = Math.random() * H; } while (Math.hypot(x - ship.x, y - ship.y) < 100);
        asteroids.push(makeAsteroid(x, y, 20 + Math.random() * 15));
      }
    };
    spawnWave();
    const keys = {};
    const kH = (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); };
    const kU = (e) => { keys[e.code] = false; };
    document.addEventListener('keydown', kH);
    document.addEventListener('keyup', kU);
    cvs.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const tx = (e.touches[0].clientX - rect.left) / rect.width * W;
      const ty = (e.touches[0].clientY - rect.top) / rect.height * H;
      const dx = tx - ship.x, dy = ty - ship.y;
      ship.angle = Math.atan2(dy, dx);
      bullets.push({ x: ship.x + Math.cos(ship.angle) * 15, y: ship.y + Math.sin(ship.angle) * 15, vx: Math.cos(ship.angle) * 6, vy: Math.sin(ship.angle) * 6, life: 45 });
      SFX.shoot();
    }, { passive: false });

    const loop = setInterval(() => {
      if (over) return; frame++;
      if (keys['ArrowLeft'] || keys['KeyA']) ship.angle -= 0.06;
      if (keys['ArrowRight'] || keys['KeyD']) ship.angle += 0.06;
      ship.thrust = keys['ArrowUp'] || keys['KeyW'] ? 0.12 : 0;
      if (keys['Space'] && frame % 8 === 0) {
        bullets.push({ x: ship.x + Math.cos(ship.angle) * 15, y: ship.y + Math.sin(ship.angle) * 15, vx: Math.cos(ship.angle) * 6, vy: Math.sin(ship.angle) * 6, life: 45 });
        SFX.shoot();
      }
      ship.vx += Math.cos(ship.angle) * ship.thrust; ship.vy += Math.sin(ship.angle) * ship.thrust;
      ship.vx *= 0.99; ship.vy *= 0.99;
      ship.x += ship.vx; ship.y += ship.vy;
      ship.x = (ship.x + W) % W; ship.y = (ship.y + H) % H;
      if (ship.invuln > 0) ship.invuln--;
      if (ship.thrust > 0) {
        particles.add(ship.x - Math.cos(ship.angle) * 12, ship.y - Math.sin(ship.angle) * 12, 1, {
          color: '#ff8800', speed: 1, life: 15, gravity: 0, size: 4
        });
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].x += bullets[i].vx; bullets[i].y += bullets[i].vy; bullets[i].life--;
        if (bullets[i].life <= 0) bullets.splice(i, 1);
      }
      for (const a of asteroids) { a.x += a.vx; a.y += a.vy; a.rot += a.rotSpeed; a.x = (a.x + W) % W; a.y = (a.y + H) % H; }
      for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        for (let j = bullets.length - 1; j >= 0; j--) {
          if (Math.hypot(bullets[j].x - a.x, bullets[j].y - a.y) < a.size) {
            SFX.explode(); shake.trigger(4);
            particles.add(a.x, a.y, 15, { colors: ['#888', '#aaa', '#ccc', '#fff'], speed: 4, life: 30 });
            score += a.size > 25 ? 20 : a.size > 15 ? 50 : 100;
            if (a.size > 15) {
              asteroids.push(makeAsteroid(a.x + (Math.random() - 0.5) * 10, a.y + (Math.random() - 0.5) * 10, a.size * 0.5));
              asteroids.push(makeAsteroid(a.x + (Math.random() - 0.5) * 10, a.y + (Math.random() - 0.5) * 10, a.size * 0.5));
            }
            asteroids.splice(i, 1); bullets.splice(j, 1); break;
          }
        }
      }
      if (ship.invuln <= 0) {
        for (const a of asteroids) {
          if (Math.hypot(ship.x - a.x, ship.y - a.y) < a.size + 10) {
            lives--; shake.trigger(8); SFX.die();
            particles.add(ship.x, ship.y, 25, { colors: ['#4488ff', '#88ccff', '#fff'], speed: 5, life: 35 });
            ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0; ship.invuln = 90;
            if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
            break;
          }
        }
      }
      if (asteroids.length === 0) { level++; spawnWave(); }
      particles.update();
      // DRAW
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(255,255,255,${0.1 + Math.sin(frame * 0.01 + i) * 0.1})`; ctx.fillRect((i * 97 + 20) % W, (i * 61 + 10) % H, 1, 1); }
      ctx.save(); shake.apply(ctx, W, H);
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
      for (const a of asteroids) {
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
        ctx.fillStyle = '#333'; ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.verts[0].x, a.verts[0].y);
        for (let i = 1; i < a.verts.length; i++) ctx.lineTo(a.verts[i].x, a.verts[i].y);
        ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      if (ship.invuln <= 0 || frame % 4 < 2) {
        ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
        ctx.fillStyle = '#ddd'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -10); ctx.lineTo(-6, 0); ctx.lineTo(-10, 10); ctx.closePath();
        ctx.fill(); ctx.stroke();
        if (ship.thrust > 0) {
          ctx.fillStyle = '#ff6600'; ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(-16 - Math.random() * 8, 0); ctx.lineTo(-8, 4); ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
      ctx.fillStyle = '#fff';
      for (const b of bullets) {
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      particles.draw(ctx);
      ctx.restore();
      drawText(ctx, `☄️ Score: ${score}`, 4, 16, 13, '#fff');
      for (let i = 0; i < lives; i++) {
        ctx.fillStyle = '#ddd'; ctx.beginPath();
        ctx.moveTo(W - 16 - i * 20, 8); ctx.lineTo(W - 24 - i * 20, 18); ctx.lineTo(W - 12 - i * 20, 18); ctx.closePath(); ctx.fill();
      }
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); document.removeEventListener('keyup', kU); };
  }

  // ==================== 4. GALAGA ====================
  function gameGalaga(area, sendScore) {
    const W = 400, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let player = { x: W / 2, w: 28, shootCD: 0 };
    let bullets = [], enemyBullets = [], enemies = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, wave = 0, over = false, frame = 0;
    const ENEMY_COLORS = [
      ['#ff4444', '#ff8800'],
      ['#44ff44', '#88ff00'],
      ['#4488ff', '#44ffff'],
      ['#ff44ff', '#ff88ff'],
      ['#ffff44', '#ffaa44'],
    ];
    const spawnWave = () => {
      wave++;
      const rows = 4 + Math.min(wave, 3);
      for (let r = 0; r < rows; r++) for (let c = 0; c < 8; c++) {
        const ci = Math.floor(r / 2) % ENEMY_COLORS.length;
        enemies.push({ x: 40 + c * 42, y: 30 + r * 32, w: 24, h: 18, hp: rows - r > 2 ? 1 : 2, color1: ENEMY_COLORS[ci][0], color2: ENEMY_COLORS[ci][1], frame: Math.random() * 100, diving: false, diveTimer: 0 });
      }
    };
    spawnWave();
    const kH = (e) => {
      if (over) return;
      if ((e.code === 'Space' || e.code === 'KeyZ') && player.shootCD <= 0) {
        player.shootCD = 10;
        bullets.push({ x: player.x, y: H - 45, vy: -7 });
        SFX.shoot();
      }
    };
    document.addEventListener('keydown', kH);
    cvs.addEventListener('touchstart', (e) => {
      const rect = cvs.getBoundingClientRect();
      player.x = (e.touches[0].clientX - rect.left) / rect.width * W;
      if (player.shootCD <= 0) { player.shootCD = 10; bullets.push({ x: player.x, y: H - 45, vy: -7 }); SFX.shoot(); }
    }, { passive: true });
    cvs.addEventListener('touchmove', (e) => { e.preventDefault(); const rect = cvs.getBoundingClientRect(); player.x = (e.touches[0].clientX - rect.left) / rect.width * W; }, { passive: false });

    const loop = setInterval(() => {
      if (over) return; frame++;
      if (player.shootCD > 0) player.shootCD--;
      if (frame % 2 === 0) {
        const kl = (e) => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') player.x -= 4; if (e.code === 'ArrowRight' || e.code === 'KeyD') player.x += 4; };
        document.addEventListener('keydown', kl); setTimeout(() => document.removeEventListener('keydown', kl), 100);
      }
      player.x = Math.max(16, Math.min(W - 16, player.x));
      for (let i = bullets.length - 1; i >= 0; i--) { bullets[i].y += bullets[i].vy; if (bullets[i].y < -5) bullets.splice(i, 1); }
      for (let i = enemyBullets.length - 1; i >= 0; i--) { enemyBullets[i].y += enemyBullets[i].vy; if (enemyBullets[i].y > H + 5) enemyBullets.splice(i, 1); }
      for (const e of enemies) {
        e.frame++;
        if (!e.diving) {
          e.x += Math.sin(e.frame * 0.02) * 0.5;
        } else {
          e.diveTimer++;
          const dx = player.x - e.x, dy = (H - 45) - e.y;
          const d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * 2.5; e.y += (dy / d) * 2.5;
        }
        if (!e.diving && Math.random() < 0.003 + wave * 0.0005) e.diving = true;
        if (e.y > H + 20) { e.y = -20; e.x = Math.random() * W; e.diving = false; }
      }
      if (frame % (50 - Math.min(wave * 3, 30)) === 0 && enemies.length > 0) {
        const shooter = enemies[Math.floor(Math.random() * enemies.length)];
        enemyBullets.push({ x: shooter.x, y: shooter.y + shooter.h, vy: 3 + wave * 0.2 });
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const b = bullets[i], e = enemies[j];
          if (b && e && Math.abs(b.x - e.x) < e.w && Math.abs(b.y - e.y) < e.h) {
            e.hp--;
            if (e.hp <= 0) {
              const pts = (4 - Math.floor(j / 8)) * 50 * wave;
              score += pts;
              particles.add(e.x, e.y, 12, { colors: [e.color1, e.color2, '#fff'], speed: 4, life: 25 });
              shake.trigger(2);
              SFX.explode();
              enemies.splice(j, 1);
            } else { SFX.hit(); particles.add(e.x, e.y, 4, { color: '#fff', speed: 2, life: 10 }); }
            bullets.splice(i, 1); break;
          }
        }
      }
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (Math.abs(b.x - player.x) < 14 && Math.abs(b.y - (H - 38)) < 10) {
          enemyBullets.splice(i, 1); lives--; shake.trigger(6); SFX.die();
          particles.add(player.x, H - 38, 20, { colors: ['#4488ff', '#88ccff', '#ff4444'], speed: 5, life: 30 });
          if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        }
      }
      if (enemies.length === 0) spawnWave();
      particles.update();
      // DRAW
      ctx.fillStyle = '#000011'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 50; i++) {
        const s = (frame * 0.1 + i * 37) % 5;
        ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.sin(frame * 0.03 + i) * 0.15})`;
        ctx.fillRect((i * 71 + frame * 0.15) % W, (i * 53) % H, s < 1 ? 2 : 1, s < 1 ? 2 : 1);
      }
      ctx.save(); shake.apply(ctx, W, H);
      for (const e of enemies) {
        ctx.fillStyle = e.color1;
        ctx.shadowColor = e.color1; ctx.shadowBlur = 4;
        const bob = Math.sin(e.frame * 0.08) * 3;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - e.h / 2 + bob);
        ctx.lineTo(e.x + e.w / 2, e.y + bob);
        ctx.lineTo(e.x + e.w / 4, e.y + e.h / 2 + bob);
        ctx.lineTo(e.x - e.w / 4, e.y + e.h / 2 + bob);
        ctx.lineTo(e.x - e.w / 2, e.y + bob);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = e.color2;
        ctx.beginPath(); ctx.arc(e.x - 5, e.y - 2 + bob, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(e.x + 5, e.y - 2 + bob, 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = '#4488ff'; ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(player.x, H - 52); ctx.lineTo(player.x - 14, H - 36); ctx.lineTo(player.x - 5, H - 30);
      ctx.lineTo(player.x + 5, H - 30); ctx.lineTo(player.x + 14, H - 36); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#aaddff'; ctx.beginPath(); ctx.arc(player.x, H - 42, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff4444'; for (const b of enemyBullets) { ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 4; ctx.fillRect(b.x - 1.5, b.y, 3, 8); }
      ctx.fillStyle = '#44ff44'; for (const b of bullets) { ctx.shadowColor = '#44ff44'; ctx.shadowBlur = 4; ctx.fillRect(b.x - 1, b.y, 2, 8); }
      ctx.shadowBlur = 0;
      particles.draw(ctx);
      ctx.restore();
      drawText(ctx, `🚀 Score: ${score}  Wave: ${wave}  Lives: ${lives}`, 4, 16, 12, '#fff');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 5. CENTIPEDE ====================
  function gameCentipede(area, sendScore) {
    const W = 400, H = 400, CS = 20;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS = W / CS, ROWS = H / CS;
    let player = { x: COLS / 2, y: ROWS - 2 };
    let segments = [], mushrooms = [], bullets = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, over = false, frame = 0, moveTimer = 0;
    const initCentipede = () => {
      segments = [];
      for (let i = 0; i < 10; i++) segments.push({ x: COLS / 2 + i, y: 0, dir: 1, alive: true });
    };
    initCentipede();
    for (let i = 0; i < 25; i++) {
      const mx = Math.floor(Math.random() * COLS), my = Math.floor(Math.random() * (ROWS - 3));
      mushrooms.push({ x: mx, y: my, hp: 3 });
    }
    const kH = (e) => {
      if (over) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') player.x = Math.max(0, player.x - 1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') player.x = Math.min(COLS - 1, player.x + 1);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') player.y = Math.max(ROWS / 2, player.y - 1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') player.y = Math.min(ROWS - 1, player.y + 1);
      else if ((e.code === 'Space' || e.code === 'KeyZ') && bullets.length < 3) {
        bullets.push({ x: player.x, y: player.y - 1, vy: -1 }); SFX.shoot();
      }
    };
    document.addEventListener('keydown', kH);
    cvs.addEventListener('touchstart', (e) => {
      const rect = cvs.getBoundingClientRect();
      player.x = Math.floor((e.touches[0].clientX - rect.left) / rect.width * COLS);
      player.y = Math.floor((e.touches[0].clientY - rect.top) / rect.height * ROWS);
      if (player.y > ROWS - 1) player.y = ROWS - 1;
      if (player.y < ROWS / 2) player.y = Math.floor(ROWS / 2);
      if (bullets.length < 3) { bullets.push({ x: player.x, y: player.y - 1, vy: -1 }); SFX.shoot(); }
    }, { passive: true });

    const loop = setInterval(() => {
      if (over) return; frame++;
      moveTimer++;
      if (moveTimer >= 8) {
        moveTimer = 0;
        let head = segments.find(s => s.alive);
        if (head) {
          const dir = head.dir;
          let nx = head.x + dir, ny = head.y;
          const blocked = nx < 0 || nx >= COLS || mushrooms.some(m => m.x === nx && m.y === ny);
          if (blocked) {
            head.dir *= -1; ny = head.y + 1; nx = head.x + head.dir;
            if (ny >= ROWS) { ny = ROWS - 1; }
          }
          head.x = Math.max(0, Math.min(COLS - 1, nx));
          head.y = Math.max(0, Math.min(ROWS - 1, ny));
          for (let i = 1; i < segments.length; i++) {
            if (segments[i].alive) {
              const prev = segments[i - 1];
              segments[i].x = prev.x - dir; segments[i].y = prev.y;
              segments[i].x = Math.max(0, Math.min(COLS - 1, segments[i].x));
            }
          }
        }
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y += bullets[i].vy;
        if (bullets[i].y < 0) { bullets.splice(i, 1); continue; }
        const bx = bullets[i].x, by = bullets[i].y;
        for (let j = segments.length - 1; j >= 0; j--) {
          if (segments[j].alive && segments[j].x === bx && segments[j].y === by) {
            segments[j].alive = false; score += 100; bullets.splice(i, 1);
            SFX.explode(); shake.trigger(2);
            particles.add(bx * CS + CS / 2, by * CS + CS / 2, 8, { colors: ['#ff4444', '#ff8800', '#ffff00'], speed: 3 });
            mushrooms.push({ x: bx, y: by, hp: 3 });
            break;
          }
        }
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (let j = mushrooms.length - 1; j >= 0; j--) {
          if (mushrooms[j].x === b.x && mushrooms[j].y === b.y) {
            mushrooms[j].hp--;
            if (mushrooms[j].hp <= 0) { mushrooms.splice(j, 1); score += 5; }
            bullets.splice(i, 1); SFX.hit(); break;
          }
        }
      }
      for (const s of segments) {
        if (s.alive && s.x === player.x && s.y === player.y) {
          lives--; SFX.die(); shake.trigger(6);
          particles.add(player.x * CS, player.y * CS, 15, { colors: ['#4488ff', '#ff4444'], speed: 4 });
          player.x = COLS / 2; player.y = ROWS - 2;
          if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        }
      }
      if (segments.every(s => !s.alive)) { score += 500; initCentipede(); }
      particles.update();
      // DRAW
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (const m of mushrooms) {
        const colors = ['#664422', '#886644', '#aa8866'];
        ctx.fillStyle = colors[m.hp - 1] || '#664422';
        ctx.shadowColor = '#442200'; ctx.shadowBlur = 2;
        ctx.fillRect(m.x * CS + 3, m.y * CS + 3, CS - 6, CS - 6);
        ctx.fillStyle = '#aa8866';
        ctx.beginPath(); ctx.arc(m.x * CS + CS / 2, m.y * CS + CS / 2 - 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i]; if (!s.alive) continue;
        const hue = (i * 15 + frame) % 360;
        ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
        ctx.shadowColor = `hsl(${hue}, 80%, 50%)`; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(s.x * CS + CS / 2, s.y * CS + CS / 2, CS / 2 - 2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        if (i === segments.findIndex(ss => ss.alive)) {
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(s.x * CS + CS / 2 - 3, s.y * CS + CS / 2 - 2, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(s.x * CS + CS / 2 + 3, s.y * CS + CS / 2 - 2, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.arc(s.x * CS + CS / 2 - 3, s.y * CS + CS / 2 - 2, 1.2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(s.x * CS + CS / 2 + 3, s.y * CS + CS / 2 - 2, 1.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.fillStyle = '#44ff44'; ctx.shadowColor = '#44ff44'; ctx.shadowBlur = 8;
      ctx.fillRect(player.x * CS + 4, player.y * CS + 4, CS - 8, CS - 8);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(player.x * CS + 7, player.y * CS + 7, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(player.x * CS + 13, player.y * CS + 7, 2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffff00';
      for (const b of bullets) { ctx.shadowColor = '#ffff00'; ctx.shadowBlur = 4; ctx.fillRect(b.x * CS + CS / 2 - 1, b.y * CS, 2, CS / 2); }
      ctx.shadowBlur = 0;
      particles.draw(ctx);
      drawText(ctx, `🐛 Score: ${score}  Lives: ${lives}`, 4, 16, 12, '#44ff44');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }



  // ==================== 6. DEFENDER ====================
  function gameDefender(area, sendScore) {
    const W = 600, H = 300;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let ship = { x: 80, y: H / 2, vy: 0, facing: 1 };
    let bullets = [], enemies = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, over = false, frame = 0, wave = 0;
    const spawnWave = () => {
      wave++;
      for (let i = 0; i < 4 + wave * 2; i++) {
        enemies.push({ x: W + Math.random() * 200, y: 40 + Math.random() * (H - 80), vx: -(1 + Math.random() * 1.5 + wave * 0.2), w: 16, h: 12, hp: 1 });
      }
    };
    spawnWave();
    const keys = {};
    const kH = (e) => {
      keys[e.code] = true;
      if ((e.code === 'Space' || e.code === 'KeyZ') && frame % 6 === 0) {
        bullets.push({ x: ship.x + ship.facing * 16, y: ship.y, vx: ship.facing * 8, life: 50 });
        SFX.shoot();
      }
    };
    const kU = (e) => { keys[e.code] = false; };
    document.addEventListener('keydown', kH); document.addEventListener('keyup', kU);

    const loop = setInterval(() => {
      if (over) return; frame++;
      if (keys['ArrowUp'] || keys['KeyW']) ship.vy -= 0.3;
      if (keys['ArrowDown'] || keys['KeyS']) ship.vy += 0.3;
      if (keys['ArrowLeft'] || keys['KeyA']) { ship.facing = -1; ship.x -= 3; }
      if (keys['ArrowRight'] || keys['KeyD']) { ship.facing = 1; ship.x += 3; }
      ship.vy *= 0.95; ship.y += ship.vy;
      ship.y = Math.max(15, Math.min(H - 15, ship.y));
      ship.x = Math.max(20, Math.min(W - 20, ship.x));
      for (let i = bullets.length - 1; i >= 0; i--) { bullets[i].x += bullets[i].vx; bullets[i].life--; if (bullets[i].life <= 0 || bullets[i].x < 0 || bullets[i].x > W) bullets.splice(i, 1); }
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i]; e.x += e.vx;
        if (e.x < -20) { enemies.splice(i, 1); continue; }
        if (Math.abs(e.x - ship.x) < 14 && Math.abs(e.y - ship.y) < 12) {
          lives--; shake.trigger(8); SFX.die();
          particles.add(ship.x, ship.y, 20, { colors: ['#4488ff', '#ff4444', '#ffff00'], speed: 5, life: 30 });
          ship.x = 80; ship.y = H / 2; ship.vy = 0;
          if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        }
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          if (Math.hypot(bullets[i].x - enemies[j].x, bullets[i].y - enemies[j].y) < 14) {
            score += 100; SFX.explode(); shake.trigger(2);
            particles.add(enemies[j].x, enemies[j].y, 10, { colors: ['#ff4444', '#ff8800', '#ffff00'], speed: 3, life: 20 });
            enemies.splice(j, 1); bullets.splice(i, 1); break;
          }
        }
      }
      if (enemies.length === 0) spawnWave();
      particles.update();
      // DRAW
      const stars = Array.from({length: 80}, (_, i) => ({ x: (i * 79 + frame * 0.3) % W, y: (i * 53) % H, b: 0.2 + Math.sin(i + frame * 0.01) * 0.15 }));
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      for (const s of stars) { ctx.globalAlpha = s.b; ctx.fillRect(s.x, s.y, 1.5, 1.5); }
      ctx.globalAlpha = 1;
      ctx.save(); shake.apply(ctx, W, H);
      ctx.fillStyle = '#554433';
      for (let x = 0; x < W; x += 4) { const h = 10 + Math.sin(x * 0.05) * 5 + Math.sin(x * 0.02) * 3; ctx.fillRect(x, H - h, 4, h); }
      ctx.fillStyle = '#4488ff'; ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 8;
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.scale(ship.facing, 1);
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff4400';
      ctx.beginPath(); ctx.moveTo(-5, -3); ctx.lineTo(-10 - Math.random() * 5, 0); ctx.lineTo(-5, 3); ctx.fill();
      ctx.restore(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffff00'; for (const b of bullets) { ctx.shadowColor = '#ffff00'; ctx.shadowBlur = 4; ctx.fillRect(b.x - 3, b.y - 1, 6, 2); }
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff4444'; for (const e of enemies) {
        ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 4;
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.beginPath(); ctx.moveTo(-e.w, 0); ctx.lineTo(-e.w / 2, -e.h / 2); ctx.lineTo(e.w / 2, -e.h / 2); ctx.lineTo(e.w, 0); ctx.lineTo(e.w / 2, e.h / 2); ctx.lineTo(-e.w / 2, e.h / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff8800'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      particles.draw(ctx);
      ctx.restore();
      drawText(ctx, `🛸 Score: ${score}  Lives: ${lives}  Wave: ${wave}`, 4, 16, 12, '#fff');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); document.removeEventListener('keyup', kU); };
  }

  // ==================== 7. TETRIS ====================
  function gameTetris(area, sendScore) {
    const W = 300, H = 500, CS = 25;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS = 10, ROWS = 20;
    const PIECES = [
      { shape: [[1,1,1,1]], color: '#00ffff' },
      { shape: [[1,0,0],[1,1,1]], color: '#0044ff' },
      { shape: [[0,0,1],[1,1,1]], color: '#ff8800' },
      { shape: [[1,1],[1,1]], color: '#ffff00' },
      { shape: [[0,1,1],[1,1,0]], color: '#44ff44' },
      { shape: [[0,1,0],[1,1,1]], color: '#aa44ff' },
      { shape: [[1,1,0],[0,1,1]], color: '#ff4444' },
    ];
    let board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    let piece = null, nextPiece = null, score = 0, lines = 0, level = 1, over = false, frame = 0, dropTimer = 0;
    const newPiece = () => {
      piece = nextPiece || PIECES[Math.floor(Math.random() * PIECES.length)];
      nextPiece = PIECES[Math.floor(Math.random() * PIECES.length)];
      piece.x = 3; piece.y = 0; piece.rot = 0;
      if (!canPlace(piece, piece.x, piece.y)) { over = true; clearInterval(loop); sendScore(score); }
    };
    const rotate = (shape) => {
      const rows = shape.length, cols = shape[0].length;
      const r = Array.from({ length: cols }, () => Array(rows).fill(0));
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) r[x][rows - 1 - y] = shape[y][x];
      return r;
    };
    const getShape = (p) => {
      let s = p.shape;
      for (let i = 0; i < p.rot; i++) s = rotate(s);
      return s;
    };
    const canPlace = (p, px, py) => {
      const s = getShape(p);
      for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) {
        if (!s[y][x]) continue;
        const bx = px + x, by = py + y;
        if (bx < 0 || bx >= COLS || by >= ROWS) return false;
        if (by >= 0 && board[by][bx]) return false;
      }
      return true;
    };
    const lockPiece = () => {
      const s = getShape(piece);
      for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) {
        if (s[y][x] && piece.y + y >= 0) board[piece.y + y][piece.x + x] = piece.color;
      }
      let cleared = 0;
      for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every(c => c !== null)) { board.splice(y, 1); board.unshift(Array(COLS).fill(null)); cleared++; y++; }
      }
      if (cleared > 0) {
        SFX.score();
        lines += cleared;
        score += [0, 100, 300, 500, 800][cleared] * level;
        level = Math.floor(lines / 10) + 1;
      }
      newPiece();
    };
    const kH = (e) => {
      if (over || !piece) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (canPlace(piece, piece.x - 1, piece.y)) piece.x--; }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (canPlace(piece, piece.x + 1, piece.y)) piece.x++; }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') { const old = piece.rot; piece.rot = (piece.rot + 1) % 4; if (!canPlace(piece, piece.x, piece.y)) piece.rot = old; SFX.bounce(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { dropTimer = 0; if (canPlace(piece, piece.x, piece.y + 1)) { piece.y++; score += 1; } }
      else if (e.code === 'Space') {
        e.preventDefault();
        while (canPlace(piece, piece.x, piece.y + 1)) { piece.y++; score += 2; }
        lockPiece();
      }
    };
    document.addEventListener('keydown', kH);
    let touchSX = 0, touchSY = 0;
    cvs.addEventListener('touchstart', (e) => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; }, { passive: true });
    cvs.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { const old = piece.rot; piece.rot = (piece.rot + 1) % 4; if (!canPlace(piece, piece.x, piece.y)) piece.rot = old; }
      else if (Math.abs(dx) > Math.abs(dy)) { piece.x += dx > 0 ? 1 : -1; if (!canPlace(piece, piece.x, piece.y)) piece.x -= dx > 0 ? 1 : -1; }
      else if (dy > 10) { while (canPlace(piece, piece.x, piece.y + 1)) piece.y++; lockPiece(); }
    }, { passive: true });
    newPiece();
    const loop = setInterval(() => {
      if (over) return; frame++;
      dropTimer++;
      const speed = Math.max(2, 12 - level);
      if (dropTimer >= speed) { dropTimer = 0; if (canPlace(piece, piece.x, piece.y + 1)) piece.y++; else lockPiece(); }
      // DRAW
      ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 0.5;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ctx.strokeRect(c * CS, r * CS, CS, CS);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c]) {
          ctx.fillStyle = board[r][c];
          ctx.shadowColor = board[r][c]; ctx.shadowBlur = 3;
          ctx.fillRect(c * CS + 1, r * CS + 1, CS - 2, CS - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(c * CS + 1, r * CS + 1, CS - 2, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(c * CS + 1, r * CS + CS - 5, CS - 2, 4);
          ctx.shadowBlur = 0;
        }
      }
      if (piece) {
        const s = getShape(piece);
        for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) {
          if (s[y][x]) {
            ctx.fillStyle = piece.color;
            ctx.shadowColor = piece.color; ctx.shadowBlur = 6;
            ctx.fillRect((piece.x + x) * CS + 1, (piece.y + y) * CS + 1, CS - 2, CS - 2);
            ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect((piece.x + x) * CS + 1, (piece.y + y) * CS + 1, CS - 2, 4);
            ctx.shadowBlur = 0;
          }
        }
      }
      drawText(ctx, `📦 Score: ${score}`, W + 10, 30, 13, '#fff', 'left', false);
      drawText(ctx, `Lines: ${lines}`, W + 10, 55, 12, '#aaa', 'left', false);
      drawText(ctx, `Level: ${level}`, W + 10, 75, 12, '#aaa', 'left', false);
      if (nextPiece) {
        drawText(ctx, 'NEXT:', W + 10, 120, 11, '#888', 'left', false);
        const ns = nextPiece.shape;
        for (let y = 0; y < ns.length; y++) for (let x = 0; x < ns[y].length; x++) {
          if (ns[y][x]) { ctx.fillStyle = nextPiece.color; ctx.fillRect(W + 10 + x * 18, 130 + y * 18, 16, 16); }
        }
      }
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 8. ARKANOID ====================
  function gameArkanoid(area, sendScore) {
    const W = 400, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let paddle = { x: W / 2, w: 70, h: 10 };
    let ball = { x: W / 2, y: H - 60, vx: 3, vy: -4, r: 5 };
    let bricks = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, over = false, frame = 0;
    const brickColors = ['#ff4444', '#ff8800', '#ffff00', '#44ff44', '#4488ff', '#ff44ff'];
    const BRICK_W = 36, BRICK_H = 14, BRICK_PAD = 3;
    const ROWS = 5, COLS = 10;
    const BRICK_OFFSET_X = (W - COLS * (BRICK_W + BRICK_PAD)) / 2;
    const BRICK_OFFSET_Y = 40;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      bricks.push({ x: BRICK_OFFSET_X + c * (BRICK_W + BRICK_PAD), y: BRICK_OFFSET_Y + r * (BRICK_H + BRICK_PAD), w: BRICK_W, h: BRICK_H, color: brickColors[r], hp: ROWS - r, alive: true });
    }
    const kH = (e) => {
      if (over) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') paddle.x -= 30;
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') paddle.x += 30;
      else if (e.code === 'Space') e.preventDefault();
    };
    document.addEventListener('keydown', kH);
    cvs.addEventListener('touchmove', (e) => { e.preventDefault(); const rect = cvs.getBoundingClientRect(); paddle.x = (e.touches[0].clientX - rect.left) / rect.width * W; }, { passive: false });

    const loop = setInterval(() => {
      if (over) return; frame++;
      paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));
      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.x - ball.r < 0 || ball.x + ball.r > W) { ball.vx *= -1; SFX.bounce(); }
      if (ball.y - ball.r < 0) { ball.vy *= -1; SFX.bounce(); }
      if (ball.y > H + 10) {
        lives--; SFX.die();
        if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        ball = { x: paddle.x, y: H - 60, vx: (Math.random() - 0.5) * 4, vy: -4, r: 5 };
      }
      if (ball.vy > 0 && Math.abs(ball.x - paddle.x) < paddle.w / 2 + ball.r && ball.y + ball.r >= H - 30) {
        ball.vy = -Math.abs(ball.vy);
        ball.vx = ((ball.x - paddle.x) / (paddle.w / 2)) * 5;
        SFX.bounce();
        particles.add(ball.x, H - 30, 4, { color: '#4488ff', speed: 2, life: 12 });
      }
      for (const b of bricks) {
        if (!b.alive) continue;
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w && ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
          ball.vy *= -1; b.hp--;
          if (b.hp <= 0) {
            b.alive = false; score += 10 * (ROWS - b.y / BRICK_H | 0);
            SFX.explode(); shake.trigger(2);
            particles.add(b.x + b.w / 2, b.y + b.h / 2, 8, { colors: [b.color, '#fff'], speed: 3, life: 20 });
          } else { SFX.hit(); }
          break;
        }
      }
      if (bricks.every(b => !b.alive)) { SFX.win(); score += 1000; clearInterval(loop); sendScore(score); return; }
      particles.update();
      // DRAW
      ctx.fillStyle = '#0a0a2e'; ctx.fillRect(0, 0, W, H);
      for (const b of bricks) {
        if (!b.alive) continue;
        ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 4;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(b.x, b.y, b.w, 3);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = '#ddd'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 6;
      const pw = paddle.w / 2;
      ctx.beginPath();
      ctx.moveTo(paddle.x - pw, H - 25); ctx.lineTo(paddle.x - pw + 8, H - 32);
      ctx.lineTo(paddle.x + pw - 8, H - 32); ctx.lineTo(paddle.x + pw, H - 25);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      particles.draw(ctx);
      drawText(ctx, `🧱 Score: ${score}  Lives: ${lives}`, 4, 18, 13, '#fff');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }



  // ==================== 9. DONKEY KONG ====================
  function gameDonkeyKong(area, sendScore) {
    const W = 400, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const platforms = [
      { x: 0, y: 365, w: 400, tilt: 1.5 },
      { x: 40, y: 295, w: 360, tilt: -1.5 },
      { x: 0, y: 225, w: 360, tilt: 1.5 },
      { x: 40, y: 155, w: 360, tilt: -1.5 },
      { x: 100, y: 90, w: 120, tilt: 0 }
    ];
    let player = { x: 30, y: 345, vx: 0, vy: 0, w: 14, h: 18, onGround: false, facing: 1, anim: 0 };
    let barrels = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, over = false, frame = 0, barrelTimer = 0;
    const GRAVITY = 0.35, JUMP = -7.5, SPEED = 2.5;
    const girl = { x: 155, y: 66 };
    const keys = {};
    const kH = (e) => {
      keys[e.code] = true;
      if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') && player.onGround) { player.vy = JUMP; player.onGround = false; SFX.jump(); }
    };
    const kU = (e) => { keys[e.code] = false; };
    document.addEventListener('keydown', kH); document.addEventListener('keyup', kU);
    cvs.addEventListener('touchstart', (e) => { if (player.onGround) { player.vy = JUMP; player.onGround = false; SFX.jump(); } }, { passive: true });
    cvs.addEventListener('touchmove', (e) => { e.preventDefault(); const rect = cvs.getBoundingClientRect(); const tx = (e.touches[0].clientX - rect.left) / rect.width * W; player.vx = tx > player.x + 10 ? SPEED : tx < player.x - 10 ? -SPEED : 0; }, { passive: false });
    cvs.addEventListener('touchend', () => { player.vx = 0; }, { passive: true });

    const getPlatY = (p, x) => p.y + (x - p.x) * (p.tilt / 60);
    const loop = setInterval(() => {
      if (over) return; frame++;
      if (keys['ArrowLeft'] || keys['KeyA']) { player.vx = -SPEED; player.facing = -1; }
      else if (keys['ArrowRight'] || keys['KeyD']) { player.vx = SPEED; player.facing = 1; }
      else player.vx = 0;
      player.x += player.vx; player.y += player.vy; player.vy += GRAVITY;
      if (player.vx !== 0) player.anim++;
      player.onGround = false;
      for (let i = platforms.length - 1; i >= 0; i--) {
        const p = platforms[i];
        const py = getPlatY(p, player.x);
        if (player.x >= p.x - 5 && player.x <= p.x + p.w + 5 && player.y + player.h >= py && player.y + player.h <= py + 14 && player.vy >= 0) {
          player.y = py - player.h; player.vy = 0; player.onGround = true; break;
        }
      }
      if (player.x < 0) player.x = 0; if (player.x > W - player.w) player.x = W - player.w;
      if (player.y > H) { over = true; clearInterval(loop); sendScore(score); return; }
      barrelTimer++;
      if (barrelTimer > 80) { barrelTimer = 0; barrels.push({ x: 55, y: 80, vx: -1.2, vy: 0, radius: 9, plat: 4 }); SFX.dig(); }
      for (let i = barrels.length - 1; i >= 0; i--) {
        const b = barrels[i]; b.vy += GRAVITY; b.x += b.vx; b.y += b.vy;
        if (b.plat < platforms.length) {
          const p = platforms[b.plat];
          const py = getPlatY(p, b.x);
          if (b.y >= py - 3) {
            b.y = py - b.radius; b.vy = 0;
            b.vx = p.tilt > 0 ? -1.5 : 1.5;
            if (b.x < p.x - 10 || b.x > p.x + p.w + 10) { b.plat++; b.vx = platforms[b.plat] ? (platforms[b.plat].tilt > 0 ? -1.5 : 1.5) : 0; }
          }
        }
        if (b.y > H + 20) { barrels.splice(i, 1); score += 10; continue; }
        if (Math.abs(b.x - player.x) < 16 && Math.abs(b.y - (player.y + player.h / 2)) < 14) {
          SFX.die(); shake.trigger(8);
          particles.add(player.x, player.y, 20, { colors: ['#4488ff', '#ff4444', '#ffff00'], speed: 5, life: 30 });
          player.x = 30; player.y = 345; player.vy = 0;
          lives--;
          if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        }
      }
      if (Math.abs(player.x - girl.x) < 25 && player.y < girl.y + 30) {
        score += 500; SFX.win();
        player.x = 30; player.y = 345; player.vy = 0;
        barrels = [];
      }
      particles.update();
      // DRAW
      ctx.fillStyle = '#0a0a1e'; ctx.fillRect(0, 0, W, H);
      for (const p of platforms) {
        for (let x = p.x; x < p.x + p.w; x += 2) {
          const py = getPlatY(p, x);
          ctx.fillStyle = (Math.floor(x / 12) + Math.floor(p.y / 40)) % 2 === 0 ? '#8B4513' : '#7B3503';
          ctx.fillRect(x, py - 3, 2, 6);
        }
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(p.x, getPlatY(p, p.x) - 2, p.w, 3);
      }
      // DK
      const dkX = 45, dkY = 65;
      ctx.fillStyle = '#8B4513';
      ctx.beginPath(); ctx.arc(dkX, dkY + 8, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6B3513'; ctx.beginPath(); ctx.arc(dkX, dkY + 12, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a2a0a'; ctx.fillRect(dkX - 5, dkY - 2, 10, 10);
      ctx.fillStyle = '#fff';
      ctx.fillRect(dkX - 4, dkY, 3, 3); ctx.fillRect(dkX + 1, dkY, 3, 3);
      ctx.fillStyle = '#000'; ctx.fillRect(dkX - 3, dkY + 1, 2, 2); ctx.fillRect(dkX + 2, dkY + 1, 2, 2);
      if (frame % 30 < 15) { ctx.fillStyle = '#ff69b4'; ctx.font = '14px sans-serif'; ctx.fillText('♥', dkX + 18, dkY + 5); }
      // Girl
      ctx.fillStyle = '#ff69b4'; ctx.font = '16px sans-serif'; ctx.fillText('👩', girl.x - 8, girl.y + 14);
      if (frame % 40 < 20) { ctx.fillStyle = '#ff69b4'; ctx.font = '10px sans-serif'; ctx.fillText('HELP!', girl.x - 5, girl.y - 4); }
      // Barrels
      for (const b of barrels) {
        const rot = frame * 0.1;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(rot);
        ctx.fillStyle = '#654321'; ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, b.radius - 3, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#444'; ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      }
      // Player
      ctx.save(); ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
      ctx.scale(player.facing, 1);
      const legOffset = Math.sin(player.anim * 0.3) * 3;
      ctx.fillStyle = '#ff4444'; ctx.fillRect(-5, -player.h / 2, 10, 8);
      ctx.fillStyle = '#ffcc88'; ctx.fillRect(-4, -player.h / 2 + 8, 8, 6);
      ctx.fillStyle = '#4488ff'; ctx.fillRect(-5, 2, 10, 6);
      ctx.fillStyle = '#ffcc88'; ctx.fillRect(-1, -player.h / 2 + 2, 6, 5);
      ctx.fillStyle = '#fff'; ctx.fillRect(-3, -player.h / 2 + 3, 2, 2); ctx.fillRect(1, -player.h / 2 + 3, 2, 2);
      ctx.fillRect(-5, 6 + legOffset, 4, 4); ctx.fillRect(1, 6 - legOffset, 4, 4);
      ctx.restore();
      particles.draw(ctx);
      drawText(ctx, `🦍 Score: ${score}  Lives: ${lives}`, 4, 16, 13, '#ff8800');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); document.removeEventListener('keyup', kU); };
  }

  // ==================== 10. SPACE INVADERS ====================
  function gameSpaceInvaders(area, sendScore) {
    const W = 400, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let player = { x: W / 2, w: 28, h: 14 };
    let bullets = [], enemyBullets = [], enemies = [], particles = new Particles(), shake = new Shake();
    let score = 0, lives = 3, wave = 0, over = false, frame = 0, shootCD = 0;
    const COLORS = [['#ff4444', '#ff6666'], ['#ff8800', '#ffaa44'], ['#ffff00', '#ffff66'], ['#44ff44', '#88ff88'], ['#ff44ff', '#ff88ff']];
    let shields = [];
    const initShields = () => { shields = []; for (let i = 0; i < 4; i++) shields.push({ x: 50 + i * 100, y: H - 80, hp: 6 }); };
    initShields();
    const spawnWave = () => {
      wave++;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
        const ci = r % COLORS.length;
        enemies.push({ x: 30 + c * 42, y: 35 + r * 34, w: 26, h: 18, hp: r === 0 ? 2 : 1, color1: COLORS[ci][0], color2: COLORS[ci][1], frame: c * 10 + r * 5, dir: 1, diving: false });
      }
    };
    spawnWave();
    const kH = (e) => {
      if (over) return;
      if ((e.code === 'Space' || e.code === 'KeyZ') && shootCD <= 0) { shootCD = 12; bullets.push({ x: player.x, y: H - 46, vy: -7 }); SFX.shoot(); }
    };
    document.addEventListener('keydown', kH);
    cvs.addEventListener('touchstart', (e) => { const rect = cvs.getBoundingClientRect(); player.x = (e.touches[0].clientX - rect.left) / rect.width * W; if (shootCD <= 0) { shootCD = 12; bullets.push({ x: player.x, y: H - 46, vy: -7 }); SFX.shoot(); } }, { passive: true });
    cvs.addEventListener('touchmove', (e) => { e.preventDefault(); const rect = cvs.getBoundingClientRect(); player.x = (e.touches[0].clientX - rect.left) / rect.width * W; }, { passive: false });

    const loop = setInterval(() => {
      if (over) return; frame++;
      if (shootCD > 0) shootCD--;
      const kl2 = (e) => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') player.x -= 4; if (e.code === 'ArrowRight' || e.code === 'KeyD') player.x += 4; };
      document.addEventListener('keydown', kl2); setTimeout(() => document.removeEventListener('keydown', kl2), 50);
      player.x = Math.max(14, Math.min(W - 14, player.x));
      for (let i = bullets.length - 1; i >= 0; i--) { bullets[i].y += bullets[i].vy; if (bullets[i].y < -5) bullets.splice(i, 1); }
      for (let i = enemyBullets.length - 1; i >= 0; i--) { enemyBullets[i].y += enemyBullets[i].vy; if (enemyBullets[i].y > H + 5) enemyBullets.splice(i, 1); }
      let edgeHit = false;
      for (const e of enemies) { e.frame++; if (e.x + e.w > W - 5 || e.x < 5) edgeHit = true; }
      if (edgeHit) { for (const e of enemies) { e.dir *= -1; e.x += e.dir * 8; e.y += 14; } }
      else { for (const e of enemies) e.x += e.dir * 0.8; }
      if (frame % Math.max(15, 45 - wave * 3) === 0 && enemies.length > 0) {
        const shooter = enemies[Math.floor(Math.random() * enemies.length)];
        enemyBullets.push({ x: shooter.x, y: shooter.y + shooter.h, vy: 3 + wave * 0.3 });
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const b = bullets[i], e = enemies[j];
          if (b && e && Math.abs(b.x - e.x) < e.w && Math.abs(b.y - e.y) < e.h) {
            e.hp--;
            if (e.hp <= 0) {
              score += [50, 40, 30, 20, 10][j % 5] * wave;
              SFX.explode(); shake.trigger(2);
              particles.add(e.x, e.y, 12, { colors: [e.color1, e.color2, '#fff'], speed: 4, life: 25 });
              enemies.splice(j, 1);
            } else { SFX.hit(); particles.add(e.x, e.y, 4, { color: '#fff', speed: 2, life: 10 }); }
            bullets.splice(i, 1); break;
          }
        }
      }
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        for (let s = shields.length - 1; s >= 0; s--) {
          if (b.x > shields[s].x && b.x < shields[s].x + 56 && b.y > shields[s].y && b.y < shields[s].y + 22) {
            shields[s].hp--; enemyBullets.splice(i, 1);
            if (shields[s].hp <= 0) shields.splice(s, 1); break;
          }
        }
      }
      if (enemyBullets.some(b => Math.abs(b.x - player.x) < 14 && Math.abs(b.y - (H - 40)) < 10)) {
        lives--; shake.trigger(6); SFX.die();
        particles.add(player.x, H - 40, 20, { colors: ['#4488ff', '#ff4444'], speed: 5, life: 30 });
        if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
      }
      if (enemies.some(e => e.y + e.h > H - 50)) { over = true; clearInterval(loop); sendScore(score); return; }
      if (enemies.length === 0) { initShields(); spawnWave(); }
      particles.update();
      // DRAW
      ctx.fillStyle = '#000011'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.sin(frame * 0.02 + i * 0.5) * 0.1})`; ctx.fillRect((i * 71 + frame * 0.2) % W, (i * 47) % H, 1, 1); }
      ctx.save(); shake.apply(ctx, W, H);
      ctx.fillStyle = '#00ff00'; ctx.shadowColor = '#00ff00'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(player.x, H - 54); ctx.lineTo(player.x - 14, H - 38); ctx.lineTo(player.x - 4, H - 34);
      ctx.lineTo(player.x + 4, H - 34); ctx.lineTo(player.x + 14, H - 38); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      for (const e of enemies) {
        const bob = Math.sin(e.frame * 0.08) * 2;
        ctx.fillStyle = e.color1; ctx.shadowColor = e.color1; ctx.shadowBlur = 4;
        ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2 + bob, e.w, e.h);
        ctx.fillStyle = e.color2;
        ctx.fillRect(e.x - e.w / 2 + 2, e.y - e.h / 2 + 2 + bob, e.w - 4, e.h / 2 - 2);
        ctx.fillStyle = '#fff';
        ctx.fillRect(e.x - 5, e.y - 3 + bob, 3, 3); ctx.fillRect(e.x + 3, e.y - 3 + bob, 3, 3);
        ctx.fillStyle = '#000';
        ctx.fillRect(e.x - 4, e.y - 2 + bob, 2, 2); ctx.fillRect(e.x + 4, e.y - 2 + bob, 2, 2);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = '#4488ff'; for (const s of shields) { ctx.globalAlpha = s.hp / 6; ctx.fillRect(s.x, s.y, 56, 22); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff4444'; for (const b of enemyBullets) { ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 4; ctx.fillRect(b.x - 1.5, b.y, 3, 8); }
      ctx.fillStyle = '#44ff44'; for (const b of bullets) { ctx.shadowColor = '#44ff44'; ctx.shadowBlur = 4; ctx.fillRect(b.x - 1, b.y, 2, 8); }
      ctx.shadowBlur = 0;
      particles.draw(ctx);
      ctx.restore();
      drawText(ctx, `👾 Score: ${score}  Lives: ${lives}  Wave: ${wave}`, 4, 16, 12, '#fff');
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 11. SNAKE ====================
  function gameSnake(area, sendScore) {
    const W = 400, H = 400, CS = 20;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS = W / CS, ROWS = H / CS;
    let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    let dir = { x: 1, y: 0 }, nextDir = { x: 1, y: 0 };
    let food = spawnFood(), special = null, particles = new Particles();
    let score = 0, over = false, frame = 0, speed = 6, moveTimer = 0;
    function spawnFood() {
      let p; do { p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; } while (snake.some(s => s.x === p.x && s.y === p.y));
      return { ...p, pulse: 0 };
    }
    const kH = (e) => {
      if (e.code === 'ArrowUp' && dir.y !== 1) nextDir = { x: 0, y: -1 };
      else if (e.code === 'ArrowDown' && dir.y !== -1) nextDir = { x: 0, y: 1 };
      else if (e.code === 'ArrowLeft' && dir.x !== 1) nextDir = { x: -1, y: 0 };
      else if (e.code === 'ArrowRight' && dir.x !== -1) nextDir = { x: 1, y: 0 };
    };
    document.addEventListener('keydown', kH);
    let touchSX = 0, touchSY = 0;
    cvs.addEventListener('touchstart', (e) => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; }, { passive: true });
    cvs.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
      if (Math.abs(dx) > Math.abs(dy)) { if (dx > 0 && dir.x !== -1) nextDir = { x: 1, y: 0 }; else if (dx < 0 && dir.x !== 1) nextDir = { x: -1, y: 0 }; }
      else { if (dy > 0 && dir.y !== -1) nextDir = { x: 0, y: 1 }; else if (dy < 0 && dir.y !== 1) nextDir = { x: 0, y: -1 }; }
    }, { passive: true });

    const loop = setInterval(() => {
      if (over) return; frame++;
      moveTimer++;
      if (moveTimer < speed) { drawFrame(); return; }
      moveTimer = 0; dir = { ...nextDir };
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || snake.some(s => s.x === head.x && s.y === head.y)) {
        SFX.die(); over = true; clearInterval(loop); sendScore(score); return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 10; speed = Math.max(2, speed - 0.1); SFX.collect();
        particles.add(food.x * CS + CS / 2, food.y * CS + CS / 2, 10, { colors: ['#ff4444', '#ff8800', '#ffff00'], speed: 4, life: 15 });
        food = spawnFood();
        if (Math.random() < 0.12) {
          let p; do { p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; } while (snake.some(s => s.x === p.x && s.y === p.y) || (p.x === food.x && p.y === food.y));
          special = { ...p, timer: 120, type: Math.random() < 0.5 ? 'bonus' : 'speed', pulse: 0 };
        }
      } else if (special && head.x === special.x && head.y === special.y) {
        score += special.type === 'bonus' ? 50 : 30; SFX.powerup();
        particles.add(special.x * CS + CS / 2, special.y * CS + CS / 2, 15, { colors: special.type === 'bonus' ? ['#ffcc00', '#ff8800'] : ['#00ffff', '#0088ff'], speed: 5, life: 20 });
        special = null;
      } else snake.pop();
      if (special) { special.timer--; if (special.timer <= 0) special = null; }
      drawFrame();
    }, 1000 / 30);

    function drawFrame() {
      ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 0.5;
      for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) ctx.strokeRect(x * CS, y * CS, CS, CS);
      // Food glow
      ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 12;
      const fPulse = 3 + Math.sin(frame * 0.15) * 1.5;
      const fGrad = ctx.createRadialGradient(food.x * CS + CS / 2, food.y * CS + CS / 2, 0, food.x * CS + CS / 2, food.y * CS + CS / 2, CS / 2);
      fGrad.addColorStop(0, '#ff6600'); fGrad.addColorStop(0.6, '#ff0000'); fGrad.addColorStop(1, '#aa0000');
      ctx.fillStyle = fGrad;
      ctx.beginPath(); ctx.arc(food.x * CS + CS / 2, food.y * CS + CS / 2, fPulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (special) {
        const sGrad = ctx.createRadialGradient(special.x * CS + CS / 2, special.y * CS + CS / 2, 0, special.x * CS + CS / 2, special.y * CS + CS / 2, CS / 2);
        if (special.type === 'bonus') { sGrad.addColorStop(0, '#ffff00'); sGrad.addColorStop(1, '#ff8800'); }
        else { sGrad.addColorStop(0, '#00ffff'); sGrad.addColorStop(1, '#0088ff'); }
        ctx.fillStyle = sGrad; ctx.globalAlpha = 0.5 + Math.sin(frame * 0.2) * 0.5;
        ctx.shadowColor = special.type === 'bonus' ? '#ffcc00' : '#00ffff'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(special.x * CS + CS / 2, special.y * CS + CS / 2, CS / 2 - 1, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }
      // Snake
      for (let i = snake.length - 1; i >= 0; i--) {
        const s = snake[i];
        const t = i / snake.length;
        const isHead = i === 0;
        const gR = isHead ? 60 : Math.floor(40 + t * 40);
        const gG = isHead ? 255 : Math.floor(180 + (1 - t) * 75);
        const gB = isHead ? 60 : Math.floor(40 + t * 40);
        ctx.fillStyle = `rgb(${gR},${gG},${gB})`;
        ctx.shadowColor = `rgb(${gR},${gG},${gB})`; ctx.shadowBlur = isHead ? 8 : 3;
        const pad = isHead ? 1 : 2;
        const radius = isHead ? 5 : 3;
        ctx.beginPath();
        ctx.roundRect(s.x * CS + pad, s.y * CS + pad, CS - pad * 2, CS - pad * 2, radius);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (isHead) {
          ctx.fillStyle = '#fff';
          const ex1x = s.x * CS + (dir.x === 0 ? 5 : dir.x === -1 ? 3 : 13);
          const ex1y = s.y * CS + (dir.y === -1 ? 4 : dir.y === 0 ? 5 : 12);
          const ex2x = s.x * CS + (dir.x === 0 ? 13 : dir.x === -1 ? 9 : 17);
          const ex2y = s.y * CS + (dir.y === -1 ? 8 : dir.y === 0 ? 13 : 16);
          ctx.beginPath(); ctx.arc(ex1x, ex1y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex2x, ex2y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.arc(ex1x + dir.x, ex1y + dir.y, 1.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex2x + dir.x, ex2y + dir.y, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      particles.update(); particles.draw(ctx);
      drawText(ctx, `🐍 Score: ${score}  Length: ${snake.length}`, 4, 16, 13, '#44ff44');
    }
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 12. FLAPPY BIRD ====================
  function gameFlappyBird(area, sendScore) {
    const W = 400, H = 500;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let bird = { x: 100, y: H / 2, vy: 0, rot: 0, wing: 0, wingDir: 1 };
    let pipes = [], particles = new Particles(), shake = new Shake();
    let score = 0, over = false, frame = 0, started = false;
    const GRAVITY = 0.32, FLAP = -6, PIPE_W = 52, PIPE_GAP = 135, PIPE_SPEED = 2.2;
    const clouds = Array.from({length: 6}, () => ({ x: Math.random() * W, y: 30 + Math.random() * 120, w: 40 + Math.random() * 60, speed: 0.2 + Math.random() * 0.3 }));
    const kH = (e) => {
      if (over) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); bird.vy = FLAP; started = true; SFX.flap(); }
    };
    document.addEventListener('keydown', kH);
    cvs.addEventListener('touchstart', (e) => { e.preventDefault(); if (!over) { bird.vy = FLAP; started = true; SFX.flap(); } }, { passive: false });

    const loop = setInterval(() => {
      if (over) return; frame++;
      bird.vy += GRAVITY; bird.y += bird.vy;
      bird.rot = Math.min(Math.max(bird.vy * 4, -25), 90);
      bird.wing += bird.wingDir * 0.4; if (bird.wing > 3 || bird.wing < -3) bird.wingDir *= -1;
      if (started) {
        if (frame % 100 === 0) { const gapY = 70 + Math.random() * (H - 260); pipes.push({ x: W, gapY, scored: false, color: `hsl(${120 + Math.random() * 40}, 70%, 45%)` }); }
        for (const p of pipes) { p.x -= PIPE_SPEED; if (!p.scored && p.x + PIPE_W < bird.x) { p.scored = true; score += 10; SFX.score(); } }
      }
      for (const c of clouds) { c.x -= c.speed; if (c.x + c.w < 0) { c.x = W + 10; c.y = 30 + Math.random() * 120; } }
      pipes = pipes.filter(p => p.x > -PIPE_W - 5);
      if (bird.y > H - 45 || bird.y < -10) { die(); return; }
      for (const p of pipes) {
        if (bird.x + 12 > p.x && bird.x - 8 < p.x + PIPE_W) {
          if (bird.y - 10 < p.gapY || bird.y + 10 > p.gapY + PIPE_GAP) { die(); return; }
        }
      }
      particles.update();
      function die() {
        SFX.die(); shake.trigger(6);
        particles.add(bird.x, bird.y, 20, { colors: ['#ffff00', '#ff8800', '#ff4444'], speed: 5, life: 30 });
        over = true; clearInterval(loop); sendScore(score);
      }
      // DRAW
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, '#1e90ff'); skyGrad.addColorStop(0.6, '#87ceeb'); skyGrad.addColorStop(0.85, '#90ee90'); skyGrad.addColorStop(1, '#4a7c23');
      ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
      for (const c of clouds) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(c.x, c.y, c.w * 0.25, 0, Math.PI * 2);
        ctx.arc(c.x + c.w * 0.2, c.y - 8, c.w * 0.2, 0, Math.PI * 2);
        ctx.arc(c.x + c.w * 0.35, c.y, c.w * 0.18, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#3d6a1a'; for (let x = 0; x < W; x += 6) { const h = 4 + Math.sin(x * 0.15) * 3; ctx.fillRect(x, H - 42 - h, 3, h + 4); }
      for (const p of pipes) {
        const pGrad = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
        pGrad.addColorStop(0, '#228b22'); pGrad.addColorStop(0.3, '#32cd32'); pGrad.addColorStop(0.7, '#228b22'); pGrad.addColorStop(1, '#1a6b1a');
        ctx.fillStyle = pGrad;
        ctx.shadowColor = '#115511'; ctx.shadowBlur = 4;
        ctx.fillRect(p.x, 0, PIPE_W, p.gapY);
        ctx.fillRect(p.x, p.gapY + PIPE_GAP, PIPE_W, H - p.gapY - PIPE_GAP);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#90ee90';
        ctx.fillRect(p.x - 4, p.gapY - 12, PIPE_W + 8, 12);
        ctx.fillRect(p.x - 4, p.gapY + PIPE_GAP, PIPE_W + 8, 12);
        ctx.fillStyle = '#aaffaa';
        ctx.fillRect(p.x - 2, p.gapY - 10, PIPE_W + 4, 4);
        ctx.fillRect(p.x - 2, p.gapY + PIPE_GAP + 2, PIPE_W + 4, 4);
      }
      ctx.save(); ctx.translate(bird.x, bird.y); ctx.rotate(bird.rot * Math.PI / 180);
      ctx.fillStyle = '#ffd700'; ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath(); ctx.ellipse(0, 3, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, -3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(6, -3, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5.5, -3.5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6600';
      ctx.beginPath(); ctx.moveTo(10, -1); ctx.lineTo(18, -3); ctx.lineTo(18, 3); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill();
      const wy = bird.wing;
      ctx.fillStyle = '#ffdd44';
      ctx.beginPath(); ctx.ellipse(-2, wy - 2, 9, 4, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eebb00';
      ctx.beginPath(); ctx.ellipse(-4, wy, 7, 3, -0.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      particles.draw(ctx);
      ctx.shadowBlur = 0;
      drawText(ctx, `${score}`, W / 2, 55, 32, '#fff', 'center');
      if (!started) {
        drawText(ctx, 'TAP or SPACE to flap!', W / 2, H / 2 + 80, 16, '#fff', 'center');
        drawText(ctx, '🐦', W / 2, H / 2 + 40, 40, '#fff', 'center', false);
      }
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 13. Q*BERT ====================
  function gameQbert(area, sendScore) {
    const W = 400, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const CUBE_W = 42, CUBE_H = 34, ROWS = 7;
    const TARGET_COLOR = '#44ff44';
    let cubes = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) {
      cubes.push({ row: r, col: c, color: '#ff4444', x: W / 2 + (c - r / 2) * CUBE_W * 0.92, y: 70 + r * CUBE_H * 1.15 });
    }
    let player = { row: 0, col: 0, jumping: false, jumpProgress: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 };
    let enemies = [], particles = new Particles();
    let score = 0, over = false, frame = 0;
    const getCube = (r, c) => cubes.find(cb => cb.row === r && cb.col === c);
    const getPos = (r, c) => { const cb = getCube(r, c); return cb ? { x: cb.x, y: cb.y - 12 } : null; };
    const jumpTo = (nr, nc) => {
      const from = getPos(player.row, player.col);
      const to = getPos(nr, nc);
      if (!to) { over = true; SFX.die(); clearInterval(loop); sendScore(score); return; }
      player.jumping = true; player.jumpProgress = 0;
      player.fromX = from.x; player.fromY = from.y;
      player.toX = to.x; player.toY = to.y;
      player.row = nr; player.col = nc;
    };
    const kH = (e) => {
      if (over || player.jumping) return;
      let nr = player.row, nc = player.col;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { nr--; nc--; }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { nc++; }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { nr++; nc++; }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { nr++; }
      else return;
      SFX.jump(); jumpTo(nr, nc);
    };
    document.addEventListener('keydown', kH);
    let touchSX = 0, touchSY = 0;
    cvs.addEventListener('touchstart', (e) => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; }, { passive: true });
    cvs.addEventListener('touchend', (e) => {
      if (player.jumping) return;
      const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
      let nr = player.row, nc = player.col;
      if (Math.abs(dx) > Math.abs(dy)) { if (dx > 0) nc++; else nr++; }
      else { if (dy < 0) { nr--; nc--; } else { nr++; nc++; } }
      SFX.jump(); jumpTo(nr, nc);
    }, { passive: true });

    const loop = setInterval(() => {
      if (over) return; frame++;
      if (player.jumping) {
        player.jumpProgress += 0.12;
        if (player.jumpProgress >= 1) {
          player.jumping = false; player.jumpProgress = 0;
          const cube = getCube(player.row, player.col);
          if (!cube) { over = true; SFX.die(); clearInterval(loop); sendScore(score); return; }
          if (cube.color !== TARGET_COLOR) { cube.color = TARGET_COLOR; score += 25; SFX.collect(); }
          if (cubes.every(c => c.color === TARGET_COLOR)) { score += 1000; SFX.win(); cubes.forEach(c => c.color = '#ff4444'); }
          if (Math.random() < 0.15 + frame * 0.0003) enemies.push({ row: 0, col: 0, type: Math.random() < 0.5 ? 'snake' : 'ball', prog: 0 });
        }
      }
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i]; e.prog += 0.03;
        if (e.prog >= 1) {
          e.prog = 0;
          if (e.type === 'snake') { e.row++; e.col++; } else { e.row++; }
          if (e.row >= ROWS) { enemies.splice(i, 1); continue; }
        }
        if (e.row === player.row && e.col === player.col && !player.jumping) {
          SFX.die(); over = true; clearInterval(loop); sendScore(score); return;
        }
      }
      particles.update();
      // DRAW
      ctx.fillStyle = '#0a0a2e'; ctx.fillRect(0, 0, W, H);
      for (const cube of cubes) {
        const x = cube.x, y = cube.y;
        const isTarget = cube.color === TARGET_COLOR;
        ctx.fillStyle = cube.color;
        ctx.shadowColor = cube.color; ctx.shadowBlur = isTarget ? 6 : 2;
        ctx.beginPath();
        ctx.moveTo(x, y - CUBE_H / 2);
        ctx.lineTo(x + CUBE_W / 2, y - CUBE_H / 4);
        ctx.lineTo(x + CUBE_W / 2, y + CUBE_H / 4);
        ctx.lineTo(x, y + CUBE_H / 2);
        ctx.lineTo(x - CUBE_W / 2, y + CUBE_H / 4);
        ctx.lineTo(x - CUBE_W / 2, y - CUBE_H / 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(x, y - CUBE_H / 2);
        ctx.lineTo(x + CUBE_W / 2, y - CUBE_H / 4);
        ctx.lineTo(x, y);
        ctx.lineTo(x - CUBE_W / 2, y - CUBE_H / 4);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Player
      const px = player.jumping ? player.fromX + (player.toX - player.fromX) * player.jumpProgress : getPos(player.row, player.col)?.x || 0;
      const py = player.jumping ? player.fromY + (player.toY - player.fromY) * player.jumpProgress - Math.sin(player.jumpProgress * Math.PI) * 20 : getPos(player.row, player.col)?.y || 0;
      ctx.fillStyle = '#ff8800'; ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(px, py - 10, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffaa44';
      ctx.beginPath(); ctx.arc(px, py - 12, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px - 3, py - 13, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 3, py - 13, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(px - 3, py - 13, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 3, py - 13, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6600';
      ctx.beginPath(); ctx.moveTo(px - 4, py - 5); ctx.lineTo(px + 4, py - 5); ctx.lineTo(px, py - 2); ctx.closePath(); ctx.fill();
      for (const e of enemies) {
        const ep = getPos(e.row, e.col);
        if (ep) {
          ctx.fillStyle = e.type === 'snake' ? '#ff00ff' : '#00ffff';
          ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(ep.x, ep.y - 8, 8, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
          ctx.fillText(e.type === 'snake' ? '🐍' : '💎', ep.x, ep.y - 5);
        }
      }
      particles.draw(ctx);
      drawText(ctx, `🟠 Score: ${score}`, 4, 16, 13, '#ff8800');
    }, 1000 / 20);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }

  // ==================== 14. DIG DUG ====================
  function gameDigDug(area, sendScore) {
    const W = 400, H = 400, CS = 20;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS = W / CS, ROWS = H / CS;
    let dirt = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    for (let c = 0; c < COLS; c++) dirt[0][c] = false;
    let player = { x: 4, y: 0, dir: 1, anim: 0, pumping: false, pumpTarget: null, pumpLen: 0 };
    let enemies = [
      { x: 8, y: 5, type: 'pooka', hp: 1, inflated: 0, moveTimer: 0, dir: 1 },
      { x: 14, y: 3, type: 'fygar', hp: 1, inflated: 0, moveTimer: 0, dir: -1, fireTimer: 0 },
      { x: 10, y: 8, type: 'pooka', hp: 1, inflated: 0, moveTimer: 0, dir: 1 },
      { x: 16, y: 10, type: 'fygar', hp: 1, inflated: 0, moveTimer: 0, dir: -1, fireTimer: 0 },
    ];
    let score = 0, lives = 3, over = false, frame = 0;
    const particles = new Particles();
    const kH = (e) => {
      if (over) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { movePlayer(-1, 0); player.dir = -1; }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { movePlayer(1, 0); player.dir = 1; }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') movePlayer(0, -1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') movePlayer(0, 1);
      else if (e.code === 'Space') {
        e.preventDefault();
        if (!player.pumping) {
          for (const en of enemies) {
            if (en.inflated > 0) continue;
            const dx = Math.abs(player.x - en.x), dy = Math.abs(player.y - en.y);
            if (dx + dy <= 5 && (dy === 0 || dx === 0)) {
              player.pumping = true; player.pumpTarget = en; player.pumpLen = 0;
              SFX.inflate(); break;
            }
          }
        }
      }
    };
    document.addEventListener('keydown', kH);
    let touchSX = 0, touchSY = 0;
    cvs.addEventListener('touchstart', (e) => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; }, { passive: true });
    cvs.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
      if (Math.abs(dx) + Math.abs(dy) < 10) {
        if (!player.pumping) {
          for (const en of enemies) {
            if (en.inflated > 0) continue;
            const ddx = Math.abs(player.x - en.x), ddy = Math.abs(player.y - en.y);
            if (ddx + ddy <= 5 && (ddy === 0 || ddx === 0)) { player.pumping = true; player.pumpTarget = en; player.pumpLen = 0; SFX.inflate(); break; }
          }
        }
      } else {
        if (Math.abs(dx) > Math.abs(dy)) movePlayer(dx > 0 ? 1 : -1, 0);
        else movePlayer(0, dy > 0 ? 1 : -1);
      }
    }, { passive: true });
    const movePlayer = (dx, dy) => {
      player.pumping = false;
      const nx = player.x + dx, ny = player.y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
      if (ny > 0) dirt[ny][nx] = false;
      player.x = nx; player.y = ny; player.anim++; player.dir = dx || player.dir;
      SFX.dig();
    };

    const loop = setInterval(() => {
      if (over) return; frame++;
      // Pump logic
      if (player.pumping && player.pumpTarget) {
        player.pumpLen += 0.5;
        if (player.pumpLen >= 3 || (player.pumpTarget.x === player.x && player.pumpTarget.y === player.y)) {
          player.pumpTarget.inflated++;
          if (player.pumpTarget.inflated >= 3) {
            score += 400; SFX.explode(); particles.add(player.pumpTarget.x * CS + CS / 2, player.pumpTarget.y * CS + CS / 2, 12, { colors: ['#ff4444', '#ff8800', '#ffff00'], speed: 4, life: 20 });
            player.pumpTarget.x = -1;
          }
          player.pumping = false; player.pumpTarget = null;
        }
      }
      // Enemies
      for (const e of enemies) {
        if (e.x < 0) continue;
        if (e.inflated > 0) {
          e.inflated += 0.02;
          if (e.inflated >= 4) {
            score += 200; SFX.explode(); particles.add(e.x * CS + CS / 2, e.y * CS + CS / 2, 12, { colors: ['#ff4444', '#ff8800'], speed: 4, life: 20 });
            e.x = -1;
          }
          continue;
        }
        e.moveTimer++;
        if (e.moveTimer > 20) {
          e.moveTimer = 0;
          const dx = player.x - e.x, dy = player.y - e.y;
          let mx = 0, my = 0;
          if (Math.abs(dx) + Math.abs(dy) > 1) {
            if (Math.abs(dx) > Math.abs(dy)) mx = dx > 0 ? 1 : -1;
            else my = dy > 0 ? 1 : -1;
          } else { mx = e.dir; }
          const nx = e.x + mx, ny = e.y + my;
          if (nx >= 0 && nx < COLS && ny > 0 && ny < ROWS) { e.x = nx; e.y = ny; e.dir = mx || e.dir; }
        }
        // Fygar fire
        if (e.type === 'fygar') {
          e.fireTimer++;
          if (e.fireTimer > 60) {
            e.fireTimer = 0;
            if (Math.abs(player.x - e.x) <= 3 && Math.abs(player.y - e.y) <= 1) {
              SFX.explode(); lives--;
              particles.add(player.x * CS, player.y * CS, 15, { colors: ['#ff8800', '#ffff00'], speed: 4 });
              if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
              player.x = 4; player.y = 0;
            }
          }
        }
        if (e.x === player.x && e.y === player.y && e.inflated <= 0) {
          lives--; SFX.die(); particles.add(player.x * CS, player.y * CS, 10, { colors: ['#ff0000', '#ff4444'] });
          if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
          player.x = 4; player.y = 0;
        }
      }
      particles.update();
      // DRAW
      const soilPalette = [['#6B3410', '#7B4420'], ['#5B2400', '#8B5430'], ['#7a4a2a', '#6a3a1a'], ['#8B6540', '#5a3010']];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (dirt[r][c]) {
          ctx.fillStyle = soilPalette[(r + c) % 4][0];
          ctx.fillRect(c * CS, r * CS, CS, CS);
          ctx.fillStyle = soilPalette[(r + c) % 4][1];
          ctx.fillRect(c * CS + 2, r * CS + 2, CS - 4, CS - 4);
          ctx.fillStyle = 'rgba(0,0,0,0.1)';
          for (let i = 0; i < 3; i++) ctx.fillRect(c * CS + Math.random() * CS, r * CS + Math.random() * CS, 2, 1);
        }
      }
      if (!dirt[player.y] || !dirt[player.y][player.x]) {
        ctx.fillStyle = '#0a0a1e'; ctx.fillRect(player.x * CS, player.y * CS, CS, CS);
      }
      // Pump line
      if (player.pumping && player.pumpTarget) {
        const pt = player.pumpTarget;
        ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 3; ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(player.x * CS + CS / 2, player.y * CS + CS / 2);
        ctx.lineTo(pt.x * CS + CS / 2, pt.y * CS + CS / 2); ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
      }
      // Player
      const px = player.x * CS, py = player.y * CS;
      ctx.fillStyle = '#4488ff'; ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 6;
      ctx.fillRect(px + 2, py + 2, CS - 4, CS - 4);
      ctx.fillStyle = '#66aaff'; ctx.fillRect(px + 4, py + 4, CS - 8, CS / 2 - 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.fillRect(px + 6, py + 6, 3, 3); ctx.fillRect(px + CS - 9, py + 6, 3, 3);
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(px + (player.dir > 0 ? CS - 3 : -3), py + 8, 6, 4);
      // Enemies
      for (const e of enemies) {
        if (e.x < 0) continue;
        const ex = e.x * CS, ey = e.y * CS;
        if (e.inflated > 0) {
          const r = CS / 2 + e.inflated * 3;
          ctx.fillStyle = '#ffaa00'; ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(ex + CS / 2, ey + CS / 2, r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
          ctx.fillText('!', ex + CS / 2, ey + CS / 2 + 4);
        } else {
          if (e.type === 'pooka') {
            ctx.fillStyle = '#ff44ff'; ctx.shadowColor = '#ff44ff'; ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.arc(ex + CS / 2, ey + CS / 2, CS / 2 - 2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff';
            ctx.fillRect(ex + 6, ey + 6, 3, 4); ctx.fillRect(ex + CS - 9, ey + 6, 3, 4);
            ctx.fillStyle = '#111';
            ctx.fillRect(ex + 7, ey + 7, 2, 2); ctx.fillRect(ex + CS - 8, ey + 7, 2, 2);
          } else {
            ctx.fillStyle = '#44ff88'; ctx.shadowColor = '#44ff88'; ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(ex + CS / 2, ey + 3); ctx.lineTo(ex + CS - 3, ey + CS / 2);
            ctx.lineTo(ex + CS / 2, ey + CS - 3); ctx.lineTo(ex + 3, ey + CS / 2);
            ctx.closePath(); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff';
            ctx.fillRect(ex + 6, ey + 8, 3, 3); ctx.fillRect(ex + CS - 9, ey + 8, 3, 3);
            ctx.fillStyle = '#111';
            ctx.fillRect(ex + 7, ey + 9, 2, 2); ctx.fillRect(ex + CS - 8, ey + 9, 2, 2);
            // Fygar fire breath
            if (frame % 30 < 3) {
              ctx.fillStyle = '#ff4400'; ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 8;
              const fDir = e.dir;
              for (let i = 1; i <= 3; i++) {
                ctx.globalAlpha = 1 - i * 0.25;
                ctx.beginPath(); ctx.arc(ex + CS / 2 + fDir * i * CS, ey + CS / 2, 6 - i, 0, Math.PI * 2); ctx.fill();
              }
              ctx.globalAlpha = 1; ctx.shadowBlur = 0;
            }
          }
        }
      }
      particles.draw(ctx);
      drawText(ctx, `⛏️ Score: ${score}  Lives: ${lives}`, 4, 16, 13, '#fff');
    }, 1000 / 15);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
  }



  // ===================== WALLET =====================
  function setupWallet() {
    $('#btn-deposit').addEventListener('click', () => $('#section-wallet').querySelector('.deposit-form')?.scrollIntoView({ behavior: 'smooth' }));
    $('#btn-withdraw').addEventListener('click', () => showWithdrawModal());
    $('#save-bank-btn').addEventListener('click', saveBankDetails);
    $('#submit-deposit-btn').addEventListener('click', submitDeposit);

    const proofArea = $('#deposit-proof-area');
    const proofInput = $('#deposit-proof');
    if (proofInput) {
      proofInput.addEventListener('change', () => {
        const file = proofInput.files[0];
        if (file) {
          const preview = $('#proof-preview');
          preview.innerHTML = `<p>${file.name}</p>`;
          preview.classList.remove('hidden');
        }
      });
    }
  }

  async function loadWallet() {
    const d = await api('/api/wallet');
    if (d.error) return;
    user.balance = d.balance;
    $('#wallet-balance').textContent = `R ${d.balance.toFixed(2)}`;
    $('#ws-won').textContent = `R ${user.totalEarnings || 0}`;
    $('#ws-wagered').textContent = `R ${user.totalSpent || 0}`;
    $('#ws-record').textContent = `${user.wins || 0} / ${user.losses || 0}`;
    $('#header-balance').textContent = `R ${d.balance.toFixed(0)}`;
    renderTransactions(d.transactions);
  }

  function renderTransactions(txs) {
    const list = $('#tx-list');
    if (!list) return;
    const icons = { deposit: '💰', bet: '🎲', win: '🏆', withdrawal: '🏦', refund: '↩️' };
    list.innerHTML = txs.map(t => `
      <div class="tx-item">
        <div class="tx-icon ${t.type}">${icons[t.type] || '•'}</div>
        <div class="tx-info">
          <div class="tx-type">${t.type.replace('_', ' ').toUpperCase()}</div>
          <div class="tx-date">${new Date(t.date).toLocaleDateString()}</div>
        </div>
        <div class="tx-amount ${t.amount >= 0 ? 'positive' : 'negative'}">${t.amount >= 0 ? '+' : ''}R${Math.abs(t.amount).toFixed(2)}</div>
      </div>
    `).join('');
  }

  async function saveBankDetails() {
    const bankName = $('#bank-name').value.trim();
    const bankHolder = $('#bank-holder').value.trim();
    const bankAccount = $('#bank-account').value.trim();
    const bankBranch = $('#bank-branch').value.trim();
    const d = await api('/api/bank-details', { method: 'PUT', body: JSON.stringify({ bankName, bankHolder, bankAccount, bankBranch }) });
    if (d.error) return showToast(d.error, 'error');
    user.bankName = bankName;
    user.bankHolder = bankHolder;
    user.bankAccount = bankAccount;
    user.bankBranch = bankBranch;
    showToast('Bank details saved!', 'success');
  }

  async function submitDeposit() {
    const amount = parseFloat($('#deposit-amount').value);
    if (!amount || amount < 10) return showToast('Minimum deposit R10', 'error');
    const proofInput = $('#deposit-proof');
    const file = proofInput?.files[0];

    const fd = new FormData();
    fd.append('amount', amount);
    if (file) fd.append('proof', file);

    const d = await fetch('/api/deposit', {
      method: 'POST',
      headers: { 'x-user-id': user.id },
      body: fd
    }).then(r => r.json());

    if (d.error) return showToast(d.error, 'error');
    showToast('Deposit submitted! Awaiting admin approval.', 'success');
    $('#deposit-amount').value = '';
    $('#proof-preview').classList.add('hidden');
    if (proofInput) proofInput.value = '';
  }

  function showWithdrawModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h2>🏦 Withdraw</h2>
        <p style="color:var(--text2);margin-bottom:1rem">Minimum R50. 5% admin fee. Once per 7 days.</p>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">Your balance: R${user.balance.toFixed(2)}</p>
        <div class="form-group">
          <label>Amount (R)</label>
          <input type="number" id="withdraw-amount" min="50" placeholder="Min R50">
        </div>
        <button class="btn-primary" onclick="window.oasisWithdraw()">Withdraw</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  window.oasisWithdraw = async () => {
    const amount = parseFloat($('#withdraw-amount')?.value);
    if (!amount) return showToast('Enter an amount', 'error');
    const d = await api('/api/withdraw', { method: 'POST', body: JSON.stringify({ amount }) });
    if (d.error) return showToast(d.error, 'error');
    document.querySelector('.modal-overlay')?.remove();
    showToast('Withdrawal submitted! Awaiting admin approval.', 'success');
    loadWallet();
  };

  // ===================== CHALLENGES =====================
  function setupChallenges() {
    $$('#section-challenges .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#section-challenges .tab-btn').forEach(b => b.classList.remove('active'));
        $$('#section-challenges .tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        $(`#tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
    $('#send-challenge-btn')?.addEventListener('click', sendChallenge);
  }

  async function loadChallenges() {
    const d = await api('/api/challenges');
    if (d.error) return;

    const inc = $('#incoming-list');
    if (inc) {
      inc.innerHTML = d.incoming.length ? d.incoming.map(c => `
        <div class="challenge-item">
          <div class="ci-info"><div class="ci-name">${c.challengerId}</div><div class="ci-details">${c.gameId} • ${new Date(c.date).toLocaleDateString()}</div></div>
          <div class="ci-amount">R${c.amount}</div>
          <div class="ci-actions">
            <button class="btn-small" onclick="window.oasisAcceptChallenge('${c.id}')">Accept</button>
            <button class="btn-danger" onclick="window.oasisDeclineChallenge('${c.id}')">Decline</button>
          </div>
        </div>
      `).join('') : '<p style="color:var(--text-muted)">No incoming challenges</p>';
    }

    const out = $('#outgoing-list');
    if (out) {
      out.innerHTML = d.outgoing.length ? d.outgoing.map(c => `
        <div class="challenge-item">
          <div class="ci-info"><div class="ci-name">To: ${c.targetId}</div><div class="ci-details">${c.gameId} • ${new Date(c.date).toLocaleDateString()}</div></div>
          <div class="ci-amount">R${c.amount}</div>
          <div class="ci-actions"><button class="btn-danger" onclick="window.oasisCancelChallenge('${c.id}')">Cancel</button></div>
        </div>
      `).join('') : '<p style="color:var(--text-muted)">No outgoing challenges</p>';
    }

    const badge = $('#challenges-badge');
    if (badge) {
      if (d.incoming.length > 0) { badge.textContent = d.incoming.length; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    }

    // Populate game dropdown
    const select = $('#challenge-game');
    if (select && select.options.length === 0) {
      GAMES.forEach(g => { const opt = document.createElement('option'); opt.value = g.id; opt.textContent = `${g.icon} ${g.name}`; select.appendChild(opt); });
    }
  }

  async function sendChallenge() {
    const targetUsername = $('#challenge-username')?.value?.trim();
    const gameId = $('#challenge-game')?.value;
    const amount = parseFloat($('#challenge-amount')?.value);
    if (!targetUsername || !gameId || !amount) return showToast('Fill in all fields', 'error');
    const d = await api('/api/challenge', { method: 'POST', body: JSON.stringify({ targetUsername, gameId, amount }) });
    if (d.error) return showToast(d.error, 'error');
    showToast('Challenge sent!', 'success');
    loadChallenges();
  }

  window.oasisAcceptChallenge = async (id) => {
    const d = await api(`/api/challenge/${id}/accept`, { method: 'POST' });
    if (d.error) return showToast(d.error, 'error');
    loadChallenges();
    loadWallet();
  };

  window.oasisDeclineChallenge = async (id) => {
    await api(`/api/challenge/${id}/decline`, { method: 'POST' });
    loadChallenges();
  };

  window.oasisCancelChallenge = async (id) => {
    await api(`/api/challenge/${id}/cancel`, { method: 'POST' });
    loadChallenges();
  };

  // ===================== MATCHES =====================
  async function loadMatches() {
    const d = await api('/api/matches');
    if (d.error) return;
    const list = $('#matches-list');
    if (!list) return;
    const gameNames = { 'pac-man': '🟡 Pac-Man', 'frogger': '🐸 Frogger', 'asteroids': '☄️ Asteroids', 'galaga': '🚀 Galaga', 'centipede': '🐛 Centipede', 'defender': '🛸 Defender', 'tetris': '📦 Tetris', 'arkanoid': '🧱 Arkanoid', 'donkey-kong': '🦍 Donkey Kong', 'space-invaders': '👾 Space Invaders', 'snake': '🐍 Snake', 'flappy-bird': '🐦 Flappy Bird', 'qbert': '🟠 Q*Bert', 'dig-dug': '⛏️ Dig Dug' };
    list.innerHTML = d.matches.length ? d.matches.map(m => {
      const won = m.winnerId === user.id;
      const draw = !m.winnerId;
      return `
        <div class="match-item">
          <div class="mi-icon">${gameNames[m.gameId]?.split(' ')[0] || '🎮'}</div>
          <div class="mi-info">
            <div class="mi-players">${m.players.map(p => p === user.id ? 'You' : 'Opponent').join(' vs ')}</div>
            <div class="mi-game">${gameNames[m.gameId] || m.gameId} • ${new Date(m.date).toLocaleDateString()}</div>
          </div>
          <span class="mi-result ${draw ? 'draw' : (won ? 'win' : 'loss')}">${draw ? 'DRAW' : (won ? 'WON' : 'LOST')}</span>
          <span style="font-family:var(--font-display);color:var(--accent);margin-left:1rem">R${m.pot}</span>
        </div>
      `;
    }).join('') : '<p style="color:var(--text-muted)">No matches played yet</p>';
  }

  // ===================== LEADERBOARD =====================
  async function loadLeaderboard() {
    const d = await api('/api/leaderboard');
    if (d.error) return;
    const el = $('#leaderboard');
    if (!el) return;
    let html = '<div class="lb-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem">';
    html += '<button class="btn-secondary lb-tab active" onclick="window.oasisLBTab(\'all\',this)" style="padding:8px 14px;font-size:12px">🏆 Overall</button>';
    const gameList = ['pac-man','frogger','asteroids','galaga','centipede','defender','tetris','arkanoid','donkey-kong','space-invaders','snake','flappy-bird','qbert','dig-dug'];
    const gameIcons = {'pac-man':'🟡','frogger':'🐸','asteroids':'☄️','galaga':'🚀','centipede':'🐛','defender':'🛸','tetris':'📦','arkanoid':'🧱','donkey-kong':'🦍','space-invaders':'👾','snake':'🐍','flappy-bird':'🐦','qbert':'🟠','dig-dug':'⛏️'};
    gameList.forEach(g => { html += `<button class="btn-secondary lb-tab" onclick="window.oasisLBTab('${g}',this)" style="padding:8px 14px;font-size:12px">${gameIcons[g]||'🎮'} ${g}</button>`; });
    html += '</div>';
    html += '<div id="lb-content">';
    html += d.leaderboard.map((p, i) => `
      <div class="lb-item ${i < 3 ? 'top3' : ''}">
        <div class="lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div>
        <div class="lb-name">${p.username}</div>
        <div class="lb-wins">${p.wins} wins</div>
        <div class="lb-earnings">R${p.earnings.toLocaleString()}</div>
      </div>
    `).join('');
    html += '</div>';
    el.innerHTML = html;
    window._lbData = d;
  }

  window.oasisLBTab = async (gameId, btn) => {
    $$('.lb-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const content = $('#lb-content');
    if (gameId === 'all') {
      const d = window._lbData || await api('/api/leaderboard');
      if (d.error) return;
      content.innerHTML = d.leaderboard.map((p, i) => `
        <div class="lb-item ${i < 3 ? 'top3' : ''}">
          <div class="lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div>
          <div class="lb-name">${p.username}</div>
          <div class="lb-wins">${p.wins} wins</div>
          <div class="lb-earnings">R${p.earnings.toLocaleString()}</div>
        </div>
      `).join('') || '<p style="color:var(--text-muted)">No players yet</p>';
    } else {
      const d = await api('/api/leaderboard/' + gameId);
      if (d.error) return;
      content.innerHTML = d.leaderboard.map((p, i) => `
        <div class="lb-item ${i < 3 ? 'top3' : ''}">
          <div class="lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div>
          <div class="lb-name">${p.username}</div>
          <div class="lb-wins">${p.wins} wins</div>
          <div class="lb-earnings">R${p.earnings.toLocaleString()}</div>
        </div>
      `).join('') || '<p style="color:var(--text-muted)">No matches played for this game yet</p>';
    }
  };

  // ===================== PROFILE =====================
  function loadProfile() {
    if (!user) return;
    $('#profile-avatar').textContent = user.username?.[0]?.toUpperCase() || '?';
    $('#profile-name').textContent = user.fullName || user.username;
    $('#profile-email').textContent = user.email;
    $('#profile-joined').textContent = `Joined ${new Date(user.joinedAt).toLocaleDateString()}`;
    $('#ps-wins').textContent = user.wins || 0;
    $('#ps-losses').textContent = user.losses || 0;
    $('#ps-earnings').textContent = `R ${(user.totalEarnings || 0).toLocaleString()}`;
    const total = (user.wins || 0) + (user.losses || 0);
    $('#ps-wr').textContent = total > 0 ? `${Math.round((user.wins / total) * 100)}%` : '0%';
  }

  // ===================== ONLINE =====================
  async function loadOnlinePlayers() {
    const d = await api('/api/online');
    if (d.error) return;
    const el = $('#online-players');
    if (!el) return;
    el.innerHTML = d.players.map(p => `
      <div class="player-card">
        <div class="pc-avatar">${p.username[0].toUpperCase()}</div>
        <div class="pc-info">
          <div class="pc-name">${p.username}</div>
          <div class="pc-stats">${p.wins} wins • R${p.earnings}</div>
        </div>
        <button class="pc-challenge" onclick="window.oasisQuickMatchWith('${p.username}')">Challenge</button>
      </div>
    `).join('');
  }

  window.oasisQuickMatchWith = (username) => {
    showToast(`Challenge ${username}? Open a game first!`, '');
  };

  // ===================== ADMIN =====================
  async function loadAdmin() {
    if (!user || user.role !== 'admin') return;
    const stats = await api('/api/admin/stats');
    if (stats.error) return;
    const el = $('#admin-stats');
    if (el) el.innerHTML = `
      <div class="admin-stat"><span class="as-val">${stats.totalUsers}</span><span class="as-label">Users</span></div>
      <div class="admin-stat"><span class="as-val">R${stats.totalBalance}</span><span class="as-label">Total Balance</span></div>
      <div class="admin-stat"><span class="as-val">${stats.totalMatches}</span><span class="as-label">Matches</span></div>
      <div class="admin-stat"><span class="as-val">R${stats.totalWagered}</span><span class="as-label">Total Wagered</span></div>
      <div class="admin-stat"><span class="as-val">${stats.pendingDeposits}</span><span class="as-label">Pending Deposits</span></div>
      <div class="admin-stat"><span class="as-val">${stats.pendingWithdrawals}</span><span class="as-label">Pending Withdrawals</span></div>
    `;

    // Setup admin tabs
    $$('#section-admin .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#section-admin .tab-btn').forEach(b => b.classList.remove('active'));
        $$('#section-admin .tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        $(`#tab-${btn.dataset.tab}`).classList.add('active');
        loadAdminTab(btn.dataset.tab);
      });
    });
    loadAdminTab('adm-deposits');
  }

  async function loadAdminTab(tab) {
    if (tab === 'adm-deposits') {
      const d = await api('/api/admin/deposits');
      const el = $('#adm-deposits-list');
      if (el) el.innerHTML = d.deposits.map(dep => `
        <div class="adm-item">
          <div class="adm-info">
            <strong>R${dep.amount}</strong> • ${dep.status} • ${new Date(dep.date).toLocaleDateString()}
            ${dep.proofFile ? `<a href="/uploads/${dep.proofFile}" target="_blank" style="color:var(--accent);margin-left:0.5rem">View Proof</a>` : ''}
          </div>
          <div class="adm-actions">
            ${dep.status === 'pending' ? `
              <button class="btn-small" onclick="window.oasisAdminApproveDeposit('${dep.id}')">Approve</button>
              <button class="btn-danger" onclick="window.oasisAdminRejectDeposit('${dep.id}')">Reject</button>
            ` : ''}
          </div>
        </div>
      `).join('') || '<p style="color:var(--text-muted)">No deposits</p>';
    }
    if (tab === 'adm-withdrawals') {
      const d = await api('/api/admin/withdrawals');
      const el = $('#adm-withdrawals-list');
      if (el) el.innerHTML = d.withdrawals.map(w => `
        <div class="adm-item">
          <div class="adm-info">
            <strong>R${w.amount}</strong> → ${w.bankName} ...${w.bankAccount?.slice(-4)} (${w.status}) • ${new Date(w.date).toLocaleDateString()}
          </div>
          <div class="adm-actions">
            ${w.status === 'pending' ? `
              <button class="btn-small" onclick="window.oasisAdminApproveWithdrawal('${w.id}')">Approve</button>
              <button class="btn-danger" onclick="window.oasisAdminRejectWithdrawal('${w.id}')">Reject</button>
            ` : ''}
          </div>
        </div>
      `).join('') || '<p style="color:var(--text-muted)">No withdrawals</p>';
    }
    if (tab === 'adm-users') {
      const d = await api('/api/admin/users');
      const el = $('#adm-users-list');
      if (el) el.innerHTML = d.users.map(u => `
        <div class="adm-item">
          <div class="adm-info"><strong>${u.username}</strong> • ${u.email} • R${u.balance} • ${u.wins}W/${u.losses}L</div>
        </div>
      `).join('');
    }
    if (tab === 'adm-matches') {
      const d = await api('/api/admin/matches');
      const el = $('#adm-matches-list');
      if (el) el.innerHTML = d.matches.map(m => `
        <div class="adm-item">
          <div class="adm-info">${m.gameId} • Pot: R${m.pot} • Winner: ${m.winnerId || 'Draw'} • ${new Date(m.date).toLocaleDateString()}</div>
        </div>
      `).join('');
    }
  }

  window.oasisAdminApproveDeposit = async (id) => {
    await api(`/api/admin/deposits/${id}/approve`, { method: 'PUT' });
    loadAdminTab('adm-deposits');
    loadAdmin();
  };
  window.oasisAdminRejectDeposit = async (id) => {
    await api(`/api/admin/deposits/${id}/reject`, { method: 'PUT' });
    loadAdminTab('adm-deposits');
  };
  window.oasisAdminApproveWithdrawal = async (id) => {
    await api(`/api/admin/withdrawals/${id}/approve`, { method: 'PUT' });
    loadAdminTab('adm-withdrawals');
    loadAdmin();
  };
  window.oasisAdminRejectWithdrawal = async (id) => {
    await api(`/api/admin/withdrawals/${id}/reject`, { method: 'PUT' });
    loadAdminTab('adm-withdrawals');
  };

  // ===================== UPDATE UI =====================
  function updateUserUI() {
    if (!user) return;
    $('#sidebar-username').textContent = user.username;
    $('#sidebar-balance').textContent = `R ${(user.balance || 0).toFixed(2)}`;
    $('#su-avatar').textContent = user.username?.[0]?.toUpperCase() || '?';
    $('#header-balance').textContent = `R ${(user.balance || 0).toFixed(0)}`;
    if (user.role === 'admin') $('#admin-nav-item').classList.remove('hidden');
  }

  // Auto-refresh online players
  setInterval(() => { if (user) loadOnlinePlayers(); }, 30000);
})();
