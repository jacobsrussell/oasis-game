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
      'street-fighter': () => gameStreetFighter(gameArea, sendScore),
      'asteroids': () => gameAsteroids(gameArea, sendScore),
      'mario-bros': () => gameMarioBros(gameArea, sendScore),
      'metal-slug': () => gameMetalSlug(gameArea, sendScore),
      'tetris': () => gameTetris(gameArea, sendScore),
      'arkanoid': () => gameArkanoid(gameArea, sendScore),
      'donkey-kong': () => gameDonkeyKong(gameArea, sendScore),
      'space-invaders': () => gameSpaceInvaders(gameArea, sendScore),
      'snake': () => gameSnake(gameArea, sendScore),
      'double-dragon': () => gameDoubleDragon(gameArea, sendScore),
      'contra': () => gameContra(gameArea, sendScore),
      'mortal-kombat': () => gameMortalKombat(gameArea, sendScore),
      'flappy-bird': () => gameFlappyBird(gameArea, sendScore),
    };
    if (games[gameId]) gameCleanup = games[gameId]();
  }


  // ==================== 1. PAC-MAN ====================

const SFX = {
  _ctx: null,
  _get() { if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)(); return this._ctx; },
  _osc(type, freq, dur, vol = 0.15) {
    const c = this._get(), t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur);
  },
  _noise(dur, vol = 0.1) {
    const c = this._get(), t = c.currentTime;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(g); g.connect(c.destination);
    s.start(t); s.stop(t + dur);
  },
  chomp() { this._osc('sine', 400, 0.08); setTimeout(() => this._osc('sine', 300, 0.08), 60); },
  score() { this._osc('sine', 880, 0.12); setTimeout(() => this._osc('sine', 1100, 0.15), 80); },
  die() {
    const c = this._get(), t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.5);
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.5);
  },
  hit() { this._noise(0.12); this._osc('square', 80, 0.12, 0.2); },
  shoot() { this._osc('square', 880, 0.08, 0.12); this._osc('sawtooth', 600, 0.06, 0.08); },
  jump() { this._osc('sine', 250, 0.1); setTimeout(() => this._osc('sine', 500, 0.1), 60); },
  flap() { this._osc('sine', 350, 0.06, 0.1); setTimeout(() => this._osc('sine', 450, 0.06, 0.1), 30); },
  collect() { this._osc('sine', 660, 0.1); setTimeout(() => this._osc('sine', 880, 0.12), 70); },
  explode() { this._noise(0.4, 0.2); this._osc('sawtooth', 60, 0.3, 0.2); },
  powerup() {
    const f = [440, 550, 660, 880];
    f.forEach((v, i) => setTimeout(() => this._osc('sine', v, 0.12), i * 80));
  },
  win() {
    const f = [523, 659, 784, 1047];
    f.forEach((v, i) => setTimeout(() => this._osc('sine', v, 0.2), i * 120));
  },
  bounce() { this._osc('sine', 300, 0.1, 0.1); },
  dig() { this._noise(0.06, 0.08); },
  inflate() { this._osc('sine', 200, 0.15); setTimeout(() => this._osc('sine', 250, 0.15), 100); },
  lock() { this._osc('square', 120, 0.1, 0.2); this._noise(0.05, 0.15); }
};

class Particles {
  constructor() { this.list = []; }
  add(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = (opts.speed || 2) * (0.5 + Math.random());
      this.list.push({
        x, y,
        vx: Math.cos(a) * sp * (0.3 + Math.random() * 0.7),
        vy: Math.sin(a) * sp * (0.3 + Math.random() * 0.7),
        life: opts.life || 30 + Math.random() * 30,
        maxLife: opts.life || 30 + Math.random() * 30,
        size: opts.size || 2 + Math.random() * 3,
        color: opts.color || '#fff',
        gravity: opts.gravity || 0,
        shrink: opts.shrink !== false
      });
    }
  }
  update() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.98; p.vy *= 0.98;
      p.life--;
      if (p.shrink) p.size *= 0.96;
      if (p.life <= 0 || p.size < 0.2) this.list.splice(i, 1);
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.3, p.size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  clear() { this.list = []; }
}

class Shake {
  constructor() { this.intensity = 0; this.decay = 0.9; }
  trigger(i = 6) { this.intensity = i; }
  apply(ctx, w, h) {
    if (this.intensity > 0.5) {
      const ox = (Math.random() - 0.5) * this.intensity;
      const oy = (Math.random() - 0.5) * this.intensity;
      ctx.translate(ox, oy);
      this.intensity *= this.decay;
    } else {
      this.intensity = 0;
    }
  }
}

