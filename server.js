const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const https = require('https');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `proof-${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    if (ext || mime) cb(null, true);
    else cb(new Error('Only images and PDF files allowed'));
  }
});

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

let db = { users: [], matches: [], transactions: [], deposits: [], withdrawals: [], challenges: [] };
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) { console.error('DB load error:', e.message); }
}
function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    syncDBToGitHub(db);
  } catch (e) { console.error('DB save error:', e.message); }
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'jacobsrussell/oasis-game';
const GITHUB_DB_PATH = process.env.GITHUB_DB_PATH || 'data/db.json';

function syncDBToGitHub(data) {
  if (!GITHUB_TOKEN) return;
  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const getReq = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${GITHUB_DB_PATH}`,
      method: 'GET',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'oasis-server', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const existing = JSON.parse(body);
          const sha = existing.sha;
          const putData = JSON.stringify({ message: 'Auto-sync db.json', content, sha, branch: 'master' });
          const putReq = https.request({
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/contents/${GITHUB_DB_PATH}`,
            method: 'PUT',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'oasis-server', 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(putData) }
          }, (putRes) => {
            let putBody = '';
            putRes.on('data', c => putBody += c);
            putRes.on('end', () => {
              if (putRes.statusCode === 200 || putRes.statusCode === 201) {
                console.log('DB synced to GitHub successfully');
              } else {
                console.error('GitHub sync failed:', putRes.statusCode, putBody.substring(0, 200));
              }
            });
          });
          putReq.on('error', (e) => console.error('GitHub sync PUT error:', e.message));
          putReq.write(putData);
          putReq.end();
        } catch (e) {
          console.error('GitHub sync parse error:', e.message);
        }
      });
    });
    getReq.on('error', (e) => console.error('GitHub sync GET error:', e.message));
    getReq.end();
  } catch (e) {
    console.error('GitHub sync error:', e.message);
  }
}

async function loadDBFromGitHub() {
  if (!GITHUB_TOKEN) return null;
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${GITHUB_DB_PATH}`,
      method: 'GET',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'oasis-server', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) return resolve(null);
          const data = JSON.parse(body);
          const content = Buffer.from(data.content, 'base64').toString('utf8');
          resolve(JSON.parse(content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function initDB() {
  loadDB();
  if (db.users.length === 0 && GITHUB_TOKEN) {
    console.log('Local DB empty, loading from GitHub...');
    const remoteDB = await loadDBFromGitHub();
    if (remoteDB && remoteDB.users && remoteDB.users.length > 0) {
      console.log(`Loaded ${remoteDB.users.length} users from GitHub`);
      db = remoteDB;
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    }
  }
}
initDB();

function findUser(query) {
  if (query.id) return db.users.find(u => u.id === query.id);
  if (query.email) return db.users.find(u => u.email === query.email);
  if (query.username) return db.users.find(u => u.username === query.username);
  return null;
}

function authMiddleware(req, res, next) {
  const id = req.headers['x-user-id'];
  if (!id) return res.status(401).json({ error: 'Unauthorized' });
  const user = findUser({ id });
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ===================== AUTH =====================
app.post('/api/register', (req, res) => {
  const { username, email, password, fullName, phone } = req.body;
  if (!username || !email || !password || !fullName) return res.status(400).json({ error: 'All fields required' });
  if (findUser({ email })) return res.status(400).json({ error: 'Email already registered' });
  if (findUser({ username })) return res.status(400).json({ error: 'Username taken' });

  const user = {
    id: uuidv4(), username, email, password: bcrypt.hashSync(password, 10),
    fullName, phone: phone || '', role: 'player',
    balance: 0, wins: 0, losses: 0, totalEarnings: 0, totalSpent: 0,
    bankName: '', bankAccount: '', bankBranch: '', bankHolder: '',
    isVerified: true, isActive: true, joinedAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB();
  res.json({ user: sanitize(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = findUser({ email });
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.isActive) return res.status(403).json({ error: 'Account suspended' });
  res.json({ user: sanitize(user) });
});

app.get('/api/me', authMiddleware, (req, res) => res.json({ user: sanitize(req.user) }));

function sanitize(u) {
  const { password, ...safe } = u;
  return safe;
}

// ===================== WALLET =====================
app.get('/api/wallet', authMiddleware, (req, res) => {
  const txs = db.transactions.filter(t => t.userId === req.user.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ balance: req.user.balance, transactions: txs });
});

app.get('/api/bank-details', authMiddleware, (req, res) => {
  res.json({
    bankName: req.user.bankName || '',
    bankAccount: req.user.bankAccount || '',
    bankBranch: req.user.bankBranch || '',
    bankHolder: req.user.bankHolder || ''
  });
});

app.put('/api/bank-details', authMiddleware, (req, res) => {
  const { bankName, bankAccount, bankBranch, bankHolder } = req.body;
  req.user.bankName = bankName || req.user.bankName;
  req.user.bankAccount = bankAccount || req.user.bankAccount;
  req.user.bankBranch = bankBranch || req.user.bankBranch;
  req.user.bankHolder = bankHolder || req.user.bankHolder;
  saveDB();
  res.json({ success: true });
});

app.post('/api/deposit', authMiddleware, upload.single('proof'), (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt < 10) return res.status(400).json({ error: 'Minimum deposit R10' });

  const dep = {
    id: uuidv4(), userId: req.user.id, amount: amt,
    proofFile: req.file ? req.file.filename : null,
    status: 'pending', date: new Date().toISOString()
  };
  db.deposits.push(dep);
  saveDB();
  res.json({ deposit: dep });
});

app.post('/api/withdraw', authMiddleware, (req, res) => {
  const { amount } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt < 50) return res.status(400).json({ error: 'Minimum withdrawal R50' });
  if (amt > req.user.balance) return res.status(400).json({ error: 'Insufficient balance' });

  const recent = db.withdrawals.filter(w => w.userId === req.user.id && w.status !== 'rejected');
  const last7 = recent.filter(w => (Date.now() - new Date(w.date).getTime()) < 7 * 24 * 60 * 60 * 1000);
  if (last7.length > 0) return res.status(400).json({ error: 'Withdrawal limit: once per 7 days' });

  if (!req.user.bankName || !req.user.bankAccount) return res.status(400).json({ error: 'Add bank details first' });

  const fee = Math.round(amt * 0.05 * 100) / 100;
  const net = Math.round((amt - fee) * 100) / 100;

  const wd = {
    id: uuidv4(), userId: req.user.id, amount: amt, fee, netAmount: net,
    bankName: req.user.bankName, bankAccount: req.user.bankAccount,
    bankBranch: req.user.bankBranch, bankHolder: req.user.bankHolder,
    status: 'pending', date: new Date().toISOString()
  };
  db.withdrawals.push(wd);
  req.user.balance = Math.round((req.user.balance - amt) * 100) / 100;
  saveDB();
  res.json({ withdrawal: wd });
});

// ===================== GAMES =====================
const GAMES = [
  { id: 'pac-man', name: 'Pac-Man', icon: '🟡', minBet: 10, maxBet: 5000, players: 2, desc: 'Navigate the maze, eat all dots, avoid ghosts! Highest score wins!' },
  { id: 'frogger', name: 'Frogger', icon: '🐸', minBet: 10, maxBet: 5000, players: 2, desc: 'Cross roads and rivers, dodge traffic! Most crossings wins!' },
  { id: 'asteroids', name: 'Asteroids', icon: '☄️', minBet: 10, maxBet: 5000, players: 2, desc: 'Warp through space, blast asteroids! Highest score wins!' },
  { id: 'galaga', name: 'Galaga', icon: '🚀', minBet: 10, maxBet: 5000, players: 2, desc: 'Dodge enemy formations and shoot! Highest alien score wins!' },
  { id: 'centipede', name: 'Centipede', icon: '🐛', minBet: 10, maxBet: 5000, players: 2, desc: 'Shoot the centipede before it reaches you! Highest score wins!' },
  { id: 'defender', name: 'Defender', icon: '🛸', minBet: 10, maxBet: 5000, players: 2, desc: 'Protect humans from alien abduction! Highest score wins!' },
  { id: 'tetris', name: 'Tetris', icon: '📦', minBet: 10, maxBet: 5000, players: 2, desc: 'Stack blocks and clear lines! Most lines cleared wins!' },
  { id: 'arkanoid', name: 'Arkanoid', icon: '🧱', minBet: 10, maxBet: 5000, players: 2, desc: 'Break every brick with power-ups! Highest score wins!' },
  { id: 'helicopter', name: 'Helicopter', icon: '🚁', minBet: 10, maxBet: 5000, players: 2, desc: 'Fly through endless caves! Longest distance wins!' },
  { id: 'geometry-dash', name: 'Geometry Dash', icon: '🔷', minBet: 10, maxBet: 5000, players: 2, desc: 'Jump and fly through obstacles! Highest progress wins!' },
  { id: 'crossy-road', name: 'Crossy Road', icon: '🐔', minBet: 10, maxBet: 5000, players: 2, desc: 'Hop across roads and rivers! Farthest distance wins!' }
];

app.get('/api/games', authMiddleware, (req, res) => res.json({ games: GAMES }));

// ===================== CHALLENGES =====================
app.post('/api/challenge', authMiddleware, (req, res) => {
  const { targetUsername, gameId, amount } = req.body;
  const amt = parseFloat(amount);
  const game = GAMES.find(g => g.id === gameId);
  if (!game) return res.status(400).json({ error: 'Invalid game' });
  if (!amt || amt < game.minBet || amt > game.maxBet) return res.status(400).json({ error: `Bet must be R${game.minBet}-R${game.maxBet}` });
  if (amt > req.user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  if (targetUsername === req.user.username) return res.status(400).json({ error: 'Cannot challenge yourself' });

  const target = findUser({ username: targetUsername });
  if (!target) return res.status(404).json({ error: 'Player not found' });

  const challenge = {
    id: uuidv4(), challengerId: req.user.id, targetId: target.id,
    gameId, amount: amt, status: 'pending', date: new Date().toISOString()
  };
  db.challenges.push(challenge);
  saveDB();

  broadcastToUser(target.id, { type: 'challenge_received', challenge: { ...challenge, challengerName: req.user.username, gameName: game.name } });
  res.json({ challenge });
});

app.get('/api/challenges', authMiddleware, (req, res) => {
  const incoming = db.challenges.filter(c => c.targetId === req.user.id && c.status === 'pending');
  const outgoing = db.challenges.filter(c => c.challengerId === req.user.id && c.status === 'pending');
  res.json({ incoming, outgoing });
});

app.post('/api/challenge/:id/accept', authMiddleware, (req, res) => {
  const challenge = db.challenges.find(c => c.id === req.params.id);
  if (!challenge || challenge.targetId !== req.user.id) return res.status(404).json({ error: 'Challenge not found' });
  if (challenge.status !== 'pending') return res.status(400).json({ error: 'Challenge no longer pending' });

  const challenger = findUser({ id: challenge.challengerId });
  if (challenger.balance < challenge.amount) return res.status(400).json({ error: 'Challenger has insufficient funds' });

  challenger.balance = Math.round((challenger.balance - challenge.amount) * 100) / 100;
  req.user.balance = Math.round((req.user.balance - challenge.amount) * 100) / 100;
  challenge.status = 'accepted';
  challenge.pot = challenge.amount * 2;
  saveDB();

  const roomId = uuidv4();
  const room = {
    id: roomId, gameId: challenge.gameId, pot: challenge.pot,
    players: [challenger.id, req.user.id], moves: {}, scores: {},
    status: 'playing', startedAt: new Date().toISOString()
  };
  activeRooms[roomId] = room;

  broadcastToUser(challenger.id, { type: 'challenge_accepted', roomId, game: challenge.gameId, pot: challenge.pot, opponent: req.user.username });
  broadcastToUser(req.user.id, { type: 'challenge_accepted', roomId, game: challenge.gameId, pot: challenge.pot, opponent: challenger.username });

  db.transactions.push(
    { id: uuidv4(), userId: challenger.id, type: 'bet', amount: -challenge.amount, matchId: roomId, date: new Date().toISOString() },
    { id: uuidv4(), userId: req.user.id, type: 'bet', amount: -challenge.amount, matchId: roomId, date: new Date().toISOString() }
  );
  saveDB();

  res.json({ roomId });
});

app.post('/api/challenge/:id/decline', authMiddleware, (req, res) => {
  const challenge = db.challenges.find(c => c.id === req.params.id);
  if (!challenge || challenge.targetId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  challenge.status = 'declined';
  saveDB();
  broadcastToUser(challenge.challengerId, { type: 'challenge_declined', challengeId: challenge.id });
  res.json({ success: true });
});

app.post('/api/challenge/:id/cancel', authMiddleware, (req, res) => {
  const challenge = db.challenges.find(c => c.id === req.params.id);
  if (!challenge || challenge.challengerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  challenge.status = 'cancelled';
  saveDB();
  res.json({ success: true });
});

// ===================== QUICK MATCH =====================
app.post('/api/quickmatch', authMiddleware, (req, res) => {
  const { gameId, amount } = req.body;
  const amt = parseFloat(amount);
  const game = GAMES.find(g => g.id === gameId);
  if (!game) return res.status(400).json({ error: 'Invalid game' });
  if (!amt || amt < game.minBet || amt > game.maxBet) return res.status(400).json({ error: `Bet must be R${game.minBet}-R${game.maxBet}` });
  if (amt > req.user.balance) return res.status(400).json({ error: 'Insufficient balance' });

  const waiting = matchQueue.filter(m => m.gameId === gameId && m.amount === amt && m.userId !== req.user.id);
  if (waiting.length > 0) {
    const opp = waiting[0];
    matchQueue = matchQueue.filter(m => m !== opp);

    const oppUser = findUser({ id: opp.userId });
    oppUser.balance = Math.round((oppUser.balance - amt) * 100) / 100;
    req.user.balance = Math.round((req.user.balance - amt) * 100) / 100;

    const roomId = uuidv4();
    const room = {
      id: roomId, gameId, pot: amt * 2,
      players: [opp.userId, req.user.id], moves: {}, scores: {},
      status: 'playing', startedAt: new Date().toISOString()
    };
    activeRooms[roomId] = room;

    broadcastToUser(opp.userId, { type: 'match_found', roomId, game: gameId, pot: amt * 2, opponent: req.user.username });
    broadcastToUser(req.user.id, { type: 'match_found', roomId, game: gameId, pot: amt * 2, opponent: oppUser.username });

    db.transactions.push(
      { id: uuidv4(), userId: opp.userId, type: 'bet', amount: -amt, matchId: roomId, date: new Date().toISOString() },
      { id: uuidv4(), userId: req.user.id, type: 'bet', amount: -amt, matchId: roomId, date: new Date().toISOString() }
    );
    saveDB();
    return res.json({ matched: true, roomId, pot: amt * 2, opponent: oppUser.username });
  }

  const entry = { userId: req.user.id, gameId, amount: amt, date: new Date().toISOString() };
  matchQueue.push(entry);
  res.json({ matched: false, queued: true });
});

app.post('/api/cancel-match', authMiddleware, (req, res) => {
  matchQueue = matchQueue.filter(m => m.userId !== req.user.id);
  res.json({ success: true });
});

const BOT_ID = 'oasis-bot-ai';
const BOT_USER = { id: BOT_ID, username: 'Oasis Bot', balance: 0, wins: 0, totalEarnings: 0, role: 'player' };

app.post('/api/freeplay', authMiddleware, (req, res) => {
  const { gameId } = req.body;
  const game = GAMES.find(g => g.id === gameId);
  if (!game) return res.status(400).json({ error: 'Invalid game' });

  const roomId = uuidv4();
  const room = {
    id: roomId, gameId, pot: 0,
    players: [req.user.id, BOT_ID], moves: {}, scores: {},
    status: 'playing', freePlay: true, startedAt: new Date().toISOString()
  };
  activeRooms[roomId] = room;

  broadcastToUser(req.user.id, { type: 'match_found', roomId, game: gameId, pot: 0, opponent: 'Oasis Bot', freePlay: true });
  res.json({ matched: true, roomId, pot: 0, opponent: 'Oasis Bot', freePlay: true });
});

function botMove(room) {
  const gameId = room.gameId;
  const botId = BOT_ID;
  const userId = room.players[0];
  const delay = 600 + Math.random() * 1000;

  setTimeout(() => {
    switch (gameId) {
      case 'rps': {
        const moves = ['rock', 'paper', 'scissors'];
        processGameMove(room, botId, userId, { type: 'game_move', move: moves[Math.floor(Math.random() * 3)] });
        break;
      }
      case 'tic-tac-toe': {
        if (!room.board) { processGameMove(room, botId, userId, { type: 'game_move' }); return; }
        const empty = room.board.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
        if (empty.length === 0) return;
        const botMark = room.turn % 2 === 0 ? 'X' : 'O';
        const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        let bestCell = empty[Math.floor(Math.random() * empty.length)];
        for (const [a,b,c] of lines) {
          const vals = [room.board[a], room.board[b], room.board[c]];
          if (vals.filter(v => v === botMark).length === 2 && vals.includes(null)) {
            bestCell = [a,b,c][vals.indexOf(null)];
          }
          const oppMark = botMark === 'X' ? 'O' : 'X';
          if (vals.filter(v => v === oppMark).length === 2 && vals.includes(null)) {
            bestCell = [a,b,c][vals.indexOf(null)];
          }
        }
        processGameMove(room, botId, userId, { type: 'game_move', cell: bestCell });
        break;
      }
      case 'higher-lower': {
        processGameMove(room, botId, userId, { type: 'game_move', guess: Math.random() > 0.5 ? 'higher' : 'lower' });
        break;
      }
      case 'dice-duel': {
        processGameMove(room, botId, userId, { type: 'game_move' });
        break;
      }
      case 'memory-match': {
        const unrevealed = [];
        if (room.memCards) {
          for (let i = 0; i < 16; i++) {
            if (!room.memRevealed[i] && !room.memFlipped?.some(f => f.idx === i)) unrevealed.push(i);
          }
        }
        const idx = unrevealed.length > 0 ? unrevealed[Math.floor(Math.random() * unrevealed.length)] : Math.floor(Math.random() * 16);
        processGameMove(room, botId, userId, { type: 'game_move', index: idx });
        break;
      }
      case 'math-rush': {
        if (room.mathQ) {
          const correct = Math.random() > 0.35;
          const ans = correct ? room.mathQ.answer : room.mathQ.answer + Math.floor(Math.random() * 10) - 5;
          processGameMove(room, botId, userId, { type: 'game_move', answer: ans });
        }
        break;
      }
      case 'street-racer': {
        const actions = ['boost', 'drift', 'slipstream', 'ram'];
        processGameMove(room, botId, userId, { type: 'game_move', action: actions[Math.floor(Math.random() * 4)] });
        break;
      }
      case 'boxing-ring': {
        const punches = ['jab', 'hook', 'uppercut', 'block', 'dodge'];
        processGameMove(room, botId, userId, { type: 'game_move', punch: punches[Math.floor(Math.random() * 5)] });
        break;
      }
      case 'street-fighter': {
        const moves = ['punch', 'kick', 'block', 'heal'];
        const botState = room.sfState?.[botId];
        if (botState && botState.energy >= 30 && Math.random() > 0.6) moves.push('fireball');
        if (botState && botState.energy >= 40 && Math.random() > 0.7) moves.push('shoryuken');
        processGameMove(room, botId, userId, { type: 'game_move', move: moves[Math.floor(Math.random() * moves.length)] });
        break;
      }
    }
  }, delay);
}

let matchQueue = [];
let activeRooms = {};

// ===================== LEADERBOARD =====================
app.get('/api/leaderboard', authMiddleware, (req, res) => {
  const top = db.users
    .filter(u => u.role === 'player')
    .sort((a, b) => b.totalEarnings - a.totalEarnings)
    .slice(0, 50)
    .map((u, i) => ({ rank: i + 1, username: u.username, earnings: u.totalEarnings, wins: u.wins }));
  res.json({ leaderboard: top });
});

// ===================== MATCH HISTORY =====================
app.get('/api/matches', authMiddleware, (req, res) => {
  const matches = db.matches
    .filter(m => m.players.includes(req.user.id))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 50);
  res.json({ matches });
});

// ===================== ONLINE PLAYERS =====================
app.get('/api/online', authMiddleware, (req, res) => {
  const online = Array.from(wsConnections.keys()).filter(id => id !== req.user.id);
  const users = online.map(id => {
    const u = findUser({ id });
    return u ? { id: u.id, username: u.username, wins: u.wins, earnings: u.totalEarnings } : null;
  }).filter(Boolean);
  res.json({ players: users });
});

// ===================== ADMIN =====================
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const totalUsers = db.users.length;
  const totalBalance = db.users.reduce((s, u) => s + u.balance, 0);
  const totalMatches = db.matches.length;
  const totalWagered = db.matches.reduce((s, m) => s + (m.pot || 0), 0);
  const pendingDeposits = db.deposits.filter(d => d.status === 'pending').length;
  const pendingWithdrawals = db.withdrawals.filter(w => w.status === 'pending').length;
  res.json({ totalUsers, totalBalance, totalMatches, totalWagered, pendingDeposits, pendingWithdrawals });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ users: db.users.map(sanitize) });
});

app.get('/api/admin/deposits', authMiddleware, adminMiddleware, (req, res) => {
  const { status } = req.query;
  let deps = db.deposits;
  if (status) deps = deps.filter(d => d.status === status);
  res.json({ deposits: deps.sort((a, b) => new Date(b.date) - new Date(a.date)) });
});

app.put('/api/admin/deposits/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
  const dep = db.deposits.find(d => d.id === req.params.id);
  if (!dep) return res.status(404).json({ error: 'Not found' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  dep.status = 'approved';
  const user = findUser({ id: dep.userId });
  if (user) {
    user.balance = Math.round((user.balance + dep.amount) * 100) / 100;
    db.transactions.push({ id: uuidv4(), userId: dep.userId, type: 'deposit', amount: dep.amount, date: new Date().toISOString() });
    broadcastToUser(dep.userId, { type: 'deposit_approved', amount: dep.amount });
  }
  saveDB();
  res.json({ success: true });
});

app.put('/api/admin/deposits/:id/reject', authMiddleware, adminMiddleware, (req, res) => {
  const dep = db.deposits.find(d => d.id === req.params.id);
  if (!dep) return res.status(404).json({ error: 'Not found' });
  dep.status = 'rejected';
  saveDB();
  res.json({ success: true });
});

app.get('/api/admin/withdrawals', authMiddleware, adminMiddleware, (req, res) => {
  const { status } = req.query;
  let wds = db.withdrawals;
  if (status) wds = wds.filter(w => w.status === status);
  res.json({ withdrawals: wds.sort((a, b) => new Date(b.date) - new Date(a.date)) });
});

app.put('/api/admin/withdrawals/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
  const wd = db.withdrawals.find(w => w.id === req.params.id);
  if (!wd) return res.status(404).json({ error: 'Not found' });
  if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  wd.status = 'approved';
  const user = findUser({ id: wd.userId });
  if (user) {
    db.transactions.push({ id: uuidv4(), userId: wd.userId, type: 'withdrawal', amount: -wd.amount, date: new Date().toISOString() });
    broadcastToUser(wd.userId, { type: 'withdrawal_approved', amount: wd.netAmount });
  }
  saveDB();
  res.json({ success: true });
});

app.put('/api/admin/withdrawals/:id/reject', authMiddleware, adminMiddleware, (req, res) => {
  const wd = db.withdrawals.find(w => w.id === req.params.id);
  if (!wd) return res.status(404).json({ error: 'Not found' });
  if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  wd.status = 'rejected';
  const user = findUser({ id: wd.userId });
  if (user) user.balance = Math.round((user.balance + wd.amount) * 100) / 100;
  saveDB();
  res.json({ success: true });
});

app.get('/api/admin/matches', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ matches: db.matches.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 100) });
});

