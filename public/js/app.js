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
      'helicopter': () => gameHelicopter(gameArea, sendScore),
      'geometry-dash': () => gameGeometryDash(gameArea, sendScore),
      'crossy-road': () => gameCrossyRoad(gameArea, sendScore),
    };
    if (games[gameId]) gameCleanup = games[gameId]();
  }


  // ==================== 1. PAC-MAN ====================
  function gamePacMan(area, sendScore) {
    const W = 300, H = 320, TS = 20;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const MAP = [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
      [1,2,1,1,0,1,0,1,0,1,0,1,1,2,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,0,1,1,0,1,0,1,1,0,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,0,1,0,1,1,1,1,1,0,1,0,1,1],
      [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
      [1,0,1,1,1,0,0,1,0,0,1,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,0,1,0,1,1,1,0,1,0,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
    ];
    const ROWS = MAP.length, COLS = MAP[0].length;
    let grid = MAP.map(r => [...r]);
    let totalDots = 0, eaten = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] === 0 || grid[r][c] === 2) totalDots++;
    let pac = { x: 1, y: 1, dir: {x:0,y:0}, nextDir: {x:0,y:0}, mouth: 0, md: 1 };
    let ghosts = [
      { x:7, y:1, color:'#ff0000', scared:false },
      { x:7, y:5, color:'#ffb8ff', scared:false },
      { x:6, y:1, color:'#00ffff', scared:false },
      { x:8, y:1, color:'#ffb851', scared:false }
    ];
    let score = 0, over = false, powerTimer = 0, frame = 0, moveTick = 0;
    const canGo = (x,y) => x>=0 && x<COLS && y>=0 && y<ROWS && grid[y][x]!==1;
    const setDir = (dx,dy) => { pac.nextDir = {x:dx,y:dy}; };
    const kH = (e) => {
      if(e.code==='ArrowLeft'||e.code==='KeyA') setDir(-1,0);
      else if(e.code==='ArrowRight'||e.code==='KeyD') setDir(1,0);
      else if(e.code==='ArrowUp'||e.code==='KeyW') setDir(0,-1);
      else if(e.code==='ArrowDown'||e.code==='KeyS') setDir(0,1);
    };
    document.addEventListener('keydown', kH);
    let tsx=0,tsy=0;
    const tS = (e)=>{tsx=e.touches[0].clientX;tsy=e.touches[0].clientY;};
    const tE = (e)=>{const dx=e.changedTouches[0].clientX-tsx,dy=e.changedTouches[0].clientY-tsy;if(Math.abs(dx)>Math.abs(dy))setDir(dx>0?1:-1,0);else setDir(0,dy>0?1:-1);};
    cvs.addEventListener('touchstart',tS,{passive:true});
    cvs.addEventListener('touchend',tE,{passive:true});
    const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    const moveGhost = (g) => {
      const opp = {x:-g._dx||0,y:-g._dy||0};
      const valid = dirs.filter(d=>!(d.x===opp.x&&d.y===opp.y)&&canGo(g.x+d.x,g.y+d.y));
      if(!valid.length) return;
      if(g.scared){g.dir=valid[Math.floor(Math.random()*valid.length)];}
      else{let best=valid[0],bd=Infinity;for(const d of valid){const dist=(pac.x-g.x-d.x)**2+(pac.y-g.y-d.y)**2;if(dist<bd){bd=dist;best=d;}}g.dir=best;}
      g._dx=g.dir.x;g._dy=g.dir.y;g.x+=g.dir.x;g.y+=g.dir.y;
      if(g.x<0)g.x=COLS-1;if(g.x>=COLS)g.x=0;
    };
    const loop = setInterval(()=>{
      if(over)return;frame++;moveTick++;
      if(moveTick>=8){
        moveTick=0;
        if(canGo(pac.x+pac.nextDir.x,pac.y+pac.nextDir.y))pac.dir={...pac.nextDir};
        if(canGo(pac.x+pac.dir.x,pac.y+pac.dir.y)){pac.x+=pac.dir.x;pac.y+=pac.dir.y;}
        if(grid[pac.y][pac.x]===2){powerTimer=300;ghosts.forEach(g=>g.scared=true);}
        if(grid[pac.y][pac.x]===0||grid[pac.y][pac.x]===2){grid[pac.y][pac.x]=-1;score+=10;eaten++;}
        if(eaten>=totalDots){over=true;clearInterval(loop);sendScore(score);return;}
        for(const g of ghosts){
          moveGhost(g);
          if(g.x===pac.x&&g.y===pac.y){
            if(g.scared){score+=200;g.x=7;g.y=1;g.scared=false;}
            else{over=true;clearInterval(loop);sendScore(score);return;}
          }
        }
      }
      if(powerTimer>0){powerTimer--;if(powerTimer===0)ghosts.forEach(g=>g.scared=false);}
      pac.mouth+=pac.md*0.3;if(pac.mouth>0.8||pac.mouth<0)pac.md*=-1;
      ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
        if(grid[r][c]===1){ctx.fillStyle='#1a1aff';ctx.fillRect(c*TS,r*TS,TS,TS);ctx.fillStyle='#0000aa';ctx.fillRect(c*TS+2,r*TS+2,TS-4,TS-4);}
        else if(grid[r][c]===0){ctx.fillStyle='#ffcc00';ctx.beginPath();ctx.arc(c*TS+TS/2,r*TS+TS/2,3,0,Math.PI*2);ctx.fill();}
        else if(grid[r][c]===2){ctx.fillStyle='#ffcc00';ctx.beginPath();ctx.arc(c*TS+TS/2,r*TS+TS/2,6,0,Math.PI*2);ctx.fill();}
      }
      const px=pac.x*TS+TS/2,py=pac.y*TS+TS/2,ang=Math.atan2(pac.dir.y,pac.dir.x);
      ctx.fillStyle='#ffff00';ctx.beginPath();ctx.arc(px,py,TS/2-2,ang+pac.mouth,ang+Math.PI*2-pac.mouth);ctx.lineTo(px,py);ctx.fill();
      for(const g of ghosts){
        ctx.fillStyle=g.scared?(powerTimer<60&&frame%10<5?'#fff':'#2121de'):g.color;
        ctx.beginPath();ctx.arc(g.x*TS+TS/2,g.y*TS+TS/2,TS/2-2,0,Math.PI*2);ctx.fill();
        if(!g.scared){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(g.x*TS+6,g.y*TS+8,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(g.x*TS+14,g.y*TS+8,3,0,Math.PI*2);ctx.fill();}
      }
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kH);};
  }

  // ==================== 2. FROGGER ====================
  function gameFrogger(area, sendScore) {
    const W = 320, H = 400, RH = 40;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let frog = {x:W/2-10,y:H-RH,w:20,h:20}, score=0, over=false, lives=3, frame=0;
    const lanes = [];
    for(let i=0;i<5;i++){
      const cars=[];const n=2+Math.floor(Math.random()*2);
      for(let j=0;j<n;j++)cars.push({x:Math.random()*W,w:25+Math.random()*25});
      lanes.push({y:H-RH*(i+2),speed:(1.5+Math.random()*2)*(i%2===0?1:-1),cars,road:true});
    }
    for(let i=0;i<5;i++){
      const logs=[];const n=2+Math.floor(Math.random()*2);
      for(let j=0;j<n;j++)logs.push({x:Math.random()*W,w:40+Math.random()*60});
      lanes.push({y:RH*(i+1),speed:(0.8+Math.random()*1.5)*(i%2===0?-1:1),logs,river:true});
    }
    const move=(dx,dy)=>{if(over)return;frog.x=Math.max(0,Math.min(W-frog.w,frog.x+dx));frog.y=Math.max(0,Math.min(H-frog.h,frog.y+dy));if(frog.y<=0){score+=100;frog.y=H-RH;frog.x=W/2-10;}};
    const kH=(e)=>{if(e.code==='ArrowLeft')move(-20,0);else if(e.code==='ArrowRight')move(20,0);else if(e.code==='ArrowUp')move(0,-RH);else if(e.code==='ArrowDown')move(0,RH);};
    document.addEventListener('keydown',kH);
    let tsx=0,tsy=0;
    cvs.addEventListener('touchstart',(e)=>{tsx=e.touches[0].clientX;tsy=e.touches[0].clientY;},{passive:true});
    cvs.addEventListener('touchend',(e)=>{const dx=e.changedTouches[0].clientX-tsx,dy=e.changedTouches[0].clientY-tsy;if(Math.abs(dx)>Math.abs(dy))move(dx>0?20:-20,0);else move(0,dy>0?RH:-RH);},{passive:true});
    const die=()=>{lives--;if(lives<=0){over=true;clearInterval(loop);sendScore(score);}else{frog.x=W/2-10;frog.y=H-RH;}};
    const loop=setInterval(()=>{
      if(over)return;frame++;
      for(const l of lanes){
        const items=l.cars||l.logs;if(!items)continue;
        for(const it of items){it.x+=l.speed;if(l.speed>0&&it.x>W+60)it.x=-it.w-20;if(l.speed<0&&it.x<-60)it.x=W+20;}
      }
      if(frog.y>0){
        for(const l of lanes){
          if(l.river&&frog.y===l.y){let onLog=false;for(const log of l.logs){if(frog.x+frog.w>log.x&&frog.x<log.x+log.w){frog.x+=l.speed;frog.x=Math.max(0,Math.min(W-frog.w,frog.x));onLog=true;}}if(!onLog){die();return;}}
          if(l.road&&frog.y===l.y){for(const car of l.cars){if(frog.x+frog.w>car.x&&frog.x<car.x+car.w){die();return;}}}
        }
      }
      ctx.fillStyle='#0a3a0a';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#333';ctx.fillRect(0,H-RH,W,RH);
      for(const l of lanes){
        if(l.road){ctx.fillStyle='#333';ctx.fillRect(0,l.y,W,RH);for(const c of l.cars){ctx.fillStyle=['#e74c3c','#3498db','#f1c40f','#2ecc71'][Math.floor(Math.random()*0.02)%4];ctx.fillRect(c.x,l.y+5,c.w,RH-10);ctx.fillStyle='#fff';ctx.fillRect(c.x+c.w-6,l.y+10,4,8);}}
        if(l.river){ctx.fillStyle='#1a3a6a';ctx.fillRect(0,l.y,W,RH);for(const log of l.logs){ctx.fillStyle='#8B4513';ctx.fillRect(log.x,l.y+5,log.w,RH-10);ctx.fillStyle='#A0522D';ctx.fillRect(log.x+2,l.y+8,log.w-4,RH-16);}}
      }
      ctx.fillStyle='#2ecc40';ctx.fillRect(frog.x,frog.y,frog.w,frog.h);
      ctx.fillStyle='#1a8a3a';ctx.fillRect(frog.x+3,frog.y+3,frog.w-6,frog.h-6);
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(frog.x+5,frog.y+5,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(frog.x+15,frog.y+5,2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score+'  Lives: '+lives,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kH);};
  }

  // ==================== 3. ASTEROIDS ====================
  function gameAsteroids(area, sendScore) {
    const W = 360, H = 400;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let ship={x:W/2,y:H/2,angle:0,vx:0,vy:0}, bullets=[], rocks=[], score=0, over=false, lives=3, frame=0;
    const spawnRock=(x,y,s)=>{rocks.push({x:x??Math.random()*W,y:y??Math.random()*H,vx:(Math.random()-0.5)*(s===3?2:4),vy:(Math.random()-0.5)*(s===3?2:4),s:s||3,r:s===3?20:s===2?12:6});};
    for(let i=0;i<5;i++)spawnRock();
    const keys={};
    const kD=(e)=>{keys[e.code]=true;if(['ArrowUp','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();};
    const kU=(e)=>{keys[e.code]=false;};
    document.addEventListener('keydown',kD);document.addEventListener('keyup',kU);
    let shootCD=0,invuln=0;
    const loop=setInterval(()=>{
      if(over)return;frame++;
      if(keys['ArrowLeft'])ship.angle-=0.07;
      if(keys['ArrowRight'])ship.angle+=0.07;
      if(keys['ArrowUp']){ship.vx+=Math.cos(ship.angle)*0.15;ship.vy+=Math.sin(ship.angle)*0.15;}
      ship.vx*=0.98;ship.vy*=0.98;ship.x+=ship.vx;ship.y+=ship.vy;
      if(ship.x<0)ship.x=W;if(ship.x>W)ship.x=0;if(ship.y<0)ship.y=H;if(ship.y>H)ship.y=0;
      if(keys['Space']&&shootCD<=0){bullets.push({x:ship.x+Math.cos(ship.angle)*15,y:ship.y+Math.sin(ship.angle)*15,vx:Math.cos(ship.angle)*6,vy:Math.sin(ship.angle)*6,life:60});shootCD=12;}
      shootCD--;
      bullets.forEach(b=>{b.x+=b.vx;b.y+=b.vy;b.life--;});bullets=bullets.filter(b=>b.life>0);
      for(let i=rocks.length-1;i>=0;i--){
        const r=rocks[i];r.x+=r.vx;r.y+=r.vy;
        if(r.x<-30)r.x=W+30;if(r.x>W+30)r.x=-30;if(r.y<-30)r.y=H+30;if(r.y>H+30)r.y=-30;
        for(let j=bullets.length-1;j>=0;j--){
          const b=bullets[j];
          if(Math.hypot(b.x-r.x,b.y-r.y)<r.r+4){
            bullets.splice(j,1);score+=(4-r.s)*25;
            if(r.s>1){spawnRock(r.x,r.y,r.s-1);spawnRock(r.x,r.y,r.s-1);}
            rocks.splice(i,1);break;
          }
        }
      }
      if(invuln<=0){
        for(const r of rocks){if(Math.hypot(ship.x-r.x,ship.y-r.y)<r.r+12){lives--;invuln=90;if(lives<=0){over=true;clearInterval(loop);sendScore(score);return;}ship.x=W/2;ship.y=H/2;ship.vx=0;ship.vy=0;break;}}
      }else invuln--;
      if(rocks.length===0){for(let i=0;i<5;i++)spawnRock();}
      ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      for(const b of bullets){ctx.fillStyle='#ffff00';ctx.fillRect(b.x-1,b.y-1,3,3);}
      ctx.strokeStyle='#aaa';ctx.lineWidth=2;
      for(const r of rocks){ctx.beginPath();for(let a=0;a<7;a++){const ang=a*Math.PI*2/7;const rr=r.r*(0.8+Math.random()*0.4);ctx.lineTo(r.x+Math.cos(ang)*rr,r.y+Math.sin(ang)*rr);}ctx.closePath();ctx.stroke();}
      if(invuln<=0||frame%6<3){
        ctx.save();ctx.translate(ship.x,ship.y);ctx.rotate(ship.angle);
        ctx.strokeStyle='#00ff88';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(15,0);ctx.lineTo(-10,-10);ctx.lineTo(-6,0);ctx.lineTo(-10,10);ctx.closePath();ctx.stroke();
        if(keys['ArrowUp']){ctx.strokeStyle='#ff4400';ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(-14-Math.random()*6,0);ctx.stroke();}
        ctx.restore();
      }
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score+'  Lives: '+lives,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kD);document.removeEventListener('keyup',kU);};
  }

  // ==================== 4. GALAGA ====================
  function gameGalaga(area, sendScore) {
    const W = 360, H = 440;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let shipX=W/2, bullets=[], eBullets=[], score=0, over=false, lives=3, frame=0;
    let aliens=[];
    const formationColors=['#ff4444','#ffaa00','#44ff44','#44aaff'];
    for(let r=0;r<4;r++)for(let c=0;c<8;c++)aliens.push({x:40+c*38,y:30+r*30,alive:true,row:r,phase:0,px:0,py:0});
    let alienDir=1,alienTimer=0,shootTimer=0;
    const keys={};
    const kD=(e)=>{keys[e.code]=true;if(['ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();};
    const kU=(e)=>{keys[e.code]=false;};
    document.addEventListener('keydown',kD);document.addEventListener('keyup',kU);
    let shootCD=0;
    const loop=setInterval(()=>{
      if(over)return;frame++;
      if(keys['ArrowLeft'])shipX=Math.max(15,shipX-4);
      if(keys['ArrowRight'])shipX=Math.min(W-15,shipX+4);
      if(keys['Space']&&shootCD<=0){bullets.push({x:shipX,y:H-30});shootCD=18;}
      shootCD--;
      bullets.forEach(b=>b.y-=7);bullets=bullets.filter(b=>b.y>0);
      alienTimer++;
      if(alienTimer>=45){
        alienTimer=0;
        let moveDown=false;
        aliens.forEach(a=>{if(a.alive){a.x+=alienDir*18;if(a.x>W-20||a.x<20)moveDown=true;}});
        if(moveDown){alienDir*=-1;aliens.forEach(a=>{if(a.alive)a.y+=15;});}
      }
      shootTimer++;
      if(shootTimer>=40){shootTimer=0;const alive=aliens.filter(a=>a.alive);if(alive.length){const shooter=alive[Math.floor(Math.random()*alive.length)];eBullets.push({x:shooter.x,y:shooter.y+10,vy:4+Math.random()*2});}}
      eBullets.forEach(b=>b.y+=b.vy);eBullets=eBullets.filter(b=>b.y<H);
      for(let j=bullets.length-1;j>=0;j--){
        for(const a of aliens){
          if(a.alive&&Math.abs(bullets[j].x-a.x)<14&&Math.abs(bullets[j].y-a.y)<10){
            a.alive=false;bullets.splice(j,1);score+=(4-a.row)*50+100;break;
          }
        }
      }
      for(let j=eBullets.length-1;j>=0;j--){
        if(Math.abs(eBullets[j].x-shipX)<12&&Math.abs(eBullets[j].y-H+30)<12){
          eBullets.splice(j,1);lives--;if(lives<=0){over=true;clearInterval(loop);sendScore(score);return;}
        }
      }
      if(aliens.every(a=>!a.alive)){for(let r=0;r<4;r++)for(let c=0;c<8;c++)aliens.push({x:40+c*38,y:30+r*30,alive:true,row:r,phase:0});}
      if(aliens.some(a=>a.alive&&a.y>H-60)){over=true;clearInterval(loop);sendScore(score);return;}
      ctx.fillStyle='#000011';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#00ff88';ctx.beginPath();ctx.moveTo(shipX,H-40);ctx.lineTo(shipX-10,H-22);ctx.lineTo(shipX+10,H-22);ctx.fill();
      ctx.fillStyle='#ffff00';bullets.forEach(b=>{ctx.fillRect(b.x-1,b.y,2,8);});
      ctx.fillStyle='#ff6666';eBullets.forEach(b=>{ctx.fillRect(b.x-1,b.y,2,8);});
      aliens.forEach(a=>{if(a.alive){ctx.fillStyle=formationColors[a.row]||'#fff';ctx.fillRect(a.x-8,a.y-6,16,12);ctx.fillStyle='#fff';ctx.fillRect(a.x-4,a.y-3,3,3);ctx.fillRect(a.x+2,a.y-3,3,3);}});
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score+'  Lives: '+lives,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kD);document.removeEventListener('keyup',kU);};
  }

  // ==================== 5. CENTIPEDE ====================
  function gameCentipede(area, sendScore) {
    const W = 360, H = 400, CS = 18;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const COLS=Math.floor(W/CS),ROWS=Math.floor(H/CS);
    let ship={x:Math.floor(COLS/2),y:ROWS-2}, bullets=[], score=0, over=false, frame=0;
    let centipede=[];for(let i=0;i<12;i++)centipede.push({x:5+i,y:0,alive:true,dir:1});
    let mushrooms=[];for(let i=0;i<15;i++)mushrooms.push({x:Math.floor(Math.random()*COLS),y:Math.floor(Math.random()*(ROWS-3)),hp:4});
    let segDir=1,segTimer=0;
    const keys={};
    const kD=(e)=>{keys[e.code]=true;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();};
    const kU=(e)=>{keys[e.code]=false;};
    document.addEventListener('keydown',kD);document.addEventListener('keyup',kU);
    const loop=setInterval(()=>{
      if(over)return;frame++;
      if(keys['ArrowLeft'])ship.x=Math.max(0,ship.x-1);
      if(keys['ArrowRight'])ship.x=Math.min(COLS-1,ship.x+1);
      if(keys['ArrowUp'])ship.y=Math.max(ROWS-4,ship.y-1);
      if(keys['ArrowDown'])ship.y=Math.min(ROWS-1,ship.y+1);
      if(frame%3===0&&keys['Space'])bullets.push({x:ship.x,y:ship.y-1});
      bullets.forEach(b=>b.y--);bullets=bullets.filter(b=>b.y>=0);
      segTimer++;
      if(segTimer>=8){segTimer=0;for(const s of centipede){
        if(!s.alive)continue;
        let moved=false;
        const mush=mushrooms.find(m=>m.x===s.x+segDir&&m.y===s.y);
        if(mush||s.x+segDir>=COLS||s.x+segDir<0){s.dir*=-1;}
        s.x+=s.dir;
        if(s.x>=COLS){s.x=COLS-1;s.y++;s.dir=-1;}
        if(s.x<0){s.x=0;s.y++;s.dir=1;}
        if(s.y>=ROWS-1){over=true;clearInterval(loop);sendScore(score);return;}
      }}
      for(let j=bullets.length-1;j>=0;j--){
        const b=bullets[j];
        for(const s of centipede){
          if(s.alive&&s.x===b.x&&s.y===b.y){s.alive=false;score+=10;bullets.splice(j,1);break;}
        }
        if(bullets[j]){
          const m=mushrooms.find(m=>m.x===b.x&&m.y===b.y);
          if(m){m.hp--;if(m.hp<=0){mushrooms.splice(mushrooms.indexOf(m),1);score+=5;}bullets.splice(j,1);}
        }
      }
      if(centipede.every(s=>!s.alive)){
        centipede=[];for(let i=0;i<14;i++)centipede.push({x:5+i,y:0,alive:true,dir:1});
        for(let i=0;i<3;i++)mushrooms.push({x:Math.floor(Math.random()*COLS),y:Math.floor(Math.random()*(ROWS-3)),hp:4});
      }
      ctx.fillStyle='#0a0a1a';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#8B4513';mushrooms.forEach(m=>{ctx.beginPath();ctx.arc(m.x*CS+CS/2,m.y*CS+CS/2,CS/3,0,Math.PI*2);ctx.fill();});
      ctx.fillStyle='#ff0000';for(const s of centipede){if(s.alive){ctx.beginPath();ctx.arc(s.x*CS+CS/2,s.y*CS+CS/2,CS/2-1,0,Math.PI*2);ctx.fill();}}
      ctx.fillStyle='#00ff88';ctx.beginPath();ctx.arc(ship.x*CS+CS/2,ship.y*CS+CS/2,CS/2-2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffff00';bullets.forEach(b=>{ctx.fillRect(b.x*CS+CS/2-1,b.y*CS,2,6);});
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kD);document.removeEventListener('keyup',kU);};
  }

  // ==================== 6. DEFENDER ====================
  function gameDefender(area, sendScore) {
    const W = 400, H = 300;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let ship={x:W/2,y:H-50}, bullets=[], enemies=[], humans=[], score=0, over=false, frame=0, scrollX=0;
    let lives=3, shootCD=0;
    for(let i=0;i<5;i++)humans.push({x:80+i*60,y:H-20,abducted:false,abductor:null});
    const spawnEnemy=()=>{enemies.push({x:Math.random()*W,y:Math.random()*150,vx:(Math.random()-0.5)*3,vy:1+Math.random()*2,alive:true,target:null});};
    for(let i=0;i<6;i++)spawnEnemy();
    const keys={};
    const kD=(e)=>{keys[e.code]=true;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();};
    const kU=(e)=>{keys[e.code]=false;};
    document.addEventListener('keydown',kD);document.addEventListener('keyup',kU);
    const loop=setInterval(()=>{
      if(over)return;frame++;
      if(keys['ArrowLeft'])ship.x=Math.max(15,ship.x-4);
      if(keys['ArrowRight'])ship.x=Math.min(W-15,ship.x+4);
      if(keys['ArrowUp'])ship.y=Math.max(20,ship.y-3);
      if(keys['ArrowDown'])ship.y=Math.min(H-40,ship.y+3);
      if(keys['Space']&&shootCD<=0){bullets.push({x:ship.x,y:ship.y-15,vy:-8});shootCD=10;}
      shootCD--;
      bullets.forEach(b=>b.y+=b.vy);bullets=bullets.filter(b=>b.y>-10);
      for(const e of enemies){
        if(!e.alive)continue;
        e.x+=e.vx;
        if(e.x<-20)e.x=W+20;if(e.x>W+20)e.x=-20;
        const target=humans.find(h=>!h.abducted&&!h.rescued);
        if(target&&!e.target){e.target=target;}
        if(e.target&&e.target.y<H-25){
          e.target.y-=1;e.y=e.target.y-15;e.x=e.target.x;
          if(e.target.y<H-120){e.alive=false;e.target.abducted=true;e.target=null;score+=50;}
        }else{e.y+=e.vy*0.5;if(e.y>H)e.y=0;}
      }
      for(let j=bullets.length-1;j>=0;j--){
        for(const e of enemies){
          if(e.alive&&Math.abs(bullets[j].x-e.x)<12&&Math.abs(bullets[j].y-e.y)<10){
            e.alive=false;bullets.splice(j,1);score+=25;break;
          }
        }
      }
      enemies=enemies.filter(e=>e.alive);
      while(enemies.length<6)spawnEnemy();
      if(frame%200===0)score+=5;
      ctx.fillStyle='#000011';ctx.fillRect(0,0,W,H);
      for(let i=0;i<W;i+=2){ctx.fillStyle=`rgba(50,50,100,${0.3+Math.sin((i+frame)*0.05)*0.2})`;ctx.fillRect(i,0,1,H);}
      ctx.fillStyle='#2ecc40';ctx.fillRect(0,H-15,W,15);
      humans.forEach(h=>{if(!h.abducted&&!h.rescued){ctx.fillStyle='#ffcc00';ctx.fillRect(h.x-4,h.y-10,8,10);ctx.beginPath();ctx.arc(h.x,h.y-14,4,0,Math.PI*2);ctx.fill();}});
      enemies.forEach(e=>{if(e.alive){ctx.fillStyle='#ff4444';ctx.beginPath();ctx.moveTo(e.x,e.y-8);ctx.lineTo(e.x-10,e.y+6);ctx.lineTo(e.x+10,e.y+6);ctx.fill();}});
      ctx.fillStyle='#00ff88';ctx.beginPath();ctx.moveTo(ship.x,ship.y-12);ctx.lineTo(ship.x-10,ship.y+8);ctx.lineTo(ship.x,ship.y+4);ctx.lineTo(ship.x+10,ship.y+8);ctx.fill();
      ctx.fillStyle='#ffff00';bullets.forEach(b=>{ctx.fillRect(b.x-1,b.y,2,6);});
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score+'  Lives: '+lives,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kD);document.removeEventListener('keyup',kU);};
  }

  // ==================== 7. TETRIS ====================
  function gameTetris(area, sendScore) {
    const ROWS=20,COLS=10;
    let board=Array.from({length:ROWS},()=>Array(COLS).fill(0));
    let score=0,lines=0,over=false;
    const SHAPES={I:[[1,1,1,1]],O:[[1,1],[1,1]],T:[[0,1,0],[1,1,1]],S:[[0,1,1],[1,1,0]],Z:[[1,1,0],[0,1,1]],J:[[1,0,0],[1,1,1]],L:[[0,0,1],[1,1,1]]};
    const COLORS={I:'#00ffff',O:'#ffff00',T:'#aa00ff',S:'#00ff00',Z:'#ff0000',J:'#0044ff',L:'#ff8800'};
    let shape,sx,sy,shapeKey;
    function newPiece(){
      const keys=Object.keys(SHAPES);shapeKey=keys[Math.floor(Math.random()*keys.length)];shape=SHAPES[shapeKey];
      sx=Math.floor((COLS-shape[0].length)/2);sy=0;
      if(!canPlace(shape,sx,sy)){over=true;sendScore(lines);}
    }
    function canPlace(s,px,py){for(let r=0;r<s.length;r++)for(let c=0;c<s[r].length;c++){if(s[r][c]){const nx=px+c,ny=py+r;if(nx<0||nx>=COLS||ny>=ROWS)return false;if(ny>=0&&board[ny][nx])return false;}}return true;}
    function place(){
      for(let r=0;r<shape.length;r++)for(let c=0;c<shape[r].length;c++)if(shape[r][c]&&sy+r>=0)board[sy+r][sx+c]=shapeKey;
      let cleared=0;
      for(let r=ROWS-1;r>=0;r--){if(board[r].every(c=>c)){board.splice(r,1);board.unshift(Array(COLS).fill(0));cleared++;r++;}}
      if(cleared){lines+=cleared;score+=cleared*cleared*100;}
      newPiece();
    }
    function render(){
      const show=board.map(r=>[...r]);
      if(shape)for(let r=0;r<shape.length;r++)for(let c=0;c<shape[r].length;c++)if(shape[r][c]&&sy+r>=0&&sy+r<ROWS)show[sy+r][sx+c]=shapeKey;
      let html='<p style="text-align:center;color:var(--text2);margin-bottom:0.3rem">Lines: <b style="color:var(--accent)">'+lines+'</b> | Score: <b style="color:var(--accent)">'+score+'</b></p>';
      html+='<div style="display:inline-grid;grid-template-columns:repeat(10,24px);gap:1px;background:var(--bg3);padding:3px;border:1px solid var(--border);border-radius:4px;margin:0 auto;display:block;width:fit-content">';
      const colMap={I:'#00ffff',O:'#ffff00',T:'#aa00ff',S:'#00ff00',Z:'#ff0000',J:'#0044ff',L:'#ff8800'};
      for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){const v=show[r][c];html+='<div style="width:24px;height:24px;border-radius:2px;background:'+(v?(colMap[v]||'var(--accent)'):'var(--surface)')+'"></div>';}
      html+='</div>';
      html+='<div style="text-align:center;margin-top:0.8rem;display:flex;justify-content:center;gap:0.4rem">';
      html+='<button class="btn-secondary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'left\')">◀</button>';
      html+='<button class="btn-primary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'rotate\')">↻</button>';
      html+='<button class="btn-secondary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'right\')">▶</button>';
      html+='<button class="btn-primary" style="width:auto;padding:0.5rem 1rem" onclick="window.oasisTetrisMove(\'drop\')">DROP</button>';
      html+='</div>';
      area.innerHTML=html;
    }
    window.oasisTetrisMove=(a)=>{
      if(over)return;
      if(a==='left'&&canPlace(shape,sx-1,sy))sx--;
      else if(a==='right'&&canPlace(shape,sx+1,sy))sx++;
      else if(a==='rotate'){const rot=shape[0].map((_,i)=>shape.map(row=>row[i]).reverse());if(canPlace(rot,sx,sy))shape=rot;}
      else if(a==='drop'){while(canPlace(shape,sx,sy+1))sy++;place();}
      render();
    };
    const kH=(e)=>{const m={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'rotate',ArrowDown:'drop'};if(m[e.key]){e.preventDefault();window.oasisTetrisMove(m[e.key]);}};
    document.addEventListener('keydown',kH);
    newPiece();render();
    const dropLoop=setInterval(()=>{if(!over){if(canPlace(shape,sx,sy+1))sy++;else place();render();}},700);
    return()=>{clearInterval(dropLoop);document.removeEventListener('keydown',kH);delete window.oasisTetrisMove;};
  }

  // ==================== 8. ARKANOID ====================
  function gameArkanoid(area, sendScore) {
    const W = 400, H = 320;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let paddleX=W/2-35,score=0,over=false,lives=3;
    let ball={x:W/2,y:H-30,vx:3.5,vy:-3.5,r:5};
    let bricks=[],powerups=[];
    const BCOLS=8,BROWS=5,BW=44,BH=14,BPAD=4;
    const bcolors=['#ff4444','#ff8844','#ffcc00','#44cc44','#4488ff'];
    for(let r=0;r<BROWS;r++)for(let c=0;c<BCOLS;c++)bricks.push({x:c*(BW+BPAD)+10,y:r*(BH+BPAD)+30,w:BW,h:BH,color:bcolors[r],alive:true});
    const tick=()=>{
      if(over)return;
      ball.x+=ball.vx;ball.y+=ball.vy;
      if(ball.x<ball.r||ball.x>W-ball.r)ball.vx*=-1;
      if(ball.y<ball.r)ball.vy*=-1;
      if(ball.y>H+10){lives--;if(lives<=0){over=true;sendScore(score);return;}ball={x:W/2,y:H-30,vx:3.5*(Math.random()>0.5?1:-1),vy:-3.5,r:5};}
      if(ball.y+ball.r>H-12&&ball.x>paddleX&&ball.x<paddleX+70){
        ball.vy=-Math.abs(ball.vy);ball.vx+=(ball.x-(paddleX+35))*0.08;
        if(Math.abs(ball.vx)>6)ball.vx=6*(ball.vx>0?1:-1);
      }
      for(let i=bricks.length-1;i>=0;i--){
        const b=bricks[i];if(!b.alive)continue;
        if(ball.x+ball.r>b.x&&ball.x-ball.r<b.x+b.w&&ball.y+ball.r>b.y&&ball.y-ball.r<b.y+b.h){
          b.alive=false;ball.vy*=-1;score+=10;
          if(Math.random()<0.15)powerups.push({x:b.x+b.w/2,y:b.y,type:Math.random()<0.5?'wide':'slow'});
        }
      }
      powerups.forEach(p=>p.y+=2);
      powerups=powerups.filter(p=>{if(p.y>H)return false;if(p.y>H-20&&p.x>paddleX&&p.x<paddleX+70){
        if(p.type==='wide')paddleX=Math.max(0,paddleX-15);
        return false;
      }return true;});
      if(bricks.every(b=>!b.alive)){over=true;sendScore(score);return;}
      ctx.fillStyle='#0a0a2e';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#ffcc00';ctx.fillRect(paddleX,H-12,70,10);
      bricks.forEach(b=>{if(b.alive){ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,b.w,b.h);}});
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();
      powerups.forEach(p=>{ctx.fillStyle=p.type==='wide'?'#00ff88':'#ff8800';ctx.fillRect(p.x-6,p.y-4,12,8);ctx.fillStyle='#fff';ctx.font='8px sans-serif';ctx.textAlign='center';ctx.fillText(p.type==='wide'?'W':'S',p.x,p.y+3);});
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Score: '+score+'  Lives: '+lives,4,14);
    };
    const mHandler=(e)=>{const rect=cvs.getBoundingClientRect();paddleX=Math.max(0,Math.min(W-70,(e.clientX-rect.left)*(W/rect.width)-35));};
    cvs.addEventListener('pointermove',mHandler);
    let touchX=0;
    cvs.addEventListener('touchstart',(e)=>{touchX=e.touches[0].clientX;},{passive:true});
    cvs.addEventListener('touchmove',(e)=>{const rect=cvs.getBoundingClientRect();paddleX=Math.max(0,Math.min(W-70,(e.touches[0].clientX-rect.left)*(W/rect.width)-35));},{passive:true});
    const loop=setInterval(tick,1000/60);
    return()=>{clearInterval(loop);cvs.removeEventListener('pointermove',mHandler);};
  }

  // ==================== 9. HELICOPTER ====================
  function gameHelicopter(area, sendScore) {
    const W = 400, H = 300;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let heli={x:80,y:H/2,vy:0},pipes=[],score=0,over=false,frame=0,dist=0;
    const spawnPipe=()=>{const gap=100+Math.random()*40;const gy=60+Math.random()*(H-gap-60);pipes.push({x:W+50,gy,gap,w:40,scored:false});};
    for(let i=0;i<3;i++)pipes.push({x:W/3+i*140,gy:60+Math.random()*(H-120-60),gap:100+Math.random()*40,w:40,scored:false});
    let isFlapping=false;
    const flap=()=>{if(!over)heli.vy=-5.5;};
    cvs.addEventListener('pointerdown',flap);
    const kH=(e)=>{if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();flap();}};
    document.addEventListener('keydown',kH);
    const loop=setInterval(()=>{
      if(over)return;frame++;
      heli.vy+=0.25;heli.y+=heli.vy;
      if(heli.vy>7)heli.vy=7;
      if(heli.y<0||heli.y>H){over=true;clearInterval(loop);sendScore(score);return;}
      for(const p of pipes){
        p.x-=2.5;
        if(!p.scored&&p.x+p.w<heli.x){p.scored=true;score++;dist++;}
        if(heli.x+18>p.x&&heli.x-18<p.x+p.w){
          if(heli.y-12<p.gy||heli.y+12>p.gy+p.gap){over=true;clearInterval(loop);sendScore(score);return;}
        }
      }
      pipes=pipes.filter(p=>p.x>-50);
      while(pipes.length<3){const last=pipes[pipes.length-1];pipes.push({x:last.x+140,gy:60+Math.random()*(H-120-60),gap:100+Math.random()*40,w:40,scored:false});}
      if(frame%3===0)dist++;
      ctx.fillStyle='#1a0a2e';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#44aa44';ctx.fillRect(0,H-2,W,2);
      ctx.fillStyle='#2ecc40';pipes.forEach(p=>{ctx.fillRect(p.x,0,p.w,p.gy);ctx.fillRect(p.x,p.gy+p.gap,p.w,H);ctx.fillStyle='#33cc55';ctx.fillRect(p.x+2,0,p.w-4,p.gy-2);ctx.fillRect(p.x+2,p.gy+p.gap+2,p.w-4,H);ctx.fillStyle='#2ecc40';});
      const heliBob=Math.sin(frame*0.3)*2;
      ctx.fillStyle='#ffcc00';ctx.fillRect(heli.x-16,heli.y-8+heliBob,32,16);
      ctx.fillStyle='#ff8800';ctx.fillRect(heli.x-8,heli.y-4+heliBob,16,8);
      ctx.fillStyle='#fff';ctx.fillRect(heli.x-18,heli.y-12+heliBob,36,4);
      if(frame%4<2){ctx.fillStyle='#ccc';ctx.fillRect(heli.x-20,heli.y-14+heliBob,40,3);}
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Distance: '+dist+'m  Pipes: '+score,4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kH);cvs.removeEventListener('pointerdown',flap);};
  }

  // ==================== 10. GEOMETRY DASH ====================
  function gameGeometryDash(area, sendScore) {
    const W = 400, H = 200, GY = H - 40;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    let cube={x:60,y:GY-20,w:20,h:20,vy:0,grounded:true,angle:0}, obstacles=[], score=0, over=false, frame=0, speed=4, dist=0;
    const spawnObs=()=>{obstacles.push({x:W+50,w:20,h:20+Math.random()*30,type:Math.random()<0.3?'spike':'block'});};
    for(let i=0;i<5;i++)obstacles.push({x:200+i*120,w:20,h:20+Math.random()*25,type:Math.random()<0.3?'spike':'block'});
    let platforms=[];for(let i=0;i<3;i++)platforms.push({x:300+i*200,y:GY-60,w:80});
    let jumpPressed=false;
    const doJump=()=>{if(cube.grounded){cube.vy=-9;cube.grounded=false;}};
    cvs.addEventListener('pointerdown',()=>{jumpPressed=true;doJump();});
    cvs.addEventListener('pointerup',()=>{jumpPressed=false;});
    const kH=(e)=>{if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();doJump();}};
    document.addEventListener('keydown',kH);
    const loop=setInterval(()=>{
      if(over)return;frame++;
      cube.vy+=0.6;cube.y+=cube.vy;
      if(cube.y>=GY-cube.h){cube.y=GY-cube.h;cube.vy=0;cube.grounded=true;}
      if(!cube.grounded)cube.angle+=0.1;
      speed=3.5+dist*0.005;if(speed>8)speed=8;
      for(const o of obstacles){
        o.x-=speed;
        if(o.type==='spike'){
          if(cube.x+cube.w>o.x+4&&cube.x<o.x+o.w-4&&cube.y+cube.h>GY-o.h+4){over=true;clearInterval(loop);sendScore(score);return;}
        }else{
          if(cube.x+cube.w>o.x&&cube.x<o.x+o.w&&cube.y+cube.h>GY-o.h&&cube.y<GY){over=true;clearInterval(loop);sendScore(score);return;}
        }
      }
      for(const p of platforms){
        p.x-=speed;
        if(cube.x+cube.w>p.x&&cube.x<p.x+p.w&&cube.y+cube.h===p.y&&cube.vy>=0){cube.y=p.y-cube.h;cube.vy=0;cube.grounded=true;}
      }
      obstacles=obstacles.filter(o=>o.x>-50);platforms=platforms.filter(p=>p.x>-100);
      if(frame%50===0)spawnObs();
      if(frame%70===0)platforms.push({x:W+50+Math.random()*100,y:GY-50-Math.random()*40,w:60+Math.random()*40});
      dist++;if(frame%6===0)score++;
      ctx.fillStyle='#0a0a2e';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#1a1a3a';ctx.fillRect(0,GY,W,H-GY);
      ctx.strokeStyle='#333';ctx.lineWidth=1;for(let i=0;i<W;i+=20){ctx.beginPath();ctx.moveTo(i,GY);ctx.lineTo(i,H);ctx.stroke();}
      ctx.save();ctx.translate(cube.x+cube.w/2,cube.y+cube.h/2);ctx.rotate(cube.angle);
      ctx.fillStyle='#00ff88';ctx.fillRect(-cube.w/2,-cube.h/2,cube.w,cube.h);
      ctx.fillStyle='#fff';ctx.fillRect(-cube.w/2+4,-cube.h/2+4,4,4);ctx.fillRect(cube.w/2-8,-cube.h/2+4,4,4);
      ctx.restore();
      obstacles.forEach(o=>{
        if(o.type==='spike'){ctx.fillStyle='#ff4444';ctx.beginPath();ctx.moveTo(o.x+o.w/2,GY-o.h);ctx.lineTo(o.x,GY);ctx.lineTo(o.x+o.w,GY);ctx.fill();}
        else{ctx.fillStyle='#ff8844';ctx.fillRect(o.x,GY-o.h,o.w,o.h);}
      });
      platforms.forEach(p=>{ctx.fillStyle='#4488ff';ctx.fillRect(p.x,p.y,p.w,8);});
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Distance: '+dist+'m',4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kH);};
  }

  // ==================== 11. CROSSY ROAD ====================
  function gameCrossyRoad(area, sendScore) {
    const W = 320, H = 400, CS = 32;
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    cvs.style.cssText = 'display:block;margin:0 auto;border-radius:12px;border:2px solid var(--border);touch-action:none';
    area.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const ROWS=Math.floor(H/CS),COLS=Math.floor(W/CS);
    let chicken={x:Math.floor(COLS/2),y:ROWS-2}, score=0, over=false, frame=0, maxRow=ROWS-2;
    const lanes=[];
    for(let i=0;i<ROWS-1;i++){
      const isRoad=i<6;
      const cars=[];const n=1+Math.floor(Math.random()*2);
      for(let j=0;j<n;j++)cars.push({x:Math.random()*W,w:CS+(Math.random()>0.5?CS:0)});
      lanes.push({y:i,speed:(1+Math.random()*2.5)*(i%2===0?1:-1),cars,water:!isRoad&&i>3});
    }
    const move=(dx,dy)=>{
      if(over)return;
      chicken.x=Math.max(0,Math.min(COLS-1,chicken.x+dx));
      chicken.y=Math.max(0,Math.min(ROWS-1,chicken.y+dy));
      if(chicken.y<maxRow){score+=(maxRow-chicken.y);maxRow=chicken.y;}
    };
    const kH=(e)=>{
      if(e.code==='ArrowLeft')move(-1,0);else if(e.code==='ArrowRight')move(1,0);
      else if(e.code==='ArrowUp')move(0,-1);else if(e.code==='ArrowDown')move(0,1);
    };
    document.addEventListener('keydown',kH);
    let tsx=0,tsy=0;
    cvs.addEventListener('touchstart',(e)=>{tsx=e.touches[0].clientX;tsy=e.touches[0].clientY;},{passive:true});
    cvs.addEventListener('touchend',(e)=>{const dx=e.changedTouches[0].clientX-tsx,dy=e.changedTouches[0].clientY-tsy;if(Math.abs(dx)>Math.abs(dy))move(dx>0?1:-1,0);else move(0,dy>0?1:-1);},{passive:true});
    const loop=setInterval(()=>{
      if(over)return;frame++;
      for(const l of lanes){
        for(const c of l.cars){c.x+=l.speed;if(l.speed>0&&c.x>W+CS*2)c.x=-c.w-CS;if(l.speed<0&&c.x<-CS*2)c.x=W+CS;}
      }
      for(const l of lanes){
        if(l.water){
          let onLog=false;
          for(const c of l.cars){if(chicken.x*CS+CS/2>c.x&&chicken.x*CS+CS/2<c.x+c.w&&chicken.y===l.y){chicken.x+=l.speed>0?0.02:-0.02;onLog=true;}}
          if(!onLog&&chicken.y===l.y){over=true;clearInterval(loop);sendScore(score);return;}
        }else{
          for(const c of l.cars){
            if(chicken.y===l.y&&chicken.x*CS+CS>c.x+4&&chicken.x*CS<c.x+c.w-4){over=true;clearInterval(loop);sendScore(score);return;}
          }
        }
      }
      if(chicken.x<0||chicken.x>=COLS){over=true;clearInterval(loop);sendScore(score);return;}
      ctx.fillStyle='#2d5a27';ctx.fillRect(0,0,W,H);
      for(let i=0;i<ROWS;i++){
        const l=lanes[i];
        if(l&&l.water){
          ctx.fillStyle='#1a4a7a';ctx.fillRect(0,i*CS,W,CS);
          l.cars.forEach(c=>{ctx.fillStyle='#6B4226';ctx.fillRect(c.x,i*CS+4,c.w,CS-8);});
        }else if(i<6){
          ctx.fillStyle='#333';ctx.fillRect(0,i*CS,W,CS);
          ctx.setLineDash([8,8]);ctx.strokeStyle='#666';ctx.beginPath();ctx.moveTo(0,i*CS+CS/2);ctx.lineTo(W,i*CS+CS/2);ctx.stroke();ctx.setLineDash([]);
          if(l)l.cars.forEach(c=>{ctx.fillStyle=['#e74c3c','#3498db','#f39c12','#9b59b6'][Math.floor(c.x)%4];ctx.fillRect(c.x,i*CS+4,c.w,CS-8);});
        }else{
          ctx.fillStyle='#3a7a3a';ctx.fillRect(0,i*CS,W,CS);
        }
      }
      ctx.fillStyle='#ffcc00';ctx.fillRect(chicken.x*CS+4,chicken.y*CS+4,CS-8,CS-8);
      ctx.fillStyle='#ff8800';ctx.fillRect(chicken.x*CS+6,chicken.y*CS+2,CS-12,6);
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(chicken.x*CS+10,chicken.y*CS+12,2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(chicken.x*CS+CS-10,chicken.y*CS+12,2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='left';ctx.fillText('Distance: '+score+'m',4,14);
    },1000/60);
    return()=>{clearInterval(loop);document.removeEventListener('keydown',kH);};
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
    const gameNames = { 'pac-man': '🟡 Pac-Man', 'frogger': '🐸 Frogger', 'asteroids': '☄️ Asteroids', 'galaga': '🚀 Galaga', 'centipede': '🐛 Centipede', 'defender': '🛸 Defender', 'tetris': '📦 Tetris', 'arkanoid': '🧱 Arkanoid', 'helicopter': '🚁 Helicopter', 'geometry-dash': '🔷 Geometry Dash', 'crossy-road': '🐔 Crossy Road' };
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