function drawGlow(ctx, x, y, r, color, alpha = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(ctx, x, y, spikes, outerR, innerR, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI) / spikes - Math.PI / 2;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawText(ctx, text, x, y, size = 14, color = '#fff', align = 'left', stroke = true) {
  ctx.save();
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (stroke) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function easeOutQuad(t) { return t * (2 - t); }
function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

function lerpColor(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const rr = Math.round(ar + (br - ar) * t), rg = Math.round(ag + (bg - ag) * t), rb = Math.round(ab + (bb - ab) * t);
  return `#${rr.toString(16).padStart(2, '0')}${rg.toString(16).padStart(2, '0')}${rb.toString(16).padStart(2, '0')}`;
}

function gamePacMan(area, sendScore) {
  const W = 400, H = 400, CS = 20;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = new Particles();
  const shake = new Shake();
  let score = 0, lives = 3, gameOver = false, won = false;
  let frame = 0, lastTime = 0;

  const COLS = W / CS, ROWS = H / CS;
  const maze = [];
  const mazeDef = [
    '####################',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    '   #.#       #.#   ',
    '####.# ##-##.#.####',
    '    .  #   #  .    ',
    '####.# #####.#.####',
    '   #.#       #.#   ',
    '####.# #####.#.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '####################'
  ];
  for (let r = 0; r < ROWS && r < mazeDef.length; r++) {
    maze[r] = [];
    for (let c = 0; c < COLS && c < mazeDef[r].length; c++) {
      const ch = mazeDef[r][c];
      if (ch === '#') maze[r][c] = 1;
      else if (ch === 'o') { maze[r][c] = 2; }
      else if (ch === 'P') { maze[r][c] = 0; }
      else if (ch === '-') { maze[r][c] = 0; }
      else maze[r][c] = 0;
    }
  }

  let pacX = 10, pacY = 16, pacDir = { x: 0, y: 0 }, nextDir = { x: 0, y: 0 };
  let pacAngle = 0, mouthAngle = 0, mouthDir = 1;
  const ghosts = [];
  const ghostDefs = [
    { x: 10, y: 10, color: '#ff0000', name: 'blinky' },
    { x: 9, y: 10, color: '#ffb8ff', name: 'pinky' },
    { x: 11, y: 10, color: '#00ffff', name: 'inky' },
    { x: 10, y: 9, color: '#ffb852', name: 'clyde' }
  ];
  for (const g of ghostDefs) {
    ghosts.push({ ...g, startX: g.x, startY: g.y, dir: { x: 0, y: -1 }, scared: false, scaredTimer: 0 });
  }

  let dotCount = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (maze[r] && (maze[r][c] === 0 || maze[r][c] === 2)) dotCount++;
  }
  let dotsEaten = 0;

  function canMove(x, y) {
    if (y < 0 || y >= ROWS) return true;
    const wx = ((x % COLS) + COLS) % COLS;
    return maze[y] && maze[y][wx] !== 1;
  }

  const bgStars = [];
  for (let i = 0; i < 30; i++) bgStars.push({ x: Math.random() * W, y: Math.random() * H, s: 0.5 + Math.random(), b: Math.random() });

  function update(dt) {
    if (gameOver || won) return;
    frame++;
    mouthAngle += 0.15 * mouthDir;
    if (mouthAngle > 0.4 || mouthAngle < 0) mouthDir *= -1;

    if (nextDir.x !== 0 || nextDir.y !== 0) {
      const nx = pacX + nextDir.x, ny = pacY + nextDir.y;
      if (canMove(nx, ny)) { pacDir = { ...nextDir }; nextDir = { x: 0, y: 0 }; }
    }
    if (pacDir.x !== 0 || pacDir.y !== 0) {
      const nx = pacX + pacDir.x, ny = pacY + pacDir.y;
      if (canMove(nx, ny)) {
        pacX = ((nx % COLS) + COLS) % COLS;
        pacY = ny;
        pacAngle = Math.atan2(pacDir.y, pacDir.x);
      }
    }

    const cr = Math.floor(pacY), cc = ((Math.floor(pacX) % COLS) + COLS) % COLS;
    if (maze[cr] && maze[cr][cc] === 2) {
      maze[cr][cc] = 0;
      score += 10;
      dotsEaten++;
      SFX.chomp();
      particles.add(pacX * CS + CS / 2, cr * CS + CS / 2, 8, { color: '#ffd700', speed: 2 });
    } else if (maze[cr] && maze[cr][cc] === 0 && !gameOver) {
    }

    for (const g of ghosts) {
      if (frame % 4 === 0) {
        const dx = pacX - g.x, dy = pacY - g.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
          const valid = dirs.filter(d => {
            if (d.x === -g.dir.x && d.y === -g.dir.y) return false;
            const nx = Math.round(g.x) + d.x, ny = Math.round(g.y) + d.y;
            return canMove(nx, ny);
          });
          if (valid.length > 0) {
            if (g.scared) {
              g.dir = valid[Math.floor(Math.random() * valid.length)];
            } else {
              valid.sort((a, b) => {
                const da = Math.abs(dx - a.x) + Math.abs(dy - a.y);
                const db = Math.abs(dx - b.x) + Math.abs(dy - b.y);
                return da - db;
              });
              g.dir = valid[0];
            }
          }
        }
      }
      const speed = g.scared ? 0.03 : 0.06;
      const nx = g.x + g.dir.x * speed, ny = g.y + g.dir.y * speed;
      if (canMove(Math.round(nx), Math.round(ny))) {
        g.x = ((nx % COLS) + COLS) % COLS;
        g.y = ny;
      } else {
        g.dir.x *= -1; g.dir.y *= -1;
      }

      const gdx = Math.abs(g.x - pacX), gdy = Math.abs(g.y - pacY);
      if (gdx < 0.8 && gdy < 0.8) {
        if (g.scared) {
          score += 200;
          SFX.collect();
          particles.add(g.x * CS, g.y * CS, 20, { color: '#00ffff', speed: 4 });
          g.x = g.startX; g.y = g.startY;
          g.scared = false;
        } else {
          lives--;
          SFX.die();
          shake.trigger(10);
          particles.add(pacX * CS, pacY * CS, 30, { color: '#ffff00', speed: 5 });
          pacX = 10; pacY = 16; pacDir = { x: 0, y: 0 };
          if (lives <= 0) {
            gameOver = true;
            setTimeout(() => sendScore(score), 1000);
          }
        }
      }
    }

    if (dotsEaten >= dotCount * 0.8 && !won) {
      won = true;
      SFX.win();
      setTimeout(() => sendScore(score), 1500);
    }

    particles.update();
    shake.apply(ctx, W, H);
  }

  function draw() {
    const gBg = ctx.createLinearGradient(0, 0, 0, H);
    gBg.addColorStop(0, '#0a0a2e');
    gBg.addColorStop(1, '#1a0a3e');
    ctx.fillStyle = gBg;
    ctx.fillRect(0, 0, W, H);

    for (const s of bgStars) {
      const flicker = 0.4 + 0.6 * Math.sin(frame * 0.02 + s.b * 10);
      ctx.globalAlpha = flicker * 0.5;
      ctx.fillStyle = '#4444ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (maze[r] && maze[r][c] === 1) {
          ctx.fillStyle = '#1a1a6e';
          ctx.shadowColor = '#4444ff';
          ctx.shadowBlur = 6;
          ctx.fillRect(c * CS, r * CS, CS, CS);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#3333cc';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * CS + 1, r * CS + 1, CS - 2, CS - 2);
        } else if (maze[r] && maze[r][c] === 0) {
          const pulse = 0.5 + 0.5 * Math.sin(frame * 0.05 + c + r);
          ctx.fillStyle = `rgba(255,215,0,${0.15 + pulse * 0.1})`;
          ctx.beginPath();
          ctx.arc(c * CS + CS / 2, r * CS + CS / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.save();
    ctx.shadowColor = '#ffff00';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    const px = pacX * CS + CS / 2, py = pacY * CS + CS / 2;
    const mouth = 0.2 + Math.abs(Math.sin(mouthAngle)) * 0.5;
    ctx.arc(px, py, CS / 2 - 1, pacAngle + mouth, pacAngle + Math.PI * 2 - mouth);
    ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    particles.draw(ctx);

    for (const g of ghosts) {
      const gx = g.x * CS + CS / 2, gy = g.y * CS + CS / 2;
      ctx.save();
      ctx.shadowColor = g.scared ? '#0000ff' : g.color;
      ctx.shadowBlur = 10;
      const gGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, CS / 2);
      gGrad.addColorStop(0, g.scared ? '#4444ff' : g.color);
      gGrad.addColorStop(1, g.scared ? '#2200aa' : lerpColor(g.color, '#000000', 0.3));
      ctx.fillStyle = gGrad;
      ctx.beginPath();
      ctx.arc(gx, gy - 2, CS / 2 - 1, Math.PI, 0);
      ctx.lineTo(gx + CS / 2 - 1, gy + CS / 2 - 1);
      for (let w = 0; w < 3; w++) {
        const wx = gx + (CS / 2 - 1) - (w * CS / 3);
        ctx.lineTo(wx, gy + CS / 4);
        ctx.lineTo(wx - CS / 6, gy + CS / 2 - 1);
      }
      ctx.closePath();
      ctx.fill();

      if (!g.scared) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(gx - 3, gy - 3, 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(gx + 3, gy - 3, 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        const edx = pacX - g.x, edy = pacY - g.y;
        const ed = Math.sqrt(edx * edx + edy * edy) || 1;
        ctx.fillStyle = '#003';
        ctx.beginPath();
        ctx.arc(gx - 3 + (edx / ed) * 1.5, gy - 3 + (edy / ed) * 1.5, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gx + 3 + (edx / ed) * 1.5, gy - 3 + (edy / ed) * 1.5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(gx - 3, gy - 2, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gx + 3, gy - 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawText(ctx, `SCORE: ${score}`, 10, 5, 14, '#ffd700');
    drawText(ctx, `LIVES: ${lives}`, W - 10, 5, 14, '#ff4444', 'right');
    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'GAME OVER', W / 2, H / 2 - 20, 28, '#ff0000', 'center');
      drawText(ctx, `Score: ${score}`, W / 2, H / 2 + 15, 18, '#fff', 'center');
    }
    if (won && !gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'YOU WIN!', W / 2, H / 2 - 20, 28, '#00ff00', 'center');
      drawText(ctx, `Score: ${score}`, W / 2, H / 2 + 15, 18, '#ffd700', 'center');
    }
  }

  function loop() { update(1); draw(); }

  function onKey(e) {
    if (gameOver || won) return;
    switch (e.key) {
      case 'ArrowRight': case 'd': nextDir = { x: 1, y: 0 }; break;
      case 'ArrowLeft': case 'a': nextDir = { x: -1, y: 0 }; break;
      case 'ArrowUp': case 'w': nextDir = { x: 0, y: -1 }; break;
      case 'ArrowDown': case 's': nextDir = { x: 0, y: 1 }; break;
    }
  }
  document.addEventListener('keydown', onKey);
  let loopId = setInterval(loop, 1000 / 60);
  return () => { clearInterval(loopId); document.removeEventListener('keydown', onKey); };
}

function gameStreetFighter(area, sendScore) {
  var W = 600, H = 400, GROUND = H - 60;
  var canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.background = "#000";
  area.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var particles = null, shake = null;
  try { particles = new Particles(); } catch (e) {}
  try { shake = new Shake(); } catch (e) {}

  var keys = {};
  var gameTime = 60;
  var frameCount = 0;
  var gameOver = false;
  var winner = "";
  var comboTimer = 0;
  var comboCount = 0;
  var fightStart = 120;

  function safeSFX(name) {
    try { if (SFX && SFX[name]) SFX[name](); } catch (e) {}
  }

  function createFighter(x, isPlayer) {
    return {
      x: x, y: GROUND, w: 40, h: 80,
      vx: 0, vy: 0,
      hp: 100, maxHp: 100, displayHp: 100,
      facing: isPlayer ? 1 : -1,
      state: "idle", stateTimer: 0,
      isPlayer: isPlayer, isBlocking: false,
      grounded: true, hitConnected: false,
      projectiles: [],
      giColor1: isPlayer ? "#0055ee" : "#ee2222",
      giColor2: isPlayer ? "#003399" : "#aa1111",
      hairColor: isPlayer ? "#8B4513" : "#111111"
    };
  }

  var player = createFighter(150, true);
  var bot = createFighter(450, false);

  function canAttack(f) {
    return f.state !== "hit" && f.state !== "ko" && f.state !== "punch" &&
           f.state !== "kick" && f.state !== "special";
  }

  function startAttack(f, type) {
    if (!canAttack(f)) return;
    f.state = type;
    f.stateTimer = type === "punch" ? 15 : type === "kick" ? 20 : 30;
    f.hitConnected = false;
    if (type === "special") {
      f.projectiles.push({
        x: f.x + f.facing * 30, y: f.y - 48,
        vx: f.facing * 6, w: 12, damage: 12, life: 100, hit: false
      });
      safeSFX("shoot");
    }
  }

  function getHitbox(f) {
    var reach = 0;
    if (f.state === "punch") reach = 35;
    else if (f.state === "kick") reach = 45;
    else return null;
    var prog = 1 - f.stateTimer / (f.state === "punch" ? 15 : 20);
    if (prog < 0.25 || prog > 0.75) return null;
    return { x: f.x + f.facing * 18, y: f.y - 70, w: reach, h: 35 };
  }

  function boxOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function takeDamage(f, dmg) {
    if (f.isBlocking) {
      dmg = Math.floor(dmg * 0.1);
      safeSFX("lock");
    } else {
      f.state = "hit";
      f.stateTimer = 15;
      f.vx = -f.facing * 3;
      safeSFX("hit");
      if (shake) shake.trigger(4);
      if (particles) particles.add(f.x, f.y - 40, 12, { color: "#ff4488", speed: 3, life: 20 });
    }
    f.hp = Math.max(0, f.hp - dmg);
    if (f.hp <= 0 && f.state !== "ko") {
      f.state = "ko";
      f.stateTimer = 120;
      safeSFX("die");
      if (shake) shake.trigger(8);
    }
  }

  function drawArena() {
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#08001a");
    bg.addColorStop(0.4, "#150830");
    bg.addColorStop(1, "#0a0a20");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.08;
    for (var i = 0; i < 6; i++) {
      ctx.strokeStyle = i % 2 === 0 ? "#ff00ff" : "#00ffff";
      ctx.beginPath();
      ctx.moveTo(80 + i * 100, 60);
      ctx.lineTo(80 + i * 100, GROUND);
      ctx.stroke();
    }
    ctx.restore();

    drawPillar(30, 70, 35, GROUND - 70);
    drawPillar(W - 65, 70, 35, GROUND - 70);

    var fg = ctx.createLinearGradient(0, GROUND, 0, H);
    fg.addColorStop(0, "#2a2a48");
    fg.addColorStop(1, "#14142a");
    ctx.fillStyle = fg;
    ctx.fillRect(0, GROUND, W, H - GROUND);

    ctx.save();
    ctx.shadowColor = "#00ffff";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "#00aacc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    ctx.lineTo(W, GROUND);
    ctx.stroke();
    ctx.restore();

    for (var tx = 0; tx < W; tx += 40) {
      ctx.strokeStyle = "rgba(0,255,255,0.06)";
      ctx.strokeRect(tx, GROUND, 40, H - GROUND);
    }
  }

  function drawPillar(x, y, w, h) {
    var pg = ctx.createLinearGradient(x, y, x + w, y);
    pg.addColorStop(0, "#1a1a3a");
    pg.addColorStop(0.5, "#3a3a5a");
    pg.addColorStop(1, "#1a1a3a");
    ctx.fillStyle = pg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(0,255,255,0.07)";
    ctx.fillRect(x + w * 0.3, y, w * 0.4, h);
    ctx.fillStyle = "#2a2a4a";
    ctx.fillRect(x - 5, y - 8, w + 10, 10);
    ctx.save();
    ctx.shadowColor = "#00ffff";
    ctx.shadowBlur = 6;
    ctx.strokeStyle = "#00aacc";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 5, y - 8, w + 10, 10);
    ctx.restore();
  }

  function drawHealthBar(x, y, w, h, hp, maxHp, name, reverse) {
    var ratio = Math.max(0, hp / maxHp);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);

    var hpGrad;
    if (ratio > 0.5) {
      hpGrad = ctx.createLinearGradient(x, y, x + w * ratio, y);
      hpGrad.addColorStop(0, "#00ff44");
      hpGrad.addColorStop(1, "#aaff00");
    } else if (ratio > 0.25) {
      hpGrad = ctx.createLinearGradient(x, y, x + w * ratio, y);
      hpGrad.addColorStop(0, "#ffcc00");
      hpGrad.addColorStop(1, "#ff8800");
    } else {
      hpGrad = ctx.createLinearGradient(x, y, x + w * ratio, y);
      hpGrad.addColorStop(0, "#ff4444");
      hpGrad.addColorStop(1, "#ff0000");
    }

    ctx.save();
    if (reverse) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.fillStyle = hpGrad;
      ctx.fillRect(0, 0, w * ratio, h);
    } else {
      ctx.fillStyle = hpGrad;
      ctx.fillRect(x, y, w * ratio, h);
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = ratio > 0.25 ? "#00ffaa" : "#ff2222";
    ctx.shadowBlur = 6;
    ctx.strokeStyle = ratio > 0.25 ? "#00ccaa" : "#ff4444";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 4;
    drawText(ctx, name, reverse ? x + w : x, y - 6, 12, "#ffffff", reverse ? "right" : "left");
    ctx.restore();
  }

  function drawFighterChar(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.facing, 1);

    var isHit = f.state === "hit" && f.stateTimer % 4 < 2;
    var isDead = f.state === "ko";
    var hitFlash = isHit || (isDead && f.stateTimer > 90);

    if (isDead) {
      var fallProg = Math.min(1, (120 - f.stateTimer) / 30);
      ctx.rotate(fallProg * Math.PI * 0.45);
      ctx.translate(0, fallProg * 15);
    }

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 2, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    var jc = f.grounded ? 0 : -15;
    var legOff1 = 0, legOff2 = 0;
    if (f.state === "walk") {
      legOff1 = Math.sin(frameCount * 0.18) * 7;
      legOff2 = -legOff1;
    }
    var kickExt = 0;
    if (f.state === "kick") {
      var kp = 1 - f.stateTimer / 20;
      kickExt = Math.sin(kp * Math.PI) * 30;
    }
    var punchExt = 0;
    if (f.state === "punch") {
      var pp = 1 - f.stateTimer / 15;
      punchExt = Math.sin(pp * Math.PI) * 28;
    }

    var c1 = hitFlash ? "#ffffff" : f.giColor1;
    var c2 = hitFlash ? "#ffffff" : f.giColor2;
    var skin = hitFlash ? "#ffffff" : "#e8b88a";
    var hair = hitFlash ? "#dddddd" : f.hairColor;

    ctx.fillStyle = c1;
    ctx.fillRect(-12 + legOff1, -22 + jc, 11, 22);
    ctx.fillRect(3 + legOff2 + (f.state === "kick" ? kickExt : 0), -22 + jc, 11, 22);
    ctx.fillStyle = hitFlash ? "#ccc" : "#222";
    ctx.fillRect(-13 + legOff1, -2 + jc, 13, 4);
    ctx.fillRect(2 + legOff2 + (f.state === "kick" ? kickExt : 0), -2 + jc, 13, 4);

    var bodyG = ctx.createLinearGradient(0, -58 + jc, 0, -22 + jc);
    bodyG.addColorStop(0, c1);
    bodyG.addColorStop(1, c2);
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.moveTo(-15, -22 + jc);
    ctx.lineTo(-17, -56 + jc);
    ctx.lineTo(17, -56 + jc);
    ctx.lineTo(15, -22 + jc);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hitFlash ? "#aaa" : "#1a1a1a";
    ctx.fillRect(-16, -26 + jc, 32, 4);

    ctx.fillStyle = c1;
    if (f.isBlocking && !isDead) {
      ctx.fillRect(10, -48 + jc, 8, 20);
      ctx.fillRect(-18, -48 + jc, 8, 20);
    } else {
      ctx.fillRect(-22, -52 + jc, 7, 22);
      ctx.fillRect(15 + punchExt, -52 + jc, 7, 22);
    }
    ctx.fillStyle = skin;
    if (f.isBlocking && !isDead) {
      ctx.fillRect(10, -30 + jc, 8, 5);
      ctx.fillRect(-18, -30 + jc, 8, 5);
    } else {
      ctx.fillRect(-22, -32 + jc, 7, 5);
      ctx.fillRect(15 + punchExt, -32 + jc, 7, 5);
    }

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -66 + jc, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.ellipse(0, -74 + jc, 13, 7, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-13, -74 + jc, 4, 5);

    if (!hitFlash) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(3, -68 + jc, 5, 4);
      ctx.fillStyle = "#000";
      ctx.fillRect(5, -68 + jc, 3, 3);
      ctx.fillStyle = "#000";
      if (f.state === "punch" || f.state === "kick" || f.state === "special") {
        ctx.fillRect(2, -60 + jc, 5, 2);
      }
    }

    if (f.isBlocking && !isDead) {
      ctx.strokeStyle = "#00ffff";
      ctx.shadowColor = "#00ffff";
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -38 + jc, 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function drawProjectile(p) {
    ctx.save();
    ctx.shadowColor = "#0088ff";
    ctx.shadowBlur = 18;
    var pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
    pg.addColorStop(0, "#ffffff");
    pg.addColorStop(0.25, "#00ccff");
    pg.addColorStop(0.6, "#0066ff");
    pg.addColorStop(1, "rgba(0,40,255,0)");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#00aaff";
    for (var i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(p.x - p.vx * i * 2, p.y, 8 - i * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function updateBotAI() {
    if (gameOver || bot.state === "ko" || fightStart > 0) return;

    var dist = Math.abs(bot.x - player.x);
    bot.facing = player.x > bot.x ? 1 : -1;

    if (!bot.grounded) bot.vy += 0.6;
    bot.x += bot.vx;
    bot.y += bot.vy;
    if (bot.y >= GROUND) { bot.y = GROUND; bot.vy = 0; bot.grounded = true; }
    bot.x = Math.max(30, Math.min(W - 30, bot.x));

    if (bot.state === "idle" || bot.state === "walk") bot.vx *= 0.85;

    if (bot.stateTimer > 0) {
      bot.stateTimer--;
      if (bot.stateTimer <= 0 && (bot.state === "punch" || bot.state === "kick" || bot.state === "special" || bot.state === "hit")) {
        bot.state = "idle";
      }
    }

    if (bot.isBlocking && bot.stateTimer <= 0) bot.isBlocking = false;

    if (bot.state === "idle" || bot.state === "walk") {
      if (Math.random() < 0.04) {
        var r = Math.random();
        if (dist > 110) {
          bot.vx = bot.facing * 2.5;
          bot.state = "walk";
        } else if (dist < 55) {
          if (r < 0.35) startAttack(bot, "punch");
          else if (r < 0.6) startAttack(bot, "kick");
          else { bot.vx = -bot.facing * 2.5; bot.state = "walk"; }
        } else {
          if (r < 0.22) startAttack(bot, "punch");
          else if (r < 0.42) startAttack(bot, "kick");
          else if (r < 0.52) startAttack(bot, "special");
          else if (r < 0.68) { bot.vy = -11; bot.grounded = false; safeSFX("jump"); }
          else if (r < 0.82) { bot.isBlocking = true; bot.stateTimer = 35; }
          else { bot.vx = bot.facing * 2; bot.state = "walk"; }
        }
      }
    }
  }

  function update() {
    frameCount++;

    if (fightStart > 0) { fightStart--; draw(); return; }

    if (!gameOver) {
      if (frameCount % 60 === 0 && gameTime > 0) {
        gameTime--;
        if (gameTime <= 0) {
          gameOver = true;
          winner = player.hp >= bot.hp ? "PLAYER" : "BOT";
          if (winner === "PLAYER") safeSFX("win");
        }
      }

      if (player.state !== "ko" && player.state !== "hit") {
        var moving = false;
        if (keys["ArrowLeft"]) {
          player.vx = -4;
          if (canAttack(player)) player.state = "walk";
          moving = true;
        } else if (keys["ArrowRight"]) {
          player.vx = 4;
          if (canAttack(player)) player.state = "walk";
          moving = true;
        }
        if (!moving && player.state === "walk") { player.state = "idle"; player.vx = 0; }
        if (keys["ArrowUp"] && player.grounded) {
          player.vy = -12;
          player.grounded = false;
          safeSFX("jump");
        }
        player.isBlocking = !!keys["ArrowDown"];
      }

      if (!player.grounded) player.vy += 0.6;
      player.x += player.vx;
      player.y += player.vy;
      if (player.y >= GROUND) { player.y = GROUND; player.vy = 0; player.grounded = true; }
      player.x = Math.max(30, Math.min(W - 30, player.x));
      if (player.state === "idle" || player.state === "walk") player.vx *= 0.85;

      if (player.stateTimer > 0) {
        player.stateTimer--;
        if (player.stateTimer <= 0 && (player.state === "punch" || player.state === "kick" || player.state === "special" || player.state === "hit")) {
          player.state = "idle";
        }
      }

      if (player.state !== "punch" && player.state !== "kick" && player.state !== "special") {
        player.facing = bot.x > player.x ? 1 : -1;
      }

      updateBotAI();

      if ((player.state === "punch" || player.state === "kick") && !player.hitConnected) {
        var hb = getHitbox(player);
        if (hb) {
          var botBox = { x: bot.x - 18, y: bot.y - 80, w: 36, h: 80 };
          if (boxOverlap(hb, botBox)) {
            player.hitConnected = true;
            var dmg = player.state === "punch" ? 8 : 12;
            takeDamage(bot, dmg);
            comboTimer = 45;
            comboCount++;
            if (comboCount > 1) safeSFX("powerup");
          }
        }
      }

      for (var pi = player.projectiles.length - 1; pi >= 0; pi--) {
        var proj = player.projectiles[pi];
        if (proj.life > 0) {
          proj.x += proj.vx;
          proj.life--;
          var botBox2 = { x: bot.x - 18, y: bot.y - 80, w: 36, h: 80 };
          var projBox = { x: proj.x - 12, y: proj.y - 12, w: 24, h: 24 };
          if (!proj.hit && boxOverlap(projBox, botBox2)) {
            proj.hit = true;
            takeDamage(bot, proj.damage);
            proj.life = 0;
            if (particles) particles.add(proj.x, proj.y, 20, { color: "#00aaff", speed: 4, life: 25 });
          }
        }
        if (proj.life <= 0) player.projectiles.splice(pi, 1);
      }

      if ((bot.state === "punch" || bot.state === "kick") && !bot.hitConnected) {
        var bhb = getHitbox(bot);
        if (bhb) {
          var pBox = { x: player.x - 18, y: player.y - 80, w: 36, h: 80 };
          if (boxOverlap(bhb, pBox)) {
            bot.hitConnected = true;
            var bdmg = bot.state === "punch" ? 6 : 10;
            takeDamage(player, bdmg);
          }
        }
      }

      if (player.hp <= 0 && player.state !== "ko") {
        player.state = "ko";
        player.stateTimer = 120;
        gameOver = true;
        winner = "BOT";
      }
      if (bot.hp <= 0 && bot.state !== "ko") {
        bot.state = "ko";
        bot.stateTimer = 120;
        gameOver = true;
        winner = "PLAYER";
        safeSFX("win");
      }

      player.displayHp = player.displayHp > player.hp ? Math.max(player.hp, player.displayHp - 0.8) : player.hp;
      bot.displayHp = bot.displayHp > bot.hp ? Math.max(bot.hp, bot.displayHp - 0.8) : bot.hp;

      if (comboTimer > 0) { comboTimer--; if (comboTimer <= 0) comboCount = 0; }
    }

    if (particles) particles.update();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (shake) shake.apply(ctx, W, H);

    drawArena();

    for (var pi = 0; pi < player.projectiles.length; pi++) {
      if (player.projectiles[pi].life > 0) drawProjectile(player.projectiles[pi]);
    }

    if (player.x > bot.x) { drawFighterChar(bot); drawFighterChar(player); }
    else { drawFighterChar(player); drawFighterChar(bot); }

    drawHealthBar(20, 20, 230, 18, player.displayHp, player.maxHp, "PLAYER", false);
    drawHealthBar(W - 250, 20, 230, 18, bot.displayHp, bot.maxHp, "CPU", true);

    ctx.save();
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 12;
    drawText(ctx, String(Math.ceil(gameTime)), W / 2, 36, 26, "#ffcc00", "center", true);
    ctx.restore();

    if (comboCount > 1 && comboTimer > 0) {
      ctx.save();
      ctx.shadowColor = "#ff00ff";
      ctx.shadowBlur = 12;
      var cs = 1 + Math.sin(frameCount * 0.2) * 0.1;
      ctx.translate(W / 2, 75);
      ctx.scale(cs, cs);
      drawText(ctx, comboCount + " HIT!", 0, 0, 22, "#ff00ff", "center", true);
      ctx.restore();
    }

    if (fightStart > 0) {
      var ftext = fightStart > 60 ? "READY..." : "FIGHT!";
      var fsc = 1 + Math.sin(frameCount * 0.15) * 0.05;
      ctx.save();
      ctx.translate(W / 2, H / 2 - 30);
      ctx.scale(fsc, fsc);
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 25;
      drawText(ctx, ftext, 0, 0, 52, "#ffcc00", "center", true);
      ctx.restore();
    }

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      var gc = winner === "PLAYER" ? "#00ffff" : "#ff4488";
      ctx.shadowColor = gc;
      ctx.shadowBlur = 25;
      drawText(ctx, winner === "PLAYER" ? "YOU WIN!" : "YOU LOSE", W / 2, H / 2 - 20, 44, gc, "center", true);
      ctx.shadowBlur = 8;
      drawText(ctx, "Press ENTER to continue", W / 2, H / 2 + 30, 16, "#aaaaaa", "center");
      ctx.restore();
      if (keys["Enter"]) {
        var score = Math.floor((player.hp / player.maxHp) * 1000 + comboCount * 150 + gameTime * 10);
        sendScore(score);
      }
    }

    if (particles) particles.draw(ctx);
  }

  function onKeyDown(e) {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
    if (player.state !== "ko" && fightStart <= 0 && !gameOver) {
      if (e.code === "KeyZ") startAttack(player, "punch");
      if (e.code === "KeyX") startAttack(player, "kick");
      if (e.code === "KeyC") startAttack(player, "special");
    }
  }

  function onKeyUp(e) { keys[e.code] = false; }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  var loop = setInterval(update, 1000 / 60);

  return function () {
    clearInterval(loop);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };
}

function gameAsteroids(area, sendScore) {
  const W = 400, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = new Particles();
  const shake = new Shake();
  let score = 0, lives = 3, gameOver = false;
  let frame = 0;

  const ship = { x: W / 2, y: H / 2, angle: -Math.PI / 2, vx: 0, vy: 0, thrust: false, invuln: 90 };
  const bullets = [];
  const asteroids = [];
  const enemyBullets = [];
  let ufo = null;
  let ufoTimer = 600;
  let starLayers = [];
  for (let l = 0; l < 3; l++) {
    const stars = [];
    for (let i = 0; i < 40; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, speed: 0.2 + l * 0.3 });
    starLayers.push(stars);
  }

  function spawnAsteroids(count) {
    for (let i = 0; i < count; i++) {
      const a = { x: Math.random() * W, y: Math.random() * H, r: 15 + Math.random() * 20, speed: 0.3 + Math.random() * 0.8, angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.03, verts: [], color: ['#888', '#aaa', '#999'][Math.floor(Math.random() * 3)] };
      const nv = 7 + Math.floor(Math.random() * 4);
      for (let v = 0; v < nv; v++) {
        const ang = (v / nv) * Math.PI * 2;
        const rad = a.r * (0.7 + Math.random() * 0.3);
        a.verts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
      }
      a.vx = Math.cos(a.angle) * a.speed;
      a.vy = Math.sin(a.angle) * a.speed;
      asteroids.push(a);
    }
  }
  spawnAsteroids(5);

  const keys = {};
  let shootCooldown = 0;

  function update() {
    if (gameOver) return;
    frame++;
    if (shootCooldown > 0) shootCooldown--;
    if (ship.invuln > 0) ship.invuln--;

    for (const sl of starLayers) for (const s of sl) {
      if (ship.thrust) s.y += s.speed;
      else s.y += s.speed * 0.3;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }

    if (keys['ArrowLeft'] || keys['a']) ship.angle -= 0.05;
    if (keys['ArrowRight'] || keys['d']) ship.angle += 0.05;
    ship.thrust = keys['ArrowUp'] || keys['w'];
    if (ship.thrust) {
      ship.vx += Math.cos(ship.angle) * 0.08;
      ship.vy += Math.sin(ship.angle) * 0.08;
      if (frame % 3 === 0) {
        particles.add(ship.x - Math.cos(ship.angle) * 10, ship.y - Math.sin(ship.angle) * 10, 1, { color: Math.random() > 0.5 ? '#ff6600' : '#ffaa00', speed: 1.5, life: 15 });
      }
    }
    if (keys[' '] && shootCooldown <= 0) {
      SFX.shoot();
      bullets.push({ x: ship.x + Math.cos(ship.angle) * 12, y: ship.y + Math.sin(ship.angle) * 12, vx: Math.cos(ship.angle) * 5 + ship.vx * 0.3, vy: Math.sin(ship.angle) * 5 + ship.vy * 0.3, life: 50 });
      shootCooldown = 12;
    }

    ship.vx *= 0.99; ship.vy *= 0.99;
    ship.x += ship.vx; ship.y += ship.vy;
    ship.x = ((ship.x % W) + W) % W;
    ship.y = ((ship.y % H) + H) % H;

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy;
      b.life--;
      b.x = ((b.x % W) + W) % W;
      b.y = ((b.y % H) + H) % H;
      if (b.life <= 0) bullets.splice(i, 1);
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy;
      b.life--;
      if (b.life <= 0) { enemyBullets.splice(i, 1); continue; }
      const dx = b.x - ship.x, dy = b.y - ship.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 && ship.invuln <= 0) {
        SFX.die(); shake.trigger(10);
        particles.add(ship.x, ship.y, 30, { color: '#00ffff', speed: 4 });
        lives--; enemyBullets.splice(i, 1);
        ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0; ship.invuln = 90;
        if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
      }
    }

    for (let i = asteroids.length - 1; i >= 0; i--) {
      const a = asteroids[i];
      a.x += a.vx; a.y += a.vy;
      a.x = ((a.x % W) + W) % W;
      a.y = ((a.y % H) + H) % H;

      let hit = false;
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < a.r) {
          SFX.explode(); shake.trigger(5);
          particles.add(a.x, a.y, 15, { color: '#ff8800', speed: 3 });
          score += 10;
          if (a.r > 12) {
            for (let k = 0; k < 2; k++) {
              const na = { x: a.x, y: a.y, r: a.r * 0.6, speed: a.speed * 1.3, angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.05, verts: [], color: a.color, vx: 0, vy: 0 };
              const nv = 6 + Math.floor(Math.random() * 3);
              for (let v = 0; v < nv; v++) {
                const ang = (v / nv) * Math.PI * 2;
                const rad = na.r * (0.7 + Math.random() * 0.3);
                na.verts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
              }
              na.vx = Math.cos(na.angle) * na.speed;
              na.vy = Math.sin(na.angle) * na.speed;
              asteroids.push(na);
            }
          }
          asteroids.splice(i, 1);
          bullets.splice(j, 1);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      if (ship.invuln <= 0) {
        const dx = ship.x - a.x, dy = ship.y - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < a.r + 8) {
          SFX.die(); shake.trigger(10);
          particles.add(ship.x, ship.y, 30, { color: '#00ffff', speed: 4 });
          lives--;
          ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0; ship.invuln = 90;
          if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
        }
      }
    }

    ufoTimer--;
    if (ufoTimer <= 0 && !ufo) {
      ufo = { x: Math.random() > 0.5 ? -15 : W + 15, y: 30 + Math.random() * 60, dir: 0, shootTimer: 60 + Math.floor(Math.random() * 60) };
      ufo.dir = ufo.x < 0 ? 1 : -1;
      ufoTimer = 400 + Math.floor(Math.random() * 400);
    }
    if (ufo) {
      ufo.x += ufo.dir * 1.2;
      ufo.shootTimer--;
      if (ufo.shootTimer <= 0) {
        const dx = ship.x - ufo.x, dy = ship.y - ufo.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        enemyBullets.push({ x: ufo.x, y: ufo.y, vx: (dx / d) * 2, vy: (dy / d) * 2, life: 80 });
        ufo.shootTimer = 40 + Math.floor(Math.random() * 60);
      }
      if (ufo.x < -20 || ufo.x > W + 20) ufo = null;

      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        const dx = b.x - ufo.x, dy = b.y - ufo.y;
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          SFX.explode(); shake.trigger(6);
          particles.add(ufo.x, ufo.y, 20, { color: '#ff00ff', speed: 4 });
          score += 100;
          bullets.splice(j, 1);
          ufo = null;
          break;
        }
      }
    }

    if (asteroids.length === 0) {
      spawnAsteroids(5 + Math.floor(score / 100));
    }

    particles.update();
    shake.apply(ctx, W, H);
  }

  function draw() {
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    for (let l = 0; l < 3; l++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + l * 0.15})`;
      for (const s of starLayers[l]) {
        ctx.fillRect(s.x, s.y, 1 + l * 0.3, 1 + l * 0.3);
      }
    }

    ctx.save();
    if (ship.invuln > 0 && frame % 6 < 3) ctx.globalAlpha = 0.4;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    const sGrad = ctx.createLinearGradient(-8, -6, -8, 6);
    sGrad.addColorStop(0, '#00ffff');
    sGrad.addColorStop(0.5, '#0066ff');
    sGrad.addColorStop(1, '#0033aa');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();

    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffff00';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    for (const a of asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.shadowColor = '#aaa';
      ctx.shadowBlur = 3;
      const aGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, a.r);
      aGrad.addColorStop(0, lerpColor(a.color, '#ffffff', 0.2));
      aGrad.addColorStop(1, lerpColor(a.color, '#000000', 0.3));
      ctx.fillStyle = aGrad;
      ctx.beginPath();
      ctx.moveTo(a.verts[0].x, a.verts[0].y);
      for (let v = 1; v < a.verts.length; v++) ctx.lineTo(a.verts[v].x, a.verts[v].y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = lerpColor(a.color, '#ffffff', 0.3);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    if (ufo) {
      ctx.save();
      ctx.translate(ufo.x, ufo.y);
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 10;
      const uGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
      uGrad.addColorStop(0, '#ff88ff');
      uGrad.addColorStop(1, '#aa00aa');
      ctx.fillStyle = uGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 5, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 8, 0, 0, Math.PI);
      ctx.fill();
      ctx.restore();
    }

    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ff3333';
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    particles.draw(ctx);
    drawText(ctx, `SCORE: ${score}`, 10, 5, 14, '#00ffff');
    drawText(ctx, `LIVES: ${lives}`, W - 10, 5, 14, '#ff4444', 'right');

    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      drawText(ctx, 'GAME OVER', W / 2, H / 2 - 20, 28, '#ff0000', 'center');
      drawText(ctx, `Score: ${score}`, W / 2, H / 2 + 15, 18, '#fff', 'center');
    }
  }

  function onKey(e) { keys[e.key] = true; e.preventDefault(); }
  function onUp(e) { keys[e.key] = false; }

  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onUp);
  let loopId = setInterval(() => { update(); draw(); }, 1000 / 60);
  return () => { clearInterval(loopId); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onUp); };
}

function gameMarioBros(area, sendScore) {
  var W = 600, H = 400;
  var canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.background = "#000";
  area.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var particles = null, shake = null;
  try { particles = new Particles(); } catch (e) {}
  try { shake = new Shake(); } catch (e) {}

  var GRAVITY = 0.45;
  var JUMP_FORCE = -9.5;
  var MOVE_SPD = 3.2;
  var TILE = 40;
  var keys = {};
  var frameCount = 0;
  var camX = 0;
  var score = 0;

  function safeSFX(name) {
    try { if (SFX && SFX[name]) SFX[name](); } catch (e) {}
  }

  var platforms = [
    { x: 0, y: 360, w: 1300, h: 40, type: "ground" },
    { x: 1400, y: 360, w: 500, h: 40, type: "ground" },
    { x: 2000, y: 360, w: 900, h: 40, type: "ground" },
    { x: 280, y: 280, w: 120, h: 20, type: "brick" },
    { x: 500, y: 220, w: 80, h: 20, type: "brick" },
    { x: 680, y: 260, w: 100, h: 20, type: "brick" },
    { x: 1500, y: 300, w: 80, h: 20, type: "brick" },
    { x: 1620, y: 250, w: 80, h: 20, type: "brick" },
    { x: 2100, y: 280, w: 120, h: 20, type: "brick" },
    { x: 2350, y: 220, w: 80, h: 20, type: "brick" },
    { x: 2500, y: 280, w: 80, h: 20, type: "brick" }
  ];

  var qBlocks = [
    { x: 200, y: 280, hit: false, bounceY: 0 },
    { x: 340, y: 280, hit: false, bounceY: 0 },
    { x: 520, y: 180, hit: false, bounceY: 0 },
    { x: 700, y: 220, hit: false, bounceY: 0 },
    { x: 1520, y: 260, hit: false, bounceY: 0 },
    { x: 2120, y: 240, hit: false, bounceY: 0 },
    { x: 2370, y: 180, hit: false, bounceY: 0 }
  ];

  var coinList = [
    { x: 300, y: 240, collected: false, sparkle: 0 },
    { x: 510, y: 180, collected: false, sparkle: 0 },
    { x: 720, y: 220, collected: false, sparkle: 0 },
    { x: 900, y: 320, collected: false, sparkle: 0 },
    { x: 1100, y: 300, collected: false, sparkle: 0 },
    { x: 1530, y: 220, collected: false, sparkle: 0 },
    { x: 2130, y: 200, collected: false, sparkle: 0 },
    { x: 2380, y: 140, collected: false, sparkle: 0 },
    { x: 2600, y: 300, collected: false, sparkle: 0 }
  ];

  var enemies = [
    { x: 400, y: 0, w: 28, h: 32, vx: -1, alive: true, squishTimer: 0, grounded: false, vy: 0 },
    { x: 650, y: 0, w: 28, h: 32, vx: -1.2, alive: true, squishTimer: 0, grounded: false, vy: 0 },
    { x: 1000, y: 0, w: 28, h: 32, vx: -0.8, alive: true, squishTimer: 0, grounded: false, vy: 0 },
    { x: 1500, y: 0, w: 28, h: 32, vx: -1, alive: true, squishTimer: 0, grounded: false, vy: 0 },
    { x: 1800, y: 0, w: 28, h: 32, vx: -1.1, alive: true, squishTimer: 0, grounded: false, vy: 0 },
    { x: 2200, y: 0, w: 28, h: 32, vx: -0.9, alive: true, squishTimer: 0, grounded: false, vy: 0 },
    { x: 2550, y: 0, w: 28, h: 32, vx: -1, alive: true, squishTimer: 0, grounded: false, vy: 0 }
  ];

  var pipes = [
    { x: 550, y: 320, h: 40 },
    { x: 1350, y: 300, h: 60 },
    { x: 1950, y: 320, h: 40 },
    { x: 2650, y: 310, h: 50 }
  ];

  var levelEnd = 2800;
  var flagX = 2750;

  var mario = {
    x: 80, y: 300, w: 24, h: 36,
    vx: 0, vy: 0,
    grounded: false, facing: 1,
    lives: 3, dead: false, deathTimer: 0,
    runFrame: 0, won: false
  };

  function resetMario() {
    mario.x = 80;
    mario.y = 300;
    mario.vx = 0;
    mario.vy = 0;
    mario.grounded = false;
    mario.dead = false;
    mario.deathTimer = 0;
    mario.runFrame = 0;
  }

  function initEnemies() {
    var startXs = [400, 650, 1000, 1500, 1800, 2200, 2550];
    var startVXs = [-1, -1.2, -0.8, -1, -1.1, -0.9, -1];
    for (var i = 0; i < enemies.length; i++) {
      enemies[i].x = startXs[i];
      enemies[i].vx = startVXs[i];
      enemies[i].alive = true;
      enemies[i].squishTimer = 0;
      enemies[i].grounded = false;
      enemies[i].vy = 0;
    }
  }

  for (var ei = 0; ei < enemies.length; ei++) {
    var groundY = 360;
    for (var pi2 = 0; pi2 < platforms.length; pi2++) {
      var pp = platforms[pi2];
      if (enemies[ei].x + 14 > pp.x && enemies[ei].x + 14 < pp.x + pp.w) {
        groundY = pp.y;
        break;
      }
    }
    enemies[ei].y = groundY - enemies[ei].h;
  }

  function boxOverlap2(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function resolvePlayerPhysics() {
    mario.vy += GRAVITY;
    if (mario.vy > 10) mario.vy = 10;
    mario.x += mario.vx;
    mario.y += mario.vy;

    mario.grounded = false;

    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      if (mario.x + mario.w > p.x && mario.x < p.x + p.w) {
        if (mario.y + mario.h > p.y && mario.y + mario.h < p.y + p.h + 12 && mario.vy >= 0) {
          mario.y = p.y - mario.h;
          mario.vy = 0;
          mario.grounded = true;
        }
      }
    }

    for (var j = 0; j < qBlocks.length; j++) {
      var qb = qBlocks[j];
      if (!qb.hit && mario.x + mario.w > qb.x && mario.x < qb.x + TILE) {
        if (mario.y + mario.h > qb.y && mario.y + mario.h < qb.y + TILE + 10 && mario.vy >= 0) {
          mario.y = qb.y - mario.h;
          mario.vy = 0;
          mario.grounded = true;
        }
        if (mario.y < qb.y + TILE && mario.y > qb.y - 10 && mario.vy > 0 &&
            mario.x + mario.w > qb.x + 5 && mario.x < qb.x + TILE - 5) {
        }
      }
      if (mario.vy < 0 && !qb.hit && mario.x + mario.w > qb.x + 4 && mario.x < qb.x + TILE - 4) {
        if (mario.y < qb.y + TILE && mario.y > qb.y) {
          qb.hit = true;
          qb.bounceY = -8;
          score += 100;
          safeSFX("collect");
          if (particles) particles.add(qb.x + 20, qb.y, 8, { color: "#ffcc00", speed: 2, life: 20 });
        }
      }
    }

    if (mario.y > H + 50) {
      marioDie();
    }

    if (mario.x < camX + 20) mario.x = camX + 20;
    if (mario.x > levelEnd) {
      mario.won = true;
    }
  }

  function marioDie() {
    if (mario.dead) return;
    mario.dead = true;
    mario.deathTimer = 90;
    mario.vy = -8;
    mario.vx = 0;
    safeSFX("die");
    if (shake) shake.trigger(5);
  }

  function updateEnemies() {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) {
        if (e.squishTimer > 0) e.squishTimer--;
        continue;
      }

      e.vy = (e.vy || 0) + GRAVITY;
      e.x += e.vx;
      e.y += e.vy;

      e.grounded = false;
      for (var j = 0; j < platforms.length; j++) {
        var p = platforms[j];
        if (e.x + e.w > p.x && e.x < p.x + p.w) {
          if (e.y + e.h > p.y && e.y + e.h < p.y + 15 && e.vy >= 0) {
            e.y = p.y - e.h;
            e.vy = 0;
            e.grounded = true;
          }
        }
      }

      if (e.x < camX - 60 || e.x > camX + W + 100) continue;

      if (e.grounded) {
        var onEdge = true;
        for (var k = 0; k < platforms.length; k++) {
          var pp2 = platforms[k];
          var checkX = e.vx < 0 ? e.x - 2 : e.x + e.w + 2;
          if (checkX > pp2.x && checkX < pp2.x + pp2.w && e.y + e.h >= pp2.y - 2 && e.y + e.h <= pp2.y + 10) {
            onEdge = false;
            break;
          }
        }
        if (onEdge) e.vx = -e.vx;
      }

      if (!mario.dead && !mario.won) {
        if (boxOverlap2(mario.x, mario.y, mario.w, mario.h, e.x, e.y, e.w, e.h)) {
          if (mario.vy > 0 && mario.y + mario.h - 8 < e.y + e.h * 0.5) {
            e.alive = false;
            e.squishTimer = 30;
            mario.vy = JUMP_FORCE * 0.7;
            score += 200;
            safeSFX("bounce");
            if (particles) particles.add(e.x + 14, e.y, 10, { color: "#88ff44", speed: 3, life: 15 });
          } else {
            marioDie();
          }
        }
      }
    }
  }

  function updateCoins() {
    for (var i = 0; i < coinList.length; i++) {
      var c = coinList[i];
      if (c.collected) continue;
      c.sparkle = (c.sparkle || 0) + 0.1;
      if (!mario.dead && !mario.won) {
        if (Math.abs(mario.x + 12 - c.x) < 20 && Math.abs(mario.y + 18 - c.y) < 20) {
          c.collected = true;
          score += 100;
          safeSFX("collect");
          if (particles) particles.add(c.x, c.y, 12, { color: "#ffcc00", speed: 3, life: 25 });
        }
      }
    }
  }

  function updateQBlockBounce() {
    for (var i = 0; i < qBlocks.length; i++) {
      var qb = qBlocks[i];
      if (qb.bounceY < 0) {
        qb.bounceY += 1.5;
        if (qb.bounceY >= 0) qb.bounceY = 0;
      }
    }
  }

  function drawSky() {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2244cc");
    sky.addColorStop(0.5, "#4488ee");
    sky.addColorStop(1, "#88bbff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawHills(0.1, "#225522", "#1a4418", 270);
    drawHills(0.3, "#337733", "#2a6628", 305);
    drawClouds();
  }

  function drawHills(speed, c1, c2, baseY) {
    var off = -camX * speed;
    var grad = ctx.createLinearGradient(0, baseY, 0, 360);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-50, H);
    for (var x = -50; x <= W + 50; x += 5) {
      var wx = x + off;
      var y = baseY + Math.sin(wx * 0.007) * 35 + Math.sin(wx * 0.013 + 1) * 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 50, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawClouds() {
    var off = -camX * 0.05;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (var i = 0; i < 7; i++) {
      var cx = ((i * 250 + off) % (W + 300)) - 150;
      var cy = 30 + (i % 3) * 35;
      drawSingleCloud(cx, cy, 0.6 + (i % 3) * 0.2);
    }
  }

  function drawSingleCloud(x, y, sc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.arc(22, -4, 22, 0, Math.PI * 2);
    ctx.arc(46, 0, 18, 0, Math.PI * 2);
    ctx.arc(14, -14, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGroundTiles() {
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      var sx = p.x - camX;
      if (sx + p.w < -50 || sx > W + 50) continue;

      if (p.type === "ground") {
        ctx.fillStyle = "#44aa44";
        ctx.fillRect(sx, p.y, p.w, 6);
        var dg = ctx.createLinearGradient(0, p.y + 6, 0, p.y + p.h);
        dg.addColorStop(0, "#8B6B3A");
        dg.addColorStop(1, "#6B4B2A");
        ctx.fillStyle = dg;
        ctx.fillRect(sx, p.y + 6, p.w, p.h - 6);
        ctx.strokeStyle = "#5a3a1a";
        ctx.lineWidth = 1;
        for (var bx = Math.max(0, Math.floor((camX - p.x) / 20) * 20); bx < p.w; bx += 20) {
          var lx = sx + bx;
          if (lx > -5 && lx < W + 5) {
            ctx.beginPath();
            ctx.moveTo(lx, p.y + 6);
            ctx.lineTo(lx, p.y + p.h);
            ctx.stroke();
          }
        }
        for (var by = p.y + 14; by < p.y + p.h; by += 14) {
          ctx.beginPath();
          ctx.moveTo(sx, by);
          ctx.lineTo(sx + p.w, by);
          ctx.stroke();
        }
      } else {
        var bg = ctx.createLinearGradient(sx, p.y, sx, p.y + p.h);
        bg.addColorStop(0, "#aa6633");
        bg.addColorStop(1, "#774422");
        ctx.fillStyle = bg;
        ctx.fillRect(sx, p.y, p.w, p.h);
        ctx.strokeStyle = "#553311";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
        for (var bx2 = 20; bx2 < p.w; bx2 += 20) {
          ctx.beginPath();
          ctx.moveTo(sx + bx2, p.y);
          ctx.lineTo(sx + bx2, p.y + p.h);
          ctx.stroke();
        }
      }
    }
  }

  function drawQBlocks() {
    for (var i = 0; i < qBlocks.length; i++) {
      var qb = qBlocks[i];
      var sx = qb.x - camX;
      var sy = qb.y + (qb.bounceY || 0);
      if (sx < -50 || sx > W + 50) continue;

      if (qb.hit) {
        ctx.fillStyle = "#555";
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, TILE, TILE);
        ctx.fillStyle = "#444";
        ctx.fillRect(sx + 8, sy + 8, TILE - 16, TILE - 16);
      } else {
        var qg = ctx.createLinearGradient(sx, sy, sx, sy + TILE);
        qg.addColorStop(0, "#ffcc00");
        qg.addColorStop(0.5, "#ffaa00");
        qg.addColorStop(1, "#cc8800");
        ctx.fillStyle = qg;
        ctx.fillRect(sx, sy, TILE, TILE);
        ctx.save();
        ctx.shadowColor = "#ffcc00";
        ctx.shadowBlur = 8 + Math.sin(frameCount * 0.08) * 3;
        ctx.strokeStyle = "#ffee44";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, TILE, TILE);
        ctx.restore();
        drawText(ctx, "?", sx + 20, sy + 29, 22, "#ffffff", "center", true);
      }
    }
  }

  function drawPipes() {
    for (var i = 0; i < pipes.length; i++) {
      var pip = pipes[i];
      var sx = pip.x - camX;
      if (sx < -60 || sx > W + 60) continue;
      var pw = 50;
      var ph = pip.h;

      var ppg = ctx.createLinearGradient(sx, 0, sx + pw, 0);
      ppg.addColorStop(0, "#1a7a1a");
      ppg.addColorStop(0.2, "#33bb33");
      ppg.addColorStop(0.5, "#44dd44");
      ppg.addColorStop(0.8, "#33bb33");
      ppg.addColorStop(1, "#1a7a1a");
      ctx.fillStyle = ppg;
      ctx.fillRect(sx, pip.y, pw, ph);

      var lipH = 12;
      var lipW = pw + 10;
      var lipX = sx - 5;
      var lpg = ctx.createLinearGradient(lipX, 0, lipX + lipW, 0);
      lpg.addColorStop(0, "#1a7a1a");
      lpg.addColorStop(0.2, "#33bb33");
      lpg.addColorStop(0.5, "#44dd44");
      lpg.addColorStop(0.8, "#33bb33");
      lpg.addColorStop(1, "#1a7a1a");
      ctx.fillStyle = lpg;
      ctx.fillRect(lipX, pip.y - lipH, lipW, lipH);

      ctx.strokeStyle = "#0a5a0a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(lipX, pip.y - lipH, lipW, lipH);
      ctx.strokeRect(sx, pip.y, pw, ph);
    }
  }

  function drawCoins() {
    for (var i = 0; i < coinList.length; i++) {
      var c = coinList[i];
      if (c.collected) continue;
      var sx = c.x - camX;
      if (sx < -20 || sx > W + 20) continue;

      var spin = Math.sin((c.sparkle || 0) * 2) * 0.3 + 0.7;
      var cr = 8 * spin;

      ctx.save();
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 10 + Math.sin(frameCount * 0.1 + i) * 4;
      var cg = ctx.createRadialGradient(sx, c.y, 0, sx, c.y, cr + 2);
      cg.addColorStop(0, "#ffff88");
      cg.addColorStop(0.5, "#ffcc00");
      cg.addColorStop(1, "#cc8800");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(sx, c.y, cr, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.ellipse(sx, c.y + 12, cr * 0.6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGoomba(e) {
    if (!e.alive && e.squishTimer <= 0) return;
    var sx = e.x - camX;
    if (sx < -40 || sx > W + 40) return;

    ctx.save();

    if (!e.alive) {
      var sp = 1 - e.squishTimer / 30;
      ctx.globalAlpha = 1 - sp;
      ctx.translate(sx + 14, e.y + e.h);
      ctx.scale(1 + sp * 0.5, Math.max(0.1, 1 - sp * 0.8));
      ctx.translate(-14, -e.h);
      sx = 0;
    } else {
      ctx.translate(sx, e.y);
      sx = 0;
    }

    var walkOff = Math.sin(frameCount * 0.08 + e.x) * 2;

    ctx.fillStyle = "#8B6B3A";
    ctx.beginPath();
    ctx.ellipse(sx + 14, e.h - 8, 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#6B4B2A";
    ctx.beginPath();
    ctx.ellipse(sx + 14, e.h * 0.45, 13, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.fillRect(sx + 6, e.h * 0.35, 6, 6);
    ctx.fillRect(sx + 16, e.h * 0.35, 6, 6);
    ctx.fillStyle = "#111";
    ctx.fillRect(sx + 8, e.h * 0.37, 3, 4);
    ctx.fillRect(sx + 18, e.h * 0.37, 3, 4);

    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(sx + 6, e.h * 0.55, 16, 3);

    ctx.fillStyle = "#6B4B2A";
    ctx.fillRect(sx + 4 + walkOff, e.h - 4, 8, 4);
    ctx.fillRect(sx + 14 - walkOff, e.h - 4, 8, 4);

    ctx.restore();
  }

  function drawMarioChar() {
    var sx = mario.x - camX;
    var sy = mario.y;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(sx + 12, sy + mario.h + 1, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(sx + 12, sy + mario.h);
    ctx.scale(mario.facing, 1);

    var legAnim = mario.grounded && Math.abs(mario.vx) > 0.5 ? Math.sin(mario.runFrame * 0.25) * 7 : 0;

    ctx.fillStyle = "#0044cc";
    ctx.fillRect(-5, -14 + legAnim, 5, 14);
    ctx.fillRect(1, -14 - legAnim, 5, 14);

    ctx.fillStyle = "#8B4513";
    ctx.fillRect(-6, -1 + legAnim, 7, 4);
    ctx.fillRect(0, -1 - legAnim, 7, 4);

    ctx.fillStyle = "#0044cc";
    ctx.fillRect(-7, -26, 14, 14);

    ctx.fillStyle = "#ee1111";
    ctx.fillRect(-7, -33, 14, 9);

    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(-11, -31, 4, 8);
    ctx.fillRect(7, -31, 4, 8);

    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(-7, -43, 14, 12);

    ctx.fillStyle = "#ee1111";
    ctx.fillRect(-9, -49, 18, 8);
    ctx.fillRect(-5, -53, 14, 6);

    ctx.fillStyle = "#cc0000";
    ctx.fillRect(-11, -43, 22, 4);

    ctx.fillStyle = "#000";
    ctx.fillRect(2, -40, 3, 3);

    ctx.fillStyle = "#4a2a0a";
    ctx.fillRect(-1, -36, 7, 2);

    ctx.restore();
    ctx.restore();
  }

  function drawFlag() {
    var sx = flagX - camX;
    if (sx < -50 || sx > W + 50) return;

    ctx.fillStyle = "#888";
    ctx.fillRect(sx, 200, 6, 160);

    ctx.save();
    ctx.shadowColor = "#00ff44";
    ctx.shadowBlur = 10;
    var fg = ctx.createLinearGradient(sx + 6, 200, sx + 56, 230);
    fg.addColorStop(0, "#00ff44");
    fg.addColorStop(1, "#00aa22");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(sx + 6, 200);
    ctx.lineTo(sx + 56, 215);
    ctx.lineTo(sx + 6, 230);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 6;
    drawText(ctx, "MARIO", 20, 24, 14, "#ffffff", "left");
    drawText(ctx, "x" + mario.lives, 80, 24, 14, "#ffffff", "left");
    ctx.shadowColor = "#ffcc00";
    drawText(ctx, "SCORE: " + score, 20, 46, 16, "#ffcc00", "left");
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 6;
    drawText(ctx, "COINS: " + coinList.filter(function (c) { return c.collected; }).length + "/" + coinList.length, W - 20, 24, 12, "#ffcc00", "right");
    ctx.restore();
  }

  function update() {
    frameCount++;

    if (mario.dead) {
      mario.deathTimer--;
      mario.vy += GRAVITY * 0.5;
      mario.y += mario.vy;
      if (mario.deathTimer <= 0) {
        mario.lives--;
        if (mario.lives <= 0) {
          var finalScore = score;
          sendScore(finalScore);
          return;
        }
        resetMario();
      }
      if (particles) particles.update();
      draw();
      return;
    }

    if (mario.won) {
      if (keys["Enter"]) {
        var winScore = score + mario.lives * 500 + coinList.filter(function (c) { return c.collected; }).length * 100;
        sendScore(winScore);
      }
      if (particles) particles.update();
      draw();
      return;
    }

    var left = keys["ArrowLeft"];
    var right = keys["ArrowRight"];
    var jump = keys["Space"] || keys["ArrowUp"];

    if (left && !right) {
      mario.vx = -MOVE_SPD;
      mario.facing = -1;
      mario.runFrame++;
    } else if (right && !left) {
      mario.vx = MOVE_SPD;
      mario.facing = 1;
      mario.runFrame++;
    } else {
      mario.vx *= 0.75;
      if (Math.abs(mario.vx) < 0.1) mario.vx = 0;
    }

    if (jump && mario.grounded) {
      mario.vy = JUMP_FORCE;
      mario.grounded = false;
      safeSFX("jump");
    }

    resolvePlayerPhysics();

    camX = mario.x - W * 0.4;
    if (camX < 0) camX = 0;
    var maxCam = levelEnd - W + 100;
    if (camX > maxCam) camX = maxCam;

    updateEnemies();
    updateCoins();
    updateQBlockBounce();

    if (particles) particles.update();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (shake) shake.apply(ctx, W, H);

    drawSky();
    drawPipes();
    drawGroundTiles();
    drawFlag();
    drawQBlocks();
    drawCoins();

    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].alive || enemies[i].squishTimer > 0) drawGoomba(enemies[i]);
    }

    if (!mario.dead || mario.deathTimer > 0) drawMarioChar();
    drawHUD();

    if (mario.won) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.shadowColor = "#00ff44";
      ctx.shadowBlur = 20;
      drawText(ctx, "LEVEL CLEAR!", W / 2, H / 2 - 30, 40, "#00ff44", "center", true);
      ctx.shadowBlur = 8;
      drawText(ctx, "SCORE: " + score, W / 2, H / 2 + 10, 24, "#ffcc00", "center");
      drawText(ctx, "Press ENTER to continue", W / 2, H / 2 + 50, 16, "#aaaaaa", "center");
      ctx.restore();
    }

    if (mario.dead && mario.lives <= 0) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.shadowColor = "#ff4444";
      ctx.shadowBlur = 20;
      drawText(ctx, "GAME OVER", W / 2, H / 2 - 20, 44, "#ff4444", "center", true);
      drawText(ctx, "SCORE: " + score, W / 2, H / 2 + 20, 22, "#ffcc00", "center");
      drawText(ctx, "Press ENTER to continue", W / 2, H / 2 + 55, 16, "#aaaaaa", "center");
      ctx.restore();
      if (keys["Enter"]) sendScore(score);
    }

    if (particles) particles.draw(ctx);
  }

  function onKeyDown(e) {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
  }

  function onKeyUp(e) { keys[e.code] = false; }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  var loop = setInterval(update, 1000 / 60);

  return function () {
    clearInterval(loop);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };
}


function gameMetalSlug(area, sendScore) {
  var W = 600, H = 400, GROUND_Y = 340;
  var canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.background = "#000";
  area.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var particles = null, shake = null;
  try { particles = new Particles(); } catch (e) {}
  try { shake = new Shake(); } catch (e) {}

  var keys = {};
  var frameCount = 0;
  var camX = 0;
  var killCount = 0;
  var gameOver = false;
  var scrollX = 0;
  var maxScroll = 3000;

  function safeSFX(name) {
    try { if (SFX && SFX[name]) SFX[name](); } catch (e) {}
  }

  var soldier = {
    x: 100, y: GROUND_Y, w: 22, h: 36,
    vx: 0, vy: 0,
    grounded: true, facing: 1,
    hp: 5, maxHp: 5,
    shooting: false, shootTimer: 0,
    grenadeCount: 5,
    dead: false, deathTimer: 0,
    runFrame: 0, crouching: false
  };

  var bullets = [];
  var enemyBullets = [];
  var enemies = [];
  var explosions = [];
  var grenades = [];
  var ammoPickups = [];
  var tanks = [];

  var enemySpawnTimer = 0;
  var tankSpawnTimer = 600;
  var ammoSpawnTimer = 400;
  var shootCooldown = 0;

  function spawnEnemy() {
    var ey = GROUND_Y - 32;
    enemies.push({
      x: camX + W + 40 + Math.random() * 60,
      y: ey, w: 20, h: 32,
      vx: -(1.5 + Math.random()),
      hp: 1,
      shootTimer: 60 + Math.random() * 120,
      alive: true, runFrame: 0
    });
  }

  function spawnTank() {
    tanks.push({
      x: camX + W + 60,
      y: GROUND_Y - 48, w: 80, h: 48,
      vx: -0.8,
      hp: 12, maxHp: 12,
      shootTimer: 80,
      alive: true
    });
  }

  function spawnAmmo() {
    ammoPickups.push({
      x: camX + W + 30 + Math.random() * 100,
      y: GROUND_Y - 60 - Math.random() * 40,
      w: 20, h: 20,
      bobPhase: Math.random() * Math.PI * 2,
      alive: true
    });
  }

  function boxOverlap3(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function soldierDie() {
    if (soldier.dead) return;
    soldier.dead = true;
    soldier.deathTimer = 120;
    soldier.vy = -7;
    safeSFX("die");
    if (shake) shake.trigger(6);
    if (particles) particles.add(soldier.x, soldier.y - 20, 20, { color: "#ff4444", speed: 4, life: 25 });
  }

  function addExplosion(x, y, size) {
    explosions.push({
      x: x, y: y, size: size || 30,
      timer: 30, maxTimer: 30
    });
    if (shake) shake.trigger(size > 40 ? 8 : 4);
    safeSFX("explode");
    if (particles) {
      particles.add(x, y, Math.floor(size * 0.8), { color: "#ff8800", speed: 5, life: 20 });
      particles.add(x, y, Math.floor(size * 0.4), { color: "#ffcc00", speed: 3, life: 30 });
      particles.add(x, y, Math.floor(size * 0.3), { color: "#ff2200", speed: 6, life: 15 });
    }
  }

  function drawBackground() {
    var sky = ctx.createLinearGradient(0, 0, 0, 220);
    sky.addColorStop(0, "#0a0a2a");
    sky.addColorStop(0.4, "#1a1040");
    sky.addColorStop(0.7, "#3a1a20");
    sky.addColorStop(1, "#5a3010");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, 220);

    var farOff = -camX * 0.15;
    ctx.fillStyle = "#15102a";
    for (var i = 0; i < 10; i++) {
      var bx = ((i * 130 + farOff) % (W + 200)) - 100;
      var bh = 50 + Math.sin(i * 3.2) * 30;
      ctx.fillRect(bx, 220 - bh, 90, bh);
      ctx.fillStyle = "rgba(255,200,50,0.15)";
      for (var wy = 220 - bh + 10; wy < 216; wy += 14) {
        for (var wx = bx + 8; wx < bx + 82; wx += 16) {
          ctx.fillRect(wx, wy, 6, 6);
        }
      }
      ctx.fillStyle = "#15102a";
    }

    var midOff = -camX * 0.35;
    ctx.fillStyle = "#1a1530";
    for (var j = 0; j < 8; j++) {
      var mx2 = ((j * 160 + 60 + midOff) % (W + 200)) - 100;
      var mh = 40 + Math.sin(j * 2.1) * 25;
      ctx.fillRect(mx2, 230 - mh, 100, mh);
      ctx.fillRect(mx2 + 20, 230 - mh - 15, 12, 15);
      ctx.fillStyle = "rgba(255,100,50,0.1)";
      for (var wy2 = 230 - mh + 8; wy2 < 226; wy2 += 12) {
        for (var wx2 = mx2 + 10; wx2 < mx2 + 90; wx2 += 18) {
          ctx.fillRect(wx2, wy2, 5, 5);
        }
      }
      ctx.fillStyle = "#1a1530";
    }

    var wireOff = -camX * 0.5;
    ctx.strokeStyle = "rgba(150,150,150,0.3)";
    ctx.lineWidth = 1;
    for (var wi = 0; wi < 20; wi++) {
      var wireX = ((wi * 80 + wireOff) % (W + 100)) - 50;
      ctx.beginPath();
      ctx.moveTo(wireX, 235);
      ctx.lineTo(wireX + 40, 230);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wireX + 15, 232);
      ctx.lineTo(wireX + 25, 228);
      ctx.stroke();
    }

    var gd = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    gd.addColorStop(0, "#6B5B3A");
    gd.addColorStop(0.3, "#5a4a2a");
    gd.addColorStop(1, "#3a2a1a");
    ctx.fillStyle = gd;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    var rockOff = -camX * 0.8;
    ctx.fillStyle = "rgba(80,70,50,0.5)";
    for (var ri = 0; ri < 15; ri++) {
      var rx = ((ri * 90 + rockOff) % (W + 100)) - 50;
      var ry = GROUND_Y + 5 + (ri % 3) * 12;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 6 + ri % 4, 3 + ri % 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(0,255,200,0.15)";
    ctx.lineWidth = 1;
    for (var li = 0; li < 8; li++) {
      var lx = ((li * 110 - camX * 0.6) % (W + 80)) - 40;
      ctx.beginPath();
      ctx.moveTo(lx, GROUND_Y);
      ctx.lineTo(lx + 3, GROUND_Y - 8 - li % 3 * 3);
      ctx.stroke();
    }
  }

  function drawSoldier() {
    var sx = soldier.x - camX;
    var sy = soldier.y;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(sx + 11, sy + soldier.h + 1, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(sx + 11, sy + soldier.h);
    ctx.scale(soldier.facing, 1);

    var runOff = soldier.grounded && Math.abs(soldier.vx) > 0.5 ? Math.sin(soldier.runFrame * 0.3) * 6 : 0;
    var crouchOff = soldier.crouching ? 10 : 0;

    ctx.fillStyle = "#556B2F";
    ctx.fillRect(-5, -14 + runOff + crouchOff, 5, 14 - crouchOff);
    ctx.fillRect(2, -14 - runOff + crouchOff, 5, 14 - crouchOff);

    ctx.fillStyle = "#4a3a2a";
    ctx.fillRect(-6, -1 + runOff + crouchOff, 6, 3);
    ctx.fillRect(1, -1 - runOff + crouchOff, 6, 3);

    var ug = ctx.createLinearGradient(0, -32 + crouchOff, 0, -14 + crouchOff);
    ug.addColorStop(0, "#8a7a50");
    ug.addColorStop(1, "#6a5a3a");
    ctx.fillStyle = ug;
    ctx.fillRect(-8, -32 + crouchOff, 16, 20);

    ctx.fillStyle = "#8a7a50";
    ctx.fillRect(-12, -30 + crouchOff, 4, 12);
    ctx.fillRect(8, -30 + crouchOff, 4, 12);

    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(-12, -20 + crouchOff, 4, 4);
    ctx.fillRect(8, -20 + crouchOff, 4, 4);

    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(-6, -40 + crouchOff, 12, 10);

    ctx.fillStyle = "#4a6a2a";
    ctx.fillRect(-8, -46 + crouchOff, 16, 8);
    ctx.fillRect(-6, -50 + crouchOff, 12, 6);

    ctx.fillStyle = "#3a5a1a";
    ctx.fillRect(-7, -42 + crouchOff, 14, 3);

    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(-4, -38 + crouchOff, 8, 2);

    ctx.fillStyle = "#000";
    ctx.fillRect(1, -38 + crouchOff, 3, 2);

    ctx.fillStyle = "#333";
    ctx.fillRect(10, -28 + crouchOff, 18, 4);
    ctx.fillRect(26, -30 + crouchOff, 4, 8);

    if (soldier.shootTimer > 8) {
      ctx.save();
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffff00";
      ctx.beginPath();
      ctx.arc(32, -26 + crouchOff, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(32, -26 + crouchOff, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();
  }

  function drawEnemies() {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      var sx = e.x - camX;
      if (sx < -40 || sx > W + 40) continue;

      ctx.save();
      ctx.translate(sx + 10, e.y + e.h);
      ctx.scale(-1, 1);

      var rOff = Math.sin(e.runFrame * 0.3) * 5;

      ctx.fillStyle = "#334488";
      ctx.fillRect(-4, -12 + rOff, 4, 12);
      ctx.fillRect(2, -12 - rOff, 4, 12);

      ctx.fillStyle = "#445599";
      ctx.fillRect(-6, -28, 12, 18);

      ctx.fillStyle = "#445599";
      ctx.fillRect(-10, -26, 4, 10);
      ctx.fillRect(6, -26, 4, 10);

      ctx.fillStyle = "#e8b88a";
      ctx.fillRect(-5, -34, 10, 8);

      ctx.fillStyle = "#334488";
      ctx.fillRect(-6, -38, 12, 6);

      ctx.fillStyle = "#000";
      ctx.fillRect(-1, -32, 2, 2);

      ctx.fillStyle = "#555";
      ctx.fillRect(6, -22, 12, 3);

      ctx.restore();
    }
  }

  function drawBullets() {
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      var sx = b.x - camX;
      if (sx < -10 || sx > W + 10) continue;
      ctx.save();
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffee44";
      ctx.beginPath();
      ctx.arc(sx, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(sx - b.vx * 2, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx - b.vx * 4, b.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (var j = 0; j < enemyBullets.length; j++) {
      var eb = enemyBullets[j];
      var sx2 = eb.x - camX;
      if (sx2 < -10 || sx2 > W + 10) continue;
      ctx.save();
      ctx.shadowColor = "#ff2222";
      ctx.shadowBlur = 5;
      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(sx2, eb.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTanks() {
    for (var i = 0; i < tanks.length; i++) {
      var t = tanks[i];
      if (!t.alive) continue;
      var sx = t.x - camX;
      if (sx < -100 || sx > W + 100) continue;

      ctx.fillStyle = "#333";
      ctx.fillRect(sx - 5, t.y + t.h - 10, t.w + 10, 10);
      for (var ti = 0; ti < 6; ti++) {
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(sx + 5 + ti * 15, t.y + t.h - 5, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      var tbg = ctx.createLinearGradient(sx, t.y, sx, t.y + t.h - 10);
      tbg.addColorStop(0, "#4a5a2e");
      tbg.addColorStop(1, "#3a4a1e");
      ctx.fillStyle = tbg;
      ctx.fillRect(sx, t.y, t.w, t.h - 10);

      ctx.fillStyle = "#3a4a1e";
      ctx.beginPath();
      ctx.arc(sx + t.w * 0.35, t.y, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#2a3a14";
      ctx.fillRect(sx + t.w * 0.35 + 14, t.y - 4, 35, 8);

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(sx + 10, t.y + 8, t.w - 20, 6);
      ctx.fillRect(sx + 10, t.y + 18, t.w - 20, 4);

      var hpRatio = t.hp / t.maxHp;
      ctx.fillStyle = "#111";
      ctx.fillRect(sx, t.y - 12, t.w, 6);
      var thg = ctx.createLinearGradient(sx, 0, sx + t.w * hpRatio, 0);
      thg.addColorStop(0, "#00ff44");
      thg.addColorStop(1, hpRatio > 0.3 ? "#ffcc00" : "#ff0000");
      ctx.fillStyle = thg;
      ctx.fillRect(sx, t.y - 12, t.w * hpRatio, 6);
    }
  }

  function drawExplosions() {
    for (var i = 0; i < explosions.length; i++) {
      var ex = explosions[i];
      var sx = ex.x - camX;
      var prog = 1 - ex.timer / ex.maxTimer;
      var r = ex.size * (0.5 + prog * 0.8);
      var alpha = 1 - prog;

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.shadowColor = "#ff8800";
      ctx.shadowBlur = 20;
      var eg = ctx.createRadialGradient(sx, ex.y, 0, sx, ex.y, r);
      eg.addColorStop(0, "rgba(255,255,200," + alpha + ")");
      eg.addColorStop(0.3, "rgba(255,180,50," + alpha + ")");
      eg.addColorStop(0.7, "rgba(255,80,20," + alpha * 0.6 + ")");
      eg.addColorStop(1, "rgba(100,20,0,0)");
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(sx, ex.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (prog < 0.4) {
        ctx.fillStyle = "rgba(255,255,255," + (1 - prog * 2.5) + ")";
        ctx.beginPath();
        ctx.arc(sx, ex.y, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawGrenades() {
    for (var i = 0; i < grenades.length; i++) {
      var g = grenades[i];
      var sx = g.x - camX;
      if (sx < -20 || sx > W + 20) continue;

      ctx.save();
      ctx.translate(sx, g.y);
      ctx.rotate(g.rotation || 0);
      ctx.fillStyle = "#4a6a2a";
      ctx.fillRect(-4, -3, 8, 6);
      ctx.fillStyle = "#3a5a1a";
      ctx.fillRect(-2, -5, 4, 2);
      ctx.restore();
    }
  }

  function drawAmmo() {
    for (var i = 0; i < ammoPickups.length; i++) {
      var a = ammoPickups[i];
      if (!a.alive) continue;
      var sx = a.x - camX;
      if (sx < -30 || sx > W + 30) continue;
      var bob = Math.sin(frameCount * 0.05 + a.bobPhase) * 4;

      ctx.save();
      ctx.translate(sx, a.y + bob);

      ctx.fillStyle = "#8B6B3A";
      ctx.fillRect(-10, -10, 20, 20);
      ctx.strokeStyle = "#6B4B2A";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-10, -10, 20, 20);

      ctx.fillStyle = "#cc8800";
      ctx.fillRect(-3, -6, 6, 12);
      ctx.fillRect(-6, -3, 12, 6);

      ctx.save();
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 6 + Math.sin(frameCount * 0.1) * 3;
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 1;
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.restore();

      ctx.restore();
    }
  }

  function drawHUD() {
    ctx.save();
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 6;
    drawText(ctx, "KILLS: " + killCount, 20, 24, 16, "#ffcc00", "left");
    ctx.restore();

    ctx.save();
    var hpRatio = soldier.hp / soldier.maxHp;
    ctx.fillStyle = "#111";
    ctx.fillRect(20, 36, 120, 10);
    var hg = ctx.createLinearGradient(20, 0, 20 + 120 * hpRatio, 0);
    hg.addColorStop(0, "#00ff44");
    hg.addColorStop(1, hpRatio > 0.3 ? "#ffcc00" : "#ff0000");
    ctx.fillStyle = hg;
    ctx.fillRect(20, 36, 120 * hpRatio, 10);
    ctx.strokeStyle = "#00ccaa";
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 36, 120, 10);
    drawText(ctx, "HP", 26, 35, 10, "#ffffff", "left");
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "#ff8800";
    ctx.shadowBlur = 4;
    drawText(ctx, "GRENADES: " + soldier.grenadeCount, 20, 60, 12, "#ff8800", "left");
    ctx.restore();
  }

  function update() {
    frameCount++;

    if (!gameOver) {
      if (!soldier.dead) {
        var moving = false;
        if (keys["ArrowLeft"]) {
          soldier.vx = -3;
          soldier.facing = -1;
          moving = true;
        } else if (keys["ArrowRight"]) {
          soldier.vx = 3;
          soldier.facing = 1;
          moving = true;
        }
        if (moving) soldier.runFrame++;
        if (!moving) soldier.vx *= 0.7;

        soldier.crouching = !!keys["ArrowDown"];

        if ((keys["KeyZ"] || keys["ArrowUp"]) && soldier.grounded) {
          soldier.vy = -9;
          soldier.grounded = false;
          safeSFX("jump");
        }

        if (keys["KeyX"] && shootCooldown <= 0 && !soldier.crouching) {
          bullets.push({
            x: soldier.x + soldier.facing * 25,
            y: soldier.y - 22,
            vx: soldier.facing * 8,
            damage: 1
          });
          soldier.shootTimer = 10;
          shootCooldown = 8;
          safeSFX("shoot");
        }

        if (keys["KeyC"] && soldier.grenadeCount > 0 && shootCooldown <= 0) {
          soldier.grenadeCount--;
          grenades.push({
            x: soldier.x, y: soldier.y - 30,
            vx: soldier.facing * 5, vy: -7,
            timer: 50, rotation: 0
          });
          shootCooldown = 20;
          safeSFX("shoot");
        }

        if (soldier.shootTimer > 0) soldier.shootTimer--;
      }

      if (shootCooldown > 0) shootCooldown--;

      if (!soldier.grounded) soldier.vy += 0.4;
      soldier.x += soldier.vx;
      soldier.y += soldier.vy;
      if (soldier.y >= GROUND_Y) { soldier.y = GROUND_Y; soldier.vy = 0; soldier.grounded = true; }
      soldier.x = Math.max(camX + 20, Math.min(camX + W - 20, soldier.x));

      if (soldier.dead) {
        soldier.deathTimer--;
        soldier.vy += 0.3;
        soldier.y += soldier.vy;
        if (soldier.deathTimer <= 0) {
          var finalScore = killCount * 100 + soldier.hp * 200;
          sendScore(finalScore);
          return;
        }
      }

      for (var bi = bullets.length - 1; bi >= 0; bi--) {
        var b = bullets[bi];
        b.x += b.vx;
        if (b.x < camX - 50 || b.x > camX + W + 50) { bullets.splice(bi, 1); continue; }

        var hit = false;
        for (var ei = enemies.length - 1; ei >= 0; ei--) {
          var e = enemies[ei];
          if (!e.alive) continue;
          if (boxOverlap3(b.x - 3, b.y - 3, 6, 6, e.x, e.y, e.w, e.h)) {
            e.hp -= b.damage;
            if (e.hp <= 0) {
              e.alive = false;
              killCount++;
              addExplosion(e.x + 10, e.y + 16, 25);
              score = killCount * 100;
            } else {
              if (particles) particles.add(b.x, b.y, 5, { color: "#ffcc00", speed: 2, life: 10 });
            }
            hit = true;
            break;
          }
        }
        if (!hit) {
          for (var ti = 0; ti < tanks.length; ti++) {
            var t = tanks[ti];
            if (!t.alive) continue;
            if (boxOverlap3(b.x - 3, b.y - 3, 6, 6, t.x, t.y, t.w, t.h)) {
              t.hp -= b.damage;
              if (particles) particles.add(b.x, b.y, 5, { color: "#ffaa00", speed: 2, life: 10 });
              if (t.hp <= 0) {
                t.alive = false;
                killCount += 5;
                addExplosion(t.x + t.w / 2, t.y + t.h / 2, 60);
              }
              hit = true;
              break;
            }
          }
        }
        if (hit) bullets.splice(bi, 1);
      }

      for (var gi = grenades.length - 1; gi >= 0; gi--) {
        var g = grenades[gi];
        g.vy += 0.25;
        g.x += g.vx;
        g.y += g.vy;
        g.rotation = (g.rotation || 0) + 0.15;
        g.timer--;

        if (g.y >= GROUND_Y || g.timer <= 0) {
          addExplosion(g.x, GROUND_Y - 10, 55);
          var gx = g.x;
          for (var ej = enemies.length - 1; ej >= 0; ej--) {
            var ge = enemies[ej];
            if (!ge.alive) continue;
            var dist = Math.abs(ge.x - gx);
            if (dist < 70) {
              ge.alive = false;
              killCount++;
              addExplosion(ge.x + 10, ge.y + 16, 20);
            }
          }
          for (var tj = 0; tj < tanks.length; tj++) {
            var gt = tanks[tj];
            if (!gt.alive) continue;
            var tdist = Math.abs(gt.x + gt.w / 2 - gx);
            if (tdist < 80) {
              gt.hp -= 5;
              if (gt.hp <= 0) {
                gt.alive = false;
                killCount += 5;
                addExplosion(gt.x + gt.w / 2, gt.y + gt.h / 2, 60);
              }
            }
          }
          grenades.splice(gi, 1);
        }
      }

      for (var ebi = enemyBullets.length - 1; ebi >= 0; ebi--) {
        var eb = enemyBullets[ebi];
        eb.x += eb.vx;
        if (eb.x < camX - 50 || eb.x > camX + W + 50) { enemyBullets.splice(ebi, 1); continue; }
        if (!soldier.dead && boxOverlap3(eb.x - 3, eb.y - 3, 6, 6, soldier.x - 8, soldier.y - soldier.h, 16, soldier.h)) {
          soldier.hp--;
          if (particles) particles.add(eb.x, eb.y, 8, { color: "#ff4444", speed: 3, life: 15 });
          if (soldier.hp <= 0) soldierDie();
          enemyBullets.splice(ebi, 1);
        }
      }

      for (var ei2 = enemies.length - 1; ei2 >= 0; ei2--) {
        var en = enemies[ei2];
        if (!en.alive) continue;
        var esx = en.x - camX;
        if (esx < -80) { enemies.splice(ei2, 1); continue; }

        en.x += en.vx;
        en.runFrame++;

        en.shootTimer--;
        if (en.shootTimer <= 0 && !soldier.dead) {
          en.shootTimer = 80 + Math.random() * 100;
          if (Math.abs(en.x - soldier.x) < 400) {
            var edir = soldier.x > en.x ? 1 : -1;
            enemyBullets.push({
              x: en.x + 10, y: en.y + 12,
              vx: edir * 4
            });
          }
        }

        if (!soldier.dead && boxOverlap3(soldier.x - 8, soldier.y - soldier.h, 16, soldier.h, en.x, en.y, en.w, en.h)) {
          soldier.hp--;
          if (soldier.hp <= 0) soldierDie();
          else {
            en.alive = false;
            addExplosion(en.x + 10, en.y + 16, 20);
          }
        }
      }

      for (var ti2 = tanks.length - 1; ti2 >= 0; ti2--) {
        var tk = tanks[ti2];
        if (!tk.alive) { tanks.splice(ti2, 1); continue; }
        var tsx = tk.x - camX;
        if (tsx < -120) { tanks.splice(ti2, 1); continue; }

        tk.x += tk.vx;

        tk.shootTimer--;
        if (tk.shootTimer <= 0 && !soldier.dead) {
          tk.shootTimer = 70 + Math.random() * 50;
          var tdir = soldier.x > tk.x ? 1 : -1;
          enemyBullets.push({ x: tk.x + tk.w * 0.35 + 50 * tdir, y: tk.y - 2, vx: tdir * 3.5 });
          enemyBullets.push({ x: tk.x + tk.w * 0.35 + 50 * tdir, y: tk.y + 5, vx: tdir * 3.5 });
        }

        if (!soldier.dead && boxOverlap3(soldier.x - 10, soldier.y - soldier.h, 20, soldier.h, tk.x, tk.y, tk.w, tk.h)) {
          soldier.hp -= 2;
          if (soldier.hp <= 0) soldierDie();
        }
      }

      if (!soldier.dead) {
        scrollX = soldier.x - 150;
        if (scrollX < camX) scrollX = camX;
        if (scrollX > maxScroll) scrollX = maxScroll;
        camX += (scrollX - camX) * 0.05;
      }

      enemySpawnTimer--;
      if (enemySpawnTimer <= 0 && !soldier.dead) {
        spawnEnemy();
        enemySpawnTimer = 80 + Math.random() * 60;
      }

      tankSpawnTimer--;
      if (tankSpawnTimer <= 0 && !soldier.dead) {
        spawnTank();
        tankSpawnTimer = 800 + Math.random() * 400;
      }

      ammoSpawnTimer--;
      if (ammoSpawnTimer <= 0 && !soldier.dead) {
        spawnAmmo();
        ammoSpawnTimer = 350 + Math.random() * 200;
      }

      for (var ai = ammoPickups.length - 1; ai >= 0; ai--) {
        var ap = ammoPickups[ai];
        if (!ap.alive) { ammoPickups.splice(ai, 1); continue; }
        if (!soldier.dead && boxOverlap3(soldier.x - 10, soldier.y - soldier.h, 20, soldier.h, ap.x - ap.w / 2, ap.y - ap.h / 2, ap.w, ap.h)) {
          ap.alive = false;
          soldier.grenadeCount = Math.min(soldier.grenadeCount + 3, 10);
          if (particles) particles.add(ap.x, ap.y, 10, { color: "#ffcc00", speed: 2, life: 20 });
          safeSFX("powerup");
        }
      }

      for (var xi = explosions.length - 1; xi >= 0; xi--) {
        explosions[xi].timer--;
        if (explosions[xi].timer <= 0) explosions.splice(xi, 1);
      }
    }

    if (particles) particles.update();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (shake) shake.apply(ctx, W, H);

    drawBackground();
    drawAmmo();
    drawTanks();
    drawEnemies();

    if (!soldier.dead || soldier.deathTimer > 0) drawSoldier();

    drawBullets();
    drawGrenades();
    drawExplosions();
    drawHUD();

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function onKeyDown(e) {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
  }

  function onKeyUp(e) { keys[e.code] = false; }

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  var loop = setInterval(update, 1000 / 60);

  return function () {
    clearInterval(loop);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };
}


function gameDoubleDragon(area, sendScore) {
  const W = 600, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const keys = {};
  document.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; e.preventDefault(); });
  document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  let score = 0, combo = 0, comboTimer = 0, wave = 1, spawnTimer = 0;
  let gameOver = false, playerWon = false;

  const player = {
    x: 150, y: 300, w: 40, h: 60, hp: 100, maxHp: 100,
    state: 'idle', dir: 1, stateTimer: 0, vx: 0, vy: 0,
    grounded: true, combo: 0, comboTimer: 0, attacking: false,
    invTimer: 0, frame: 0
  };

  const enemies = [];
  const particles = [];
  const hitEffects = [];

  function addParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 1) * 6,
        life: 30 + Math.random() * 20, maxLife: 50, size: 2 + Math.random() * 4, color
      });
    }
  }

  function addHitEffect(x, y) {
    hitEffects.push({ x, y, timer: 10, size: 30 });
    if (typeof Shake !== 'undefined') Shake.trigger(5);
  }

  function spawnEnemy() {
    const types = ['basic', 'basic', 'basic', 'fast', 'fast', 'heavy'];
    const t = types[Math.floor(Math.random() * Math.min(types.length, wave + 1))];
    const e = {
      x: W + 40, y: 300, w: 36, h: 56, type: t,
      hp: t === 'heavy' ? 80 : t === 'fast' ? 30 : 50,
      maxHp: t === 'heavy' ? 80 : t === 'fast' ? 30 : 50,
      speed: t === 'fast' ? 2.5 : t === 'heavy' ? 0.8 : 1.2,
      damage: t === 'heavy' ? 15 : t === 'fast' ? 5 : 10,
      state: 'walk', stateTimer: 0, dir: -1, attacking: false,
      knockback: 0, flashTimer: 0, attackCooldown: 0, frame: 0
    };
    enemies.push(e);
  }

  function drawBackground() {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    skyGrad.addColorStop(0, '#0a0020');
    skyGrad.addColorStop(0.5, '#1a0040');
    skyGrad.addColorStop(1, '#2a1050');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.7);

    // Stars
    for (let i = 0; i < 30; i++) {
      const sx = (i * 137 + 50) % W;
      const sy = (i * 89 + 20) % (H * 0.4);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.sin(Date.now() * 0.003 + i) * 0.2})`;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    // Buildings
    const buildings = [
      { x: 0, w: 80, h: 180 }, { x: 90, w: 60, h: 140 },
      { x: 160, w: 100, h: 200 }, { x: 270, w: 70, h: 160 },
      { x: 350, w: 90, h: 190 }, { x: 450, w: 70, h: 150 },
      { x: 530, w: 80, h: 170 }
    ];
    const groundY = H * 0.7;
    buildings.forEach(b => {
      const bGrad = ctx.createLinearGradient(b.x, groundY - b.h, b.x, groundY);
      bGrad.addColorStop(0, '#1a1a30');
      bGrad.addColorStop(1, '#0d0d20');
      ctx.fillStyle = bGrad;
      ctx.fillRect(b.x, groundY - b.h, b.w, b.h);

      // Windows
      for (let wy = groundY - b.h + 15; wy < groundY - 10; wy += 20) {
        for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += 18) {
          const lit = Math.sin(wx * 0.1 + wy * 0.1 + Date.now() * 0.001) > 0;
          ctx.fillStyle = lit ? '#ffcc44' : '#222244';
          ctx.fillRect(wx, wy, 8, 10);
          if (lit) {
            ctx.shadowColor = '#ffcc44';
            ctx.shadowBlur = 6;
            ctx.fillRect(wx, wy, 8, 10);
            ctx.shadowBlur = 0;
          }
        }
      }
    });

    // Neon signs
    ctx.shadowColor = '#ff00ff';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#ff00ff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('ARCADE', 180, groundY - 160);
    ctx.shadowColor = '#00ffff';
    ctx.fillStyle = '#00ffff';
    ctx.fillText('BAR', 460, groundY - 120);
    ctx.shadowBlur = 0;

    // Ground
    const gGrad = ctx.createLinearGradient(0, groundY, 0, H);
    gGrad.addColorStop(0, '#1a1a2a');
    gGrad.addColorStop(0.3, '#151525');
    gGrad.addColorStop(1, '#0a0a18');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, groundY, W, H - groundY);

    // Road lines
    ctx.strokeStyle = '#333355';
    ctx.lineWidth = 1;
    for (let lx = 0; lx < W; lx += 40) {
      ctx.beginPath();
      ctx.moveTo(lx, groundY + 15);
      ctx.lineTo(lx + 20, groundY + 15);
      ctx.stroke();
    }
  }

  function drawFighter(x, y, dir, state, frame, isPlayer, flashTimer) {
    ctx.save();
    ctx.translate(x, y);
    if (dir < 0) ctx.scale(-1, 1);

    const breathing = Math.sin(Date.now() * 0.005) * 2;
    const isFlashing = flashTimer > 0 && Math.floor(flashTimer / 2) % 2 === 0;

    if (isFlashing) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-20, -60, 40, 60);
      ctx.restore();
      return;
    }

    // Legs
    const legAnim = state === 'walk' ? Math.sin(frame * 0.3) * 8 : 0;
    const kickAnim = state === 'kick' ? Math.min(stateTimer * 3, 20) : 0;

    ctx.fillStyle = isPlayer ? '#0044aa' : '#aa2200';
    ctx.fillRect(-8, -20 + breathing, 6, 20 + legAnim);
    ctx.fillRect(2, -20 + breathing, 6, 20 - legAnim);

    if (state === 'kick' || state === 'jumpkick') {
      ctx.fillStyle = isPlayer ? '#0055cc' : '#cc3300';
      ctx.fillRect(4, -25 + breathing, 20, 6);
    }

    // Body
    const bodyGrad = ctx.createLinearGradient(-12, -55 + breathing, 12, -20 + breathing);
    if (isPlayer) {
      bodyGrad.addColorStop(0, '#0066dd');
      bodyGrad.addColorStop(1, '#003388');
    } else {
      bodyGrad.addColorStop(0, '#dd3300');
      bodyGrad.addColorStop(1, '#881100');
    }
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-12, -55 + breathing, 24, 36);

    // Arms
    const punchExtend = state === 'punch' ? Math.min(stateTimer * 4, 20) : 0;
    const uppercutExtend = (state === 'uppercut') ? Math.min(stateTimer * 5, 25) : 0;

    ctx.fillStyle = '#deb887';
    if (state === 'punch' || state === 'uppercut') {
      ctx.fillRect(10, -48 + breathing - uppercutExtend, 6, 6 + punchExtend + uppercutExtend);
      ctx.fillRect(14, -48 + breathing - uppercutExtend + punchExtend, 8, 6);
    } else {
      ctx.fillRect(12, -50 + breathing, 6, 18);
      ctx.fillRect(-18, -50 + breathing, 6, 18);
    }

    // Head
    const headGrad = ctx.createRadialGradient(0, -58 + breathing, 2, 0, -58 + breathing, 10);
    headGrad.addColorStop(0, '#ffcc99');
    headGrad.addColorStop(1, '#cc9966');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(0, -58 + breathing, 10, 0, Math.PI * 2);
    ctx.fill();

    // Headband
    ctx.fillStyle = isPlayer ? '#00ccff' : '#ff4444';
    ctx.fillRect(-11, -62 + breathing, 22, 4);

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(3, -59 + breathing, 3, 3);

    ctx.restore();
  }

  function updatePlayer() {
    if (gameOver) return;
    player.frame++;
    if (player.invTimer > 0) player.invTimer--;

    if (player.stateTimer > 0) {
      player.stateTimer--;
      if (player.stateTimer === 0) {
        player.attacking = false;
        player.state = 'idle';
      }
      return;
    }

    player.vx = 0;
    if (keys['arrowleft']) { player.vx = -3; player.dir = -1; player.state = 'walk'; }
    else if (keys['arrowright']) { player.vx = 3; player.dir = 1; player.state = 'walk'; }
    else if (!player.attacking) { player.state = 'idle'; }

    if (keys['arrowup'] && player.grounded) { player.vy = -10; player.grounded = false; }

    // Attack
    if (!player.attacking) {
      if (keys['arrowup'] && keys['z']) {
        player.state = 'uppercut'; player.stateTimer = 15; player.attacking = true;
        if (typeof SFX !== 'undefined') SFX.hit();
      } else if (keys['z']) {
        player.state = 'punch'; player.stateTimer = 8; player.attacking = true;
        if (typeof SFX !== 'undefined') SFX.hit();
      } else if (keys['x']) {
        player.state = 'kick'; player.stateTimer = 15; player.attacking = true;
        if (typeof SFX !== 'undefined') SFX.shoot();
      }
    }

    player.x += player.vx;
    if (!player.grounded) { player.vy += 0.5; player.y += player.vy; }
    if (player.y >= 300) { player.y = 300; player.vy = 0; player.grounded = true; }
    player.x = Math.max(30, Math.min(W - 30, player.x));

    // Hit detection
    if (player.attacking && player.stateTimer > 8) {
      const atkRange = player.state === 'punch' ? 45 : 55;
      const atkDmg = player.state === 'punch' ? 10 : player.state === 'uppercut' ? 25 : 20;

      enemies.forEach(e => {
        if (e.hp <= 0) return;
        const dx = Math.abs(e.x - player.x);
        const dy = Math.abs(e.y - player.y);
        if (dx < atkRange && dy < 40) {
          e.hp -= atkDmg;
          e.knockback = player.dir * (player.state === 'uppercut' ? 8 : 5);
          e.flashTimer = 8;
          addParticles(e.x, e.y - 30, 8, '#ff4444');
          addHitEffect(e.x, e.y - 30);

          combo++;
          comboTimer = 90;
          const multiplier = Math.min(combo, 10);
          score += atkDmg * multiplier;
          if (typeof SFX !== 'undefined') SFX.hit();

          if (combo >= 5) {
            enemies.forEach(e2 => {
              if (e2 !== e && e2.hp > 0 && Math.abs(e2.x - player.x) < 100) {
                e2.hp -= 15;
                e2.knockback = player.dir * 8;
                e2.flashTimer = 8;
                addParticles(e2.x, e2.y - 30, 5, '#00ffff');
              }
            });
          }
        }
      });
    }
  }

  function updateEnemies() {
    if (gameOver) return;
    spawnTimer++;
    const spawnRate = Math.max(60, 180 - wave * 15);
    if (spawnTimer >= spawnRate && enemies.filter(e => e.hp > 0).length < 6) {
      spawnEnemy();
      spawnTimer = 0;
      if (enemies.length > wave * 4) wave++;
    }

    enemies.forEach(e => {
      if (e.hp <= 0) {
        e.stateTimer++;
        return;
      }
      e.frame++;
      if (e.flashTimer > 0) e.flashTimer--;
      if (e.attackCooldown > 0) e.attackCooldown--;

      if (e.knockback !== 0) {
        e.x += e.knockback;
        e.knockback *= 0.8;
        if (Math.abs(e.knockback) < 0.5) e.knockback = 0;
        return;
      }

      const dx = player.x - e.x;
      const dist = Math.abs(dx);
      e.dir = dx > 0 ? 1 : -1;

      if (dist > 50) {
        e.x += e.dir * e.speed;
        e.state = 'walk';
      } else if (e.attackCooldown <= 0) {
        e.state = 'attack';
        e.attacking = true;
        e.stateTimer = 15;
        e.attackCooldown = 60;
      }

      if (e.attacking && e.stateTimer === 10 && player.invTimer <= 0) {
        if (dist < 60 && Math.abs(e.y - player.y) < 30) {
          player.hp -= e.damage;
          player.invTimer = 30;
          addParticles(player.x, player.y - 30, 6, '#ff8844');
          if (typeof SFX !== 'undefined') SFX.die();
          if (typeof Shake !== 'undefined') Shake.trigger(3);
          combo = 0;
          if (player.hp <= 0) {
            gameOver = true;
            player.state = 'ko';
          }
        }
      }

      if (e.stateTimer > 0) {
        e.stateTimer--;
        if (e.stateTimer === 0) e.attacking = false;
      }

      e.x = Math.max(20, Math.min(W - 20, e.x));
    });
  }

  function drawHUD() {
    // Player HP
    ctx.fillStyle = '#000';
    ctx.fillRect(14, 14, 204, 18);
    const hpPct = Math.max(0, player.hp / player.maxHp);
    const hpGrad = ctx.createLinearGradient(16, 0, 216, 0);
    hpGrad.addColorStop(0, '#00ff88');
    hpGrad.addColorStop(0.5, '#ffff00');
    hpGrad.addColorStop(1, '#ff0044');
    ctx.fillStyle = hpGrad;
    ctx.fillRect(16, 16, 200 * hpPct, 14);
    ctx.strokeStyle = '#ffffff44';
    ctx.strokeRect(14, 14, 204, 18);

    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', 16, 10);
    ctx.shadowBlur = 0;

    // Score
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('SCORE: ' + score, W - 16, 24);
    ctx.shadowBlur = 0;

    // Wave
    ctx.fillStyle = '#ff4488';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('WAVE ' + wave, W - 16, 42);

    // Combo
    if (combo > 1 && comboTimer > 0) {
      const scale = 1 + Math.sin(Date.now() * 0.01) * 0.1;
      ctx.save();
      ctx.translate(W / 2, 60);
      ctx.scale(scale, scale);
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(combo + ' HITS!', 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('x' + Math.min(combo, 10) + ' MULTIPLIER', 0, 18);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.shadowColor = '#ff0044';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ff0044';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.fillText('Final Score: ' + score, W / 2, H / 2 + 20);
    }
  }

  function update() {
    if (!gameOver) {
      updatePlayer();
      updateEnemies();
    }
    if (comboTimer > 0) comboTimer--;
    if (comboTimer === 0) combo = 0;

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = hitEffects.length - 1; i >= 0; i--) {
      hitEffects[i].timer--;
      if (hitEffects[i].timer <= 0) hitEffects.splice(i, 1);
    }

    // Remove dead enemies after animation
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].hp <= 0 && enemies[i].stateTimer > 30) {
        enemies.splice(i, 1);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    // Draw enemies
    enemies.forEach(e => {
      if (e.hp > 0 || e.stateTimer < 30) {
        drawFighter(e.x, e.y, e.dir, e.state, e.frame, false, e.flashTimer);
        // Health bar
        if (e.hp > 0) {
          const barW = 30;
          const hpPct = e.hp / e.maxHp;
          ctx.fillStyle = '#333';
          ctx.fillRect(e.x - barW / 2, e.y - 68, barW, 4);
          ctx.fillStyle = hpPct > 0.5 ? '#00ff44' : hpPct > 0.25 ? '#ffcc00' : '#ff0044';
          ctx.fillRect(e.x - barW / 2, e.y - 68, barW * hpPct, 4);
        } else {
          // Death fade
          ctx.globalAlpha = 1 - e.stateTimer / 30;
        }
        ctx.globalAlpha = 1;
      }
    });

    // Draw player
    if (player.invTimer <= 0 || Math.floor(player.invTimer / 3) % 2 === 0) {
      drawFighter(player.x, player.y, player.dir, player.state, player.frame, true, 0);
    }

    // Particles
    particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Hit effects
    hitEffects.forEach(h => {
      ctx.globalAlpha = h.timer / 10;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.size * (1 - h.timer / 10), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    drawHUD();
  }

  const loop = setInterval(() => {
    update();
    draw();
    if (gameOver) {
      clearInterval(loop);
      document.removeEventListener('keydown', arguments.callee);
      setTimeout(() => sendScore(score), 1500);
    }
  }, 1000 / 60);

  return () => {
    clearInterval(loop);
    document.onkeydown = null;
    document.onkeyup = null;
  };
}


// ==================== GAME 5: CONTRA ====================
// ==================== 7. TETRIS (gameTetris) ====================
function gameTetris(area, sendScore) {
  const PLAY_W = 250, SIDE_W = 120, W = PLAY_W + SIDE_W, H = 500, CS = 25;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
  area.appendChild(cvs);
  const ctx = cvs.getContext('2d');
  const COLS = 10, ROWS = 20;

  const PIECE_TYPES = [
    { shape: [[1,1,1,1]], name: 'I', grad: ['#00ffff', '#0088aa', '#004466'] },
    { shape: [[1,0,0],[1,1,1]], name: 'J', grad: ['#0044ff', '#0022aa', '#001166'] },
    { shape: [[0,0,1],[1,1,1]], name: 'L', grad: ['#ff8800', '#cc6600', '#884400'] },
    { shape: [[1,1],[1,1]], name: 'O', grad: ['#ffcc00', '#cc9900', '#886600'] },
    { shape: [[0,1,1],[1,1,0]], name: 'S', grad: ['#00ff88', '#00aa55', '#006633'] },
    { shape: [[0,0,0],[1,1,1],[0,1,0]], name: 'T', grad: ['#cc44ff', '#8822aa', '#551166'] },
    { shape: [[1,1,0],[0,1,1]], name: 'Z', grad: ['#ff4444', '#cc2222', '#881111'] }
  ];

  let board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let piece = null, nextPiece = null, score = 0, lines = 0, level = 1, over = false, frame = 0, dropTimer = 0;
  let lineFlash = -1, lineFlashTimer = 0, clearParticles = [];
  let bgParticles = [];
  for (let i = 0; i < 25; i++) bgParticles.push({ x: Math.random() * W, y: Math.random() * H, vy: -0.15 - Math.random() * 0.3, size: 1 + Math.random() * 1.5, alpha: 0.1 + Math.random() * 0.2 });

  const rotate = (shape) => {
    const rows = shape.length, cols = shape[0].length;
    const r = Array.from({ length: cols }, () => Array(rows).fill(0));
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) r[x][rows - 1 - y] = shape[y][x];
    return r;
  };
  const getShape = (p) => { let s = p.shape; for (let i = 0; i < p.rot; i++) s = rotate(s); return s; };
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
  const getGhostY = (p) => {
    let gy = p.y;
    while (canPlace(p, p.x, gy + 1)) gy++;
    return gy;
  };

  const newPiece = () => {
    piece = nextPiece || { ...PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)], x: 3, y: 0, rot: 0 };
    nextPiece = { ...PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)], x: 3, y: 0, rot: 0 };
    piece.x = 3; piece.y = 0; piece.rot = 0;
    if (!canPlace(piece, piece.x, piece.y)) { over = true; clearInterval(loop); sendScore(score); }
  };

  const lockPiece = () => {
    const s = getShape(piece);
    for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) {
      if (s[y][x] && piece.y + y >= 0) board[piece.y + y][piece.x + x] = piece.grad;
    }
    let cleared = 0, clearedRows = [];
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every(c => c !== null)) { clearedRows.push(y); cleared++; }
    }
    if (cleared > 0) {
      lineFlash = clearedRows[0]; lineFlashTimer = 20;
      for (const ry of clearedRows) {
        for (let x = 0; x < COLS; x++) {
          clearParticles.push({ x: x * CS + CS / 2, y: ry * CS + CS / 2, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 4 - 2, life: 30, color: board[ry][x] ? board[ry][x][0] : '#fff' });
        }
      }
      setTimeout(() => {
        for (let i = clearedRows.length - 1; i >= 0; i--) { board.splice(clearedRows[i], 1); board.unshift(Array(COLS).fill(null)); }
      }, 200);
      SFX.score(); lines += cleared;
      score += [0, 100, 300, 500, 800][cleared] * level;
      level = Math.floor(lines / 10) + 1;
    }
    SFX.lock();
    newPiece();
  };

  const kH = (e) => {
    if (over || !piece) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (canPlace(piece, piece.x - 1, piece.y)) piece.x--; }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (canPlace(piece, piece.x + 1, piece.y)) piece.x++; }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      const old = piece.rot; piece.rot = (piece.rot + 1) % 4;
      if (!canPlace(piece, piece.x, piece.y)) {
        // Wall kick attempts
        if (canPlace(piece, piece.x - 1, piece.y)) piece.x--;
        else if (canPlace(piece, piece.x + 1, piece.y)) piece.x++;
        else if (canPlace(piece, piece.x - 2, piece.y)) piece.x -= 2;
        else if (canPlace(piece, piece.x + 2, piece.y)) piece.x += 2;
        else piece.rot = old;
      }
      SFX.bounce();
    }
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
    if (!piece) return;
    const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const old = piece.rot; piece.rot = (piece.rot + 1) % 4;
      if (!canPlace(piece, piece.x, piece.y)) { if (canPlace(piece, piece.x - 1, piece.y)) piece.x--; else if (canPlace(piece, piece.x + 1, piece.y)) piece.x++; else piece.rot = old; }
    } else if (Math.abs(dx) > Math.abs(dy)) {
      piece.x += dx > 0 ? 1 : -1; if (!canPlace(piece, piece.x, piece.y)) piece.x -= dx > 0 ? 1 : -1;
    } else if (dy > 10) { while (canPlace(piece, piece.x, piece.y + 1)) piece.y++; lockPiece(); }
  }, { passive: true });
  newPiece();

  const drawBlockGrad = (bx, by, size, colors) => {
    const grad = ctx.createLinearGradient(bx, by, bx + size, by + size);
    grad.addColorStop(0, colors[0]); grad.addColorStop(0.6, colors[1]); grad.addColorStop(1, colors[2]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    const r = 3;
    ctx.moveTo(bx + r, by); ctx.lineTo(bx + size - r, by); ctx.quadraticCurveTo(bx + size, by, bx + size, by + r);
    ctx.lineTo(bx + size, by + size - r); ctx.quadraticCurveTo(bx + size, by + size, bx + size - r, by + size);
    ctx.lineTo(bx + r, by + size); ctx.quadraticCurveTo(bx, by + size, bx, by + size - r);
    ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath(); ctx.fill();
    // Inner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(bx + r + 2, by + 2); ctx.lineTo(bx + size - r - 2, by + 2); ctx.quadraticCurveTo(bx + size - 2, by + 2, bx + size - 2, by + r + 2);
    ctx.lineTo(bx + 5, by + 6); ctx.lineTo(bx + 2, by + 6); ctx.closePath(); ctx.fill();
    // Bottom shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(bx + 2, by + size - 4, size - 4, 3);
  };

  const loop = setInterval(() => {
    if (over) return; frame++;

    // Update clear particles
    for (let i = clearParticles.length - 1; i >= 0; i--) {
      const p = clearParticles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
      if (p.life <= 0) clearParticles.splice(i, 1);
    }

    // Update bg particles
    for (const p of bgParticles) { p.y += p.vy; if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; } }

    dropTimer++;
    const speed = Math.max(2, 12 - level);
    if (dropTimer >= speed) { dropTimer = 0; if (canPlace(piece, piece.x, piece.y + 1)) piece.y++; else lockPiece(); }
    if (lineFlashTimer > 0) lineFlashTimer--;

    // DRAW
    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#080018'); bgGrad.addColorStop(0.5, '#0c0025'); bgGrad.addColorStop(1, '#0a0020');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    // Floating particles
    for (const p of bgParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#3322aa';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Playfield border glow
    ctx.shadowColor = '#4400aa'; ctx.shadowBlur = 15;
    ctx.strokeStyle = '#330088'; ctx.lineWidth = 2;
    ctx.strokeRect(-1, -1, PLAY_W + 2, ROWS * CS + 2);
    ctx.shadowBlur = 0;

    // Grid lines
    ctx.strokeStyle = 'rgba(60, 40, 120, 0.25)'; ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * CS); ctx.lineTo(PLAY_W, r * CS); ctx.stroke(); }
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CS, 0); ctx.lineTo(c * CS, ROWS * CS); ctx.stroke(); }

    // Line flash
    if (lineFlashTimer > 0 && lineFlash >= 0) {
      ctx.globalAlpha = (lineFlashTimer / 20) * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, lineFlash * CS, PLAY_W, CS);
      ctx.globalAlpha = 1;
    }

    // Placed blocks
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (board[r][c]) {
        ctx.shadowColor = board[r][c][0]; ctx.shadowBlur = 3;
        drawBlockGrad(c * CS + 1, r * CS + 1, CS - 2, board[r][c]);
        ctx.shadowBlur = 0;
      }
    }

    // Ghost piece
    if (piece) {
      const ghostY = getGhostY(piece);
      const gs = getShape(piece);
      ctx.globalAlpha = 0.2;
      for (let y = 0; y < gs.length; y++) for (let x = 0; x < gs[y].length; x++) {
        if (gs[y][x]) {
          ctx.strokeStyle = piece.grad[0]; ctx.lineWidth = 1;
          ctx.strokeRect((piece.x + x) * CS + 2, (ghostY + y) * CS + 2, CS - 4, CS - 4);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Current piece
    if (piece) {
      const s = getShape(piece);
      ctx.shadowColor = piece.grad[0]; ctx.shadowBlur = 8;
      for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) {
        if (s[y][x] && piece.y + y >= 0) {
          drawBlockGrad((piece.x + x) * CS + 1, (piece.y + y) * CS + 1, CS - 2, piece.grad);
        }
      }
      ctx.shadowBlur = 0;
    }

    // Clear particles
    for (const p of clearParticles) {
      ctx.globalAlpha = p.life / 30;
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    // Sidebar background
    const sideGrad = ctx.createLinearGradient(PLAY_W, 0, W, 0);
    sideGrad.addColorStop(0, 'rgba(20,10,40,0.95)'); sideGrad.addColorStop(1, 'rgba(10,5,25,0.98)');
    ctx.fillStyle = sideGrad; ctx.fillRect(PLAY_W, 0, SIDE_W, H);
    ctx.strokeStyle = '#330088'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PLAY_W, 0); ctx.lineTo(PLAY_W, H); ctx.stroke();

    drawText(ctx, 'SCORE', PLAY_W + SIDE_W / 2, 28, 11, '#8866cc', 'center');
    drawText(ctx, `${score}`, PLAY_W + SIDE_W / 2, 50, 16, '#fff', 'center', true);
    drawText(ctx, 'LEVEL', PLAY_W + SIDE_W / 2, 80, 11, '#8866cc', 'center');
    drawText(ctx, `${level}`, PLAY_W + SIDE_W / 2, 98, 14, '#00ffff', 'center');
    drawText(ctx, 'LINES', PLAY_W + SIDE_W / 2, 125, 11, '#8866cc', 'center');
    drawText(ctx, `${lines}`, PLAY_W + SIDE_W / 2, 143, 14, '#00ff88', 'center');

    // Next piece preview
    drawText(ctx, 'NEXT', PLAY_W + SIDE_W / 2, 190, 11, '#8866cc', 'center');
    if (nextPiece) {
      const ns = nextPiece.shape;
      const previewCS = 18;
      const nw = ns[0].length * previewCS, nh = ns.length * previewCS;
      const px = PLAY_W + (SIDE_W - nw) / 2, py = 200;
      // Preview background
      ctx.fillStyle = 'rgba(30,15,60,0.5)';
      ctx.beginPath();
      const br = 6;
      ctx.moveTo(px + br, py - 5); ctx.lineTo(px + nw - br + 5, py - 5);
      ctx.quadraticCurveTo(px + nw + 5, py - 5, px + nw + 5, py + br - 5);
      ctx.lineTo(px + nw + 5, py + nh - br + 5); ctx.quadraticCurveTo(px + nw + 5, py + nh + 5, px + nw - br + 5, py + nh + 5);
      ctx.lineTo(px + br, py + nh + 5); ctx.quadraticCurveTo(px - 5, py + nh + 5, px - 5, py + nh - br + 5);
      ctx.lineTo(px - 5, py + br - 5); ctx.quadraticCurveTo(px - 5, py - 5, px + br, py - 5);
      ctx.closePath(); ctx.fill();

      ctx.shadowColor = nextPiece.grad[0]; ctx.shadowBlur = 6;
      for (let y = 0; y < ns.length; y++) for (let x = 0; x < ns[y].length; x++) {
        if (ns[y][x]) drawBlockGrad(px + x * previewCS, py + y * previewCS, previewCS - 1, nextPiece.grad);
      }
      ctx.shadowBlur = 0;
    }
  }, 1000 / 60);
  return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
}