// ===================== WEBSOCKET =====================
const wsConnections = new Map();

wss.on('connection', (ws, req) => {
  let userId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'auth') {
        const user = findUser({ id: msg.userId });
        if (!user) { ws.close(); return; }
        userId = user.id;
        wsConnections.set(userId, ws);
        broadcastOnlineCount();
        return;
      }

      if (!userId) return;

      if (msg.type === 'game_move') {
        const room = activeRooms[msg.roomId];
        if (!room || !room.players.includes(userId)) return;
        processGameMove(room, userId, msg);
      }

      if (msg.type === 'game_score') {
        const room = activeRooms[msg.roomId];
        if (!room || !room.players.includes(userId)) return;
        handleGameScore(room, userId, msg);
      }

      if (msg.type === 'chat') {
        const user = findUser({ id: userId });
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'chat', username: user.username, message: msg.message, date: new Date().toISOString() }));
          }
        });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (userId) wsConnections.delete(userId);
    broadcastOnlineCount();
  });
});

function broadcastToUser(userId, data) {
  const ws = wsConnections.get(userId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcastOnlineCount() {
  const count = wsConnections.size;
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'online_count', count }));
  });
}

// ===================== GAME ENGINES =====================

function handleGameScore(room, userId, msg) {
  if (!room.scores) room.scores = {};
  if (room.scores[userId] !== undefined) return;
  room.scores[userId] = msg.score || 0;

  if (room.freePlay) {
    const botScore = generateBotScore(room.gameId);
    room.scores[BOT_ID] = botScore;
    const won = (msg.score || 0) > botScore;
    const draw = (msg.score || 0) === botScore;
    endMatch(room, draw ? null : (won ? userId : BOT_ID));
  } else {
    const p1 = room.players[0], p2 = room.players[1];
    if (room.scores[p1] !== undefined && room.scores[p2] !== undefined) {
      const s1 = room.scores[p1], s2 = room.scores[p2];
      endMatch(room, s1 > s2 ? p1 : s2 > s1 ? p2 : null);
    } else {
      const opp = room.players.find(p => p !== userId);
      broadcastToUser(opp, { type: 'opponent_scored', roomId: room.id });
    }
  }
}

