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

      case 'c4_update': handleC4Update(msg); break;
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
      'flappy-bird': () => gameFlappyBird(gameArea, sendScore),
      '2048': () => game2048(gameArea, sendScore),
      'snake': () => gameSnake(gameArea, sendScore),
      'connect-4': () => gameConnect4(gameArea, roomId),
      'breakout': () => gameBreakout(gameArea, sendScore),
      'space-invaders': () => gameSpaceInvaders(gameArea, sendScore),
      'whack-a-mole': () => gameWhackAMole(gameArea, sendScore),
      'minesweeper': () => gameMinesweeper(gameArea, sendScore),
      'tetris': () => gameTetris(gameArea, sendScore),
      'bubble-shooter': () => gameBubbleShooter(gameArea, sendScore),
      'doodle-jump': () => gameDoodleJump(gameArea, sendScore),
    };
    if (games[gameId]) gameCleanup = games[gameId]();
  }

  // ==================== 1. FLAPPY BIRD ====================
  function gameFlappyBird(area, sendScore) {
    const W = 320, H = 480;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border)';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let bird = { y: H / 2, vy: 0 }, pipes = [], score = 0, over = false, frame = 0;
    const flap = () => { if (!over) bird.vy = -7; };
    cvs.addEventListener('pointerdown', flap);
    const kHandler = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); } };
    document.addEventListener('keydown', kHandler);
    const loop = setInterval(() => {
      if (over) return;
      bird.vy += 0.45; bird.y += bird.vy;
      if (frame % 90 === 0) { const gap = 130, gy = 50 + Math.random() * (H - gap - 100); pipes.push({ x: W, gy, gap, scored: false }); }
      pipes.forEach(p => p.x -= 2.5);
      pipes = pipes.filter(p => p.x > -40);
      pipes.forEach(p => { if (!p.scored && p.x + 30 < 80) { score++; p.scored = true; } });
      if (bird.y < 0 || bird.y > H) { over = true; sendScore(score); showToast(`Flappy Bird: ${score} points`, score > 0 ? 'success' : 'error'); }
      pipes.forEach(p => { if (80 + 12 > p.x && 80 - 12 < p.x + 30 && (bird.y - 12 < p.gy || bird.y + 12 > p.gy + p.gap)) { over = true; sendScore(score); showToast(`Flappy Bird: ${score} points`, 'error'); } });
      ctx.fillStyle = '#1a0a2e'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#00ff88'; pipes.forEach(p => { ctx.fillRect(p.x, 0, 30, p.gy); ctx.fillRect(p.x, p.gy + p.gap, 30, H); });
      ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(80, bird.y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Orbitron,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(score, W / 2, 45);
      if (over) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Orbitron,sans-serif'; ctx.fillText('GAME OVER', W / 2, H / 2 - 10); ctx.font = '18px Orbitron,sans-serif'; ctx.fillText(`Score: ${score}`, W / 2, H / 2 + 25); }
      frame++;
    }, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kHandler); };
  }

  // ==================== 2. 2048 ====================
  function game2048(area, sendScore) {
    let grid = Array(4).fill(null).map(() => Array(4).fill(0));
    let score = 0, over = false;
    function addTile() { const empty = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!grid[r][c]) empty.push([r, c]); if (!empty.length) return; const [r, c] = empty[Math.floor(Math.random() * empty.length)]; grid[r][c] = Math.random() < 0.9 ? 2 : 4; }
    addTile(); addTile();
    function slide(row) { let a = row.filter(x => x), merged = false; for (let i = 0; i < a.length - 1; i++) { if (a[i] === a[i + 1]) { a[i] *= 2; score += a[i]; a.splice(i + 1, 1); merged = true; } } while (a.length < 4) a.push(0); return a; }
    function move(dir) {
      if (over) return; let moved = false;
      const g = grid.map(r => [...r]);
      if (dir === 'left') { for (let r = 0; r < 4; r++) { const n = slide(g[r]); if (n.join(',') !== g[r].join(',')) moved = true; grid[r] = n; } }
      else if (dir === 'right') { for (let r = 0; r < 4; r++) { const n = slide(g[r].slice().reverse()).reverse(); if (n.join(',') !== g[r].join(',')) moved = true; grid[r] = n; } }
      else if (dir === 'up') { for (let c = 0; c < 4; c++) { const col = [g[0][c], g[1][c], g[2][c], g[3][c]]; const n = slide(col); if (n.join(',') !== col.join(',')) moved = true; for (let r = 0; r < 4; r++) grid[r][c] = n[r]; } }
      else if (dir === 'down') { for (let c = 0; c < 4; c++) { const col = [g[3][c], g[2][c], g[1][c], g[0][c]]; const n = slide(col).reverse(); if (n.join(',') !== [g[0][c], g[1][c], g[2][c], g[3][c]].join(',')) moved = true; for (let r = 0; r < 4; r++) grid[r][c] = n[r]; } }
      if (moved) addTile();
      if (!canMove()) { over = true; sendScore(score); showToast(`2048: ${score} points`, 'success'); }
    }
    function canMove() { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { if (!grid[r][c]) return true; if (c < 3 && grid[r][c] === grid[r][c + 1]) return true; if (r < 3 && grid[r][c] === grid[r + 1][c]) return true; } return false; }
    const colors = { 0: 'transparent', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' };
    function render() {
      let html = `<p style="text-align:center;color:var(--text2);margin-bottom:0.5rem">Score: <b style="color:var(--accent)">${score}</b></p><div style="display:inline-grid;grid-template-columns:repeat(4,70px);gap:6px;background:var(--bg3);padding:8px;border-radius:12px;border:2px solid var(--border);margin:0 auto;display:block;width:fit-content">`;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const v = grid[r][c]; html += `<div style="width:70px;height:70px;border-radius:8px;background:${colors[v] || '#3c3a32'};display:flex;align-items:center;justify-content:center;font:bold 22px Orbitron,sans-serif;color:${v > 4 ? '#fff' : '#776e65'}">${v || ''}</div>`; }
      html += '</div>';
      html += '<p style="text-align:center;color:var(--text-muted);margin-top:1rem;font-size:0.85rem">Use arrow keys or swipe to slide tiles</p>';
      area.innerHTML = html;
    }
    const kHandler = (e) => { const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }; if (map[e.key]) { e.preventDefault(); move(map[e.key]); render(); } };
    document.addEventListener('keydown', kHandler);
    let tx, ty;
    const tStart = (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; };
    const tEnd = (e) => { const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left'); else move(dy > 0 ? 'down' : 'up'); render(); };
    area.addEventListener('touchstart', tStart, { passive: true });
    area.addEventListener('touchend', tEnd, { passive: true });
    render();
    return () => document.removeEventListener('keydown', kHandler);
  }

  // ==================== 3. SNAKE ====================
  function gameSnake(area, sendScore) {
    const W = 300, H = 300, CS = 15;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border)';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let snake = [{ x: 7, y: 7 }], dir = { x: 1, y: 0 }, food = spawnFood(), score = 0, over = false, speed = 120;
    function spawnFood() { let p; do { p = { x: Math.floor(Math.random() * (W / CS)), y: Math.floor(Math.random() * (H / CS)) }; } while (snake.some(s => s.x === p.x && s.y === p.y)); return p; }
    function tick() {
      if (over) return;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.x >= W / CS || head.y < 0 || head.y >= H / CS || snake.some(s => s.x === head.x && s.y === head.y)) {
        over = true; sendScore(score); showToast(`Snake: ${score} points`, score > 5 ? 'success' : 'error'); return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) { score++; food = spawnFood(); if (speed > 60) speed -= 3; }
      else snake.pop();
      ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0, 0, W, H);
      snake.forEach((s, i) => { ctx.fillStyle = i === 0 ? '#00ff88' : '#00cc66'; ctx.fillRect(s.x * CS + 1, s.y * CS + 1, CS - 2, CS - 2); });
      ctx.fillStyle = '#ff4444'; ctx.beginPath(); ctx.arc(food.x * CS + CS / 2, food.y * CS + CS / 2, CS / 2 - 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Orbitron,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`Score: ${score}`, 8, 18);
    }
    const loop = setInterval(tick, speed);
    const kHandler = (e) => {
      const map = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };
      if (map[e.key]) { e.preventDefault(); const n = map[e.key]; if (n.x !== -dir.x || n.y !== -dir.y) dir = n; }
    };
    document.addEventListener('keydown', kHandler);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kHandler); };
  }

  // ==================== 4. CONNECT 4 ====================
  function gameConnect4(area, roomId) {
    let board = Array(6).fill(null).map(() => Array(7).fill(0));
    let myTurn = true;
    function render() {
      let html = `<p style="text-align:center;color:var(--text2);margin-bottom:0.5rem" id="c4-status">${myTurn ? 'Your turn - click a column' : 'Opponent\'s turn...'}</p>`;
      html += '<div style="display:inline-grid;grid-template-columns:repeat(7,50px);gap:4px;background:#1a3a8a;padding:8px;border-radius:12px;margin:0 auto;display:block;width:fit-content">';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
        const v = board[r][c];
        const bg = v === 1 ? '#ff4444' : v === 2 ? '#ffcc00' : '#111';
        html += `<div style="width:50px;height:50px;border-radius:50%;background:${bg};border:2px solid #0d1b4a;cursor:${myTurn && v === 0 ? 'pointer' : 'default'}" onclick="window.oasisC4Drop(${c})"></div>`;
      }
      html += '</div>';
      area.innerHTML = html;
    }
    window.oasisC4Drop = (col) => {
      if (!myTurn || !currentRoom) return;
      ws.send(JSON.stringify({ type: 'game_c4', roomId: currentRoom, col }));
      myTurn = false; render();
    };
    window.oasisC4Handler = (msg) => {
      if (msg.board) board = msg.board;
      myTurn = msg.yourTurn;
      if (msg.win) { showToast(msg.lastMove?.mark === 1 ? 'You won Connect 4!' : 'Bot won Connect 4!', msg.lastMove?.mark === 1 ? 'success' : 'error'); }
      render();
    };
    render();
    return () => { delete window.oasisC4Drop; delete window.oasisC4Handler; };
  }
  function handleC4Update(msg) { if (window.oasisC4Handler) window.oasisC4Handler(msg); }

  // ==================== 5. BREAKOUT ====================
  function gameBreakout(area, sendScore) {
    const W = 400, H = 300;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border)';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let paddleX = W / 2 - 40, score = 0, over = false;
    let ball = { x: W / 2, y: H - 30, vx: 3, vy: -3 };
    let bricks = [];
    const BCOLS = 8, BROWS = 5, BW = 44, BH = 14, BPAD = 4;
    const bcolors = ['#ff4444', '#ff8844', '#ffcc00', '#44ff44', '#4488ff'];
    for (let r = 0; r < BROWS; r++) for (let c = 0; c < BCOLS; c++) bricks.push({ x: c * (BW + BPAD) + 12, y: r * (BH + BPAD) + 30, w: BW, h: BH, color: bcolors[r], alive: true });
    function tick() {
      if (over) return;
      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.x < 0 || ball.x > W) ball.vx *= -1;
      if (ball.y < 0) ball.vy *= -1;
      if (ball.y > H) { over = true; sendScore(score); showToast(`Breakout: ${score} points`, 'error'); return; }
      if (ball.y + 8 > H - 15 && ball.x > paddleX && ball.x < paddleX + 80) { ball.vy = -Math.abs(ball.vy); ball.vx += (ball.x - (paddleX + 40)) * 0.05; }
      bricks.forEach(b => { if (b.alive && ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h) { b.alive = false; ball.vy *= -1; score += 10; } });
      if (bricks.every(b => !b.alive)) { over = true; sendScore(score); showToast(`Breakout: Perfect! ${score} pts`, 'success'); return; }
      ctx.fillStyle = '#0a0a2e'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffcc00'; ctx.fillRect(paddleX, H - 15, 80, 12);
      bricks.forEach(b => { if (b.alive) { ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h); } });
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Orbitron,sans-serif'; ctx.fillText(`Score: ${score}`, 8, 18);
    }
    const mHandler = (e) => { const rect = cvs.getBoundingClientRect(); paddleX = Math.max(0, Math.min(W - 80, (e.clientX - rect.left) * (W / rect.width) - 40)); };
    cvs.addEventListener('pointermove', mHandler);
    const loop = setInterval(tick, 1000 / 60);
    return () => { clearInterval(loop); cvs.removeEventListener('pointermove', mHandler); };
  }

  // ==================== 6. SPACE INVADERS ====================
  function gameSpaceInvaders(area, sendScore) {
    const W = 360, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border)';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let shipX = W / 2, bullets = [], score = 0, over = false;
    let aliens = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) aliens.push({ x: 30 + c * 38, y: 30 + r * 32, alive: true });
    let alienDir = 1, alienSpeed = 0.5, alienDropTimer = 0;
    let keys = {};
    const kDown = (e) => { keys[e.code] = true; if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); };
    const kUp = (e) => { keys[e.code] = false; };
    document.addEventListener('keydown', kDown);
    document.addEventListener('keyup', kUp);
    let shootCD = 0;
    function tick() {
      if (over) return;
      if (keys['ArrowLeft']) shipX = Math.max(15, shipX - 4);
      if (keys['ArrowRight']) shipX = Math.min(W - 15, shipX + 4);
      if (keys['Space'] && shootCD <= 0) { bullets.push({ x: shipX, y: H - 40 }); shootCD = 15; }
      shootCD--;
      bullets.forEach(b => b.y -= 6);
      bullets = bullets.filter(b => b.y > 0);
      let moveDown = false;
      aliens.forEach(a => { if (!a.alive) return; a.x += alienDir * alienSpeed; if (a.x > W - 20 || a.x < 20) moveDown = true; });
      if (moveDown) { alienDir *= -1; aliens.forEach(a => a.y += 12); }
      bullets.forEach(b => { aliens.forEach(a => { if (a.alive && Math.abs(b.x - a.x) < 14 && Math.abs(b.y - a.y) < 10) { a.alive = false; b.y = -100; score += 25; } }); });
      if (aliens.every(a => !a.alive)) { over = true; sendScore(score); showToast(`Space Invaders: Perfect! ${score} pts`, 'success'); return; }
      if (aliens.some(a => a.alive && a.y > H - 60)) { over = true; sendScore(score); showToast(`Space Invaders: ${score} pts`, 'error'); return; }
      ctx.fillStyle = '#000011'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#00ff88'; ctx.beginPath(); ctx.moveTo(shipX, H - 45); ctx.lineTo(shipX - 12, H - 25); ctx.lineTo(shipX + 12, H - 25); ctx.fill();
      ctx.fillStyle = '#ffff00'; bullets.forEach(b => { ctx.fillRect(b.x - 2, b.y, 4, 10); });
      ctx.fillStyle = '#ff4444'; aliens.forEach(a => { if (a.alive) { ctx.fillRect(a.x - 12, a.y - 8, 24, 16); ctx.fillStyle = '#fff'; ctx.fillRect(a.x - 6, a.y - 4, 4, 4); ctx.fillRect(a.x + 2, a.y - 4, 4, 4); ctx.fillStyle = '#ff4444'; } });
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Orbitron,sans-serif'; ctx.fillText(`Score: ${score}`, 8, 18);
    }
    const loop = setInterval(tick, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kDown); document.removeEventListener('keyup', kUp); };
  }

  // ==================== 7. WHACK A MOLE ====================
  function gameWhackAMole(area, sendScore) {
    let score = 0, timeLeft = 30, active = -1;
    function render() {
      let html = `<p style="text-align:center;color:var(--text2);margin-bottom:0.5rem">Score: <b style="color:var(--accent)">${score}</b> | Time: <b style="color:${timeLeft < 10 ? 'var(--red)' : 'var(--green)'}">${timeLeft}s</b></p>`;
      html += '<div style="display:inline-grid;grid-template-columns:repeat(3,80px);gap:10px;margin:0 auto;display:block;width:fit-content">';
      for (let i = 0; i < 9; i++) {
        const up = i === active;
        html += `<div style="width:80px;height:80px;border-radius:50%;background:${up ? '#4a3520' : '#2a1a10'};border:3px solid ${up ? '#8B4513' : '#5a3a20'};display:flex;align-items:center;justify-content:center;font-size:2rem;cursor:${up ? 'pointer' : 'default'};transition:all 0.15s" onclick="window.oasisWhack(${i})">${up ? '🐹' : '🕳️'}</div>`;
      }
      html += '</div>';
      area.innerHTML = html;
    }
    window.oasisWhack = (i) => { if (i === active) { score++; active = -1; render(); } };
    render();
    const moleInterval = setInterval(() => { if (timeLeft > 0) { active = Math.floor(Math.random() * 9); render(); } }, 700);
    const clearMole = setInterval(() => { active = -1; render(); }, 500);
    const timerInterval = setInterval(() => { timeLeft--; if (timeLeft <= 0) { clearInterval(moleInterval); clearInterval(timerInterval); clearInterval(clearMole); over = true; sendScore(score); showToast(`Whack-a-Mole: ${score} hits!`, score > 10 ? 'success' : 'error'); } render(); }, 1000);
    let over = false;
    return () => { clearInterval(moleInterval); clearInterval(timerInterval); clearInterval(clearMole); delete window.oasisWhack; };
  }

  // ==================== 8. MINESWEEPER ====================
  function gameMinesweeper(area, sendScore) {
    const ROWS = 10, COLS = 10, MINES = 12;
    let board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
    let revealed = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    let flagged = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    let mines = 0, over = false, started = false;
    function placeMines(safeR, safeC) {
      let placed = 0;
      while (placed < MINES) {
        const r = Math.floor(Math.random() * ROWS), c = Math.floor(Math.random() * COLS);
        if (board[r][c] === -1 || (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1)) continue;
        board[r][c] = -1; placed++;
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c] === -1) continue;
        let cnt = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === -1) cnt++; }
        board[r][c] = cnt;
      }
    }
    function reveal(r, c) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || revealed[r][c] || flagged[r][c]) return;
      revealed[r][c] = true;
      if (board[r][c] === 0) { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) reveal(r + dr, c + dc); }
    }
    function checkWin() {
      let safe = 0, rev = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { if (board[r][c] !== -1) safe++; if (revealed[r][c] && board[r][c] !== -1) rev++; }
      return safe === rev;
    }
    const numColors = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000', '#808080'];
    function render() {
      let html = `<p style="text-align:center;color:var(--text2);margin-bottom:0.5rem">Mines: ${MINES} | Revealed: ${revealed.flat().filter(Boolean).length}</p>`;
      html += '<div style="display:inline-grid;grid-template-columns:repeat(10,30px);gap:2px;margin:0 auto;display:block;width:fit-content">';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (revealed[r][c]) {
          const v = board[r][c];
          html += `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;font:bold 14px sans-serif;background:${v === -1 ? '#ff4444' : '#ddd'};color:${numColors[v] || '#000'};border-radius:3px">${v === -1 ? '💣' : (v || '')}</div>`;
        } else {
          html += `<div style="width:30px;height:30px;background:#888;border-radius:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px" onclick="window.oasisMSReveal(${r},${c})" oncontextmenu="event.preventDefault();window.oasisMSFlag(${r},${c})">${flagged[r][c] ? '🚩' : ''}</div>`;
        }
      }
      html += '</div>';
      html += '<p style="text-align:center;color:var(--text-muted);margin-top:0.8rem;font-size:0.8rem">Click to reveal | Right-click to flag</p>';
      area.innerHTML = html;
    }
    window.oasisMSReveal = (r, c) => {
      if (over || revealed[r][c] || flagged[r][c]) return;
      if (!started) { placeMines(r, c); started = true; }
      if (board[r][c] === -1) { over = true; for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) revealed[i][j] = true; render(); sendScore(0); showToast('Boom! Hit a mine!', 'error'); return; }
      reveal(r, c);
      if (checkWin()) { over = true; const pts = revealed.flat().filter(Boolean).length; render(); sendScore(pts); showToast(`Minesweeper cleared! ${pts} pts`, 'success'); return; }
      render();
    };
    window.oasisMSFlag = (r, c) => { if (!over && !revealed[r][c]) { flagged[r][c] = !flagged[r][c]; render(); } };
    render();
    return () => { delete window.oasisMSReveal; delete window.oasisMSFlag; };
  }

  // ==================== 9. TETRIS ====================
  function gameTetris(area, sendScore) {
    const ROWS = 18, COLS = 10;
    let board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    let score = 0, lines = 0, over = false;
    const SHAPES = { I: [[1,1,1,1]], O: [[1,1],[1,1]], T: [[0,1,0],[1,1,1]], S: [[0,1,1],[1,1,0]], Z: [[1,1,0],[0,1,1]], J: [[1,0,0],[1,1,1]], L: [[0,0,1],[1,1,1]] };
    let shape, sx, sy;
    function newPiece() {
      const keys = Object.keys(SHAPES);
      shape = SHAPES[keys[Math.floor(Math.random() * keys.length)]];
      sx = Math.floor((COLS - shape[0].length) / 2); sy = 0;
      if (!canPlace(shape, sx, sy)) { over = true; sendScore(lines); showToast(`Tetris: ${lines} lines`, 'error'); }
    }
    function canPlace(s, px, py) { for (let r = 0; r < s.length; r++) for (let c = 0; c < s[r].length; c++) { if (s[r][c]) { const nx = px + c, ny = py + r; if (nx < 0 || nx >= COLS || ny >= ROWS) return false; if (ny >= 0 && board[ny][nx]) return false; } } return true; }
    function place() {
      for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) if (shape[r][c] && sy + r >= 0) board[sy + r][sx + c] = 1;
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) { if (board[r].every(c => c)) { board.splice(r, 1); board.unshift(Array(COLS).fill(0)); cleared++; r++; } }
      if (cleared) { lines += cleared; score += cleared * cleared * 100; }
      newPiece();
    }
    function render() {
      const show = board.map(r => [...r]);
      if (shape) for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) if (shape[r][c] && sy + r >= 0 && sy + r < ROWS) show[sy + r][sx + c] = 2;
      let html = `<p style="text-align:center;color:var(--text2);margin-bottom:0.3rem">Lines: <b style="color:var(--accent)">${lines}</b> | Score: <b style="color:var(--accent)">${score}</b></p>`;
      html += '<div style="display:inline-grid;grid-template-columns:repeat(10,24px);gap:1px;background:var(--bg3);padding:3px;border:1px solid var(--border);border-radius:4px;margin:0 auto;display:block;width:fit-content">';
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const v = show[r][c]; html += `<div style="width:24px;height:24px;border-radius:2px;background:${v === 2 ? 'var(--accent)' : v ? '#4488ff' : 'var(--surface)'}"></div>`; }
      html += '</div>';
      html += '<div style="text-align:center;margin-top:0.8rem;display:flex;justify-content:center;gap:0.4rem">';
      html += '<button class="btn-secondary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'left\')">◀</button>';
      html += '<button class="btn-primary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'rotate\')">↻</button>';
      html += '<button class="btn-secondary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'right\')">▶</button>';
      html += '<button class="btn-primary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'drop\')">DROP</button>';
      html += '</div>';
      area.innerHTML = html;
    }
    window.oasisTetrisMove = (a) => {
      if (over) return;
      if (a === 'left' && canPlace(shape, sx - 1, sy)) sx--;
      else if (a === 'right' && canPlace(shape, sx + 1, sy)) sx++;
      else if (a === 'rotate') { const rot = shape[0].map((_, i) => shape.map(row => row[i]).reverse()); if (canPlace(rot, sx, sy)) shape = rot; }
      else if (a === 'drop') { while (canPlace(shape, sx, sy + 1, board)) sy++; place(); }
      render();
    };
    const kHandler = (e) => { const m = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'rotate', ArrowDown: 'drop' }; if (m[e.key]) { e.preventDefault(); window.oasisTetrisMove(m[e.key]); } };
    document.addEventListener('keydown', kHandler);
    newPiece(); render();
    const dropLoop = setInterval(() => { if (!over) { if (canPlace(shape, sx, sy + 1)) sy++; else place(); render(); } }, 800);
    return () => { clearInterval(dropLoop); document.removeEventListener('keydown', kHandler); delete window.oasisTetrisMove; };
  }

  // ==================== 10. BUBBLE SHOOTER ====================
  function gameBubbleShooter(area, sendScore) {
    const W = 360, H = 500;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border)';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS = 8, R = 18, ROWS_TOP = 6;
    const COLORS = ['#ff4444', '#44ff44', '#4444ff', '#ffcc00', '#ff44ff'];
    let grid = [], score = 0, over = false;
    for (let r = 0; r < ROWS_TOP; r++) { const row = []; for (let c = 0; c < COLS; c++) row.push(COLORS[Math.floor(Math.random() * COLORS.length)]); grid.push(row); }
    let aimX = W / 2, aimY = H, shooter = { color: COLORS[Math.floor(Math.random() * COLORS.length)], next: COLORS[Math.floor(Math.random() * COLORS.length)] };
    let flying = null;

    function getPos(r, c) { const x = c * R * 2 + R + (r % 2 ? R : 0); const y = r * R * 1.73 + R; return { x, y }; }

    function shoot() {
      if (flying || over) return;
      const dx = aimX - W / 2, dy = aimY - H;
      const len = Math.sqrt(dx * dx + dy * dy);
      flying = { x: W / 2, y: H, vx: dx / len * 8, vy: dy / len * 8, color: shooter.color };
      shooter.color = shooter.next;
      shooter.next = COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    function tick() {
      if (over || !flying) return;
      flying.x += flying.vx; flying.y += flying.vy;
      if (flying.x < R || flying.x > W - R) flying.vx *= -1;
      if (flying.y < R) { land(flying); flying = null; return; }
      grid.forEach((row, r) => row.forEach((cell, c) => {
        if (!cell || !flying) return;
        const p = getPos(r, c);
        if (Math.hypot(flying.x - p.x, flying.y - p.y) < R * 1.8) { land(flying); flying = null; }
      }));
    }

    function land(b) {
      let bestR = 0, bestC = 0, bestD = Infinity;
      grid.forEach((row, r) => row.forEach((cell, c) => {
        if (cell) return;
        const p = getPos(r, c);
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < bestD) { bestD = d; bestR = r; bestC = c; }
      }));
      while (grid.length <= bestR) grid.push(Array(COLS).fill(null));
      grid[bestR][bestC] = b.color;
      checkMatches(bestR, bestC, b.color);
      if (grid.flat().filter(Boolean).length === 0) { over = true; score += 500; sendScore(score); showToast(`Bubble Shooter: Perfect clear! ${score} pts`, 'success'); }
    }

    function checkMatches(r, c, color) {
      const matches = [];
      const visited = new Set();
      function flood(cr, cc) {
        const key = `${cr},${cc}`;
        if (visited.has(key) || cr < 0 || cr >= grid.length || cc < 0 || cc >= COLS) return;
        if (grid[cr]?.[cc] !== color) return;
        visited.add(key);
        matches.push([cr, cc]);
        flood(cr - 1, cc); flood(cr + 1, cc); flood(cr, cc - 1); flood(cr, cc + 1);
      }
      flood(r, c);
      if (matches.length >= 3) { score += matches.length * 50; matches.forEach(([mr, mc]) => { if (grid[mr]) grid[mr][mc] = null; }); }
    }

    cvs.addEventListener('pointermove', (e) => { const rect = cvs.getBoundingClientRect(); aimX = (e.clientX - rect.left) * (W / rect.width); });
    cvs.addEventListener('pointerup', shoot);

    function render() {
      ctx.fillStyle = '#0a0a2e'; ctx.fillRect(0, 0, W, H);
      grid.forEach((row, r) => row.forEach((cell, c) => {
        if (!cell) return;
        const p = getPos(r, c);
        ctx.fillStyle = cell; ctx.beginPath(); ctx.arc(p.x, p.y, R - 2, 0, Math.PI * 2); ctx.fill();
      }));
      if (flying) { ctx.fillStyle = flying.color; ctx.beginPath(); ctx.arc(flying.x, flying.y, R - 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = shooter.color; ctx.beginPath(); ctx.arc(W / 2, H - 20, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#555'; ctx.fillRect(W / 2 - 2, H - 60, 4, 40);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Orbitron,sans-serif'; ctx.fillText(`Score: ${score}`, 8, 18);
    }

    const loop = setInterval(() => { tick(); render(); }, 1000 / 60);
    return () => clearInterval(loop);
  }

  // ==================== 11. DOODLE JUMP ====================
  function gameDoodleJump(area, sendScore) {
    const W = 320, H = 480;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border)';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let duder = { x: W / 2, y: H - 60, vx: 0 }, platforms = [], score = 0, over = false, maxHeight = 0;
    for (let i = 0; i < 8; i++) platforms.push({ x: Math.random() * (W - 50), y: H - 60 - i * 60, w: 55, type: Math.random() < 0.15 ? 'moving' : 'static' });
    let keys = {};
    const kDown = (e) => { keys[e.code] = true; };
    const kUp = (e) => { keys[e.code] = false; };
    document.addEventListener('keydown', kDown);
    document.addEventListener('keyup', kUp);

    let jumpVy = -10;
    duder.vy = jumpVy;

    function tick() {
      if (over) return;
      if (keys['ArrowLeft'] || keys['KeyA']) duder.vx = -4;
      else if (keys['ArrowRight'] || keys['KeyD']) duder.vx = 4;
      else duder.vx *= 0.9;

      duder.x += duder.vx;
      duder.vy += 0.4;
      duder.y += duder.vy;

      if (duder.x < 0) duder.x = W;
      if (duder.x > W) duder.x = 0;

      platforms.forEach(p => { if (p.type === 'moving') p.x += (Math.sin(Date.now() / 500 + p.y) * 1.5); });

      if (duder.vy > 0) {
        platforms.forEach(p => {
          if (duder.x + 20 > p.x && duder.x < p.x + p.w && duder.y + 30 > p.y && duder.y + 30 < p.y + 15) {
            duder.vy = jumpVy;
          }
        });
      }

      const scrollThreshold = H * 0.4;
      if (duder.y < scrollThreshold) {
        const diff = scrollThreshold - duder.y;
        duder.y = scrollThreshold;
        platforms.forEach(p => p.y += diff);
        score += Math.floor(diff);
      }

      platforms = platforms.filter(p => p.y < H + 50);
      while (platforms.length < 8) {
        const topY = Math.min(...platforms.map(p => p.y));
        platforms.push({ x: Math.random() * (W - 50), y: topY - 50 - Math.random() * 30, w: 55, type: Math.random() < 0.15 ? 'moving' : 'static' });
      }

      if (duder.y > H) { over = true; sendScore(score); showToast(`Doodle Jump: ${score} height!`, 'success'); }

      ctx.fillStyle = '#e8f4e8'; ctx.fillRect(0, 0, W, H);
      platforms.forEach(p => { ctx.fillStyle = p.type === 'moving' ? '#ff8844' : '#44aa44'; ctx.fillRect(p.x, p.y, p.w, 10); });
      ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(duder.x + 10, duder.y + 10, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(duder.x + 6, duder.y + 7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(duder.x + 14, duder.y + 7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#333'; ctx.font = 'bold 14px Orbitron,sans-serif'; ctx.fillText(`Height: ${score}`, 8, 18);
    }
    const loop = setInterval(tick, 1000 / 60);
    return () => { clearInterval(loop); document.removeEventListener('keydown', kDown); document.removeEventListener('keyup', kUp); };
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
    const gameNames = { 'tic-tac-toe': '⭕ Tic Tac Toe', 'rps': '✊ Rock Paper Scissors', 'higher-lower': '🃏 Higher or Lower', 'dice-duel': '🎲 Dice Duel', 'memory-match': '🧠 Memory Match', 'math-rush': '🔢 Math Rush' };
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
    el.innerHTML = d.leaderboard.map((p, i) => `
      <div class="lb-item ${i < 3 ? 'top3' : ''}">
        <div class="lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div>
        <div class="lb-name">${p.username}</div>
        <div class="lb-wins">${p.wins} wins</div>
        <div class="lb-earnings">R${p.earnings.toLocaleString()}</div>
      </div>
    `).join('');
  }

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
