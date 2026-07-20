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

function gameFrogger(area, sendScore) {
  const W = 400, H = 400, CS = 25;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = new Particles();
  const shake = new Shake();
  let score = 0, lives = 3, gameOver = false, won = false;
  let frame = 0;
  const ROWS = H / CS;

  let frogX = 10, frogY = ROWS - 1, frogDir = 0, frogHopping = false;
  let hopProgress = 0, hopFromX, hopFromY;
  let hopSquash = 0;

  const lanes = [];
  for (let i = 0; i < ROWS; i++) {
    if (i <= 4) {
      const isWater = i < 4;
      if (isWater) {
        const speed = 0.3 + Math.random() * 0.5;
        const dir = i % 2 === 0 ? 1 : -1;
        const logLen = 2 + Math.floor(Math.random() * 3);
        const lane = [];
        for (let x = dir > 0 ? -logLen * CS : W; dir > 0 ? x < W : x > -logLen * CS; x += (logLen + 2 + Math.random() * 3) * CS) {
          lane.push({ x, len: logLen, speed: speed * dir, y: i });
        }
        lanes.push({ type: 'log', items: lane, isWater: true });
      } else {
        lanes.push({ type: 'empty', items: [], isWater: false });
      }
    } else if (i >= 5 && i < ROWS - 1) {
      const speed = 0.4 + Math.random() * 0.6;
      const dir = i % 2 === 0 ? 1 : -1;
      const lane = [];
      const count = 3 + Math.floor(Math.random() * 2);
      for (let j = 0; j < count; j++) {
        const carW = 1 + Math.floor(Math.random() * 2);
        lane.push({ x: (W / count) * j + (dir > 0 ? 0 : W), w: carW, speed: speed * dir, y: i,
          colors: ['#ff2244', '#2244ff', '#ffaa00', '#44ff44', '#ff44ff'][Math.floor(Math.random() * 5)]
        });
      }
      lanes.push({ type: 'car', items: lane, isWater: false });
    } else {
      lanes.push({ type: 'empty', items: [], isWater: false });
    }
  }

  function update() {
    if (gameOver || won) return;
    frame++;
    hopSquash *= 0.85;

    if (frogHopping) {
      hopProgress += 0.12;
      if (hopProgress >= 1) {
        frogHopping = false;
        hopProgress = 1;
        frogX = Math.round(frogX);
        frogY = Math.round(frogY);
        hopSquash = 0.3;

        if (frogY <= 0 || frogY >= ROWS) {
        } else {
          const lane = lanes[frogY];
          if (lane && lane.isWater) {
            let onLog = false;
            for (const log of lane.items) {
              const lx = Math.floor(frogX / CS);
              const logStart = Math.floor(log.x / CS);
              if (lx >= logStart && lx < logStart + log.len) { onLog = true; break; }
            }
            if (!onLog) {
              SFX.die();
              shake.trigger(8);
              particles.add(frogX * CS + CS / 2, frogY * CS + CS / 2, 20, { color: '#00aaff', speed: 3 });
              lives--;
              frogX = 10; frogY = ROWS - 1;
              if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
              return;
            }
          }
        }
      }
      const t = easeInOutQuad(hopProgress);
      frogX = hopFromX;
      frogY = hopFromY + (frogY - hopFromY) * t;
    }

    for (const lane of lanes) {
      for (const item of lane.items) {
        item.x += item.speed;
        if (lane.type === 'car') {
          if (item.speed > 0 && item.x > W + CS) item.x = -item.w * CS;
          if (item.speed < 0 && item.x < -item.w * CS) item.x = W + CS;
        } else {
          if (item.speed > 0 && item.x > W + item.len * CS * 2) item.x = -item.len * CS;
          if (item.speed < 0 && item.x < -item.len * CS * 2) item.x = W + item.len * CS;
        }
      }
    }

    if (!frogHopping) {
      const lane = lanes[frogY];
      if (lane && lane.type === 'car') {
        for (const car of lane.items) {
          if (frogX * CS >= car.x && frogX * CS < car.x + car.w * CS) {
            SFX.die();
            shake.trigger(10);
            particles.add(frogX * CS + CS / 2, frogY * CS + CS / 2, 25, { color: '#ff4400', speed: 4 });
            lives--;
            frogX = 10; frogY = ROWS - 1;
            if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
            return;
          }
        }
      }
    }

    if (frogY <= 1) {
      score += 50;
      SFX.win();
      particles.add(frogX * CS + CS / 2, frogY * CS + CS / 2, 30, { color: '#00ff00', speed: 4 });
      frogX = 10; frogY = ROWS - 1;
      if (score >= 250) { won = true; setTimeout(() => sendScore(score), 1500); }
    }

    particles.update();
    shake.apply(ctx, W, H);
  }

  function draw() {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#1a3a1a');
    bgGrad.addColorStop(0.3, '#0a1a2a');
    bgGrad.addColorStop(1, '#1a2a0a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < ROWS; i++) {
      const y = i * CS;
      const lane = lanes[i];
      if (lane && lane.isWater) {
        const wGrad = ctx.createLinearGradient(0, y, 0, y + CS);
        wGrad.addColorStop(0, '#002244');
        wGrad.addColorStop(0.5, '#003366');
        wGrad.addColorStop(1, '#002244');
        ctx.fillStyle = wGrad;
        ctx.fillRect(0, y, W, CS);
        for (let wx = 0; wx < W; wx += 40) {
          const waveOff = Math.sin(frame * 0.03 + wx * 0.1) * 2;
          ctx.strokeStyle = 'rgba(100,200,255,0.15)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(wx, y + CS / 2 + waveOff);
          ctx.quadraticCurveTo(wx + 15, y + CS / 2 + waveOff + 3, wx + 30, y + CS / 2 + waveOff);
          ctx.stroke();
        }
      } else if (lane && lane.type === 'car') {
        const rGrad = ctx.createLinearGradient(0, y, 0, y + CS);
        rGrad.addColorStop(0, '#2a2a2a');
        rGrad.addColorStop(0.5, '#3a3a3a');
        rGrad.addColorStop(1, '#2a2a2a');
        ctx.fillStyle = rGrad;
        ctx.fillRect(0, y, W, CS);
        if (i % 2 === 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([10, 15]);
          ctx.beginPath();
          ctx.moveTo(0, y + CS / 2);
          ctx.lineTo(W, y + CS / 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        const gGrad = ctx.createLinearGradient(0, y, 0, y + CS);
        gGrad.addColorStop(0, '#1a4a1a');
        gGrad.addColorStop(0.5, '#2a5a2a');
        gGrad.addColorStop(1, '#1a4a1a');
        ctx.fillStyle = gGrad;
        ctx.fillRect(0, y, W, CS);
      }
    }

    for (const lane of lanes) {
      if (lane.type === 'log') {
        for (const log of lane.items) {
          const lGrad = ctx.createLinearGradient(0, log.y * CS, 0, log.y * CS + CS);
          lGrad.addColorStop(0, '#6a4a2a');
          lGrad.addColorStop(0.5, '#8a6a3a');
          lGrad.addColorStop(1, '#6a4a2a');
          ctx.fillStyle = lGrad;
          ctx.shadowColor = '#8a6a3a';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.roundRect(log.x + 2, log.y * CS + 3, log.len * CS - 4, CS - 6, 4);
          ctx.fill();
          ctx.shadowBlur = 0;
          for (let gx = 0; gx < log.len; gx++) {
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(log.x + gx * CS + CS / 2, log.y * CS + 5);
            ctx.lineTo(log.x + gx * CS + CS / 2, log.y * CS + CS - 5);
            ctx.stroke();
          }
        }
      } else if (lane.type === 'car') {
        for (const car of lane.items) {
          const cGrad = ctx.createLinearGradient(0, car.y * CS, 0, car.y * CS + CS);
          cGrad.addColorStop(0, lerpColor(car.colors, '#ffffff', 0.3));
          cGrad.addColorStop(0.5, car.colors);
          cGrad.addColorStop(1, lerpColor(car.colors, '#000000', 0.3));
          ctx.fillStyle = cGrad;
          ctx.shadowColor = car.colors;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.roundRect(car.x + 2, car.y * CS + 4, car.w * CS - 4, CS - 8, 5);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffaa00';
          ctx.shadowColor = '#ffaa00';
          ctx.shadowBlur = 4;
          if (car.speed > 0) {
            ctx.beginPath();
            ctx.arc(car.x + car.w * CS - 4, car.y * CS + 8, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(car.x + car.w * CS - 4, car.y * CS + CS - 12, 3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = '#ff2200';
            ctx.shadowColor = '#ff2200';
            ctx.beginPath();
            ctx.arc(car.x + 4, car.y * CS + 8, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(car.x + 4, car.y * CS + CS - 12, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
      }
    }

    const fpx = frogX * CS + CS / 2, fpy = frogY * CS + CS / 2;
    ctx.save();
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 10;
    const fGrad = ctx.createRadialGradient(fpx, fpy, 0, fpx, fpy, CS / 2);
    fGrad.addColorStop(0, '#44ff44');
    fGrad.addColorStop(1, '#008800');
    ctx.fillStyle = fGrad;
    ctx.beginPath();
    ctx.ellipse(fpx, fpy + hopSquash * 4, CS / 2 - 2, CS / 2 - 2 - hopSquash * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(fpx - 4, fpy - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fpx + 4, fpy - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(fpx - 4, fpy - 4, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fpx + 4, fpy - 4, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    particles.draw(ctx);
    drawText(ctx, `SCORE: ${score}`, 10, 5, 14, '#00ff00');
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
      drawText(ctx, 'SAFE!', W / 2, H / 2 - 20, 28, '#00ff00', 'center');
      drawText(ctx, `Score: ${score}`, W / 2, H / 2 + 15, 18, '#ffd700', 'center');
    }
  }

  function onKey(e) {
    if (gameOver || won || frogHopping) return;
    let nx = frogX, ny = frogY;
    switch (e.key) {
      case 'ArrowRight': case 'd': nx++; break;
      case 'ArrowLeft': case 'a': nx--; break;
      case 'ArrowUp': case 'w': ny--; break;
      case 'ArrowDown': case 's': ny++; break;
      default: return;
    }
    if (nx < 0 || nx >= W / CS || ny < 0 || ny >= ROWS) return;
    hopFromX = frogX; hopFromY = frogY;
    frogX = nx; frogY = ny;
    frogHopping = true;
    hopProgress = 0;
    frogDir = ny < hopFromY ? 0 : ny > hopFromY ? 2 : nx < hopFromX ? 3 : 1;
    SFX.jump();
    score += 5;
  }

  document.addEventListener('keydown', onKey);
  let loopId = setInterval(() => { update(); draw(); }, 1000 / 60);
  return () => { clearInterval(loopId); document.removeEventListener('keydown', onKey); };
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

function gameGalaga(area, sendScore) {
  const W = 400, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = new Particles();
  const shake = new Shake();
  let score = 0, lives = 3, gameOver = false, wave = 1;
  let frame = 0;

  let starLayers = [];
  for (let l = 0; l < 3; l++) {
    const stars = [];
    for (let i = 0; i < 50; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, speed: 0.1 + l * 0.2 });
    starLayers.push(stars);
  }

  const ship = { x: W / 2, y: H - 30 };
  const bullets = [];
  const enemies = [];
  let diveBombing = [];
  const enemyBullets = [];
  let shootCooldown = 0;
  let waveTimer = 0;
  let waveCleared = false;

  function spawnWave() {
    enemies.length = 0;
    diveBombing.length = 0;
    const rowColors = ['#ff4444', '#ff8844', '#ffff44', '#44ff44', '#44ffff'];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 8; c++) {
        enemies.push({
          x: 60 + c * 35, y: 40 + r * 28,
          startX: 60 + c * 35, startY: 40 + r * 28,
          color: rowColors[r],
          divePath: null, diveT: 0, alive: true,
          pulsePhase: Math.random() * Math.PI * 2
        });
      }
    }
    waveCleared = false;
    waveTimer = 0;
  }
  spawnWave();

  let keys = {};

  function update() {
    if (gameOver) return;
    frame++;
    if (shootCooldown > 0) shootCooldown--;

    for (const sl of starLayers) for (const s of sl) {
      s.y += s.speed;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }

    if (keys['ArrowLeft'] || keys['a']) ship.x = Math.max(10, ship.x - 3);
    if (keys['ArrowRight'] || keys['d']) ship.x = Math.min(W - 10, ship.x + 3);
    if (keys[' '] && shootCooldown <= 0) {
      SFX.shoot();
      bullets.push({ x: ship.x, y: ship.y - 10, vy: -6 });
      shootCooldown = 12;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      bullets[i].y += bullets[i].vy;
      if (bullets[i].y < -10) bullets.splice(i, 1);
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      e.pulsePhase += 0.05;
      const hover = Math.sin(frame * 0.02 + e.pulsePhase) * 5;
      e.y = e.startY + hover;
      e.x = e.startX + Math.sin(frame * 0.01 + e.pulsePhase * 2) * 8;

      if (!e.divePath && Math.random() < 0.003) {
        const dx = ship.x - e.x, dy = ship.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        e.divePath = { sx: e.x, sy: e.y, tx: ship.x, ty: ship.y, cp1x: e.x + (Math.random() - 0.5) * 100, cp1y: (e.y + ship.y) / 2 };
        e.diveT = 0;
      }

      if (e.divePath) {
        e.diveT += 0.015;
        const t = e.diveT;
        const p = e.divePath;
        e.x = (1 - t) * (1 - t) * p.sx + 2 * (1 - t) * t * p.cp1x + t * t * p.tx;
        e.y = (1 - t) * (1 - t) * p.sy + 2 * (1 - t) * t * p.cp1y + t * t * p.ty;

        if (Math.random() < 0.02) {
          const dx = ship.x - e.x, dy = ship.y - e.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          enemyBullets.push({ x: e.x, y: e.y, vx: (dx / d) * 3, vy: (dy / d) * 3, life: 80 });
        }

        if (e.diveT >= 1) {
          e.divePath = null;
          e.diveT = 0;
          e.x = e.startX; e.y = e.startY;
        }
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = b.x - e.x, dy = b.y - e.y;
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          SFX.explode(); shake.trigger(4);
          particles.add(e.x, e.y, 15, { color: e.color, speed: 3 });
          e.alive = false;
          score += 10 + Math.floor(wave * 5);
          bullets.splice(i, 1);
          break;
        }
      }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0) { enemyBullets.splice(i, 1); continue; }
      const dx = b.x - ship.x, dy = b.y - ship.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10) {
        SFX.die(); shake.trigger(8);
        particles.add(ship.x, ship.y, 25, { color: '#00ffff', speed: 4 });
        lives--;
        ship.x = W / 2;
        enemyBullets.splice(i, 1);
        if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
      }
    }

    const aliveCount = enemies.filter(e => e.alive).length;
    if (aliveCount === 0 && !waveCleared) {
      waveCleared = true;
      waveTimer = 90;
      SFX.win();
      score += 100 * wave;
    }
    if (waveCleared) {
      waveTimer--;
      if (waveTimer <= 0) { wave++; spawnWave(); }
    }

    particles.update();
    shake.apply(ctx, W, H);
  }

  function draw() {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#000010');
    bgGrad.addColorStop(1, '#0a0a20');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    for (let l = 0; l < 3; l++) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + l * 0.12})`;
      for (const s of starLayers[l]) ctx.fillRect(s.x, s.y, 1, 1 + l * 0.5);
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      const pulse = 0.9 + Math.sin(e.pulsePhase) * 0.1;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 8;
      const eGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
      eGrad.addColorStop(0, lerpColor(e.color, '#ffffff', 0.3));
      eGrad.addColorStop(1, e.color);
      ctx.fillStyle = eGrad;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(-10, 4);
      ctx.lineTo(-5, 8);
      ctx.lineTo(5, 8);
      ctx.lineTo(10, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-3, -1, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(3, -1, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur = 12;
    const pGrad = ctx.createLinearGradient(ship.x, ship.y - 12, ship.x, ship.y + 12);
    pGrad.addColorStop(0, '#00ffff');
    pGrad.addColorStop(0.5, '#0066ff');
    pGrad.addColorStop(1, '#0022aa');
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.moveTo(ship.x, ship.y - 12);
    ctx.lineTo(ship.x - 10, ship.y + 10);
    ctx.lineTo(ship.x - 3, ship.y + 6);
    ctx.lineTo(ship.x, ship.y + 10);
    ctx.lineTo(ship.x + 3, ship.y + 6);
    ctx.lineTo(ship.x + 10, ship.y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const fGrad = ctx.createRadialGradient(ship.x, ship.y + 14, 0, ship.x, ship.y + 14, 6);
    fGrad.addColorStop(0, '#ffff00');
    fGrad.addColorStop(1, '#ff440000');
    ctx.fillStyle = fGrad;
    ctx.beginPath();
    ctx.arc(ship.x, ship.y + 14, 4 + Math.sin(frame * 0.3) * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#88ffaa';
    for (const b of bullets) {
      ctx.fillRect(b.x - 1, b.y, 2, 8);
    }
    ctx.shadowBlur = 0;

    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ff6644';
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    particles.draw(ctx);

    if (waveCleared) {
      const t = 1 - waveTimer / 90;
      ctx.globalAlpha = Math.min(1, t * 3);
      drawText(ctx, `WAVE ${wave} CLEAR!`, W / 2, H / 2 - 10, 24, '#ffff00', 'center');
      drawText(ctx, `+${100 * wave} BONUS`, W / 2, H / 2 + 15, 16, '#00ff88', 'center');
      ctx.globalAlpha = 1;
    }

    drawText(ctx, `SCORE: ${score}`, 10, 5, 14, '#00ffff');
    drawText(ctx, `LIVES: ${lives}`, W - 10, 5, 14, '#ff4444', 'right');
    drawText(ctx, `WAVE: ${wave}`, W / 2, 5, 12, '#ffff88', 'center');

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

function gameCentipede(area, sendScore) {
  const W = 400, H = 400, CS = 20;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  area.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = new Particles();
  const shake = new Shake();
  let score = 0, lives = 3, gameOver = false;
  let frame = 0;
  const COLS = W / CS, ROWS = H / CS;

  const mushrooms = [];
  for (let i = 0; i < 30; i++) {
    mushrooms.push({ x: Math.floor(Math.random() * COLS), y: 2 + Math.floor(Math.random() * (ROWS - 4)), hp: 3, pulsePhase: Math.random() * Math.PI * 2 });
  }

  const player = { x: COLS / 2, y: ROWS - 2, aimAngle: -Math.PI / 2 };
  const bullets = [];
  let shootCooldown = 0;

  const centipede = [];
  const segCount = 12;
  for (let i = 0; i < segCount; i++) {
    centipede.push({ x: i, y: 0, dir: { x: 1, y: 1 }, alive: true, rainbow: i / segCount });
  }
  let centipedeMoveTimer = 0;

  let spider = null;
  let spiderTimer = 300 + Math.floor(Math.random() * 200);
  let flea = null;
  let fleaTimer = 400 + Math.floor(Math.random() * 300);
  let fleaY = 0;

  const keys = {};

  function update() {
    if (gameOver) return;
    frame++;
    if (shootCooldown > 0) shootCooldown--;
    centipedeMoveTimer++;

    if (keys['ArrowLeft'] || keys['a']) player.x = Math.max(0.5, player.x - 0.15);
    if (keys['ArrowRight'] || keys['d']) player.x = Math.min(COLS - 0.5, player.x + 0.15);
    if (keys['ArrowUp'] || keys['w']) player.y = Math.max(ROWS - 5, player.y - 0.15);
    if (keys['ArrowDown'] || keys['s']) player.y = Math.min(ROWS - 0.5, player.y + 0.15);

    if (keys[' '] && shootCooldown <= 0) {
      SFX.shoot();
      const dx = Math.cos(player.aimAngle), dy = Math.sin(player.aimAngle);
      bullets.push({ x: player.x * CS, y: player.y * CS, vx: dx * 5, vy: dy * 5, life: 60 });
      shootCooldown = 10;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) { bullets.splice(i, 1); continue; }

      let hit = false;
      for (const m of mushrooms) {
        if (Math.abs(b.x - (m.x * CS + CS / 2)) < CS / 2 && Math.abs(b.y - (m.y * CS + CS / 2)) < CS / 2) {
          m.hp--;
          SFX.dig();
          particles.add(b.x, b.y, 5, { color: '#aa8844', speed: 2 });
          if (m.hp <= 0) {
            const mi = mushrooms.indexOf(m);
            if (mi > -1) mushrooms.splice(mi, 1);
            score += 1;
          }
          bullets.splice(i, 1);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      for (const seg of centipede) {
        if (!seg.alive) continue;
        const sx = seg.x * CS + CS / 2, sy = seg.y * CS + CS / 2;
        if (Math.abs(b.x - sx) < CS / 2 && Math.abs(b.y - sy) < CS / 2) {
          SFX.explode();
          particles.add(sx, sy, 12, { color: lerpColor('#ff0000', '#ffff00', seg.rainbow), speed: 3 });
          seg.alive = false;
          score += 10;
          if (mushrooms.length < 40) {
            mushrooms.push({ x: Math.round(seg.x), y: Math.round(seg.y), hp: 3, pulsePhase: Math.random() * Math.PI * 2 });
          }
          bullets.splice(i, 1);
          break;
        }
      }
    }

    if (centipedeMoveTimer >= 8) {
      centipedeMoveTimer = 0;
      for (let i = 0; i < centipede.length; i++) {
        const seg = centipede[i];
        if (!seg.alive) continue;

        let moved = false;
        for (const m of mushrooms) {
          if (Math.round(seg.x) === m.x && Math.round(seg.y + seg.dir.y) === m.y) {
            seg.dir.x = seg.dir.y > 0 ? (Math.random() > 0.5 ? 1 : -1) : (Math.random() > 0.5 ? 1 : -1);
            seg.dir.y *= -1;
            moved = true;
            break;
          }
        }

        seg.x += seg.dir.x * 0.8;
        seg.y += seg.dir.y * 0.3;

        if (seg.x >= COLS - 0.5) { seg.dir.x = -1; seg.y += 0.5; }
        if (seg.x <= 0.5) { seg.dir.x = 1; seg.y += 0.5; }
        if (seg.y >= ROWS - 0.5) { seg.y = ROWS - 0.5; seg.dir.y = -1; }
        if (seg.y <= 0) { seg.y = 0; seg.dir.y = 1; }
      }
    }

    for (const seg of centipede) {
      if (!seg.alive) continue;
      const dx = seg.x - player.x, dy = seg.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.8) {
        SFX.die(); shake.trigger(10);
        particles.add(player.x * CS, player.y * CS, 25, { color: '#00ff00', speed: 4 });
        lives--;
        player.x = COLS / 2; player.y = ROWS - 2;
        if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
        return;
      }
    }

    if (mushrooms.length > 0) {
      const m = mushrooms[Math.floor(Math.random() * mushrooms.length)];
      m.pulsePhase += 0.05;
    }

    spiderTimer--;
    if (spiderTimer <= 0 && !spider) {
      spider = { x: Math.random() * W, y: H, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random(), life: 120, phase: Math.random() * Math.PI * 2 };
      spiderTimer = 500 + Math.floor(Math.random() * 400);
    }
    if (spider) {
      spider.x += spider.vx + Math.sin(spider.phase + frame * 0.1) * 1.5;
      spider.y += spider.vy;
      spider.life--;
      if (spider.y < H * 0.3) spider.vy = 1;
      if (spider.life <= 0 || spider.y > H + 20) spider = null;
      else {
        const dx = spider.x - player.x * CS, dy = spider.y - player.y * CS;
        if (Math.sqrt(dx * dx + dy * dy) < 15) {
          SFX.die(); shake.trigger(10);
          particles.add(player.x * CS, player.y * CS, 25, { color: '#ff00ff', speed: 4 });
          lives--;
          spider = null;
          player.x = COLS / 2; player.y = ROWS - 2;
          if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
          return;
        }
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          const ddx = b.x - spider.x, ddy = b.y - spider.y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) < 12) {
            SFX.explode(); shake.trigger(5);
            particles.add(spider.x, spider.y, 15, { color: '#ff00ff', speed: 3 });
            score += 300;
            spider = null;
            bullets.splice(j, 1);
            break;
          }
        }
      }
    }

    fleaTimer--;
    if (fleaTimer <= 0 && !flea) {
      flea = { x: Math.random() * COLS, y: 0, vy: 2 };
      fleaTimer = 600 + Math.floor(Math.random() * 400);
    }
    if (flea) {
      flea.y += flea.vy * 0.05;
      if (Math.random() < 0.1 && mushrooms.length < 50) {
        mushrooms.push({ x: Math.round(flea.x), y: Math.round(flea.y), hp: 1, pulsePhase: Math.random() * Math.PI * 2 });
      }
      if (flea.y >= ROWS) flea = null;
      else {
        const dx = flea.x - player.x, dy = flea.y - player.y;
        if (Math.sqrt(dx * dx + dy * dy) < 0.8) {
          SFX.die(); shake.trigger(10);
          particles.add(player.x * CS, player.y * CS, 20, { color: '#ffff00', speed: 4 });
          lives--;
          flea = null;
          player.x = COLS / 2; player.y = ROWS - 2;
          if (lives <= 0) { gameOver = true; setTimeout(() => sendScore(score), 1000); }
          return;
        }
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(b.x - flea.x * CS) < CS && Math.abs(b.y - flea.y * CS) < CS) {
            SFX.explode();
            particles.add(flea.x * CS, flea.y * CS, 10, { color: '#ffff00', speed: 3 });
            score += 100;
            flea = null;
            bullets.splice(j, 1);
            break;
          }
        }
      }
    }

    const allDead = centipede.every(s => !s.alive);
    if (allDead) {
      centipede.length = 0;
      for (let i = 0; i < segCount; i++) {
        centipede.push({ x: i, y: 0, dir: { x: 1, y: 1 }, alive: true, rainbow: i / segCount });
      }
      score += 500;
      SFX.powerup();
    }

    particles.update();
    shake.apply(ctx, W, H);
  }

  function draw() {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a1a0a');
    bgGrad.addColorStop(1, '#0a2a0a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.strokeStyle = 'rgba(0,100,0,0.1)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(c * CS, r * CS, CS, CS);
      }
    }

    for (const m of mushrooms) {
      const mx = m.x * CS + CS / 2, my = m.y * CS + CS / 2;
      const hpRatio = m.hp / 3;
      const mGrad = ctx.createRadialGradient(mx, my, 0, mx, my, CS / 2);
      mGrad.addColorStop(0, lerpColor('#ffaa00', '#884400', 1 - hpRatio));
      mGrad.addColorStop(1, lerpColor('#884400', '#442200', 1 - hpRatio));
      ctx.fillStyle = mGrad;
      ctx.shadowColor = '#ff8800';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.arc(mx, my, CS / 2 - 2, Math.PI, 0);
      ctx.lineTo(mx + CS / 2 - 2, my + 3);
      ctx.lineTo(mx - CS / 2 + 2, my + 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6a4a2a';
      ctx.fillRect(mx - 2, my, 4, 5);
      ctx.fillStyle = `rgba(255,200,100,${0.3 + Math.sin(m.pulsePhase) * 0.1})`;
      ctx.beginPath();
      ctx.arc(mx - 2, my - 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx + 3, my - 1, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (let i = centipede.length - 1; i >= 0; i--) {
      const seg = centipede[i];
      if (!seg.alive) continue;
      const sx = seg.x * CS + CS / 2, sy = seg.y * CS + CS / 2;
      const hue = (seg.rainbow * 360 + frame * 2) % 360;
      const segColor = `hsl(${hue}, 100%, 60%)`;
      ctx.shadowColor = segColor;
      ctx.shadowBlur = 8;
      const sGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, CS / 2);
      sGrad.addColorStop(0, `hsl(${hue}, 100%, 80%)`);
      sGrad.addColorStop(1, segColor);
      ctx.fillStyle = sGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, CS / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      if (i === 0) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx - 3, sy - 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx + 3, sy - 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(sx - 3, sy - 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx + 3, sy - 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    const ppx = player.x * CS + CS / 2, ppy = player.y * CS + CS / 2;
    ctx.save();
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 10;
    const pGrad = ctx.createRadialGradient(ppx, ppy, 0, ppx, ppy, CS / 2);
    pGrad.addColorStop(0, '#66ff66');
    pGrad.addColorStop(1, '#008800');
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(ppx, ppy, CS / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#aaffaa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ppx, ppy);
    const aimX = ppx + Math.cos(player.aimAngle) * 20;
    const aimY = ppy + Math.sin(player.aimAngle) * 20;
    ctx.lineTo(aimX, aimY);
    ctx.stroke();
    ctx.restore();

    ctx.shadowColor = '#88ff88';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#aaffaa';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (spider) {
      ctx.save();
      ctx.translate(spider.x, spider.y);
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#cc44cc';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let leg = 0; leg < 4; leg++) {
        const la = Math.sin(frame * 0.2 + leg) * 0.3;
        ctx.strokeStyle = '#ff88ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-3, 0);
        ctx.lineTo(-8 - leg, -5 + leg * 3 + la * 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(3, 0);
        ctx.lineTo(8 + leg, -5 + leg * 3 - la * 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (flea) {
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#ffff44';
      ctx.beginPath();
      ctx.arc(flea.x * CS, flea.y * CS, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    particles.draw(ctx);
    drawText(ctx, `SCORE: ${score}`, 10, 5, 14, '#00ff00');
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

// ==================== MODERN GAME IMPLEMENTATIONS v2 ====================
// High-quality mobile graphics using Canvas 2D API
// Depends on globals: SFX, Particles, Shake, drawText, drawGlow, easeOutQuad, easeInOutQuad


// ==================== 6. DEFENDER (gameDefender) ====================
function gameDefender(area, sendScore) {
  const W = 600, H = 300;
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
  area.appendChild(cvs);
  const ctx = cvs.getContext('2d');

  let ship = { x: 80, y: H / 2, vy: 0, facing: 1, trail: [] };
  let bullets = [], enemies = [], particles = new Particles(), shake = new Shake();
  let score = 0, lives = 3, over = false, frame = 0, wave = 0;
  let bgParticles = [];
  for (let i = 0; i < 40; i++) bgParticles.push({ x: Math.random() * W, y: Math.random() * H, vx: -0.2 - Math.random() * 0.5, size: 1 + Math.random() * 2, alpha: 0.2 + Math.random() * 0.4 });

  const starLayers = [
    Array.from({ length: 60 }, (_, i) => ({ x: (i * 97) % W, y: (i * 61) % H, s: 0.8, b: 0.15 + Math.random() * 0.2 })),
    Array.from({ length: 40 }, (_, i) => ({ x: (i * 131) % W, y: (i * 79) % H, s: 1.2, b: 0.2 + Math.random() * 0.25 })),
    Array.from({ length: 20 }, (_, i) => ({ x: (i * 199) % W, y: (i * 103) % H, s: 1.8, b: 0.3 + Math.random() * 0.3 }))
  ];

  const spawnWave = () => {
    wave++;
    const count = 5 + wave * 3;
    for (let i = 0; i < count; i++) {
      const shapes = ['diamond', 'hex', 'triangle'];
      enemies.push({
        x: W + 40 + Math.random() * 300, y: 40 + Math.random() * (H - 80),
        vx: -(1.2 + Math.random() * 1.5 + wave * 0.25), w: 18, h: 14, hp: 1,
        shape: shapes[Math.floor(Math.random() * shapes.length)],
        color: ['#ff00ff', '#00ffff', '#ff4488', '#ffcc00', '#00ff88'][Math.floor(Math.random() * 5)],
        bobPhase: Math.random() * Math.PI * 2, trail: []
      });
    }
  };
  spawnWave();

  const keys = {};
  const kH = (e) => {
    keys[e.code] = true;
    if ((e.code === 'Space' || e.code === 'KeyZ') && frame % 5 === 0) {
      bullets.push({ x: ship.x + ship.facing * 18, y: ship.y, vx: ship.facing * 10, life: 45, trail: [] });
      SFX.shoot();
      particles.add(ship.x + ship.facing * 16, ship.y, 3, { colors: ['#00ffff', '#0088ff'], speed: 2, life: 8 });
    }
  };
  const kU = (e) => { keys[e.code] = false; };
  document.addEventListener('keydown', kH); document.addEventListener('keyup', kU);

  cvs.addEventListener('touchstart', (e) => {
    const rect = cvs.getBoundingClientRect();
    const ty = (e.touches[0].clientY - rect.top) / rect.height * H;
    if (ty < ship.y) keys['ArrowUp'] = true; else keys['ArrowDown'] = true;
    if (frame % 5 === 0) {
      bullets.push({ x: ship.x + ship.facing * 18, y: ship.y, vx: ship.facing * 10, life: 45, trail: [] });
      SFX.shoot();
    }
  }, { passive: true });
  cvs.addEventListener('touchend', () => { keys['ArrowUp'] = false; keys['ArrowDown'] = false; }, { passive: true });

  const drawBgGrad = () => {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#020010');
    grad.addColorStop(0.5, '#050028');
    grad.addColorStop(1, '#0a0030');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  };

  const loop = setInterval(() => {
    if (over) return; frame++;

    if (keys['ArrowUp'] || keys['KeyW']) ship.vy -= 0.35;
    if (keys['ArrowDown'] || keys['KeyS']) ship.vy += 0.35;
    if (keys['ArrowLeft'] || keys['KeyA']) { ship.facing = -1; ship.x -= 3.5; }
    if (keys['ArrowRight'] || keys['KeyD']) { ship.facing = 1; ship.x += 3.5; }
    ship.vy *= 0.94; ship.y += ship.vy;
    ship.y = Math.max(18, Math.min(H - 18, ship.y));
    ship.x = Math.max(25, Math.min(W - 25, ship.x));

    ship.trail.push({ x: ship.x, y: ship.y });
    if (ship.trail.length > 8) ship.trail.shift();

    for (let i = bullets.length - 1; i >= 0; i--) {
      bullets[i].trail.push({ x: bullets[i].x, y: bullets[i].y });
      if (bullets[i].trail.length > 5) bullets[i].trail.shift();
      bullets[i].x += bullets[i].vx; bullets[i].life--;
      if (bullets[i].life <= 0 || bullets[i].x < -10 || bullets[i].x > W + 10) bullets.splice(i, 1);
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.trail.push({ x: e.x, y: e.y });
      if (e.trail.length > 5) e.trail.shift();
      e.x += e.vx;
      e.y += Math.sin(frame * 0.04 + e.bobPhase) * 0.8;
      if (e.x < -30) { enemies.splice(i, 1); continue; }
      if (Math.abs(e.x - ship.x) < 16 && Math.abs(e.y - ship.y) < 14) {
        lives--; shake.trigger(10); SFX.die();
        particles.add(ship.x, ship.y, 25, { colors: ['#0088ff', '#ff00ff', '#ffcc00', '#fff'], speed: 6, life: 35 });
        ship.x = 80; ship.y = H / 2; ship.vy = 0; ship.trail = [];
        if (lives <= 0) { over = true; clearInterval(loop); sendScore(score); return; }
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        if (Math.hypot(bullets[i].x - enemies[j].x, bullets[i].y - enemies[j].y) < 16) {
          score += 100 * wave; SFX.explode(); shake.trigger(3);
          const en = enemies[j];
          particles.add(en.x, en.y, 18, { colors: [en.color, '#ff4400', '#ffcc00', '#fff'], speed: 5, life: 28 });
          enemies.splice(j, 1); bullets.splice(i, 1); break;
        }
      }
    }
    if (enemies.length === 0) spawnWave();

    for (const p of bgParticles) { p.x += p.vx; if (p.x < -5) { p.x = W + 5; p.y = Math.random() * H; } }

    particles.update();

    // DRAW
    drawBgGrad();

    // Background particles
    for (const p of bgParticles) {
      ctx.globalAlpha = p.alpha * (0.5 + Math.sin(frame * 0.03 + p.x) * 0.3);
      ctx.fillStyle = '#3344aa';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Parallax stars
    for (let l = 0; l < 3; l++) {
      for (const s of starLayers[l]) {
        s.x -= (l + 1) * 0.4;
        if (s.x < 0) s.x += W;
        ctx.globalAlpha = s.b + Math.sin(frame * 0.015 + l) * 0.08;
        ctx.fillStyle = l === 2 ? '#aaccff' : l === 1 ? '#8899cc' : '#556688';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    ctx.save(); shake.apply(ctx, W, H);

    // Bullet trails + bullets
    for (const b of bullets) {
      for (let t = 0; t < b.trail.length; t++) {
        const alpha = (t / b.trail.length) * 0.4;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#00ffff';
        ctx.beginPath(); ctx.arc(b.trail[t].x, b.trail[t].y, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 12;
      const bGrad = ctx.createLinearGradient(b.x - 8, b.y, b.x + 8, b.y);
      bGrad.addColorStop(0, '#00ffff'); bGrad.addColorStop(1, '#0088ff');
      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 8, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Enemy trails + enemies
    for (const e of enemies) {
      for (let t = 0; t < e.trail.length; t++) {
        ctx.globalAlpha = (t / e.trail.length) * 0.2;
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(e.trail[t].x, e.trail[t].y, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(e.x, e.y);
      ctx.shadowColor = e.color; ctx.shadowBlur = 8;
      const eGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 12);
      eGrad.addColorStop(0, '#fff'); eGrad.addColorStop(0.4, e.color); eGrad.addColorStop(1, '#000');
      ctx.fillStyle = eGrad;
      if (e.shape === 'diamond') {
        ctx.beginPath(); ctx.moveTo(0, -e.h); ctx.lineTo(e.w, 0); ctx.lineTo(0, e.h); ctx.lineTo(-e.w, 0); ctx.closePath(); ctx.fill();
      } else if (e.shape === 'hex') {
        ctx.beginPath();
        for (let a = 0; a < 6; a++) { const ang = a * Math.PI / 3; ctx.lineTo(Math.cos(ang) * e.w * 0.7, Math.sin(ang) * e.h * 0.7); }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(e.w, 0); ctx.lineTo(-e.w * 0.6, -e.h); ctx.lineTo(-e.w * 0.6, e.h); ctx.closePath(); ctx.fill();
      }
      // Inner glow
      ctx.globalAlpha = 0.4 + Math.sin(frame * 0.15 + e.bobPhase) * 0.3;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Ship ghost trails
    for (let t = 0; t < ship.trail.length; t++) {
      ctx.globalAlpha = (t / ship.trail.length) * 0.15;
      ctx.fillStyle = '#4488ff';
      ctx.beginPath();
      ctx.save(); ctx.translate(ship.trail[t].x, ship.trail[t].y); ctx.scale(ship.facing, 1);
      ctx.moveTo(14, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Ship
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.scale(ship.facing, 1);
    ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 14;
    const shipGrad = ctx.createLinearGradient(-12, -8, 14, 8);
    shipGrad.addColorStop(0, '#0044ff'); shipGrad.addColorStop(0.5, '#4488ff'); shipGrad.addColorStop(1, '#88ccff');
    ctx.fillStyle = shipGrad;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, -2); ctx.lineTo(-2, 2); ctx.lineTo(-6, 10); ctx.closePath(); ctx.fill();
    // Cockpit highlight
    ctx.fillStyle = '#aaddff';
    ctx.beginPath(); ctx.arc(4, -2, 3, 0, Math.PI * 2); ctx.fill();
    // Engine glow
    ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 10;
    const engineGrad = ctx.createLinearGradient(-6, 0, -16 - Math.random() * 8, 0);
    engineGrad.addColorStop(0, '#ff4400'); engineGrad.addColorStop(0.5, '#ff8800'); engineGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = engineGrad;
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-14 - Math.random() * 8, 0); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // Lives as mini ship icons
    for (let i = 0; i < lives; i++) {
      ctx.save(); ctx.translate(20 + i * 24, 18);
      ctx.fillStyle = '#4488ff'; ctx.shadowColor = '#4488ff'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-3, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    particles.draw(ctx);
    ctx.restore();

    drawText(ctx, `Score: ${score}  Wave: ${wave}`, W - 10, 16, 12, '#fff', 'right');
  }, 1000 / 60);
  return () => { clearInterval(loop); document.removeEventListener('keydown', kH); document.removeEventListener('keyup', kU); };
}


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

function gameQbert(area, sendScore) {
  const W = 400, H = 400;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.borderRadius = "12px";
  canvas.style.display = "block";
  area.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const particles = new Particles();
  const shake = new Shake();

  const ROWS = 7;
  const CUBE_W = 40;
  const CUBE_H = 24;
  const CUBE_HH = CUBE_H / 2;
  const OFFSET_X = W / 2;
  const OFFSET_Y = 80;

  let cubes = [];
  let targetColor = "#00ff88";
  let player = { row: 0, col: 0, jumping: false, jumpT: 0, jumpFrom: null, jumpTo: null, falling: false, fallVY: 0, fallY: 0, facing: 1, bubbleText: null, bubbleTimer: 0 };
  let enemies = [];
  let score = 0;
  let gameOver = false;
  let deathTimer = 0;
  let frameCount = 0;
  let started = false;

  // Build pyramid
  for (let r = 0; r < ROWS; r++) {
    cubes[r] = [];
    for (let c = 0; c <= r; c++) {
      const px = OFFSET_X + (c - r / 2) * CUBE_W;
      const py = OFFSET_Y + r * CUBE_H;
      cubes[r][c] = { px, py, colored: false };
    }
  }

  function cubeCenter(row, col) {
    const c = cubes[row][col];
    return { x: c.px, y: c.py };
  }

  function screenToGrid(sx, sy) {
    let best = null, bestD = Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= r; c++) {
        const cp = cubeCenter(r, c);
        const d = Math.hypot(sx - cp.x, sy - cp.y);
        if (d < bestD) { bestD = d; best = { row: r, col: c }; }
      }
    }
    return best;
  }

  function onKey(e) {
    if (gameOver && deathTimer > 60) {
      sendScore(score);
      cleanup();
      return;
    }
    if (player.jumping || player.falling) return;
    if (!started) { started = true; return; }

    const key = e.key;
    let dr = 0, dc = 0;
    // Q*Bert moves diagonally on isometric grid
    if (key === "1" || key === "q") { dr = 1; dc = 0; player.facing = -1; } // down-left
    else if (key === "2" || key === "w") { dr = 1; dc = 1; player.facing = 1; } // down-right
    else if (key === "3" || key === "a") { dr = -1; dc = 0; player.facing = -1; } // up-left
    else if (key === "4" || key === "e") { dr = -1; dc = 1; player.facing = 1; } // up-right

    if (dr === 0 && dc === 0) return;

    const nr = player.row + dr;
    const nc = player.col + dc;

    if (nr < 0 || nr >= ROWS || nc < 0 || nc > nr) {
      // Falling off!
      player.falling = true;
      player.fallVY = 0;
      player.bubbleText = "(@!#?)";
      player.bubbleTimer = 120;
      SFX.die();
      return;
    }

    player.jumping = true;
    player.jumpT = 0;
    player.jumpFrom = cubeCenter(player.row, player.col);
    player.jumpTo = cubeCenter(nr, nc);
    player.targetRow = nr;
    player.targetCol = nc;
    SFX.jump();
  }
  document.addEventListener("keydown", onKey);

  // Touch controls
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (gameOver && deathTimer > 60) { sendScore(score); cleanup(); return; }
    if (!started) { started = true; return; }
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const rect = canvas.getBoundingClientRect();
    const ex = e.changedTouches[0].clientX;
    const ey = e.changedTouches[0].clientY;
    const dx = ex - touchStart.x;
    const dy = ey - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    // Simulate a key based on direction
    const fakeEvent = { key: "" };
    if (dx < 0 && dy < 0) fakeEvent.key = "a";
    else if (dx > 0 && dy < 0) fakeEvent.key = "e";
    else if (dx < 0 && dy > 0) fakeEvent.key = "q";
    else fakeEvent.key = "w";
    onKey(fakeEvent);
  });

  function spawnEnemy() {
    if (enemies.length >= 2) return;
    const type = Math.random() < 0.5 ? "snake" : "ball";
    enemies.push({
      type, row: 0, col: 0, progress: 0, speed: 0.01 + Math.random() * 0.01,
      px: cubes[0][0].px, py: cubes[0][0].py
    });
  }

  function update() {
    frameCount++;
    if (gameOver) { deathTimer++; particles.update(); return; }

    // Player jump
    if (player.jumping) {
      player.jumpT += 0.08;
      if (player.jumpT >= 1) {
        player.jumping = false;
        player.row = player.targetRow;
        player.col = player.targetCol;
        if (!cubes[player.row][player.col].colored) {
          cubes[player.row][player.col].colored = true;
          SFX.bounce();
          particles.add(cubes[player.row][player.col].px, cubes[player.row][player.col].py, 10, {
            color: targetColor, speed: 3, life: 30, size: 4
          });
          // Check win
          let allColored = true;
          for (let r = 0; r < ROWS; r++)
            for (let c = 0; c <= r; c++)
              if (!cubes[r][c].colored) allColored = false;
          if (allColored) {
            score += 100;
            SFX.win();
            for (let r = 0; r < ROWS; r++)
              for (let c = 0; c <= r; c++)
                cubes[r][c].colored = false;
          }
        }
      }
    }

    // Player fall
    if (player.falling) {
      player.fallVY += 0.3;
      player.fallY += player.fallVY;
      if (player.fallY > 400) {
        gameOver = true;
        deathTimer = 0;
        shake.trigger(10);
      }
    }

    // Enemies
    if (frameCount % 180 === 0) spawnEnemy();
    for (let e of enemies) {
      e.progress += e.speed;
      if (e.progress >= 1) {
        e.progress = 0;
        e.row++;
        if (e.row >= ROWS) { e.dead = true; continue; }
        if (e.col > e.row) e.col = e.row;
      }
      const from = cubes[e.row] && cubes[e.row][e.col] ? cubeCenter(e.row, e.col) : { x: e.px, y: e.py };
      const nextRow = Math.min(e.row + 1, ROWS - 1);
      const to = cubes[nextRow] && cubes[nextRow][e.col] ? cubeCenter(nextRow, e.col) : from;
      e.px = from.x + (to.x - from.x) * e.progress;
      e.py = from.y + (to.y - from.y) * e.progress;

      // Collision
      if (!player.falling) {
        const pp = player.jumping ? player.jumpFrom : cubeCenter(player.row, player.col);
        const cp = { x: e.px, y: e.py };
        if (Math.hypot(pp.x - cp.x, pp.y - cp.y) < 20) {
          gameOver = true;
          deathTimer = 0;
          SFX.die();
          shake.trigger(10);
        }
      }
    }
    enemies = enemies.filter(e => !e.dead && e.py < 500);

    if (player.bubbleTimer > 0) player.bubbleTimer--;
    particles.update();
  }

  function drawIsoCube(x, y, topCol, leftCol, rightCol, glow) {
    const hw = CUBE_W / 2;
    const hh = CUBE_HH;

    ctx.save();
    if (glow) {
      ctx.shadowColor = topCol;
      ctx.shadowBlur = 12;
    }

    // Top face
    const tg = ctx.createLinearGradient(x - hw, y - hh, x + hw, y);
    tg.addColorStop(0, topCol);
    tg.addColorStop(1, shadeColor(topCol, -20));
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(x, y - hh);
    ctx.lineTo(x + hw, y);
    ctx.lineTo(x, y + hh);
    ctx.lineTo(x - hw, y);
    ctx.closePath();
    ctx.fill();

    // Left face
    const lg = ctx.createLinearGradient(x - hw, y, x, y + hh);
    lg.addColorStop(0, leftCol);
    lg.addColorStop(1, shadeColor(leftCol, -30));
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(x - hw, y);
    ctx.lineTo(x, y + hh);
    ctx.lineTo(x, y + hh + CUBE_H * 0.7);
    ctx.lineTo(x - hw, y + CUBE_H * 0.7);
    ctx.closePath();
    ctx.fill();

    // Right face
    const rg = ctx.createLinearGradient(x, y + hh, x + hw, y);
    rg.addColorStop(0, rightCol);
    rg.addColorStop(1, shadeColor(rightCol, -40));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(x + hw, y);
    ctx.lineTo(x, y + hh);
    ctx.lineTo(x, y + hh + CUBE_H * 0.7);
    ctx.lineTo(x + hw, y + CUBE_H * 0.7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function shadeColor(col, amt) {
    let r = parseInt(col.slice(1, 3), 16) + amt;
    let g = parseInt(col.slice(3, 5), 16) + amt;
    let b = parseInt(col.slice(5, 7), 16) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  function drawQBert(x, y) {
    ctx.save();
    ctx.shadowColor = "#ff8833";
    ctx.shadowBlur = 12;

    // Body
    const bg = ctx.createRadialGradient(x, y - 4, 2, x, y - 4, 14);
    bg.addColorStop(0, "#ffaa44");
    bg.addColorStop(1, "#dd6611");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x, y - 4, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x - 5, y - 7, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 5, y - 7, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(x - 4 + player.facing, y - 7, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 6 + player.facing, y - 7, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Nose/snout
    ctx.fillStyle = "#ff6622";
    ctx.beginPath();
    ctx.ellipse(x + player.facing * 6, y - 1, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Feet
    ctx.fillStyle = "#cc5500";
    ctx.beginPath();
    ctx.ellipse(x - 6, y + 10, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 6, y + 10, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function draw() {
    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1a0a2e");
    bg.addColorStop(1, "#0d0520");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    shake.apply(ctx, W, H);

    // Cubes
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= r; c++) {
        const cube = cubes[r][c];
        let topC, leftC, rightC;
        if (cube.colored) {
          topC = "#00ff88"; leftC = "#00cc66"; rightC = "#009944";
        } else {
          topC = "#3a2a5e"; leftC = "#2a1a4e"; rightC = "#1a0a3e";
        }
        drawIsoCube(cube.px, cube.py, topC, leftC, rightC, cube.colored);
      }
    }

    // Enemies
    for (let e of enemies) {
      if (e.type === "snake") {
        ctx.save();
        ctx.shadowColor = "#8844ff";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#8844ff";
        ctx.beginPath();
        ctx.arc(e.px, e.py - 6, 8, 0, Math.PI * 2);
        ctx.fill();
        // Coil body
        for (let i = 1; i < 4; i++) {
          ctx.globalAlpha = 1 - i * 0.2;
          ctx.beginPath();
          ctx.arc(e.px + i * 2, e.py - 6 + i * 6, 7 - i, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.shadowColor = "#0088ff";
        ctx.shadowBlur = 10;
        const bg2 = ctx.createRadialGradient(e.px, e.py - 4, 1, e.px, e.py - 4, 10);
        bg2.addColorStop(0, "#44aaff");
        bg2.addColorStop(1, "#0055cc");
        ctx.fillStyle = bg2;
        ctx.beginPath();
        ctx.arc(e.px, e.py - 4, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Player
    if (!player.falling) {
      let px, py;
      if (player.jumping) {
        const t = easeInOutQuad(player.jumpT);
        px = player.jumpFrom.x + (player.jumpTo.x - player.jumpFrom.x) * t;
        py = player.jumpFrom.y + (player.jumpTo.y - player.jumpFrom.y) * t - 30 * Math.sin(t * Math.PI);
        // Squash and stretch
        const squash = 1 + 0.2 * Math.sin(t * Math.PI);
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1 / squash, squash);
        ctx.translate(-px, -py);
        drawQBert(px, py);
        ctx.restore();
      } else {
        const cp = cubeCenter(player.row, player.col);
        drawQBert(cp.x, cp.y);
      }
    } else {
      // Falling
      const cp = cubeCenter(ROWS - 1, 0);
      drawQBert(cp.x, cp.y + player.fallY);
    }

    // Speech bubble
    if (player.bubbleTimer > 0) {
      const bp = player.falling ? { x: cubeCenter(ROWS - 1, 0).x, y: cubeCenter(ROWS - 1, 0).y + player.fallY - 25 } : cubeCenter(player.row, player.col);
      ctx.save();
      ctx.globalAlpha = Math.min(1, player.bubbleTimer / 30);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(bp.x, bp.y - 20, 30, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#111";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("(@!#?)", bp.x, bp.y - 17);
      ctx.restore();
    }

    particles.draw(ctx);

    // Score
    drawText(ctx, "SCORE: " + score, W / 2, 30, 20, "#ff8833", "center", true);

    if (!started) {
      const pulse = 0.7 + 0.3 * Math.sin(frameCount * 0.08);
      ctx.save();
      ctx.globalAlpha = pulse;
      drawText(ctx, "PRESS ANY KEY", W / 2, H / 2, 20, "#ffffff", "center", true);
      drawText(ctx, "Q/W/A/E to move", W / 2, H / 2 + 30, 14, "#aaaacc", "center", false);
      ctx.restore();
    }

    if (gameOver) {
      drawText(ctx, "GAME OVER", W / 2, H / 2, 30, "#ff4488", "center", true);
      if (deathTimer > 60) drawText(ctx, "CLICK TO RESTART", W / 2, H / 2 + 35, 16, "#ffffff", "center", false);
    }
  }

  const loop = setInterval(() => { update(); draw(); }, 1000 / 60);

  function cleanup() {
    clearInterval(loop);
    document.removeEventListener("keydown", onKey);
    canvas.remove();
  }
  return cleanup;
}

function gameDigDug(area, sendScore) {
  const W = 400, H = 400, CS = 20, COLS = 20, ROWS = 20;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.borderRadius = "12px";
  canvas.style.display = "block";
  area.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const particles = new Particles();
  const shake = new Shake();

  let player = { x: 10, y: 0, px: 10 * CS + CS / 2, py: CS / 2, dir: 0, pumping: false, pumpTarget: null, pumpLine: [] };
  let dirt = [];
  let enemies = [];
  let score = 0;
  let lives = 3;
  let gameOver = false;
  let deathTimer = 0;
  let frameCount = 0;
  let digging = false;
  let keys = {};

  // Initialize dirt
  for (let r = 1; r < ROWS; r++) {
    dirt[r] = [];
    for (let c = 0; c < COLS; c++) {
      const depth = r / ROWS;
      const rVal = Math.floor(100 - depth * 50);
      const gVal = Math.floor(70 - depth * 40);
      const bVal = Math.floor(40 - depth * 20);
      dirt[r][c] = { dug: false, color: `rgb(${rVal},${gVal},${bVal})`, texture: Math.random() };
    }
  }

  function spawnEnemies() {
    enemies = [];
    // Pookas
    for (let i = 0; i < 3; i++) {
      let c, r;
      do { c = Math.floor(Math.random() * COLS); r = 3 + Math.floor(Math.random() * (ROWS - 4)); } while (dirt[r][c].dug);
      enemies.push({
        type: "pooka", x: c, y: r, px: c * CS + CS / 2, py: r * CS + CS / 2,
        inflate: 0, inflateDir: 0, speed: 0.02, alive: true, ghost: false, ghostTimer: 0
      });
    }
    // Fygars
    for (let i = 0; i < 2; i++) {
      let c, r;
      do { c = Math.floor(Math.random() * COLS); r = 4 + Math.floor(Math.random() * (ROWS - 5)); } while (dirt[r][c].dug);
      enemies.push({
        type: "fygar", x: c, y: r, px: c * CS + CS / 2, py: r * CS + CS / 2,
        inflate: 0, inflateDir: 0, speed: 0.015, alive: true, fireDir: 1, fireTimer: 0
      });
    }
  }

  spawnEnemies();

  function onKey(e) {
    keys[e.key] = true;
    if (gameOver && deathTimer > 60) {
      sendScore(score);
      cleanup();
    }
  }
  function onKeyUp(e) { keys[e.key] = false; }
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("click", () => {
    if (gameOver && deathTimer > 60) { sendScore(score); cleanup(); }
  });

  function movePlayer(dx, dy) {
    if (player.pumping) return;
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
    if (ny >= 1 && dirt[ny] && !dirt[ny][nx].dug) {
      dirt[ny][nx].dug = true;
      SFX.dig();
      particles.add(nx * CS + CS / 2, ny * CS + CS / 2, 4, {
        color: dirt[ny][nx].color, speed: 2, life: 20, size: 3
      });
    }
    player.x = nx;
    player.y = ny;
    if (dx < 0) player.dir = 0;
    else if (dx > 0) player.dir = 1;
    else if (dy < 0) player.dir = 2;
    else if (dy > 0) player.dir = 3;
  }

  function startPump() {
    if (player.pumping) { stopPump(); return; }
    for (let e of enemies) {
      if (!e.alive) continue;
      const dist = Math.hypot(e.px - player.px, e.py - player.py);
      if (dist < CS * 3) {
        player.pumping = true;
        player.pumpTarget = e;
        e.inflateDir = 1;
        SFX.inflate();
        return;
      }
    }
  }

  function stopPump() {
    player.pumping = false;
    if (player.pumpTarget) {
      player.pumpTarget.inflateDir = -1;
      player.pumpTarget = null;
    }
  }

  function update() {
    frameCount++;
    if (gameOver) { deathTimer++; particles.update(); return; }

    // Smooth pixel position
    const tpx = player.x * CS + CS / 2;
    const tpy = player.y * CS + CS / 2;
    player.px += (tpx - player.px) * 0.25;
    player.py += (tpy - player.py) * 0.25;

    // Movement
    const moveDelay = 6;
    if (frameCount % moveDelay === 0) {
      if (keys["ArrowLeft"] || keys["a"]) movePlayer(-1, 0);
      else if (keys["ArrowRight"] || keys["d"]) movePlayer(1, 0);
      else if (keys["ArrowUp"] || keys["w"]) movePlayer(0, -1);
      else if (keys["ArrowDown"] || keys["s"]) movePlayer(0, 1);
    }

    if (keys[" "] || keys["f"]) startPump();
    if (!keys[" "] && !keys["f"] && player.pumping) stopPump();

    // Enemies
    for (let e of enemies) {
      if (!e.alive) continue;

      // Inflate
      if (e.inflateDir !== 0) {
        e.inflate += e.inflateDir * 0.03;
        if (e.inflate >= 1) {
          // Defeated
          e.alive = false;
          score += 200;
          SFX.explode();
          shake.trigger(6);
          particles.add(e.px, e.py, 20, {
            color: e.type === "pooka" ? "#ff4444" : "#44ff44", speed: 4, life: 40, size: 5
          });
          stopPump();
        }
        if (e.inflate <= 0) { e.inflate = 0; e.inflateDir = 0; }
      }

      // Movement AI
      if (e.inflate === 0 && frameCount % 3 === 0) {
        // Simple AI: move toward player
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        let mx = 0, my = 0;
        if (Math.abs(dx) > Math.abs(dy)) mx = dx > 0 ? 1 : -1;
        else my = dy > 0 ? 1 : -1;

        const nx = e.x + mx;
        const ny = e.y + my;
        if (nx >= 0 && nx < COLS && ny >= 1 && ny < ROWS && dirt[ny] && dirt[ny][nx].dug) {
          e.x = nx; e.y = ny;
        } else {
          // Try other direction
          const mx2 = dy > 0 ? 0 : (dy < 0 ? 0 : (dx > 0 ? 0 : 0));
          const my2 = dx > 0 ? 0 : (dx < 0 ? 0 : (dy > 0 ? 0 : 0));
          const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
          const d = dirs[Math.floor(Math.random() * 4)];
          const nnx = e.x + d.x, nny = e.y + d.y;
          if (nnx >= 0 && nnx < COLS && nny >= 1 && nny < ROWS && dirt[nny] && dirt[nny][nnx].dug) {
            e.x = nnx; e.y = nny;
          }
        }
      }

      // Fygar fire
      if (e.type === "fygar" && e.inflate === 0) {
        e.fireTimer++;
        if (e.fireTimer > 120) {
          e.fireTimer = 0;
          // Fire breath particles
          for (let i = 0; i < 5; i++) {
            particles.add(e.px + e.fireDir * (10 + i * 8), e.py, 2, {
              color: ["#ff4400", "#ff8800", "#ffcc00"][Math.floor(Math.random() * 3)],
              speed: 3, life: 20, size: 4
            });
          }
          // Check if fire hits player
          if (Math.abs(player.py - e.py) < CS && ((e.fireDir > 0 && player.px > e.px) || (e.fireDir < 0 && player.px < e.px))) {
            if (Math.abs(player.px - e.px) < CS * 2.5) {
              die();
            }
          }
          e.fireDir = player.px > e.px ? 1 : -1;
        }
      }

      // Collision with player
      if (!player.pumping && e.inflate === 0) {
        if (Math.abs(e.px - player.px) < CS * 0.7 && Math.abs(e.py - player.py) < CS * 0.7) {
          die();
        }
      }

      e.px += (e.x * CS + CS / 2 - e.px) * 0.2;
      e.py += (e.y * CS + CS / 2 - e.py) * 0.2;
    }

    // Pump line update
    if (player.pumping && player.pumpTarget) {
      player.pumpLine = [];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        player.pumpLine.push({
          x: player.px + (player.pumpTarget.px - player.px) * (i / steps),
          y: player.py + (player.pumpTarget.py - player.py) * (i / steps)
        });
      }
    }

    particles.update();
  }

  function die() {
    lives--;
    SFX.die();
    shake.trigger(8);
    particles.add(player.px, player.py, 15, { color: "#0088ff", speed: 3, life: 40, size: 4 });
    if (lives <= 0) {
      gameOver = true;
      deathTimer = 0;
    } else {
      player.x = 10; player.y = 0;
      player.px = 10 * CS + CS / 2;
      player.py = CS / 2;
      stopPump();
    }
  }

  function draw() {
    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1a1a2e");
    bg.addColorStop(1, "#2a1a10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Surface
    const sg = ctx.createLinearGradient(0, 0, 0, CS);
    sg.addColorStop(0, "#44aa55");
    sg.addColorStop(1, "#338844");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, CS);

    // Sky strip
    const skyG = ctx.createLinearGradient(0, 0, 0, CS);
    skyG.addColorStop(0, "#2255aa");
    skyG.addColorStop(1, "#4488cc");
    ctx.fillStyle = skyG;
    ctx.fillRect(0, 0, W, CS * 0.5);

    shake.apply(ctx, W, H);

    // Dirt
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!dirt[r][c].dug) {
          ctx.fillStyle = dirt[r][c].color;
          ctx.fillRect(c * CS, r * CS, CS, CS);
          // Texture dots
          ctx.save();
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(c * CS + dirt[r][c].texture * CS, r * CS + (1 - dirt[r][c].texture) * CS, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          // Dug tunnel - dark background
          ctx.fillStyle = "#0a0a14";
          ctx.fillRect(c * CS, r * CS, CS, CS);
          // Rounded tunnel edges
          ctx.save();
          ctx.fillStyle = dirt[r][c].color;
          // Top edge
          if (r > 1 && !dirt[r - 1][c].dug) {
            ctx.fillRect(c * CS, r * CS, CS, 3);
          }
          ctx.restore();
        }
      }
    }

    // Enemies
    for (let e of enemies) {
      if (!e.alive) continue;
      ctx.save();
      const sc = 1 + e.inflate * 0.5;
      ctx.translate(e.px, e.py);
      ctx.scale(sc, sc);

      if (e.type === "pooka") {
        ctx.shadowColor = "#ff4444";
        ctx.shadowBlur = 10;
        const pg = ctx.createRadialGradient(0, 0, 2, 0, 0, 12);
        pg.addColorStop(0, "#ff6666");
        pg.addColorStop(1, "#cc2222");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        // Goggles
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(-4, -2, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(4, -2, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(-4, -2, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(4, -2, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Fygar
        ctx.shadowColor = "#44ff44";
        ctx.shadowBlur = 10;
        const fg = ctx.createRadialGradient(0, 0, 2, 0, 0, 14);
        fg.addColorStop(0, "#66ff66");
        fg.addColorStop(1, "#22aa22");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        // Eyes
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(-4, -3, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(5, -3, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(-3, -3, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(6, -3, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Pump line
    if (player.pumping && player.pumpTarget) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#ffffff";
      ctx.shadowColor = "#00ffff";
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.px, player.py);
      ctx.lineTo(player.pumpTarget.px, player.pumpTarget.py);
      ctx.stroke();
      ctx.restore();
    }

    // Player
    ctx.save();
    ctx.shadowColor = "#0088ff";
    ctx.shadowBlur = 12;
    const pbg = ctx.createRadialGradient(player.px, player.py, 2, player.px, player.py, 12);
    pbg.addColorStop(0, "#4488ff");
    pbg.addColorStop(1, "#0044aa");
    ctx.fillStyle = pbg;
    ctx.beginPath();
    ctx.arc(player.px, player.py, 12, 0, Math.PI * 2);
    ctx.fill();

    // Helmet visor
    ctx.shadowBlur = 0;
    const hg = ctx.createLinearGradient(player.px - 8, player.py - 8, player.px + 8, player.py - 8);
    hg.addColorStop(0, "#88ccff");
    hg.addColorStop(1, "#4488cc");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(player.px, player.py - 3, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // White suit details
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(player.px, player.py + 5, 4, 0, Math.PI);
    ctx.fill();

    // Direction indicator
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const dd = dirs[player.dir];
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(player.px + dd[0] * 10, player.py + dd[1] * 10, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    particles.draw(ctx);

    // Score
    drawText(ctx, "SCORE: " + score, W / 2, H - 15, 16, "#00ff88", "center", true);

    // Lives
    for (let i = 0; i < lives; i++) {
      ctx.save();
      ctx.fillStyle = "#0088ff";
      ctx.shadowColor = "#0088ff";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(20 + i * 25, 15, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (gameOver) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      drawText(ctx, "GAME OVER", W / 2, H / 2 - 10, 30, "#ff4488", "center", true);
      if (deathTimer > 60) drawText(ctx, "CLICK TO RESTART", W / 2, H / 2 + 30, 16, "#ffffff", "center", false);
    }
  }

  const loop = setInterval(() => { update(); draw(); }, 1000 / 60);

  function cleanup() {
    clearInterval(loop);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
    canvas.remove();
  }
  return cleanup;
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
