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
        showToast(`⚡ Match found! vs ${msg.opponent} for R${msg.pot}`, 'success');
        currentRoom = msg.roomId;
        currentGame = msg.game;
        startGame(msg.game, msg.roomId, msg.pot, msg.opponent);
        break;

      case 'game_update': handleTTTUpdate(msg); break;
      case 'rps_result': handleRPSResult(msg); break;
      case 'rps_waiting': showToast('Waiting for opponent...', ''); break;
      case 'hl_update': handleHLUpdate(msg); break;
      case 'dice_roll': handleDiceRoll(msg); break;
      case 'mem_flip': handleMemFlip(msg); break;
      case 'mem_match': handleMemMatch(msg); break;
      case 'math_new': handleMathNew(msg); break;
      case 'math_result': handleMathResult(msg); break;

      case 'match_over':
        if (msg.won === true) showToast(`🏆 You won R${msg.amount}!`, 'success');
        else if (msg.won === false) showToast(`💔 You lost. Better luck next time!`, 'error');
        else showToast(`🤝 Draw! R${msg.amount} refunded.`, '');
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
        <button class="gc-play" onclick="window.oasisPlay('${g.id}')">PLAY NOW</button>
      </div>
    `).join('');
  }

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
  function startGame(gameId, roomId, pot, opponent) {
    navigate('game');
    const arena = $('#game-arena');
    arena.innerHTML = `
      <div style="width:100%;max-width:600px;margin:0 auto">
        <div class="game-header">
          <h2>${GAMES.find(g => g.id === gameId)?.icon || '🎮'} ${GAMES.find(g => g.id === gameId)?.name || gameId}</h2>
          <div class="pot">Pot: R${pot}</div>
          <div class="opponent">vs ${opponent}</div>
        </div>
        <div id="game-area"></div>
      </div>
    `;

    switch (gameId) {
      case 'tic-tac-toe': initTTT(); break;
      case 'rps': initRPS(); break;
      case 'higher-lower': initHL(); break;
      case 'dice-duel': initDice(); break;
      case 'memory-match': initMemory(); break;
      case 'math-rush': initMath(); break;
    }
  }

  // --- TIC TAC TOE ---
  function initTTT() {
    $('#game-area').innerHTML = `
      <p style="text-align:center;color:var(--text2);margin-bottom:1rem">Get 3 in a row to win rounds. First to 2 rounds wins!</p>
      <div class="ttt-board" id="ttt-board">${Array(9).fill('').map((_, i) => `<div class="ttt-cell" data-cell="${i}" onclick="window.oasisTTTClick(${i})"></div>`).join('')}</div>
      <p id="ttt-status" style="text-align:center;margin-top:1rem;color:var(--accent);font-family:var(--font-display)">Your turn</p>
    `;
  }

  window.oasisTTTClick = (cell) => {
    if (!currentRoom) return;
    ws.send(JSON.stringify({ type: 'game_move', roomId: currentRoom, cell }));
  };

  function handleTTTUpdate(msg) {
    const cells = $$('.ttt-cell');
    if (cells[msg.cell]) {
      cells[msg.cell].textContent = msg.mark;
      cells[msg.cell].classList.add('taken');
    }
    if (msg.scores) {
      const status = $('#ttt-status');
      if (status) status.textContent = msg.nextTurn ? 'Your turn' : "Opponent's turn";
    }
  }

  // --- RPS ---
  function initRPS() {
    $('#game-area').innerHTML = `
      <p style="text-align:center;color:var(--text2);margin-bottom:1rem">Best of 3 rounds wins!</p>
      <div class="rps-choices">
        <div class="rps-choice" onclick="window.oasisRPS('rock')">✊</div>
        <div class="rps-choice" onclick="window.oasisRPS('paper')">✋</div>
        <div class="rps-choice" onclick="window.oasisRPS('scissors')">✌️</div>
      </div>
      <div id="rps-result" class="rps-result"></div>
      <div id="rps-score" style="text-align:center;color:var(--text2)"></div>
    `;
  }

  window.oasisRPS = (move) => {
    if (!currentRoom) return;
    $$('.rps-choice').forEach(c => c.classList.remove('selected'));
    event.target.closest('.rps-choice').classList.add('selected');
    ws.send(JSON.stringify({ type: 'game_move', roomId: currentRoom, move }));
  };

  function handleRPSResult(msg) {
    const r = $('#rps-result');
    if (r) r.textContent = `You: ${msg.move1} vs Opponent: ${msg.move2}`;
    const s = $('#rps-score');
    if (s) s.textContent = `Score: ${msg.scores[user.id] || 0} - ${msg.scores[Object.keys(msg.scores).find(k => k !== user.id)] || 0}`;
    $$('.rps-choice').forEach(c => c.classList.remove('selected'));
  }

  // --- HIGHER LOWER ---
  function initHL() {
    $('#game-area').innerHTML = `
      <p style="text-align:center;color:var(--text2);margin-bottom:1rem">Guess if the next card is higher or lower!</p>
      <div class="hl-card-display">
        <div class="hl-card" id="hl-current">?</div>
      </div>
      <div class="hl-buttons">
        <button class="btn-secondary" onclick="window.oasisHL('lower')">⬇ Lower</button>
        <button class="btn-primary" onclick="window.oasisHL('higher')" style="width:auto">⬆ Higher</button>
      </div>
      <div id="hl-score" style="text-align:center;margin-top:1rem;color:var(--text2)"></div>
    `;
  }

  window.oasisHL = (guess) => {
    if (!currentRoom) return;
    ws.send(JSON.stringify({ type: 'game_move', roomId: currentRoom, guess }));
  };

  function handleHLUpdate(msg) {
    const el = $('#hl-current');
    if (el) el.textContent = `${msg.card.name}`;
    const s = $('#hl-score');
    if (s) s.textContent = `Score: ${msg.scores[user.id] || 0} | Round: ${msg.round}`;
    showToast(msg.correct ? '✅ Correct!' : '❌ Wrong!', msg.correct ? 'success' : 'error');
  }

  // --- DICE ---
  function initDice() {
    $('#game-area').innerHTML = `
      <p style="text-align:center;color:var(--text2);margin-bottom:1rem">Roll the dice! Highest total after 6 rolls wins!</p>
      <div class="dice-area">
        <div class="dice-display" id="dice-display">🎲</div>
        <div class="dice-scores" id="dice-scores"></div>
        <button class="btn-primary" id="dice-roll-btn" onclick="window.oasisDiceRoll()" style="width:auto;padding:1rem 3rem">ROLL DICE</button>
        <p id="dice-status" style="margin-top:1rem;color:var(--text2)"></p>
      </div>
    `;
  }

  window.oasisDiceRoll = () => {
    if (!currentRoom) return;
    ws.send(JSON.stringify({ type: 'game_move', roomId: currentRoom }));
    $('#dice-roll-btn').disabled = true;
  };

  function handleDiceRoll(msg) {
    const display = $('#dice-display');
    const emojis = ['⚀','⚁','⚂','⚃','⚄','⚅'];
    const die1 = Math.floor(msg.roll / 2);
    const die2 = msg.roll - die1 - 2;
    if (display) display.textContent = `${emojis[Math.min(die1, 5)]} ${emojis[Math.min(die2, 5)]}`;

    const scores = $('#dice-scores');
    if (scores) {
      scores.innerHTML = Object.entries(msg.totals).map(([pid, total]) =>
        `<div><strong>${pid === user.id ? 'You' : 'Opponent'}</strong>: ${total}</div>`
      ).join('');
    }

    const myTurn = msg.playerId === user.id;
    const status = $('#dice-status');
    if (status) status.textContent = myTurn ? 'Your roll!' : "Opponent's roll";
    if (myTurn) setTimeout(() => { const b = $('#dice-roll-btn'); if (b) b.disabled = false; }, 500);
  }

  // --- MEMORY ---
  function initMemory() {
    $('#game-area').innerHTML = `
      <p style="text-align:center;color:var(--text2);margin-bottom:1rem">Find matching pairs! Most pairs wins.</p>
      <div class="mem-board" id="mem-board">${Array(16).fill('').map((_, i) => `<div class="mem-card" data-idx="${i}" onclick="window.oasisMemClick(${i})">?</div>`).join('')}</div>
      <div id="mem-scores" style="text-align:center;margin-top:1rem;color:var(--text2)"></div>
    `;
  }

  window.oasisMemClick = (idx) => {
    if (!currentRoom) return;
    ws.send(JSON.stringify({ type: 'game_move', roomId: currentRoom, index: idx }));
  };

  function handleMemFlip(msg) {
    const card = $(`.mem-card[data-idx="${msg.index}"]`);
    if (card) { card.textContent = msg.value; card.classList.add('flipped'); }
  }

  function handleMemMatch(msg) {
    msg.indices.forEach(idx => {
      const card = $(`.mem-card[data-idx="${idx}"]`);
      if (card) { card.classList.add('matched'); card.classList.remove('flipped'); }
    });
    const s = $('#mem-scores');
    if (s) s.textContent = `You: ${msg.playerId === user.id ? '+' : ''} pair`;
  }

  // --- MATH RUSH ---
  function initMath() {
    $('#game-area').innerHTML = `
      <p style="text-align:center;color:var(--text2);margin-bottom:1rem">Solve 10 problems. Most correct wins!</p>
      <div class="math-display">
        <div class="math-question" id="math-question">Loading...</div>
        <div>
          <input type="number" class="math-input" id="math-answer" onkeydown="if(event.key==='Enter')window.oasisMathSubmit()">
          <button class="math-submit" onclick="window.oasisMathSubmit()">→</button>
        </div>
        <div id="math-scores" style="margin-top:1rem;color:var(--text2)"></div>
      </div>
    `;
  }

  window.oasisMathSubmit = () => {
    const answer = parseInt($('#math-answer')?.value);
    if (isNaN(answer)) return;
    if (!currentRoom) return;
    ws.send(JSON.stringify({ type: 'game_move', roomId: currentRoom, answer }));
    const inp = $('#math-answer');
    if (inp) { inp.value = ''; inp.focus(); }
  };

  function handleMathNew(msg) {
    const q = $('#math-question');
    if (q) q.textContent = msg.question;
    const inp = $('#math-answer');
    if (inp) inp.focus();
  }

  function handleMathResult(msg) {
    const s = $('#math-scores');
    if (s) s.textContent = `You: ${msg.scores[user.id] || 0} | Opponent: ${msg.scores[Object.keys(msg.scores).find(k => k !== user.id)] || 0} | Answer: ${msg.answer}`;
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