// ==================== 8. ARKANOID (gameArkanoid) ====================
function gameArkanoid(area, sendScore) {
  const W = 400, H = 400;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
  area.appendChild(cvs);
  const ctx = cvs.getContext('2d');

  let paddle = { x: W / 2, w: 80, h: 12, targetX: W / 2 };
  let ball = { x: W / 2, y: H - 60, vx: 3, vy: -4.5, r: 6, trail: [] };
  let bricks = [], particles = new Particles(), shake = new Shake();
  let score = 0, lives = 3, over = false, frame = 0, launched = false;

  let bgParticles = [];
  for (let i = 0; i < 30; i++) bgParticles.push({ x: Math.random() * W, y: Math.random() * H, vy: -0.1 - Math.random() * 0.2, size: 0.5 + Math.random() * 1.5, alpha: 0.08 + Math.random() * 0.15 });

  const BRICK_W = 36, BRICK_H = 14, BRICK_PAD = 3;
  const ROWS = 6, COLS = 10;
  const BRICK_OFFSET_X = (W - COLS * (BRICK_W + BRICK_PAD)) / 2;
  const BRICK_OFFSET_Y = 40;
  const rowGrads = [
    ['#ff4488', '#cc2266', '#881144'],
    ['#ff8800', '#cc6600', '#884400'],
    ['#ffcc00', '#ccaa00', '#887700'],
    ['#00ff88', '#00aa55', '#006633'],
    ['#0088ff', '#0066cc', '#004488'],
    ['#aa44ff', '#7722cc', '#441188']
  ];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    bricks.push({
      x: BRICK_OFFSET_X + c * (BRICK_W + BRICK_PAD), y: BRICK_OFFSET_Y + r * (BRICK_H + BRICK_PAD),
      w: BRICK_W, h: BRICK_H, grad: rowGrads[r], hp: 1, alive: true, breakScale: 1, breakAlpha: 1
    });
  }

  const kH = (e) => {
    if (over) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') paddle.targetX -= 35;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') paddle.targetX += 35;
    else if (e.code === 'Space') {
      e.preventDefault();
      if (!launched) { launched = true; ball.vy = -5; ball.vx = (Math.random() - 0.5) * 4; }
    }
  };
  document.addEventListener('keydown', kH);
  cvs.addEventListener('touchmove', (e) => {
    e.preventDefault(); const rect = cvs.getBoundingClientRect();
    paddle.targetX = (e.touches[0].clientX - rect.left) / rect.width * W;
    if (!launched) launched = true;
  }, { passive: false });
  cvs.addEventListener('touchstart', (e) => {
    if (!launched) { launched = true; ball.vy = -5; ball.vx = (Math.random() - 0.5) * 4; }
  }, { passive: true });

  const resetBall = () => {
    ball = { x: paddle.x, y: H - 60, vx: 0, vy: 0, r: 6, trail: [] };
    launched = false;
  };
  resetBall();

  const loop = setInterval(() => {
    if (over) return; frame++;

    // Paddle smooth movement
    paddle.x += (paddle.targetX - paddle.x) * 0.2;
    paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));

    if (!launched) { ball.x = paddle.x; ball.y = H - 60; }

    if (launched) {
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 8) ball.trail.shift();
      ball.x += ball.vx; ball.y += ball.vy;

      if (ball.x - ball.r < 0 || ball.x + ball.r > W) { ball.vx *= -1; ball.x = Math.max(ball.r, Math.min(W - ball.r, ball.x)); SFX.bounce(); }
      if (ball.y - ball.r < 0) { ball.vy *= -1; ball.y = ball.r; SFX.bounce(); }

      if (ball.y > H + 15) {
        lives--; SFX.die();
        if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        resetBall();
      }

      // Paddle collision
      if (ball.vy > 0 && ball.y + ball.r >= H - 35 && ball.y + ball.r <= H - 20 &&
          ball.x > paddle.x - paddle.w / 2 - ball.r && ball.x < paddle.x + paddle.w / 2 + ball.r) {
        ball.vy = -Math.abs(ball.vy);
        const hitPos = (ball.x - paddle.x) / (paddle.w / 2);
        ball.vx = hitPos * 5.5;
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        const maxSpeed = 7;
        if (speed > maxSpeed) { ball.vx *= maxSpeed / speed; ball.vy *= maxSpeed / speed; }
        SFX.bounce();
        particles.add(ball.x, H - 35, 6, { colors: ['#00ffff', '#0088ff', '#fff'], speed: 3, life: 15 });
      }

      // Brick collision
      for (const b of bricks) {
        if (!b.alive) continue;
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w && ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
          const overlapLeft = (ball.x + ball.r) - b.x;
          const overlapRight = (b.x + b.w) - (ball.x - ball.r);
          const overlapTop = (ball.y + ball.r) - b.y;
          const overlapBottom = (b.y + b.h) - (ball.y - ball.r);
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapLeft || minOverlap === overlapRight) ball.vx *= -1;
          else ball.vy *= -1;

          b.hp--;
          if (b.hp <= 0) {
            b.alive = false; score += 10 * (ROWS - Math.floor((b.y - BRICK_OFFSET_Y) / (BRICK_H + BRICK_PAD)));
            SFX.explode(); shake.trigger(2);
            particles.add(b.x + b.w / 2, b.y + b.h / 2, 12, { colors: [b.grad[0], b.grad[1], '#fff'], speed: 4, life: 25 });
          } else { SFX.hit(); }
          break;
        }
      }

      if (bricks.every(b => !b.alive)) { SFX.win(); score += 1000; clearInterval(loop); sendScore(score); return; }
    }

    // Update bg particles
    for (const p of bgParticles) { p.y += p.vy; if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; } }

    particles.update();

    // DRAW
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#050520'); bgGrad.addColorStop(0.5, '#0a0a35'); bgGrad.addColorStop(1, '#080828');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    for (const p of bgParticles) {
      ctx.globalAlpha = p.alpha; ctx.fillStyle = '#2233aa';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save(); shake.apply(ctx, W, H);

    // Bricks
    for (const b of bricks) {
      if (!b.alive) continue;
      ctx.shadowColor = b.grad[0]; ctx.shadowBlur = 5;
      const bGrad = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      bGrad.addColorStop(0, b.grad[0]); bGrad.addColorStop(0.5, b.grad[1]); bGrad.addColorStop(1, b.grad[2]);
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      const br = 3;
      ctx.moveTo(b.x + br, b.y); ctx.lineTo(b.x + b.w - br, b.y); ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + br);
      ctx.lineTo(b.x + b.w, b.y + b.h - br); ctx.quadraticCurveTo(b.x + b.w, b.y + b.h, b.x + b.w - br, b.y + b.h);
      ctx.lineTo(b.x + br, b.y + b.h); ctx.quadraticCurveTo(b.x, b.y + b.h, b.x, b.y + b.h - br);
      ctx.lineTo(b.x, b.y + br); ctx.quadraticCurveTo(b.x, b.y, b.x + br, b.y);
      ctx.closePath(); ctx.fill();
      // Top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(b.x + 3, b.y + 1, b.w - 6, 3);
      ctx.shadowBlur = 0;
    }

    // Paddle
    const pw = paddle.w / 2;
    ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 12;
    const padGrad = ctx.createLinearGradient(paddle.x - pw, H - 32, paddle.x + pw, H - 26);
    padGrad.addColorStop(0, '#0066cc'); padGrad.addColorStop(0.3, '#00bbff'); padGrad.addColorStop(0.7, '#00bbff'); padGrad.addColorStop(1, '#0066cc');
    ctx.fillStyle = padGrad;
    ctx.beginPath();
    ctx.moveTo(paddle.x - pw, H - 26); ctx.lineTo(paddle.x - pw + 10, H - 34);
    ctx.lineTo(paddle.x + pw - 10, H - 34); ctx.lineTo(paddle.x + pw, H - 26);
    ctx.closePath(); ctx.fill();
    // Paddle highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(paddle.x - pw + 12, H - 33); ctx.lineTo(paddle.x + pw - 12, H - 33);
    ctx.lineTo(paddle.x + pw - 14, H - 30); ctx.lineTo(paddle.x - pw + 14, H - 30);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;

    // Ball trail
    for (let t = 0; t < ball.trail.length; t++) {
      const alpha = (t / ball.trail.length) * 0.3;
      const size = ball.r * (t / ball.trail.length);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ball.trail[t].x, ball.trail[t].y, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ball
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16;
    const ballGrad = ctx.createRadialGradient(ball.x - 1, ball.y - 1, 0, ball.x, ball.y, ball.r + 2);
    ballGrad.addColorStop(0, '#ffffff'); ballGrad.addColorStop(0.5, '#ddddff'); ballGrad.addColorStop(1, '#8888cc');
    ctx.fillStyle = ballGrad;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    particles.draw(ctx);
    ctx.restore();

    // Lives as small circles
    for (let i = 0; i < lives; i++) {
      ctx.fillStyle = '#00ccff'; ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(W - 20 - i * 18, 16, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    drawText(ctx, `Score: ${score}`, 10, 16, 12, '#fff');
  }, 1000 / 60);
  return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
}