function generateBotScore(gameId) {
  const r = Math.random;
  switch (gameId) {
    case 'pac-man': return Math.floor(r() * 8000) + 2000;
    case 'frogger': return Math.floor(r() * 25) + 8;
    case 'asteroids': return Math.floor(r() * 6000) + 1500;
    case 'galaga': return Math.floor(r() * 12000) + 3000;
    case 'centipede': return Math.floor(r() * 10000) + 2000;
    case 'defender': return Math.floor(r() * 15000) + 4000;
    case 'tetris': return Math.floor(r() * 30) + 5;
    case 'arkanoid': return Math.floor(r() * 5000) + 1000;
    case 'helicopter': return Math.floor(r() * 800) + 200;
    case 'geometry-dash': return Math.floor(r() * 5000) + 1000;
    case 'crossy-road': return Math.floor(r() * 40) + 10;
    default: return Math.floor(r() * 100);
  }
}

function endMatch(room, winnerId) {
  room.status = 'finished';
  const match = {
    id: room.id, gameId: room.gameId, players: room.players,
    pot: room.pot, winnerId, date: new Date().toISOString()
  };
  db.matches.push(match);

  if (room.freePlay) {
    broadcastToUser(room.players[0], { type: 'match_over', roomId: room.id, won: winnerId === room.players[0], amount: 0, freePlay: true });
    saveDB();
    delete activeRooms[room.id];
    return;
  }

  if (winnerId) {
    const winner = findUser({ id: winnerId });
    const loserId = room.players.find(p => p !== winnerId);
    winner.balance = Math.round((winner.balance + room.pot) * 100) / 100;
    winner.wins++;
    winner.totalEarnings = Math.round((winner.totalEarnings + room.pot) * 100) / 100;
    const loser = findUser({ id: loserId });
    if (loser) { loser.losses++; loser.totalSpent = Math.round((loser.totalSpent + (room.pot / 2)) * 100) / 100; }

    db.transactions.push({ id: uuidv4(), userId: winnerId, type: 'win', amount: room.pot, matchId: room.id, date: new Date().toISOString() });
    broadcastToUser(winnerId, { type: 'match_over', roomId: room.id, won: true, amount: room.pot });
    broadcastToUser(loserId, { type: 'match_over', roomId: room.id, won: false, amount: room.pot / 2 });
  } else {
    room.players.forEach(pid => {
      const u = findUser({ id: pid });
      if (u) u.balance = Math.round((u.balance + room.pot / 2) * 100) / 100;
      db.transactions.push({ id: uuidv4(), userId: pid, type: 'refund', amount: room.pot / 2, matchId: room.id, date: new Date().toISOString() });
      broadcastToUser(pid, { type: 'match_over', roomId: room.id, won: null, amount: room.pot / 2, draw: true });
    });
  }
  saveDB();
  delete activeRooms[room.id];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ===================== CLEANUP =====================
setInterval(() => {
  const now = Date.now();
  Object.keys(activeRooms).forEach(id => {
    const room = activeRooms[id];
    if (now - new Date(room.startedAt).getTime() > 10 * 60 * 1000) {
      endMatch(room, null);
    }
  });
  matchQueue = matchQueue.filter(m => (now - new Date(m.date).getTime()) < 5 * 60 * 1000);
}, 30000);

// ===================== CATCH ALL =====================
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, () => console.log(`Oasis running on port ${PORT}`));