// ==================== 9. DONKEY KONG (gameDonkeyKong) ====================
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

  const ladders = [
    { x: 350, y1: 365, y2: 295 }, { x: 100, y1: 295, y2: 225 },
    { x: 310, y1: 225, y2: 155 }, { x: 160, y1: 155, y2: 90 }
  ];

  let player = { x: 30, y: 345, vx: 0, vy: 0, w: 14, h: 20, onGround: false, facing: 1, anim: 0, trail: [] };
  let barrels = [], particles = new Particles(), shake = new Shake();
  let score = 0, lives = 3, over = false, frame = 0, barrelTimer = 0;
  let bgParticles = [];
  for (let i = 0; i < 20; i++) bgParticles.push({ x: Math.random() * W, y: Math.random() * H, vy: 0.1 + Math.random() * 0.2, size: 0.8 + Math.random() * 1.2, alpha: 0.06 + Math.random() * 0.1 });

  const GRAVITY = 0.38, JUMP = -7.8, SPEED = 2.8;
  const girl = { x: 155, y: 66 };
  const dk = { x: 45, y: 65, anim: 0 };
  const keys = {};

  const kH = (e) => {
    keys[e.code] = true;
    if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') && player.onGround) {
      player.vy = JUMP; player.onGround = false; SFX.jump();
    }
  };
  const kU = (e) => { keys[e.code] = false; };
  document.addEventListener('keydown', kH); document.addEventListener('keyup', kU);

  cvs.addEventListener('touchstart', (e) => {
    const rect = cvs.getBoundingClientRect();
    const tx = (e.touches[0].clientX - rect.left) / rect.width * W;
    if (player.onGround) { player.vy = JUMP; player.onGround = false; SFX.jump(); }
    if (tx > W / 2) keys['ArrowRight'] = true; else keys['ArrowLeft'] = true;
  }, { passive: true });
  cvs.addEventListener('touchend', () => { keys['ArrowLeft'] = false; keys['ArrowRight'] = false; }, { passive: true });

  const getPlatY = (p, x) => p.y + (x - p.x) * (p.tilt / 60);

  const loop = setInterval(() => {
    if (over) return; frame++;
    dk.anim++;

    if (keys['ArrowLeft'] || keys['KeyA']) { player.vx = -SPEED; player.facing = -1; }
    else if (keys['ArrowRight'] || keys['KeyD']) { player.vx = SPEED; player.facing = 1; }
    else player.vx = 0;

    player.x += player.vx; player.y += player.vy; player.vy += GRAVITY;
    if (player.vx !== 0) player.anim++;
    player.trail.push({ x: player.x, y: player.y });
    if (player.trail.length > 5) player.trail.shift();

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
    if (barrelTimer > 80) {
      barrelTimer = 0;
      barrels.push({ x: 55, y: 80, vx: -1.5, vy: 0, radius: 10, plat: 4, rot: 0, trail: [] });
      SFX.explode();
    }

    for (let i = barrels.length - 1; i >= 0; i--) {
      const b = barrels[i]; b.vy += GRAVITY; b.x += b.vx; b.y += b.vy; b.rot += b.vx * 0.15;
      b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 4) b.trail.shift();

      if (b.plat < platforms.length) {
        const p = platforms[b.plat];
        const py = getPlatY(p, b.x);
        if (b.y >= py - b.radius) {
          b.y = py - b.radius; b.vy = 0;
          b.vx = p.tilt > 0 ? -1.8 : 1.8;
          if (b.x < p.x - 10 || b.x > p.x + p.w + 10) {
            b.plat++;
            if (b.plat < platforms.length) b.vx = platforms[b.plat].tilt > 0 ? -1.8 : 1.8;
          }
        }
      }
      if (b.y > H + 20) { barrels.splice(i, 1); score += 10; continue; }
      if (Math.abs(b.x - player.x) < 18 && Math.abs(b.y - (player.y + player.h / 2)) < 16) {
        SFX.die(); shake.trigger(10);
        particles.add(player.x, player.y, 25, { colors: ['#ff4444', '#ff8800', '#ffcc00', '#fff'], speed: 6, life: 35 });
        player.x = 30; player.y = 345; player.vy = 0; player.trail = [];
        lives--;
        if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
      }
    }

    if (Math.abs(player.x - girl.x) < 25 && player.y < girl.y + 30) {
      score += 500; SFX.win();
      particles.add(girl.x, girl.y, 30, { colors: ['#ff69b4', '#ffcc00', '#fff'], speed: 5, life: 30 });
      player.x = 30; player.y = 345; player.vy = 0; player.trail = [];
      barrels = [];
    }

    for (const p of bgParticles) { p.y += p.vy; if (p.y > H + 5) { p.y = -5; p.x = Math.random() * W; } }
    particles.update();

    // DRAW
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0020'); bgGrad.addColorStop(0.5, '#100030'); bgGrad.addColorStop(1, '#080018');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    for (const p of bgParticles) {
      ctx.globalAlpha = p.alpha; ctx.fillStyle = '#442288';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save(); shake.apply(ctx, W, H);

    // Ladders
    for (const l of ladders) {
      const topY = Math.min(l.y1, l.y2) + 4;
      const botY = Math.max(l.y1, l.y2) - 2;
      ctx.strokeStyle = '#ccaa44'; ctx.lineWidth = 3;
      ctx.shadowColor = '#ccaa44'; ctx.shadowBlur = 3;
      const topX = l.x + (topY - l.y1) * (ladders.indexOf(l) % 2 === 0 ? -0.05 : 0.05);
      const botX = l.x + (botY - l.y1) * (ladders.indexOf(l) % 2 === 0 ? -0.05 : 0.05);
      ctx.beginPath(); ctx.moveTo(topX - 6, topY); ctx.lineTo(botX - 6, botY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(topX + 6, topY); ctx.lineTo(botX + 6, botY); ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let r = 0; r < 6; r++) {
        const t = r / 6;
        const ry = topY + (botY - topY) * t;
        const rx = topX + (botX - topX) * t;
        ctx.beginPath(); ctx.moveTo(rx - 6, ry); ctx.lineTo(rx + 6, ry); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // Platforms (girder style)
    for (const p of platforms) {
      for (let x = p.x; x < p.x + p.w; x += 2) {
        const py = getPlatY(p, x);
        const checker = (Math.floor(x / 14) + Math.floor(p.y / 40)) % 2 === 0;
        const girderGrad = ctx.createLinearGradient(x, py - 4, x, py + 5);
        girderGrad.addColorStop(0, checker ? '#aa6622' : '#8B4513');
        girderGrad.addColorStop(0.5, checker ? '#cc8844' : '#aa5522');
        girderGrad.addColorStop(1, checker ? '#774411' : '#663308');
        ctx.fillStyle = girderGrad;
        ctx.fillRect(x, py - 3, 2, 7);
      }
      // Top edge highlight
      ctx.fillStyle = '#cc9944'; ctx.fillRect(p.x, getPlatY(p, p.x) - 4, p.w, 2);
      // Rivets
      ctx.fillStyle = '#553311';
      for (let x = p.x + 10; x < p.x + p.w; x += 30) {
        ctx.beginPath(); ctx.arc(x, getPlatY(p, x) + 2, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // DK
    ctx.save(); ctx.translate(dk.x, dk.y);
    ctx.shadowColor = '#8B4513'; ctx.shadowBlur = 4;
    // Body
    const dkBodyGrad = ctx.createRadialGradient(0, 10, 4, 0, 10, 16);
    dkBodyGrad.addColorStop(0, '#aa6633'); dkBodyGrad.addColorStop(1, '#6B3513');
    ctx.fillStyle = dkBodyGrad;
    ctx.beginPath(); ctx.arc(0, 10, 15, 0, Math.PI * 2); ctx.fill();
    // Belly
    ctx.fillStyle = '#8B6914';
    ctx.beginPath(); ctx.arc(0, 14, 9, 0, Math.PI * 2); ctx.fill();
    // Head
    ctx.fillStyle = '#8B4513';
    ctx.beginPath(); ctx.arc(0, -2, 11, 0, Math.PI * 2); ctx.fill();
    // Face
    ctx.fillStyle = '#5a2a0a';
    ctx.beginPath(); ctx.ellipse(0, 2, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4, -3, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -3, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(-3, -2, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -2, 1.8, 0, Math.PI * 2); ctx.fill();
    // Arm animation
    if (frame % 30 < 15) {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(10, 2 + Math.sin(dk.anim * 0.2) * 3, 8, 14);
      ctx.fillRect(-18, 2 - Math.sin(dk.anim * 0.2) * 3, 8, 14);
    } else {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(10, 2 - Math.sin(dk.anim * 0.2) * 3, 8, 14);
      ctx.fillRect(-18, 2 + Math.sin(dk.anim * 0.2) * 3, 8, 14);
    }
    // Heart
    if (frame % 30 < 15) {
      ctx.fillStyle = '#ff4488'; ctx.shadowColor = '#ff4488'; ctx.shadowBlur = 6;
      ctx.font = '14px sans-serif'; ctx.fillText('\u2665', 16, -6);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Girl
    ctx.save(); ctx.translate(girl.x, girl.y);
    // Dress
    const dressGrad = ctx.createLinearGradient(-6, 0, 6, 16);
    dressGrad.addColorStop(0, '#ff69b4'); dressGrad.addColorStop(1, '#cc3388');
    ctx.fillStyle = dressGrad;
    ctx.beginPath(); ctx.moveTo(-8, 12); ctx.lineTo(8, 12); ctx.lineTo(5, 16); ctx.lineTo(-5, 16); ctx.closePath(); ctx.fill();
    // Body
    ctx.fillStyle = '#ff69b4';
    ctx.fillRect(-4, 2, 8, 10);
    // Head
    ctx.fillStyle = '#ffccaa';
    ctx.beginPath(); ctx.arc(0, -2, 6, 0, Math.PI * 2); ctx.fill();
    // Hair
    ctx.fillStyle = '#663300';
    ctx.beginPath(); ctx.arc(0, -4, 6, Math.PI, Math.PI * 2); ctx.fill();
    // Eyes
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(-2, -2, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2, -2, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Speech bubble
    if (frame % 50 < 30) {
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff4488'; ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(girl.x - 10, girl.y - 18);
      ctx.quadraticCurveTo(girl.x - 5, girl.y - 28, girl.x + 8, girl.y - 28);
      ctx.quadraticCurveTo(girl.x + 22, girl.y - 28, girl.x + 22, girl.y - 18);
      ctx.quadraticCurveTo(girl.x + 22, girl.y - 12, girl.x + 14, girl.y - 12);
      ctx.lineTo(girl.x + 4, girl.y - 8);
      ctx.lineTo(girl.x + 6, girl.y - 12);
      ctx.quadraticCurveTo(girl.x - 10, girl.y - 12, girl.x - 10, girl.y - 18);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff2266'; ctx.font = 'bold 8px sans-serif'; ctx.fillText('HELP!', girl.x - 4, girl.y - 17);
    }

    // Barrel trails
    for (const b of barrels) {
      for (let t = 0; t < b.trail.length; t++) {
        ctx.globalAlpha = (t / b.trail.length) * 0.15;
        ctx.fillStyle = '#8B4513';
        ctx.beginPath(); ctx.arc(b.trail[t].x, b.trail[t].y, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Barrels
    for (const b of barrels) {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.shadowColor = '#aa6622'; ctx.shadowBlur = 6;
      const barrelGrad = ctx.createRadialGradient(-2, -2, 1, 0, 0, b.radius);
      barrelGrad.addColorStop(0, '#bb8844'); barrelGrad.addColorStop(0.6, '#8B6914'); barrelGrad.addColorStop(1, '#553311');
      ctx.fillStyle = barrelGrad;
      ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, Math.PI * 2); ctx.fill();
      // Metal bands
      ctx.strokeStyle = '#ccaa44'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, b.radius - 3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, b.radius - 6, 0, Math.PI * 2); ctx.stroke();
      // Center dot
      ctx.fillStyle = '#444';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Player trails
    for (let t = 0; t < player.trail.length; t++) {
      ctx.globalAlpha = (t / player.trail.length) * 0.12;
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(player.trail[t].x - player.w / 2, player.trail[t].y, player.w, player.h);
    }
    ctx.globalAlpha = 1;

    // Player (Mario-like)
    ctx.save(); ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
    ctx.scale(player.facing, 1);
    const legOffset = Math.sin(player.anim * 0.35) * 4;
    ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 6;

    // Hat
    const hatGrad = ctx.createLinearGradient(-6, -player.h / 2, 6, -player.h / 2 + 4);
    hatGrad.addColorStop(0, '#ff2222'); hatGrad.addColorStop(1, '#cc0000');
    ctx.fillStyle = hatGrad;
    ctx.fillRect(-6, -player.h / 2 - 2, 12, 5);

    // Body
    const bodyGrad = ctx.createLinearGradient(-5, -player.h / 2 + 3, 5, -player.h / 2 + 11);
    bodyGrad.addColorStop(0, '#ff4444'); bodyGrad.addColorStop(1, '#cc2222');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-6, -player.h / 2 + 3, 12, 8);

    // Face
    ctx.fillStyle = '#ffcc88';
    ctx.fillRect(-4, -player.h / 2 + 8, 8, 5);

    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-2, -player.h / 2 + 9, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2, -player.h / 2 + 9, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(-1.5, -player.h / 2 + 9.2, 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2.5, -player.h / 2 + 9.2, 0.8, 0, Math.PI * 2); ctx.fill();

    // Overalls
    const overGrad = ctx.createLinearGradient(-5, 2, 5, 8);
    overGrad.addColorStop(0, '#4488ff'); overGrad.addColorStop(1, '#2266cc');
    ctx.fillStyle = overGrad;
    ctx.fillRect(-5, 2, 10, 6);

    // Legs
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(-5, 7 + legOffset, 4, 5);
    ctx.fillRect(1, 7 - legOffset, 4, 5);

    // Shoes
    ctx.fillStyle = '#663300';
    ctx.fillRect(-6, 11 + legOffset, 5, 3);
    ctx.fillRect(1, 11 - legOffset, 5, 3);

    // Mustache
    ctx.fillStyle = '#663300';
    ctx.fillRect(-4, -player.h / 2 + 12, 8, 1.5);

    ctx.shadowBlur = 0;
    ctx.restore();

    particles.draw(ctx);
    ctx.restore();

    drawText(ctx, `Score: ${score}  Lives: ${lives}`, 4, 16, 12, '#ffcc00');
  }, 1000 / 60);
  return () => { clearInterval(loop); document.removeEventListener('keydown', kH); document.removeEventListener('keyup', kU); };
}


// ==================== 10. SPACE INVADERS (gameSpaceInvaders) ====================
function gameSpaceInvaders(area, sendScore) {
  const W = 400, H = 400;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
  area.appendChild(cvs);
  const ctx = cvs.getContext('2d');

  let player = { x: W / 2, w: 28, h: 14, shield: 3, trail: [] };
  let bullets = [], enemyBullets = [], enemies = [], particles = new Particles(), shake = new Shake();
  let score = 0, lives = 3, wave = 0, over = false, frame = 0, shootCD = 0;
  let ufo = null, ufoTimer = 0;
  let bgParticles = [];
  for (let i = 0; i < 35; i++) bgParticles.push({ x: Math.random() * W, y: Math.random() * H, vy: 0.05 + Math.random() * 0.15, size: 0.5 + Math.random() * 1.5, alpha: 0.06 + Math.random() * 0.12 });

  const rowGrads = [
    [['#ff4488', '#cc2266', '#881144'], ['#ff66aa', '#ff4488', '#cc2266']],
    [['#ff8800', '#cc6600', '#884400'], ['#ffaa44', '#ff8800', '#cc6600']],
    [['#ffcc00', '#ccaa00', '#887700'], ['#ffdd44', '#ffcc00', '#ccaa00']],
    [['#00ff88', '#00aa55', '#006633'], ['#44ffaa', '#00ff88', '#00aa55']],
    [['#0088ff', '#0066cc', '#004488'], ['#44aaff', '#0088ff', '#0066cc']]
  ];

  let shields = [];
  const initShields = () => {
    shields = [];
    for (let i = 0; i < 4; i++) {
      const sx = 40 + i * 95;
      // Create pixel-based shield shape
      const pixels = [];
      for (let py = 0; py < 22; py++) for (let px = 0; px < 44; px++) {
        // Arched shield shape
        if (py < 6 && (px < 6 || px > 37)) continue;
        if (py < 2 && (px < 14 || px > 29)) continue;
        if (py >= 16 && px >= 14 && px <= 29) continue; // arch cutout
        pixels.push({ x: sx + px * 1, y: H - 70 + py, alive: true });
      }
      shields.push({ pixels, hp: 1 });
    }
  };
  initShields();

  const spawnWave = () => {
    wave++;
    const alienColors = rowGrads;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
      const ci = r % 2;
      enemies.push({
        x: 30 + c * 42, y: 35 + r * 32, w: 26, h: 18,
        hp: r === 0 ? 2 : 1, grad: alienColors[r][ci],
        frame: c * 10 + r * 5, dir: 1, diving: false
      });
    }
  };
  spawnWave();

  const kH = (e) => {
    if (over) return;
    if ((e.code === 'Space' || e.code === 'KeyZ') && shootCD <= 0) {
      shootCD = 12;
      bullets.push({ x: player.x, y: H - 52, vy: -8, trail: [] });
      SFX.shoot();
      particles.add(player.x, H - 48, 3, { colors: ['#00ff88', '#00ffff'], speed: 2, life: 8 });
    }
  };
  document.addEventListener('keydown', kH);

  cvs.addEventListener('touchstart', (e) => {
    const rect = cvs.getBoundingClientRect();
    player.x = (e.touches[0].clientX - rect.left) / rect.width * W;
    if (shootCD <= 0) {
      shootCD = 12;
      bullets.push({ x: player.x, y: H - 52, vy: -8, trail: [] });
      SFX.shoot();
    }
  }, { passive: true });
  cvs.addEventListener('touchmove', (e) => {
    e.preventDefault(); const rect = cvs.getBoundingClientRect();
    player.x = (e.touches[0].clientX - rect.left) / rect.width * W;
  }, { passive: false });

  const loop = setInterval(() => {
    if (over) return; frame++;
    if (shootCD > 0) shootCD--;

    // Key repeat for movement
    const kl2 = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') player.x -= 4;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') player.x += 4;
    };
    document.addEventListener('keydown', kl2); setTimeout(() => document.removeEventListener('keydown', kl2), 50);
    player.x = Math.max(16, Math.min(W - 16, player.x));

    player.trail.push({ x: player.x, y: H - 42 });
    if (player.trail.length > 4) player.trail.shift();

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      bullets[i].trail.push({ x: bullets[i].x, y: bullets[i].y });
      if (bullets[i].trail.length > 5) bullets[i].trail.shift();
      bullets[i].y += bullets[i].vy;
      if (bullets[i].y < -5) bullets.splice(i, 1);
    }

    // Enemy bullets
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      enemyBullets[i].trail.push({ x: enemyBullets[i].x, y: enemyBullets[i].y });
      if (enemyBullets[i].trail.length > 4) enemyBullets[i].trail.shift();
      enemyBullets[i].y += enemyBullets[i].vy;
      if (enemyBullets[i].y > H + 5) enemyBullets.splice(i, 1);
    }

    // Enemy movement
    let edgeHit = false;
    for (const e of enemies) { e.frame++; if (e.x + e.w > W - 5 || e.x < 5) edgeHit = true; }
    if (edgeHit) { for (const e of enemies) { e.dir *= -1; e.x += e.dir * 8; e.y += 14; } }
    else { for (const e of enemies) e.x += e.dir * (0.8 + wave * 0.1); }

    // Enemy shooting
    if (frame % Math.max(12, 40 - wave * 3) === 0 && enemies.length > 0) {
      const shooter = enemies[Math.floor(Math.random() * enemies.length)];
      enemyBullets.push({ x: shooter.x, y: shooter.y + shooter.h / 2, vy: 3 + wave * 0.3, trail: [] });
    }

    // UFO
    ufoTimer++;
    if (!ufo && ufoTimer > 600 + Math.random() * 300) {
      ufo = { x: -30, y: 20, dir: 1, points: [50, 100, 150, 200, 300][Math.floor(Math.random() * 5)], trail: [] };
      ufoTimer = 0;
    }
    if (ufo) {
      ufo.trail.push({ x: ufo.x, y: ufo.y }); if (ufo.trail.length > 6) ufo.trail.shift();
      ufo.x += ufo.dir * 2.5;
      if (ufo.x > W + 30) ufo = null;
    }

    // Bullet-enemy collision
    for (let i = bullets.length - 1; i >= 0; i--) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        const b = bullets[i], e = enemies[j];
        if (b && e && Math.abs(b.x - e.x) < e.w && Math.abs(b.y - e.y) < e.h) {
          e.hp--;
          if (e.hp <= 0) {
            score += [50, 40, 30, 20, 10][j % 5] * wave;
            SFX.explode(); shake.trigger(3);
            particles.add(e.x, e.y, 15, { colors: [e.grad[0], e.grad[1], '#fff'], speed: 5, life: 28 });
            enemies.splice(j, 1);
          } else { SFX.hit(); particles.add(e.x, e.y, 5, { color: '#fff', speed: 2, life: 10 }); }
          bullets.splice(i, 1); break;
        }
      }
    }

    // Bullet-UFO collision
    if (ufo) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        if (Math.abs(bullets[i].x - ufo.x) < 20 && Math.abs(bullets[i].y - ufo.y) < 10) {
          score += ufo.points; SFX.explode(); shake.trigger(5);
          particles.add(ufo.x, ufo.y, 20, { colors: ['#ff00ff', '#ff4488', '#ffcc00', '#fff'], speed: 6, life: 30 });
          ufo = null; bullets.splice(i, 1); break;
        }
      }
    }

    // Shield collision
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      for (const s of shields) {
        for (let p = s.pixels.length - 1; p >= 0; p--) {
          if (s.pixels[p].alive && Math.abs(b.x - s.pixels[p].x) < 3 && Math.abs(b.y - s.pixels[p].y) < 3) {
            s.pixels[p].alive = false;
            // Destroy nearby pixels for blast radius
            for (const pp of s.pixels) {
              if (pp.alive && Math.abs(pp.x - b.x) < 6 && Math.abs(pp.y - b.y) < 6 && Math.random() < 0.4) pp.alive = false;
            }
            enemyBullets.splice(i, 1);
            particles.add(b.x, b.y, 4, { colors: ['#00ff88', '#0088ff'], speed: 2, life: 10 });
            break;
          }
        }
        if (enemyBullets[i] === undefined || enemyBullets[i] === null) break;
      }
    }

    // Player shield degradation from enemy bullets hitting near player
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      if (Math.abs(enemyBullets[i].x - player.x) < 16 && Math.abs(enemyBullets[i].y - (H - 42)) < 12) {
        player.shield--;
        SFX.hit(); shake.trigger(4);
        particles.add(player.x, H - 42, 8, { colors: ['#00ff88', '#00ffff', '#fff'], speed: 3, life: 15 });
        enemyBullets.splice(i, 1);
        if (player.shield <= 0) {
          lives--; shake.trigger(8); SFX.die();
          particles.add(player.x, H - 42, 25, { colors: ['#00ff88', '#ff4444', '#ffcc00', '#fff'], speed: 6, life: 35 });
          player.x = W / 2; player.shield = 3; player.trail = [];
          if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
        }
      }
    }

    // Enemy reaches bottom
    if (enemies.some(e => e.y + e.h > H - 50)) { over = true; clearInterval(loop); sendScore(score); return; }

    // Wave complete
    if (enemies.length === 0) { initShields(); spawnWave(); }

    for (const p of bgParticles) { p.y += p.vy; if (p.y > H + 5) { p.y = -5; p.x = Math.random() * W; } }
    particles.update();

    // DRAW
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#000010'); bgGrad.addColorStop(0.5, '#000025'); bgGrad.addColorStop(1, '#000018');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    // Floating particles
    for (const p of bgParticles) {
      ctx.globalAlpha = p.alpha + Math.sin(frame * 0.02 + p.x) * 0.03;
      ctx.fillStyle = '#2244aa';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Moving grid lines
    ctx.strokeStyle = 'rgba(30, 50, 100, 0.15)'; ctx.lineWidth = 0.5;
    const gridOffset = (frame * 0.3) % 30;
    for (let x = -30 + gridOffset; x < W + 30; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    ctx.save(); shake.apply(ctx, W, H);

    // UFO trail
    if (ufo) {
      for (let t = 0; t < ufo.trail.length; t++) {
        ctx.globalAlpha = (t / ufo.trail.length) * 0.25;
        ctx.fillStyle = '#ff00ff';
        ctx.beginPath(); ctx.arc(ufo.trail[t].x, ufo.trail[t].y, 8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // UFO
      ctx.save(); ctx.translate(ufo.x, ufo.y);
      ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = 14;
      const ufoGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 16);
      ufoGrad.addColorStop(0, '#ff88ff'); ufoGrad.addColorStop(0.5, '#ff00ff'); ufoGrad.addColorStop(1, '#8800aa');
      ctx.fillStyle = ufoGrad;
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
      // Dome
      ctx.fillStyle = '#ffaaff';
      ctx.beginPath(); ctx.ellipse(0, -4, 8, 5, 0, Math.PI, Math.PI * 2); ctx.fill();
      // Lights
      for (let l = 0; l < 3; l++) {
        ctx.fillStyle = frame % 20 < 10 ? '#ffcc00' : '#ff4488';
        ctx.beginPath(); ctx.arc(-8 + l * 8, 2, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Enemies
    for (const e of enemies) {
      const bob = Math.sin(e.frame * 0.08) * 2;
      const e1Grad = ctx.createLinearGradient(e.x - e.w / 2, e.y - e.h / 2, e.x + e.w / 2, e.y + e.h / 2);
      e1Grad.addColorStop(0, e.grad[0]); e1Grad.addColorStop(0.5, e.grad[1]); e1Grad.addColorStop(1, e.grad[2]);
      ctx.fillStyle = e1Grad;
      ctx.shadowColor = e.grad[0]; ctx.shadowBlur = 6;

      // Animated alien shape (toggle between 2 frames)
      const altFrame = Math.floor(e.frame / 15) % 2;
      ctx.save(); ctx.translate(e.x, e.y + bob);
      ctx.beginPath();
      if (altFrame === 0) {
        // Frame A: wider stance
        ctx.moveTo(-e.w / 2, -e.h / 4);
        ctx.lineTo(-e.w / 3, -e.h / 2);
        ctx.lineTo(e.w / 3, -e.h / 2);
        ctx.lineTo(e.w / 2, -e.h / 4);
        ctx.lineTo(e.w / 2, e.h / 4);
        ctx.lineTo(e.w / 3, e.h / 2);
        ctx.lineTo(-e.w / 3, e.h / 2);
        ctx.lineTo(-e.w / 2, e.h / 4);
      } else {
        // Frame B: legs up
        ctx.moveTo(-e.w / 2, -e.h / 3);
        ctx.lineTo(-e.w / 4, -e.h / 2);
        ctx.lineTo(e.w / 4, -e.h / 2);
        ctx.lineTo(e.w / 2, -e.h / 3);
        ctx.lineTo(e.w / 2, 0);
        ctx.lineTo(e.w / 3, e.h / 3);
        ctx.lineTo(0, e.h / 5);
        ctx.lineTo(-e.w / 3, e.h / 3);
        ctx.lineTo(-e.w / 2, 0);
      }
      ctx.closePath(); ctx.fill();

      // Eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-5, -3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-4, -2, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, -2, 1.5, 0, Math.PI * 2); ctx.fill();

      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Shields
    for (const s of shields) {
      ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 3;
      for (const p of s.pixels) {
        if (!p.alive) continue;
        const hp = s.pixels.filter(pp => pp.alive && Math.abs(pp.x - p.x) < 8 && Math.abs(pp.y - p.y) < 8).length;
        const alpha = Math.min(1, hp / 12);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#00ff88';
        ctx.fillRect(p.x, p.y, 1, 1);
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    // Player trails
    for (let t = 0; t < player.trail.length; t++) {
      ctx.globalAlpha = (t / player.trail.length) * 0.1;
      ctx.fillStyle = '#00ff88';
      ctx.beginPath(); ctx.arc(player.trail[t].x, player.trail[t].y, 10, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Player ship
    ctx.save(); ctx.translate(player.x, H - 42);
    ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 12;
    const shipGrad = ctx.createLinearGradient(0, -14, 0, 10);
    shipGrad.addColorStop(0, '#00ff88'); shipGrad.addColorStop(0.5, '#00cc66'); shipGrad.addColorStop(1, '#008844');
    ctx.fillStyle = shipGrad;
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(-14, 6); ctx.lineTo(-6, 10);
    ctx.lineTo(6, 10); ctx.lineTo(14, 6); ctx.closePath(); ctx.fill();
    // Cockpit
    ctx.fillStyle = '#aaffcc';
    ctx.beginPath(); ctx.arc(0, -4, 4, 0, Math.PI * 2); ctx.fill();
    // Engine glow
    ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 8;
    const engineGrad = ctx.createLinearGradient(-4, 10, 4, 18);
    engineGrad.addColorStop(0, '#00ff88'); engineGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = engineGrad;
    ctx.fillRect(-4 + Math.random() * 2 - 1, 10, 6, 6 + Math.random() * 4);
    ctx.shadowBlur = 0;

    // Shield indicator
    if (player.shield > 0) {
      ctx.globalAlpha = player.shield / 3 * 0.3;
      ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Bullets
    for (const b of bullets) {
      for (let t = 0; t < b.trail.length; t++) {
        ctx.globalAlpha = (t / b.trail.length) * 0.3;
        ctx.fillStyle = '#00ff88';
        ctx.beginPath(); ctx.arc(b.trail[t].x, b.trail[t].y, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(b.x - 1.5, b.y, 3, 10);
      ctx.shadowBlur = 0;
    }

    // Enemy bullets
    for (const b of enemyBullets) {
      for (let t = 0; t < b.trail.length; t++) {
        ctx.globalAlpha = (t / b.trail.length) * 0.3;
        ctx.fillStyle = '#ff4444';
        ctx.beginPath(); ctx.arc(b.trail[t].x, b.trail[t].y, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#ff4444';
      // Zigzag bullet
      ctx.beginPath();
      ctx.moveTo(b.x - 1, b.y); ctx.lineTo(b.x + 2, b.y + 3);
      ctx.lineTo(b.x - 1, b.y + 6); ctx.lineTo(b.x + 2, b.y + 9);
      ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 2; ctx.stroke();
      ctx.shadowBlur = 0;
    }

    particles.draw(ctx);
    ctx.restore();

    // HUD
    // Lives as ship icons
    for (let i = 0; i < lives; i++) {
      ctx.save(); ctx.translate(18 + i * 20, 16);
      ctx.fillStyle = '#00ff88'; ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 3;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-6, 3); ctx.lineTo(-2, 5); ctx.lineTo(2, 5); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    drawText(ctx, `Score: ${score}`, W - 10, 16, 12, '#fff', 'right');
    drawText(ctx, `Wave: ${wave}`, W / 2, 16, 12, '#00ffff', 'center');
  }, 1000 / 60);
  return () => { clearInterval(loop); document.removeEventListener('keydown', kH); };
}


function gameSnake(area, sendScore) {
  const W = 400, H = 400, CS = 20, COLS = 20, ROWS = 20;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.borderRadius = "12px";
  canvas.style.display = "block";
  area.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const particles = new Particles();
  const shake = new Shake();

  let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  let dir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let food = { x: 15, y: 10 };
  let specialFood = null;
  let specialTimer = 0;
  let score = 0;
  let gameOver = false;
  let deathTimer = 0;
  let moveTimer = 0;
  let moveInterval = 5;
  let interpProgress = 0;
  let prevSnake = snake.map(s => ({ ...s }));
  let trail = [];
  let frameCount = 0;

  function placeFood() {
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    food = pos;
  }

  function placeSpecial() {
    const types = ["bonus", "speed"];
    const type = types[Math.floor(Math.random() * types.length)];
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y) || (pos.x === food.x && pos.y === food.y));
    specialFood = { x: pos.x, y: pos.y, type, life: 300 };
  }

  function onKey(e) {
    const key = e.key.toLowerCase();
    if (key === "arrowup" || key === "w") { if (dir.y !== 1) nextDir = { x: 0, y: -1 }; }
    else if (key === "arrowdown" || key === "s") { if (dir.y !== -1) nextDir = { x: 0, y: 1 }; }
    else if (key === "arrowleft" || key === "a") { if (dir.x !== 1) nextDir = { x: -1, y: 0 }; }
    else if (key === "arrowright" || key === "d") { if (dir.x !== -1) nextDir = { x: 1, y: 0 }; }
    if (gameOver && deathTimer > 60) {
      sendScore(score);
      cleanup();
    }
  }
  document.addEventListener("keydown", onKey);

  // Touch/click support
  function onClick(e) {
    if (gameOver && deathTimer > 60) {
      sendScore(score);
      cleanup();
    }
  }
  canvas.addEventListener("click", onClick);

  function die() {
    gameOver = true;
    deathTimer = 0;
    SFX.die();
    shake.trigger(10);
    for (let s of snake) {
      particles.add(s.x * CS + CS / 2, s.y * CS + CS / 2, 5, {
        color: "#00ff88", speed: 3, life: 60, size: 4
      });
    }
  }

  function update() {
    frameCount++;
    if (gameOver) { deathTimer++; particles.update(); return; }

    moveTimer++;
    if (moveTimer < moveInterval) {
      interpProgress = moveTimer / moveInterval;
      return;
    }
    moveTimer = 0;
    interpProgress = 0;

    prevSnake = snake.map(s => ({ ...s }));
    dir = { ...nextDir };

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) { die(); return; }
    if (snake.some(s => s.x === head.x && s.y === head.y)) { die(); return; }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score += 10;
      SFX.collect();
      particles.add(food.x * CS + CS / 2, food.y * CS + CS / 2, 15, {
        color: "#ff4488", speed: 4, life: 40, size: 5
      });
      placeFood();
      if (Math.random() < 0.25) placeSpecial();
      if (moveInterval > 3) moveInterval = Math.max(3, moveInterval - 0.1);
    } else if (specialFood && head.x === specialFood.x && head.y === specialFood.y) {
      if (specialFood.type === "bonus") {
        score += 50;
        SFX.powerup();
        particles.add(specialFood.x * CS + CS / 2, specialFood.y * CS + CS / 2, 25, {
          color: "#ffcc00", speed: 5, life: 50, size: 6
        });
      } else {
        score += 20;
        SFX.powerup();
        moveInterval = Math.max(2, moveInterval - 1);
        particles.add(specialFood.x * CS + CS / 2, specialFood.y * CS + CS / 2, 20, {
          color: "#00ffff", speed: 5, life: 50, size: 5
        });
      }
      specialFood = null;
    } else {
      snake.pop();
    }

    if (specialFood) {
      specialFood.life--;
      if (specialFood.life <= 0) specialFood = null;
    }

    // Trail particles behind head
    trail.push({ x: head.x * CS + CS / 2, y: head.y * CS + CS / 2, life: 20 });
    if (trail.length > 20) trail.shift();
    particles.update();
  }

  function drawSnakeSegment(x, y, i, total) {
    const px = x * CS, py = y * CS;
    const scale = 1 - (i / total) * 0.3;
    const sz = CS * scale;
    const off = (CS - sz) / 2;

    ctx.save();
    const g = ctx.createRadialGradient(px + CS / 2, py + CS / 2, 0, px + CS / 2, py + CS / 2, CS / 2);
    if (i === 0) {
      g.addColorStop(0, "#66ffaa");
      g.addColorStop(1, "#00cc66");
    } else {
      g.addColorStop(0, "#00ff88");
      g.addColorStop(1, "#009944");
    }
    ctx.fillStyle = g;
    ctx.shadowColor = "#00ff88";
    ctx.shadowBlur = i === 0 ? 15 : 8;
    ctx.beginPath();
    ctx.roundRect(px + off + 1, py + off + 1, sz - 2, sz - 2, 6);
    ctx.fill();
    ctx.restore();

    if (i === 0) {
      // Eyes
      ctx.save();
      ctx.shadowBlur = 0;
      const cx = px + CS / 2, cy = py + CS / 2;
      const ex = dir.x * 3, ey = dir.y * 3;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(cx - 4 + ex, cy - 2 + ey, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 4 + ex, cy - 2 + ey, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(cx - 4 + ex + dir.x * 2, cy - 2 + ey + dir.y * 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 4 + ex + dir.x * 2, cy - 2 + ey + dir.y * 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function draw() {
    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0a1a");
    bg.addColorStop(1, "#0d1520");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,136,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += CS) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += CS) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    shake.apply(ctx, W, H);

    // Trail
    ctx.save();
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i];
      t.life--;
      if (t.life > 0) {
        ctx.globalAlpha = t.life / 20 * 0.4;
        ctx.fillStyle = "#00ff88";
        ctx.beginPath();
        ctx.arc(t.x, t.y, 3 * (t.life / 20), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    trail = trail.filter(t => t.life > 0);
    ctx.restore();

    // Snake with interpolation
    const total = snake.length;
    for (let i = total - 1; i >= 0; i--) {
      let sx, sy;
      if (moveTimer < moveInterval && prevSnake[i]) {
        sx = prevSnake[i].x + (snake[i].x - prevSnake[i].x) * easeOutQuad(interpProgress);
        sy = prevSnake[i].y + (snake[i].y - prevSnake[i].y) * easeOutQuad(interpProgress);
      } else {
        sx = snake[i].x; sy = snake[i].y;
      }
      if (!gameOver || (deathTimer % 4 < 2)) {
        drawSnakeSegment(sx, sy, i, total);
      } else if (gameOver) {
        // Dissolve effect
      }
    }

    if (gameOver) {
      // Dissolve particles
      if (deathTimer % 3 === 0 && deathTimer < 50) {
        const si = Math.floor(Math.random() * snake.length);
        particles.add(snake[si].x * CS + CS / 2, snake[si].y * CS + CS / 2, 2, {
          color: "#00ff88", speed: 2, life: 40, size: 3
        });
      }
    }

    // Food
    const fpulse = 0.8 + 0.2 * Math.sin(frameCount * 0.1);
    const fg = ctx.createRadialGradient(
      food.x * CS + CS / 2, food.y * CS + CS / 2, 2,
      food.x * CS + CS / 2, food.y * CS + CS / 2, CS / 2 * fpulse
    );
    fg.addColorStop(0, "#ffffff");
    fg.addColorStop(0.3, "#ff4488");
    fg.addColorStop(1, "rgba(255,68,136,0)");
    ctx.save();
    ctx.fillStyle = fg;
    ctx.shadowColor = "#ff4488";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(food.x * CS + CS / 2, food.y * CS + CS / 2, CS / 2 * fpulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Special food
    if (specialFood) {
      const sp = 0.7 + 0.3 * Math.sin(frameCount * 0.15);
      const alpha = Math.min(1, specialFood.life / 60);
      ctx.save();
      ctx.globalAlpha = alpha;
      const col = specialFood.type === "bonus" ? "#ffcc00" : "#00ffff";
      const sg = ctx.createRadialGradient(
        specialFood.x * CS + CS / 2, specialFood.y * CS + CS / 2, 2,
        specialFood.x * CS + CS / 2, specialFood.y * CS + CS / 2, CS / 2 * sp
      );
      sg.addColorStop(0, "#fff");
      sg.addColorStop(0.4, col);
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.shadowColor = col;
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(specialFood.x * CS + CS / 2, specialFood.y * CS + CS / 2, CS / 2 * sp, 0, Math.PI * 2);
      ctx.fill();
      // Symbol
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "center";
      ctx.fillText(specialFood.type === "bonus" ? "\u2605" : "\u26A1", specialFood.x * CS + CS / 2, specialFood.y * CS + CS / 2 + 5);
      ctx.restore();
    }

    particles.draw(ctx);

    // Score
    drawText(ctx, "SCORE: " + score, W / 2, 30, 20, "#00ff88", "center", true);

    if (gameOver) {
      drawText(ctx, "GAME OVER", W / 2, H / 2 - 20, 30, "#ff4488", "center", true);
      if (deathTimer > 60) drawText(ctx, "CLICK TO RESTART", W / 2, H / 2 + 20, 16, "#ffffff", "center", false);
    }
  }

  placeFood();
  const loop = setInterval(() => { update(); draw(); }, 1000 / 60);

  function cleanup() {
    clearInterval(loop);
    document.removeEventListener("keydown", onKey);
    canvas.removeEventListener("click", onClick);
    canvas.remove();
  }
  return cleanup;
}

function gameFlappyBird(area, sendScore) {
  const W = 400, H = 550;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.borderRadius = "12px";
  canvas.style.display = "block";
  area.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const particles = new Particles();
  const shake = new Shake();

  let bird = { x: 100, y: H / 2, vy: 0, rot: 0, wingAngle: 0 };
  const GRAVITY = 0.35;
  const FLAP = -6.5;
  const PIPE_W = 60;
  const PIPE_GAP = 140;
  const PIPE_SPEED = 2.2;
  let pipes = [];
  let score = 0;
  let gameState = "start"; // start, playing, dead
  let groundX = 0;
  let clouds = [];
  let frameCount = 0;
  let deathTimer = 0;

  for (let i = 0; i < 6; i++) {
    clouds.push({
      x: Math.random() * W,
      y: 30 + Math.random() * 150,
      w: 40 + Math.random() * 80,
      speed: 0.3 + Math.random() * 0.5,
      layer: Math.floor(Math.random() * 3)
    });
  }

  function spawnPipe() {
    const gapY = 80 + Math.random() * (H - 200);
    pipes.push({ x: W, gapY, scored: false });
  }

  function flap() {
    if (gameState === "start") {
      gameState = "playing";
      bird.vy = FLAP;
      SFX.flap();
    } else if (gameState === "playing") {
      bird.vy = FLAP;
      SFX.flap();
      particles.add(bird.x, bird.y + 10, 3, {
        color: "#ffffff", speed: 2, life: 15, size: 3
      });
    } else if (gameState === "dead" && deathTimer > 60) {
      sendScore(score);
      cleanup();
    }
  }

  function onKey(e) {
    if (e.code === "Space" || e.key === " " || e.key === "ArrowUp") {
      e.preventDefault();
      flap();
    }
  }
  document.addEventListener("keydown", onKey);
  canvas.addEventListener("click", () => { flap(); });
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); flap(); });

  function die() {
    gameState = "dead";
    deathTimer = 0;
    SFX.die();
    shake.trigger(12);
    for (let i = 0; i < 20; i++) {
      particles.add(bird.x, bird.y, 1, {
        color: ["#ffcc00", "#ffffff", "#ff8800"][Math.floor(Math.random() * 3)],
        speed: 3 + Math.random() * 4, life: 40 + Math.random() * 30, size: 3 + Math.random() * 3
      });
    }
  }

  function update() {
    frameCount++;
    if (gameState === "dead") { deathTimer++; particles.update(); return; }
    if (gameState === "start") {
      bird.y = H / 2 + Math.sin(frameCount * 0.05) * 15;
      bird.wingAngle = Math.sin(frameCount * 0.2) * 0.4;
      for (let c of clouds) { c.x -= c.speed * 0.3; if (c.x + c.w < 0) c.x = W + c.w; }
      return;
    }

    bird.vy += GRAVITY;
    bird.y += bird.vy;
    bird.rot = Math.min(Math.max(bird.vy * 3, -30), 70);
    bird.wingAngle = Math.sin(frameCount * 0.3) * 0.5;

    // Pipes
    if (frameCount % 90 === 0) spawnPipe();
    for (let p of pipes) {
      p.x -= PIPE_SPEED;
      if (!p.scored && p.x + PIPE_W < bird.x) { p.scored = true; score++; SFX.score(); }
    }
    pipes = pipes.filter(p => p.x + PIPE_W > -10);

    // Collision
    if (bird.y > H - 80 || bird.y < 0) { die(); return; }
    for (let p of pipes) {
      if (bird.x + 15 > p.x && bird.x - 15 < p.x + PIPE_W) {
        if (bird.y - 15 < p.gapY - PIPE_GAP / 2 || bird.y + 15 > p.gapY + PIPE_GAP / 2) {
          die(); return;
        }
      }
    }

    for (let c of clouds) { c.x -= c.speed; if (c.x + c.w < 0) c.x = W + c.w; }
    groundX = (groundX - PIPE_SPEED) % 40;
    particles.update();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a1628");
    g.addColorStop(0.4, "#1a3a5c");
    g.addColorStop(0.75, "#d4845a");
    g.addColorStop(1, "#e8a060");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawClouds() {
    for (let c of clouds) {
      ctx.save();
      ctx.globalAlpha = 0.15 + c.layer * 0.1;
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w / 2, c.w / 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x - c.w * 0.2, c.y - c.w * 0.08, c.w / 3, c.w / 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x + c.w * 0.2, c.y + c.w * 0.04, c.w / 3.5, c.w / 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPipe(p) {
    const topH = p.gapY - PIPE_GAP / 2;
    const botY = p.gapY + PIPE_GAP / 2;
    const capH = 24;

    // Top pipe body
    const tg = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
    tg.addColorStop(0, "#1a8a2a");
    tg.addColorStop(0.5, "#2ecc40");
    tg.addColorStop(1, "#1a7a22");
    ctx.fillStyle = tg;
    ctx.shadowColor = "#00ff44";
    ctx.shadowBlur = 8;
    ctx.fillRect(p.x + 2, 0, PIPE_W - 4, topH);

    // Top cap
    const tcg = ctx.createLinearGradient(p.x - 4, 0, p.x + PIPE_W + 4, 0);
    tcg.addColorStop(0, "#1a8a2a");
    tcg.addColorStop(0.5, "#33dd55");
    tcg.addColorStop(1, "#1a7a22");
    ctx.fillStyle = tcg;
    ctx.beginPath();
    ctx.roundRect(p.x - 4, topH - capH, PIPE_W + 8, capH, 6);
    ctx.fill();

    // Bottom pipe body
    ctx.fillStyle = tg;
    ctx.fillRect(p.x + 2, botY, PIPE_W - 4, H - botY);

    // Bottom cap
    ctx.fillStyle = tcg;
    ctx.beginPath();
    ctx.roundRect(p.x - 4, botY, PIPE_W + 8, capH, 6);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Stripes
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    for (let sy = 0; sy < topH; sy += 12) {
      ctx.beginPath(); ctx.moveTo(p.x + 5, sy); ctx.lineTo(p.x + PIPE_W - 5, sy); ctx.stroke();
    }
    for (let sy = botY + capH; sy < H; sy += 12) {
      ctx.beginPath(); ctx.moveTo(p.x + 5, sy); ctx.lineTo(p.x + PIPE_W - 5, sy); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot * Math.PI / 180);

    // Body
    const bg = ctx.createRadialGradient(0, 0, 2, 0, 0, 16);
    bg.addColorStop(0, "#ffee55");
    bg.addColorStop(1, "#ddaa00");
    ctx.fillStyle = bg;
    ctx.shadowColor = "#ffcc00";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.save();
    ctx.rotate(bird.wingAngle);
    ctx.fillStyle = "#eebb00";
    ctx.beginPath();
    ctx.ellipse(-4, 4, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Eye
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(7, -3, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(9, -3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(10, -4, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#ff6622";
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(22, 2);
    ctx.lineTo(14, 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawGround() {
    const gy = H - 60;
    const gg = ctx.createLinearGradient(0, gy, 0, H);
    gg.addColorStop(0, "#22aa33");
    gg.addColorStop(0.3, "#44bb33");
    gg.addColorStop(1, "#886633");
    ctx.fillStyle = gg;
    ctx.fillRect(0, gy, W, 60);

    // Grass tufts
    ctx.fillStyle = "#33cc44";
    for (let gx = groundX; gx < W + 40; gx += 40) {
      ctx.beginPath();
      ctx.ellipse(gx, gy + 4, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    drawSky();
    drawClouds();
    pipes.forEach(drawPipe);
    drawGround();

    shake.apply(ctx, W, H);

    if (gameState !== "dead") drawBird();
    else {
      // Flash effect
      if (deathTimer < 10 && deathTimer % 2 === 0) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    particles.draw(ctx);

    // Score
    drawText(ctx, String(score), W / 2, 55, 48, "#ffffff", "center", true);

    if (gameState === "start") {
      const pulse = 0.8 + 0.2 * Math.sin(frameCount * 0.08);
      ctx.save();
      ctx.globalAlpha = pulse;
      drawText(ctx, "TAP TO START", W / 2, H / 2 + 60, 22, "#ffffff", "center", true);
      ctx.restore();
    }

    if (gameState === "dead" && deathTimer > 60) {
      drawText(ctx, "TAP TO RESTART", W / 2, H / 2 + 40, 18, "#ffffff", "center", false);
    }
  }

  const loop = setInterval(() => { update(); draw(); }, 1000 / 60);

  function cleanup() {
    clearInterval(loop);
    document.removeEventListener("keydown", onKey);
    canvas.removeEventListener("click", flap);
    canvas.remove();
  }
  return cleanup;
}

function gameContra(area, sendScore) {
  const W = 600, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const keys = {};
  document.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; e.preventDefault(); });
  document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  let score = 0, distance = 0, lives = 3, gameOver = false;
  let scrollX = 0, shootCooldown = 0, shootFrame = 0;

  const player = {
    x: 120, y: 280, w: 28, h: 44, vy: 0, grounded: true,
    dir: 1, aimX: 1, aimY: 0, state: 'run', frame: 0,
    invTimer: 0, powerup: 'normal', powerTimer: 0, crouching: false
  };

  const bullets = [];
  const enemyBullets = [];
  const enemies = [];
  const powerups = [];
  const particles = [];
  const explosions = [];
  const scrollObjects = [];

  function addParticles(x, y, count, color, spread) {
    spread = spread || 4;
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y, vx: (Math.random() - 0.5) * spread * 2, vy: (Math.random() - 1) * spread,
        life: 20 + Math.random() * 15, maxLife: 35, size: 1.5 + Math.random() * 3, color
      });
    }
  }

  function addExplosion(x, y, size) {
    explosions.push({ x, y, size: size || 20, timer: 15, maxTimer: 15 });
    addParticles(x, y, 12, '#ff8800', 6);
    addParticles(x, y, 8, '#ffcc00', 4);
    addParticles(x, y, 6, '#ff4444', 3);
    if (typeof Shake !== 'undefined') Shake.trigger(size > 25 ? 8 : 4);
  }

  function spawnEnemy() {
    const types = ['soldier', 'soldier', 'turret', 'runner'];
    const t = types[Math.floor(Math.random() * Math.min(types.length, Math.floor(distance / 500) + 2))];
    const e = {
      x: W + scrollX + 40, y: t === 'turret' ? 295 : 280, w: 24, h: t === 'turret' ? 20 : 36,
      type: t, hp: t === 'turret' ? 30 : t === 'runner' ? 15 : 25,
      maxHp: t === 'turret' ? 30 : t === 'runner' ? 15 : 25,
      speed: t === 'runner' ? 3 : t === 'turret' ? 0 : 1,
      shootTimer: t === 'turret' ? 60 + Math.random() * 60 : 0,
      frame: 0, flashTimer: 0, alive: true
    };
    enemies.push(e);
  }

  function spawnPowerup() {
    const types = ['S', 'L', 'B'];
    powerups.push({
      x: 100 + Math.random() * (W - 200), y: -20,
      type: types[Math.floor(Math.random() * types.length)], vy: 1.5, size: 16
    });
  }

  function fireBullet() {
    if (shootCooldown > 0) return;
    shootFrame = 5;
    const bx = player.x + player.aimX * 15;
    const by = player.y - 20 + player.aimY * 15;
    const speed = 8;
    const angle = Math.atan2(player.aimY, player.aimX || player.dir);

    if (player.powerup === 'spread') {
      for (let i = -1; i <= 1; i++) {
        const a = angle + i * 0.2;
        bullets.push({ x: bx, y: by, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, damage: 5, life: 60 });
      }
      shootCooldown = 12;
    } else if (player.powerup === 'laser') {
      bullets.push({ x: bx, y: by, vx: Math.cos(angle) * speed * 1.5, vy: Math.sin(angle) * speed * 1.5, damage: 20, life: 80, laser: true });
      shootCooldown = 18;
    } else {
      bullets.push({ x: bx, y: by, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage: 5, life: 60 });
      shootCooldown = 10;
    }
    if (typeof SFX !== 'undefined') SFX.shoot();
  }

  function drawBackground() {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.6);
    skyGrad.addColorStop(0, '#0a1628');
    skyGrad.addColorStop(0.4, '#1a2a40');
    skyGrad.addColorStop(1, '#2a3a30');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.6);

    // Sun/moon
    ctx.shadowColor = '#ffaa44';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#ffcc66';
    ctx.beginPath();
    ctx.arc(500, 60, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Far mountains
    ctx.fillStyle = '#1a2a20';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.5);
    for (let x = 0; x <= W; x += 40) {
      ctx.lineTo(x, H * 0.5 - Math.sin((x + scrollX * 0.1) * 0.015) * 30 - 20);
    }
    ctx.lineTo(W, H * 0.6);
    ctx.lineTo(0, H * 0.6);
    ctx.fill();

    // Palm trees (parallax)
    for (let i = 0; i < 6; i++) {
      const tx = ((i * 130 - scrollX * 0.3) % (W + 80)) - 40;
      const ty = H * 0.52;
      // Trunk
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(tx - 3, ty - 50, 6, 50);
      // Leaves
      ctx.fillStyle = '#1a5a1a';
      for (let l = 0; l < 5; l++) {
        const la = l * Math.PI * 2 / 5;
        ctx.beginPath();
        ctx.ellipse(tx + Math.cos(la) * 18, ty - 55 + Math.sin(la) * 8, 20, 6, la, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Bunkers (mid parallax)
    for (let i = 0; i < 3; i++) {
      const bx = ((i * 250 + 100 - scrollX * 0.5) % (W + 200)) - 100;
      ctx.fillStyle = '#3a3a30';
      ctx.fillRect(bx, H * 0.48, 60, 30);
      ctx.fillStyle = '#2a2a20';
      ctx.fillRect(bx + 5, H * 0.50, 20, 15);
    }

    // Ground
    const gGrad = ctx.createLinearGradient(0, H * 0.65, 0, H);
    gGrad.addColorStop(0, '#3a5a2a');
    gGrad.addColorStop(0.15, '#5a4a2a');
    gGrad.addColorStop(1, '#3a3020');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, H * 0.65, W, H * 0.35);

    // Grass tufts
    ctx.fillStyle = '#4a7a3a';
    for (let gx = 0; gx < W; gx += 15) {
      const gh = 3 + Math.sin((gx + scrollX * 0.8) * 0.1) * 3;
      ctx.fillRect(gx, H * 0.65 - gh, 8, gh);
    }
  }

  function drawPlayer() {
    if (player.invTimer > 0 && Math.floor(player.invTimer / 3) % 2 === 0) return;
    const px = player.x - scrollX;
    const py = player.y;
    const breathing = Math.sin(Date.now() * 0.006) * 1.5;

    ctx.save();
    ctx.translate(px, py);
    if (player.dir < 0) ctx.scale(-1, 1);

    const crouch = player.crouching ? 12 : 0;

    // Legs
    const legAnim = player.state === 'run' ? Math.sin(player.frame * 0.3) * 6 : 0;
    ctx.fillStyle = '#2a4a2a';
    ctx.fillRect(-6, -14 + crouch, 5, 14 - crouch + legAnim);
    ctx.fillRect(1, -14 + crouch, 5, 14 - crouch - legAnim);

    // Boots
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(-7, -2 + legAnim, 7, 3);
    ctx.fillRect(0, -2 - legAnim, 7, 3);

    // Body - muscular torso
    const torsoGrad = ctx.createLinearGradient(-10, -40 + crouch + breathing, 10, -14);
    torsoGrad.addColorStop(0, '#cc7744');
    torsoGrad.addColorStop(1, '#aa5522');
    ctx.fillStyle = torsoGrad;
    ctx.fillRect(-10, -40 + crouch + breathing, 20, 26);

    // Muscle lines
    ctx.strokeStyle = '#8a4422';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, -36 + crouch + breathing);
    ctx.lineTo(-3, -26 + crouch + breathing);
    ctx.moveTo(5, -36 + crouch + breathing);
    ctx.lineTo(3, -26 + crouch + breathing);
    ctx.stroke();

    // Arms
    const aimAngle = Math.atan2(player.aimY, player.aimX || 1);
    ctx.fillStyle = '#cc7744';
    ctx.save();
    ctx.translate(8, -35 + crouch + breathing);
    ctx.rotate(aimAngle);
    ctx.fillRect(0, -2, 16, 4);
    // Gun
    ctx.fillStyle = '#444';
    ctx.fillRect(14, -3, 10, 6);
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(22, -1, 3, 2);
    ctx.restore();

    // Head
    const headGrad = ctx.createRadialGradient(0, -44 + crouch + breathing, 2, 0, -44 + crouch + breathing, 9);
    headGrad.addColorStop(0, '#ddaa77');
    headGrad.addColorStop(1, '#bb8855');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(0, -44 + crouch + breathing, 9, 0, Math.PI * 2);
    ctx.fill();

    // Red headband
    ctx.fillStyle = '#dd2222';
    ctx.fillRect(-10, -48 + crouch + breathing, 20, 4);
    // Headband tails
    ctx.fillRect(-10, -47 + crouch + breathing, -12, 3);

    ctx.restore();

    // Shield
    if (player.powerup === 'barrier' && player.powerTimer > 0) {
      ctx.strokeStyle = `rgba(0,255,255,${0.5 + Math.sin(Date.now() * 0.01) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py - 20, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawEnemy(e) {
    if (!e.alive) return;
    const ex = e.x - scrollX;
    const ey = e.y;
    const flash = e.flashTimer > 0;

    if (e.type === 'soldier' || e.type === 'runner') {
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(-1, 1);

      const bodyColor = e.type === 'runner' ? '#553388' : '#336633';
      const darkColor = e.type === 'runner' ? '#332255' : '#224422';

      // Body
      ctx.fillStyle = flash ? '#fff' : bodyColor;
      ctx.fillRect(-8, -38, 16, 24);

      // Legs
      const la = Math.sin(e.frame * 0.2) * 5;
      ctx.fillStyle = flash ? '#fff' : '#333';
      ctx.fillRect(-5, -14, 4, 14 + la);
      ctx.fillRect(1, -14, 4, 14 - la);

      // Head
      ctx.fillStyle = flash ? '#fff' : '#55aa33';
      ctx.beginPath();
      ctx.arc(0, -42, 7, 0, Math.PI * 2);
      ctx.fill();

      // Eye
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(3, -43, 3, 2);

      ctx.restore();
    } else if (e.type === 'turret') {
      // Turret base
      const tGrad = ctx.createLinearGradient(ex - 15, ey - 15, ex + 15, ey + 5);
      tGrad.addColorStop(0, flash ? '#fff' : '#666');
      tGrad.addColorStop(1, flash ? '#ddd' : '#333');
      ctx.fillStyle = tGrad;
      ctx.fillRect(ex - 15, ey - 15, 30, 20);

      // Barrel
      ctx.fillStyle = flash ? '#fff' : '#555';
      const bAngle = Math.atan2(player.y - ey, player.x - e.x);
      ctx.save();
      ctx.translate(ex, ey - 8);
      ctx.rotate(bAngle);
      ctx.fillRect(0, -2, 20, 4);
      ctx.restore();

      // Red light
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(ex, ey - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // HP bar
    if (e.hp < e.maxHp) {
      const barW = 24;
      ctx.fillStyle = '#333';
      ctx.fillRect(ex - barW / 2, ey - 55, barW, 3);
      ctx.fillStyle = '#ff0044';
      ctx.fillRect(ex - barW / 2, ey - 55, barW * (e.hp / e.maxHp), 3);
    }
  }

  function drawHUD() {
    // Lives
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('LIVES: ' + lives, 16, 20);
    ctx.shadowBlur = 0;

    // Score
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('SCORE: ' + score, W - 16, 20);
    ctx.shadowBlur = 0;

    // Distance
    ctx.fillStyle = '#00ffff';
    ctx.font = '12px monospace';
    ctx.fillText('DIST: ' + Math.floor(distance) + 'm', W - 16, 38);

    // Power-up indicator
    if (player.powerup !== 'normal') {
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(player.powerup.toUpperCase() + ' [' + Math.ceil(player.powerTimer / 60) + 's]', 16, 38);
      ctx.shadowBlur = 0;
    }
  }

  function update() {
    if (gameOver) return;
    player.frame++;
    distance += 0.8;
    if (player.invTimer > 0) player.invTimer--;
    if (shootCooldown > 0) shootCooldown--;
    if (shootFrame > 0) shootFrame--;
    if (player.powerTimer > 0) {
      player.powerTimer--;
      if (player.powerTimer <= 0) player.powerup = 'normal';
    }

    // Aiming
    player.aimX = 0; player.aimY = 0;
    if (keys['arrowup']) player.aimY = -1;
    if (keys['arrowdown']) { player.aimY = 1; player.crouching = true; } else { player.crouching = false; }
    if (keys['arrowright']) player.aimX = 1;
    if (keys['arrowleft']) player.aimX = -1;
    if (player.aimX !== 0) player.dir = player.aimX;
    if (player.aimX === 0 && player.aimY === 0) player.aimX = player.dir;

    // Movement
    if (keys['arrowleft']) player.x -= 3;
    if (keys['arrowright']) player.x += 3;
    if (keys['z'] && player.grounded) { player.vy = -10; player.grounded = false; }
    if (!player.grounded) { player.vy += 0.45; player.y += player.vy; }
    if (player.y >= 280) { player.y = 280; player.vy = 0; player.grounded = true; }
    player.x = Math.max(20, Math.min(W - 20, player.x));
    player.state = player.grounded ? 'run' : 'jump';

    // Shooting
    if (keys['x']) fireBullet();

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        bullets.splice(i, 1);
        continue;
      }
      // Hit enemies
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (!e.alive) continue;
        const dx = Math.abs(b.x - e.x);
        const dy = Math.abs(b.y - (e.y - 15));
        if (dx < 20 && dy < 20) {
          e.hp -= b.damage;
          e.flashTimer = 4;
          addParticles(b.x, b.y, 4, '#ffcc00');
          if (!b.laser) { bullets.splice(i, 1); break; }
          if (e.hp <= 0) {
            e.alive = false;
            score += e.type === 'turret' ? 200 : 100;
            addExplosion(e.x, e.y, 25);
            if (typeof SFX !== 'undefined') SFX.explode();
          }
        }
      }
    }

    // Enemy bullets
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0) { enemyBullets.splice(i, 1); continue; }
      if (Math.abs(b.x - player.x) < 15 && Math.abs(b.y - (player.y - 20)) < 20 && player.invTimer <= 0) {
        hitPlayer();
        enemyBullets.splice(i, 1);
      }
    }

    // Spawn enemies
    if (Math.random() < 0.015 + distance * 0.00001) spawnEnemy();
    if (Math.random() < 0.003) spawnPowerup();

    // Update enemies
    enemies.forEach(e => {
      if (!e.alive) return;
      e.frame++;
      if (e.flashTimer > 0) e.flashTimer--;

      if (e.type === 'runner') {
        e.x -= e.speed;
      } else if (e.type === 'soldier') {
        e.x -= e.speed * 0.5;
      }

      if (e.type === 'turret') {
        e.shootTimer--;
        if (e.shootTimer <= 0) {
          const angle = Math.atan2(player.y - 20 - e.y, player.x - e.x);
          enemyBullets.push({
            x: e.x, y: e.y - 8, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, life: 120
          });
          e.shootTimer = 80 + Math.random() * 40;
          if (typeof SFX !== 'undefined') SFX.shoot();
        }
      }

      // Enemy touches player
      if (Math.abs(e.x - player.x) < 20 && Math.abs(e.y - player.y) < 30 && player.invTimer <= 0) {
        hitPlayer();
      }
    });

    // Clean up dead enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].x < scrollX - 100 || !enemies[i].alive) {
        if (!enemies[i].alive || enemies[i].x < scrollX - 100) {
          enemies.splice(i, 1);
        }
      }
    }

    // Powerups
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy;
      if (p.y > H + 20) { powerups.splice(i, 1); continue; }
      if (Math.abs(p.x - player.x) < 20 && Math.abs(p.y - player.y) < 30) {
        player.powerup = p.type === 'S' ? 'spread' : p.type === 'L' ? 'laser' : 'barrier';
        player.powerTimer = p.type === 'B' ? 180 : 600;
        addParticles(p.x, p.y, 10, '#00ffff', 5);
        if (typeof SFX !== 'undefined') SFX.powerup();
        powerups.splice(i, 1);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = explosions.length - 1; i >= 0; i--) {
      explosions[i].timer--;
      if (explosions[i].timer <= 0) explosions.splice(i, 1);
    }
  }

  function hitPlayer() {
    if (player.powerup === 'barrier') {
      player.powerup = 'normal';
      player.powerTimer = 0;
      addParticles(player.x, player.y, 10, '#00ffff');
      if (typeof SFX !== 'undefined') SFX.bounce();
      return;
    }
    lives--;
    player.invTimer = 120;
    addParticles(player.x, player.y, 15, '#ff4444');
    if (typeof Shake !== 'undefined') Shake.trigger(6);
    if (typeof SFX !== 'undefined') SFX.die();
    if (lives <= 0) {
      gameOver = true;
      addExplosion(player.x, player.y, 40);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    // Enemy bullets
    enemyBullets.forEach(b => {
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#ff6644';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Powerups
    powerups.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      const bob = Math.sin(Date.now() * 0.008) * 3;
      ctx.translate(0, bob);
      ctx.shadowColor = p.type === 'S' ? '#ff00ff' : p.type === 'L' ? '#ffcc00' : '#00ffff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#222';
      ctx.fillRect(-10, -10, 20, 20);
      ctx.strokeStyle = ctx.shadowColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.fillStyle = ctx.shadowColor;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.type, 0, 5);
      ctx.shadowBlur = 0;
      ctx.restore();
    });

    // Enemies
    enemies.forEach(e => drawEnemy(e));

    // Player bullets
    bullets.forEach(b => {
      if (b.laser) {
        ctx.shadowColor = '#ff00ff';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#ff44ff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 2, b.y - b.vy * 2);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 2, b.y - b.vy * 2);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffff88';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
        // Trail
        ctx.fillStyle = '#ffcc0044';
        ctx.beginPath();
        ctx.arc(b.x - b.vx * 0.5, b.y - b.vy * 0.5, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.shadowBlur = 0;

    drawPlayer();

    // Particles
    particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    // Explosions
    explosions.forEach(e => {
      const progress = 1 - e.timer / e.maxTimer;
      ctx.globalAlpha = 1 - progress;
      const r = e.size * (0.5 + progress * 0.8);
      const eGrad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      eGrad.addColorStop(0, '#ffffff');
      eGrad.addColorStop(0.3, '#ffcc00');
      eGrad.addColorStop(0.6, '#ff6600');
      eGrad.addColorStop(1, '#ff000000');
      ctx.fillStyle = eGrad;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    drawHUD();

    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.shadowColor = '#ff0044';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ff0044';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.fillText('Score: ' + score + '  Distance: ' + Math.floor(distance) + 'm', W / 2, H / 2 + 20);
    }
  }

  const loop = setInterval(() => {
    update();
    draw();
    if (gameOver) {
      clearInterval(loop);
      setTimeout(() => sendScore(score), 1500);
    }
  }, 1000 / 60);

  return () => {
    clearInterval(loop);
    document.onkeydown = null;
    document.onkeyup = null;
  };
}


// ==================== GAME 6: MORTAL KOMBAT ====================

function gameMortalKombat(area, sendScore) {
  const W = 600, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const keys = {};
  document.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; e.preventDefault(); });
  document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  let score = 0, round = 1, playerWins = 0, botWins = 0, maxRounds = 3;
  let gameOver = false, roundOver = false, roundTimer = 99 * 60;
  let koTimer = 0, victoryScreen = 0;
  let comboCount = 0, comboTimer = 0, flawless = true;

  const flames = [];
  const particles = [];
  const projectiles = [];

  function addParticles(x, y, count, color, opts) {
    opts = opts || {};
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * (opts.spread || 6),
        vy: (Math.random() - 1) * (opts.upForce || 4),
        life: (opts.life || 25) + Math.random() * 15,
        maxLife: (opts.life || 25) + 15,
        size: (opts.size || 2) + Math.random() * 3,
        color,
        gravity: opts.gravity !== undefined ? opts.gravity : 0.1
      });
    }
  }

  function createFighter(x, isPlayer) {
    return {
      x, y: 290, w: 40, h: 65, hp: 100, maxHp: 100,
      state: 'idle', dir: isPlayer ? 1 : -1, frame: 0,
      stateTimer: 0, vx: 0, vy: 0, grounded: true,
      attacking: false, blocking: false, hitstun: 0, comboCounter: 0,
      isPlayer, flashTimer: 0, specialCooldown: 0, ko: false,
      idleOffset: 0
    };
  }

  const player = createFighter(180, true);
  const bot = createFighter(420, false);

  function resetRound() {
    player.x = 180; player.hp = 100; player.state = 'idle'; player.attacking = false;
    player.hitstun = 0; player.ko = false; player.y = 290;
    player.vy = 0; player.grounded = true; player.specialCooldown = 0;
    bot.x = 420; bot.hp = 100; bot.state = 'idle'; bot.attacking = false;
    bot.hitstun = 0; bot.ko = false; bot.y = 290;
    bot.vy = 0; bot.grounded = true; bot.specialCooldown = 0;
    roundTimer = 99 * 60; roundOver = false; koTimer = 0;
    comboCount = 0; comboTimer = 0; flawless = true;
    projectiles.length = 0;
  }

  function drawBackground() {
    // Dark temple gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0010');
    bgGrad.addColorStop(0.3, '#1a0028');
    bgGrad.addColorStop(0.6, '#200030');
    bgGrad.addColorStop(1, '#0a0015');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Pillars
    const pillarPositions = [50, 150, 450, 550];
    pillarPositions.forEach(px => {
      const pilGrad = ctx.createLinearGradient(px - 15, 0, px + 15, 0);
      pilGrad.addColorStop(0, '#2a1a30');
      pilGrad.addColorStop(0.5, '#4a2a50');
      pilGrad.addColorStop(1, '#2a1a30');
      ctx.fillStyle = pilGrad;
      ctx.fillRect(px - 15, 80, 30, 220);
      // Pillar top
      ctx.fillStyle = '#5a3a60';
      ctx.fillRect(px - 20, 75, 40, 15);
      // Pillar base
      ctx.fillRect(px - 20, 295, 40, 10);
    });

    // Fire pits
    [100, 300, 500].forEach(fx => {
      // Pit
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(fx - 20, 300, 40, 20);
      ctx.fillStyle = '#333';
      ctx.fillRect(fx - 22, 298, 44, 5);

      // Flame particles
      if (Math.random() < 0.4) {
        flames.push({
          x: fx + (Math.random() - 0.5) * 16,
          y: 298, vx: (Math.random() - 0.5) * 1,
          vy: -1.5 - Math.random() * 2,
          life: 15 + Math.random() * 10, maxLife: 25,
          size: 2 + Math.random() * 4
        });
      }
    });

    // Torches
    [80, 520].forEach(tx => {
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(tx - 3, 120, 6, 40);
      if (Math.random() < 0.3) {
        flames.push({
          x: tx + (Math.random() - 0.5) * 6,
          y: 118, vx: (Math.random() - 0.5) * 0.5,
          vy: -1 - Math.random() * 1.5,
          life: 12 + Math.random() * 8, maxLife: 20,
          size: 2 + Math.random() * 3
        });
      }
    });

    // Ground
    const floorGrad = ctx.createLinearGradient(0, 310, 0, H);
    floorGrad.addColorStop(0, '#2a1a20');
    floorGrad.addColorStop(0.3, '#1a0a15');
    floorGrad.addColorStop(1, '#0a0510');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, 310, W, H - 310);

    // Floor line
    ctx.strokeStyle = '#4a2a50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 310);
    ctx.lineTo(W, 310);
    ctx.stroke();

    // Ground pattern
    ctx.strokeStyle = '#1a0a15';
    for (let gx = 0; gx < W; gx += 30) {
      ctx.beginPath();
      ctx.moveTo(gx, 312);
      ctx.lineTo(gx + 15, H);
      ctx.stroke();
    }
  }

  function drawFighter(f) {
    if (f.ko && koTimer > 60) {
      ctx.globalAlpha = Math.max(0, 1 - (koTimer - 60) / 60);
    }
    if (f.flashTimer > 0 && Math.floor(f.flashTimer / 2) % 2 === 0) {
      ctx.globalAlpha = 0.5;
    }

    const px = f.x;
    const py = f.y;
    const isP = f.isPlayer;
    const breathing = Math.sin(f.frame * 0.08) * 2;
    const bobble = f.state === 'idle' ? Math.sin(f.frame * 0.1) * 1.5 : 0;

    ctx.save();
    ctx.translate(px, py + bobble);
    if (f.dir < 0) ctx.scale(-1, 1);

    const isHit = f.flashTimer > 0;

    // Legs
    const walkAnim = f.state === 'walk' ? Math.sin(f.frame * 0.25) * 6 : 0;
    const crouchOffset = f.state === 'crouch' ? 10 : 0;

    // Left leg
    const legGrad = ctx.createLinearGradient(-8, -12, -2, 0);
    legGrad.addColorStop(0, isHit ? '#fff' : (isP ? '#0033aa' : '#aa1100'));
    legGrad.addColorStop(1, isHit ? '#ddd' : (isP ? '#002288' : '#881100'));
    ctx.fillStyle = legGrad;
    ctx.fillRect(-8, -12 + crouchOffset, 6, 12 - crouchOffset + walkAnim);

    // Right leg
    ctx.fillRect(2, -12 + crouchOffset, 6, 12 - crouchOffset - walkAnim);

    // Feet
    ctx.fillStyle = isHit ? '#ccc' : '#222';
    ctx.fillRect(-9, -1 + walkAnim, 8, 3);
    ctx.fillRect(1, -1 - walkAnim, 8, 3);

    // Body with muscle definition
    const bodyGrad = ctx.createLinearGradient(-14, -55 + breathing + crouchOffset, 14, -12);
    if (isP) {
      bodyGrad.addColorStop(0, isHit ? '#88ccff' : '#0055cc');
      bodyGrad.addColorStop(0.5, isHit ? '#aaddff' : '#0044aa');
      bodyGrad.addColorStop(1, isHit ? '#88ccff' : '#003388');
    } else {
      bodyGrad.addColorStop(0, isHit ? '#ff8888' : '#cc2200');
      bodyGrad.addColorStop(0.5, isHit ? '#ffaaaa' : '#aa1100');
      bodyGrad.addColorStop(1, isHit ? '#ff8888' : '#881100');
    }
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-14, -55 + breathing + crouchOffset, 28, 43);

    // Muscle lines
    ctx.strokeStyle = isHit ? '#ffffff44' : (isP ? '#00226688' : '#66000088');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -50 + breathing + crouchOffset);
    ctx.lineTo(-4, -35 + breathing + crouchOffset);
    ctx.moveTo(6, -50 + breathing + crouchOffset);
    ctx.lineTo(4, -35 + breathing + crouchOffset);
    // Abs
    ctx.moveTo(0, -45 + breathing + crouchOffset);
    ctx.lineTo(0, -20 + breathing + crouchOffset);
    ctx.stroke();

    // Arms
    const punchExtend = f.state === 'punch' ? Math.min(f.stateTimer * 3, 18) : 0;
    const kickExtend = f.state === 'kick' ? Math.min(f.stateTimer * 3, 20) : 0;

    ctx.fillStyle = isHit ? '#ffcc99' : '#cc8855';

    if (f.state === 'punch') {
      // Punching arm
      ctx.fillRect(12, -48 + breathing + crouchOffset, 6 + punchExtend, 5);
      // Fist
      ctx.fillStyle = '#ddaa77';
      ctx.fillRect(16 + punchExtend, -50 + breathing + crouchOffset, 6, 8);
      // Other arm guard
      ctx.fillStyle = isHit ? '#ffcc99' : '#cc8855';
      ctx.fillRect(-18, -42 + breathing + crouchOffset, 6, 14);
    } else if (f.state === 'special') {
      // Arms forward for projectile
      ctx.fillRect(12, -45 + breathing + crouchOffset, 18, 5);
      ctx.fillRect(-18, -42 + breathing + crouchOffset, 6, 14);
    } else {
      // Guard stance
      ctx.fillRect(14, -45 + breathing + crouchOffset, 6, 16);
      ctx.fillRect(-18, -45 + breathing + crouchOffset, 6, 16);
    }

    if (f.state === 'kick' && kickExtend > 0) {
      ctx.fillStyle = isHit ? '#ddd' : '#333';
      ctx.fillRect(4, -15, 6 + kickExtend, 5);
    }

    // Head
    const headGrad = ctx.createRadialGradient(0, -60 + breathing + crouchOffset, 2, 0, -60 + breathing + crouchOffset, 10);
    headGrad.addColorStop(0, isHit ? '#ffffff' : '#ddaa77');
    headGrad.addColorStop(1, isHit ? '#dddddd' : '#bb8855');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(0, -60 + breathing + crouchOffset, 10, 0, Math.PI * 2);
    ctx.fill();

    // Mask
    ctx.fillStyle = isHit ? '#ffffff' : (isP ? '#0044cc' : '#cc2200');
    ctx.fillRect(-10, -63 + breathing + crouchOffset, 20, 8);

    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(2, -62 + breathing + crouchOffset, 5, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(4, -62 + breathing + crouchOffset, 2, 3);

    // Blocking shield
    if (f.blocking) {
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -30 + crouchOffset, 25, -0.5, 0.5);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHealthBars() {
    // Player HP bar
    const barY = 30;
    const barH = 18;
    const maxBarW = 240;

    // Player
    ctx.fillStyle = '#000';
    ctx.fillRect(20, barY, maxBarW + 4, barH + 4);
    const pPct = Math.max(0, player.hp / player.maxHp);
    const pHpGrad = ctx.createLinearGradient(22, 0, 22 + maxBarW, 0);
    pHpGrad.addColorStop(0, '#00ff44');
    pHpGrad.addColorStop(0.5, '#ffcc00');
    pHpGrad.addColorStop(1, '#ff0044');
    ctx.fillStyle = pHpGrad;
    ctx.fillRect(22, barY + 2, maxBarW * pPct, barH);
    ctx.strokeStyle = '#ffffff33';
    ctx.strokeRect(20, barY, maxBarW + 4, barH + 4);

    // Player name
    ctx.shadowColor = '#0088ff';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#0088ff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SUB-ZERO', 22, barY - 4);
    ctx.shadowBlur = 0;

    // Bot HP bar
    ctx.fillStyle = '#000';
    ctx.fillRect(W - 24 - maxBarW, barY, maxBarW + 4, barH + 4);
    const bPct = Math.max(0, bot.hp / bot.maxHp);
    ctx.fillStyle = pHpGrad;
    ctx.fillRect(W - 22 - maxBarW * bPct, barY + 2, maxBarW * bPct, barH);
    ctx.strokeStyle = '#ffffff33';
    ctx.strokeRect(W - 24 - maxBarW, barY, maxBarW + 4, barH + 4);

    // Bot name
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ff4444';
    ctx.textAlign = 'right';
    ctx.fillText('SCORPION', W - 22, barY - 4);
    ctx.shadowBlur = 0;

    // Timer
    const timerText = Math.max(0, Math.ceil(roundTimer / 60)).toString();
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(timerText, W / 2, barY + 20);
    ctx.shadowBlur = 0;

    // Round markers
    ctx.font = '10px monospace';
    ctx.fillStyle = '#ffffff88';
    ctx.fillText('ROUND ' + round, W / 2, barY - 4);

    // Win markers
    for (let i = 0; i < playerWins; i++) {
      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.arc(30 + i * 15, barY + barH + 14, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < botWins; i++) {
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.arc(W - 30 - i * 15, barY + barH + 14, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function hitFighter(attacker, defender, damage) {
    if (defender.blocking) {
      damage = Math.floor(damage * 0.2);
      addParticles(defender.x, defender.y - 30, 4, '#8888ff');
      if (typeof SFX !== 'undefined') SFX.bounce();
    } else {
      defender.hp -= damage;
      defender.hitstun = 15;
      defender.flashTimer = 10;
      comboCount++;
      comboTimer = 90;
      addParticles(defender.x, defender.y - 30, 10, '#ff0000', { spread: 5, upForce: 5 });
      if (typeof Shake !== 'undefined') Shake.trigger(damage > 15 ? 8 : 4);
      if (typeof SFX !== 'undefined') SFX.hit();
      if (attacker.isPlayer) score += damage * comboCount;
      flawless = false;
    }

    if (defender.hp <= 0) {
      defender.hp = 0;
      defender.ko = true;
      defender.state = 'ko';
      koTimer = 1;
    }
  }

  function updateFighter(f, isBot) {
    f.frame++;
    if (f.flashTimer > 0) f.flashTimer--;
    if (f.specialCooldown > 0) f.specialCooldown--;

    if (f.hitstun > 0) {
      f.hitstun--;
      f.vx *= 0.85;
      f.x += f.vx;
      if (!f.grounded) { f.vy += 0.5; f.y += f.vy; }
      if (f.y >= 290) { f.y = 290; f.vy = 0; f.grounded = true; }
      return;
    }

    if (f.stateTimer > 0) {
      f.stateTimer--;
      if (f.stateTimer === 0) {
        f.attacking = false;
        f.state = 'idle';
      }
      return;
    }

    f.vx = 0;
    f.blocking = false;

    const other = f.isPlayer ? bot : player;
    const dx = other.x - f.x;
    const facingRight = dx > 0;

    if (!isBot) {
      // Player input
      f.blocking = (keys['arrowleft'] && f.dir < 0) || (keys['arrowright'] && f.dir > 0);

      if (!f.blocking && !f.attacking) {
        if (keys['arrowleft']) { f.vx = -3; f.state = 'walk'; f.dir = -1; }
        else if (keys['arrowright']) { f.vx = 3; f.state = 'walk'; f.dir = 1; }
        else { f.state = 'idle'; }

        if (keys['arrowup'] && f.grounded) { f.vy = -9; f.grounded = false; }
        if (keys['arrowdown']) f.state = 'crouch';

        // Attacks
        if (keys['z']) {
          f.state = 'punch'; f.stateTimer = 12; f.attacking = true;
          setTimeout(() => {
            if (Math.abs(f.x - other.x) < 55 && !other.ko) {
              hitFighter(f, other, 8);
            }
          }, 100);
          if (typeof SFX !== 'undefined') SFX.shoot();
        } else if (keys['x']) {
          f.state = 'kick'; f.stateTimer = 18; f.attacking = true;
          setTimeout(() => {
            if (Math.abs(f.x - other.x) < 65 && !other.ko) {
              hitFighter(f, other, 14);
            }
          }, 150);
          if (typeof SFX !== 'undefined') SFX.shoot();
        } else if (keys['c'] && f.specialCooldown <= 0) {
          f.state = 'special'; f.stateTimer = 20; f.attacking = true;
          f.specialCooldown = 40;
          projectiles.push({
            x: f.x + f.dir * 30, y: f.y - 35,
            vx: f.dir * 5, damage: 18, isPlayer: true,
            life: 60, color: '#00ccff'
          });
          if (typeof SFX !== 'undefined') SFX.shoot();
        }
      }
    } else {
      // Bot AI
      const dist = Math.abs(dx);
      const shouldBlock = dist < 70 && other.attacking;
      const shouldAttack = dist < 60 && Math.random() < 0.06;
      const shouldSpecial = dist > 100 && dist < 300 && Math.random() < 0.02 && f.specialCooldown <= 0;

      if (shouldBlock) {
        f.blocking = true;
        f.state = 'idle';
      } else if (shouldSpecial) {
        f.state = 'special'; f.stateTimer = 20; f.attacking = true;
        f.specialCooldown = 90;
        f.dir = facingRight ? 1 : -1;
        projectiles.push({
          x: f.x + f.dir * 30, y: f.y - 35,
          vx: f.dir * 5, damage: 18, isPlayer: false,
          life: 60, color: '#ff4400'
        });
        if (typeof SFX !== 'undefined') SFX.shoot();
      } else if (shouldAttack) {
        f.dir = facingRight ? 1 : -1;
        if (Math.random() < 0.5) {
          f.state = 'punch'; f.stateTimer = 12; f.attacking = true;
          setTimeout(() => {
            if (Math.abs(f.x - player.x) < 55 && !player.ko) {
              hitFighter(f, player, 8);
            }
          }, 100);
        } else {
          f.state = 'kick'; f.stateTimer = 18; f.attacking = true;
          setTimeout(() => {
            if (Math.abs(f.x - player.x) < 65 && !player.ko) {
              hitFighter(f, player, 14);
            }
          }, 150);
        }
        if (typeof SFX !== 'undefined') SFX.shoot();
      } else {
        // Move toward or away
        f.dir = facingRight ? 1 : -1;
        if (dist > 80) {
          f.vx = 2;
          f.state = 'walk';
        } else if (dist < 40) {
          f.vx = -f.dir * 1.5;
          f.state = 'walk';
        } else {
          f.state = 'idle';
          // Sometimes jump
          if (Math.random() < 0.01 && f.grounded) {
            f.vy = -9; f.grounded = false;
          }
        }
      }
    }

    f.x += f.vx;
    if (!f.grounded) { f.vy += 0.5; f.y += f.vy; }
    if (f.y >= 290) { f.y = 290; f.vy = 0; f.grounded = true; }

    // Keep in bounds
    f.x = Math.max(40, Math.min(W - 40, f.x));

    // Push apart if overlapping
    const overlap = 50 - Math.abs(f.x - other.x);
    if (overlap > 0 && Math.abs(f.y - other.y) < 30) {
      const push = overlap / 2;
      if (f.x < other.x) { f.x -= push; other.x += push; }
      else { f.x += push; other.x -= push; }
    }
  }

  function update() {
    if (gameOver) return;

    // KO handling
    if (koTimer > 0) {
      koTimer++;
      if (koTimer > 120) {
        if (player.ko) {
          botWins++;
        } else if (bot.ko) {
          playerWins++;
        }

        if (playerWins >= 2 || botWins >= 2) {
          gameOver = true;
          victoryScreen = 1;
        } else {
          round++;
          resetRound();
        }
      }
      return;
    }

    roundTimer--;
    if (roundTimer <= 0) {
      // Time up - whoever has more HP wins
      if (player.hp > bot.hp) { bot.hp = 0; bot.ko = true; }
      else if (bot.hp > player.hp) { player.hp = 0; player.ko = true; }
      else {
        // Draw - both lose
        player.hp = 0; bot.hp = 0;
        player.ko = true; bot.ko = true;
      }
      koTimer = 1;
    }

    updateFighter(player, false);
    updateFighter(bot, true);

    // Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.x += p.vx; p.life--;
      if (p.life <= 0 || p.x < -20 || p.x > W + 20) {
        projectiles.splice(i, 1);
        continue;
      }
      const target = p.isPlayer ? bot : player;
      if (Math.abs(p.x - target.x) < 25 && Math.abs(p.y - (target.y - 30)) < 30) {
        hitFighter(p.isPlayer ? player : bot, target, p.damage);
        addParticles(p.x, p.y, 15, p.color, { spread: 6, upForce: 4 });
        projectiles.splice(i, 1);
      }
    }

    // Flames
    for (let i = flames.length - 1; i >= 0; i--) {
      const f = flames[i];
      f.x += f.vx; f.y += f.vy; f.life--;
      if (f.life <= 0) flames.splice(i, 1);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Combo timer
    if (comboTimer > 0) {
      comboTimer--;
      if (comboTimer <= 0) comboCount = 0;
    }
  }

  function drawProjectiles() {
    projectiles.forEach(p => {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 15;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      // Trail
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - p.vx, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    });
  }

  function drawFlames() {
    flames.forEach(f => {
      const alpha = f.life / f.maxLife;
      const r = f.size * alpha;
      const color = alpha > 0.5 ? '#ffcc00' : '#ff6600';
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawHUD() {
    drawHealthBars();

    // Combo display
    if (comboCount > 1 && comboTimer > 0) {
      const scale = 1 + Math.sin(Date.now() * 0.015) * 0.15;
      ctx.save();
      ctx.translate(W / 2, H / 2 - 80);
      ctx.scale(scale, scale);
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(comboCount + ' HITS!', 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // KO
    if (koTimer > 0 && koTimer < 60) {
      const scale = koTimer / 60;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(0.5 + scale * 1.5, 0.5 + scale * 1.5);
      ctx.globalAlpha = Math.min(1, scale * 2);
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 60px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('K.O.!', 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Victory
    if (victoryScreen > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, W, H);

      const isFlawless = flawless && playerWins > botWins;
      const text = playerWins > botWins
        ? (isFlawless ? 'FLAWLESS VICTORY' : 'YOU WIN')
        : 'YOU LOSE';

      const color = playerWins > botWins ? '#00ff88' : '#ff0044';

      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      ctx.fillStyle = color;
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, W / 2, H / 2 - 30);
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.fillText('Score: ' + score, W / 2, H / 2 + 10);
      ctx.fillText('Rounds: ' + playerWins + ' - ' + botWins, W / 2, H / 2 + 35);

      if (victoryScreen > 0) victoryScreen++;
      if (victoryScreen > 120) {
        clearInterval(loop);
        setTimeout(() => sendScore(score), 500);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawFlames();

    // Draw fighters (back one first)
    if (player.x < bot.x) {
      drawFighter(player);
      drawFighter(bot);
    } else {
      drawFighter(bot);
      drawFighter(player);
    }

    drawProjectiles();

    // Particles
    particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    drawHUD();

    // Fatality flash
    if (koTimer > 0 && koTimer < 10) {
      ctx.fillStyle = `rgba(255,0,0,${0.3 - koTimer * 0.03})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  const loop = setInterval(() => {
    update();
    draw();
  }, 1000 / 60);

  return () => {
    clearInterval(loop);
    document.onkeydown = null;
    document.onkeyup = null;
  };
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
    const gameNames = { 'pac-man': '🟡 Pac-Man', 'street-fighter': '🥊 Street Fighter', 'asteroids': '☄️ Asteroids', 'mario-bros': '🍄 Mario Bros', 'metal-slug': '🔫 Metal Slug', 'tetris': '📦 Tetris', 'arkanoid': '🧱 Arkanoid', 'donkey-kong': '🦍 Donkey Kong', 'space-invaders': '👾 Space Invaders', 'snake': '🐍 Snake', 'double-dragon': '🤜 Double Dragon', 'contra': '💥 Contra', 'mortal-kombat': '💀 Mortal Kombat', 'flappy-bird': '🐦 Flappy Bird' };
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
    const gameList = ['pac-man','street-fighter','asteroids','mario-bros','metal-slug','tetris','arkanoid','donkey-kong','space-invaders','snake','double-dragon','contra','mortal-kombat','flappy-bird'];
    const gameIcons = {'pac-man':'🟡','street-fighter':'🥊','asteroids':'☄️','mario-bros':'🍄','metal-slug':'🔫','tetris':'📦','arkanoid':'🧱','donkey-kong':'🦍','space-invaders':'👾','snake':'🐍','double-dragon':'🤜','contra':'💥','mortal-kombat':'💀','flappy-bird':'🐦'};
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