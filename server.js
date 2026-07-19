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
  { id: 'tic-tac-toe', name: 'Tic Tac Toe', icon: '⭕', minBet: 10, maxBet: 5000, players: 2, desc: 'Classic noughts and crosses. Get 3 in a row to win!' },
  { id: 'rps', name: 'Rock Paper Scissors', icon: '✊', minBet: 10, maxBet: 5000, players: 2, desc: 'Best of 3. Rock crushes Scissors, Scissors cuts Paper, Paper covers Rock.' },
  { id: 'higher-lower', name: 'Higher or Lower', icon: '🃏', minBet: 10, maxBet: 10000, players: 2, desc: 'Guess if the next card is higher or lower. Most correct wins.' },
  { id: 'dice-duel', name: 'Dice Duel', icon: '🎲', minBet: 10, maxBet: 5000, players: 2, desc: 'Roll the dice. Highest total after 3 rolls wins!' },
  { id: 'memory-match', name: 'Memory Match', icon: '🧠', minBet: 10, maxBet: 5000, players: 2, desc: 'Find matching pairs. Most pairs found wins!' },
  { id: 'math-rush', name: 'Math Rush', icon: '🔢', minBet: 10, maxBet: 5000, players: 2, desc: 'Solve math problems fastest. Most correct answers wins!' },
  { id: 'street-racer', name: 'Street Racer', icon: '🏎️', minBet: 10, maxBet: 10000, players: 2, desc: 'High-speed street racing! Dodge traffic and outpace your rival to the finish line.' },
  { id: 'boxing-ring', name: 'Boxing Ring', icon: '🥊', minBet: 10, maxBet: 10000, players: 2, desc: 'Step into the ring! Jab, hook, and uppercut your way to victory. Knockout wins the pot!' },
  { id: 'street-fighter', name: 'Street Fighter', icon: '🐉', minBet: 10, maxBet: 10000, players: 2, desc: 'Choose your fighter and battle! Execute combos and special moves to defeat your opponent.' },
  { id: 'tetris-clash', name: 'Tetris Clash', icon: '🧱', minBet: 10, maxBet: 5000, players: 2, desc: 'Race to clear lines! Send garbage blocks to your opponent. Last one standing wins!' },
  { id: 'block-puzzle', name: 'Block Puzzle', icon: '🟦', minBet: 10, maxBet: 5000, players: 2, desc: 'Fit blocks on the board and clear rows. Most points wins the showdown!' }
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
function processGameMove(room, userId, msg) {
  const pIdx = room.players.indexOf(userId);
  if (pIdx === -1) return;
  const oppId = room.players[1 - pIdx];

  switch (room.gameId) {
    case 'tic-tac-toe':
      handleTicTacToe(room, userId, oppId, msg);
      break;
    case 'rps':
      handleRPS(room, userId, oppId, msg);
      break;
    case 'higher-lower':
      handleHigherLower(room, userId, oppId, msg);
      break;
    case 'dice-duel':
      handleDiceDuel(room, userId, oppId, msg);
      break;
    case 'memory-match':
      handleMemoryMatch(room, userId, oppId, msg);
      break;
    case 'math-rush':
      handleMathRush(room, userId, oppId, msg);
      break;
    case 'street-racer':
      handleStreetRacer(room, userId, oppId, msg);
      break;
    case 'boxing-ring':
      handleBoxing(room, userId, oppId, msg);
      break;
    case 'street-fighter':
      handleStreetFighter(room, userId, oppId, msg);
      break;
    case 'tetris-clash':
      handleTetrisClash(room, userId, oppId, msg);
      break;
    case 'block-puzzle':
      handleBlockPuzzle(room, userId, oppId, msg);
      break;
  }

  if (room.freePlay && room.status === 'playing' && userId !== BOT_ID && room.players.includes(BOT_ID) && !room._botPending && room.gameId !== 'tetris-clash' && room.gameId !== 'block-puzzle') {
    room._botPending = true;
    setTimeout(() => { room._botPending = false; }, 300);
    botMove(room);
  }
}

function handleTicTacToe(room, userId, oppId, msg) {
  if (!room.board) { room.board = Array(9).fill(null); room.turn = 0; room.scores = { [room.players[0]]: 0, [room.players[1]]: 0 }; }
  if (room.players[room.turn % 2] !== userId) return;
  const cell = parseInt(msg.cell);
  if (isNaN(cell) || cell < 0 || cell > 8 || room.board[cell]) return;

  room.board[cell] = room.turn % 2 === 0 ? 'X' : 'O';
  room.turn++;

  const winner = checkTicTacToe(room.board);
  if (winner || room.turn === 9) {
    const p1 = room.players[0], p2 = room.players[1];
    if (winner === 'X') room.scores[p1]++;
    else if (winner === 'O') room.scores[p2]++;

    if (room.scores[p1] >= 2 || room.scores[p2] >= 2 || room.turn === 9) {
      endMatch(room, room.scores[p1] > room.scores[p2] ? p1 : room.scores[p2] > room.scores[p1] ? p2 : null);
    } else {
      room.board = Array(9).fill(null);
      room.turn = 0;
      broadcastToUser(userId, { type: 'game_update', roomId: room.id, board: room.board, scores: room.scores, nextTurn: true, message: `Round ${room.scores[p1] + room.scores[p2] + 1}` });
      broadcastToUser(oppId, { type: 'game_update', roomId: room.id, board: room.board, scores: room.scores, nextTurn: false, message: `Round ${room.scores[p1] + room.scores[p2] + 1}` });
    }
  } else {
    broadcastToUser(userId, { type: 'game_update', roomId: room.id, board: room.board, cell, mark: room.board[cell], nextTurn: false });
    broadcastToUser(oppId, { type: 'game_update', roomId: room.id, board: room.board, cell, mark: room.board[cell], nextTurn: true });
  }
}

function checkTicTacToe(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,c,d] of lines) { if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; }
  return null;
}

function handleRPS(room, userId, oppId, msg) {
  if (!room.moves) room.moves = {};
  if (!room.rpsRound) room.rpsRound = 1;
  if (!room.rpsScores) room.rpsScores = { [room.players[0]]: 0, [room.players[1]]: 0 };

  const move = msg.move;
  if (!['rock', 'paper', 'scissors'].includes(move)) return;
  room.moves[userId] = move;

  if (room.moves[oppId]) {
    const m1 = room.moves[room.players[0]];
    const m2 = room.moves[room.players[1]];
    let winner = null;
    if (m1 === m2) winner = 'draw';
    else if ((m1 === 'rock' && m2 === 'scissors') || (m1 === 'paper' && m2 === 'rock') || (m1 === 'scissors' && m2 === 'paper')) winner = room.players[0];
    else winner = room.players[1];

    if (winner !== 'draw') room.rpsScores[winner]++;
    room.rpsRound++;
    room.moves = {};

    if (room.rpsScores[room.players[0]] >= 2 || room.rpsScores[room.players[1]] >= 2 || room.rpsRound > 3) {
      const p1Score = room.rpsScores[room.players[0]];
      const p2Score = room.rpsScores[room.players[1]];
      endMatch(room, p1Score > p2Score ? room.players[0] : p2Score > p1Score ? room.players[1] : null);
    } else {
      broadcastToUser(userId, { type: 'rps_result', roomId: room.id, move1: m1, move2: m2, round: room.rpsRound - 1, scores: room.rpsScores, nextRound: true });
      broadcastToUser(oppId, { type: 'rps_result', roomId: room.id, move1: m1, move2: m2, round: room.rpsRound - 1, scores: room.rpsScores, nextRound: true });
    }
  } else {
    broadcastToUser(oppId, { type: 'rps_waiting', roomId: room.id });
  }
}

function handleHigherLower(room, userId, oppId, msg) {
  if (!room.hlDeck) {
    room.hlDeck = shuffleDeck();
    room.hlScores = { [room.players[0]]: 0, [room.players[1]]: 0 };
    room.hlTurn = 0;
    room.hlCurrent = room.hlDeck.pop();
    room.hlRound = 0;
  }

  if (room.players[room.hlTurn % 2] !== userId) return;

  const guess = msg.guess;
  if (!['higher', 'lower'].includes(guess)) return;

  const nextCard = room.hlDeck.pop();
  const correct = (guess === 'higher' && nextCard.value > room.hlCurrent.value) || (guess === 'lower' && nextCard.value < room.hlCurrent.value);
  if (correct) room.hlScores[userId]++;
  room.hlCurrent = nextCard;
  room.hlRound++;
  room.hlTurn++;

  broadcastToUser(userId, { type: 'hl_update', roomId: room.id, card: nextCard, correct, scores: room.hlScores, round: room.hlRound });
  broadcastToUser(oppId, { type: 'hl_update', roomId: room.id, card: nextCard, correct, scores: room.hlScores, round: room.hlRound });

  if (room.hlRound >= 10) {
    const p1s = room.hlScores[room.players[0]];
    const p2s = room.hlScores[room.players[1]];
    endMatch(room, p1s > p2s ? room.players[0] : p2s > p1s ? room.players[1] : null);
  }
}

function handleDiceDuel(room, userId, oppId, msg) {
  if (!room.diceRolls) { room.diceRolls = { [room.players[0]]: 0, [room.players[1]]: 0 }; room.diceTurn = 0; room.diceRound = 0; }

  if (room.players[room.diceTurn % 2] !== userId) return;
  const roll = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
  room.diceRolls[userId] += roll;
  room.diceRound++;
  room.diceTurn++;

  broadcastToUser(userId, { type: 'dice_roll', roomId: room.id, playerId: userId, roll, totals: room.diceRolls, round: room.diceRound });
  broadcastToUser(oppId, { type: 'dice_roll', roomId: room.id, playerId: userId, roll, totals: room.diceRolls, round: room.diceRound });

  if (room.diceRound >= 6) {
    const p1 = room.players[0], p2 = room.players[1];
    endMatch(room, room.diceRolls[p1] > room.diceRolls[p2] ? p1 : room.diceRolls[p2] > room.diceRolls[p1] ? p2 : null);
  }
}

function handleMemoryMatch(room, userId, oppId, msg) {
  if (!room.memCards) {
    const pairs = 8;
    const vals = [];
    for (let i = 1; i <= pairs; i++) { vals.push(i, i); }
    room.memCards = shuffleArray(vals);
    room.memRevealed = Array(16).fill(false);
    room.memFlipped = [];
    room.memPairs = { [room.players[0]]: 0, [room.players[1]]: 0 };
    room.memTurn = 0;
  }

  if (room.players[room.memTurn % 2] !== userId) return;
  const idx = parseInt(msg.index);
  if (isNaN(idx) || idx < 0 || idx > 15 || room.memRevealed[idx] || room.memFlipped.length >= 2) return;

  room.memFlipped.push({ idx, val: room.memCards[idx], userId });
  broadcastToUser(userId, { type: 'mem_flip', roomId: room.id, index: idx, value: room.memCards[idx] });
  broadcastToUser(oppId, { type: 'mem_flip', roomId: room.id, index: idx, value: room.memCards[idx] });

  if (room.memFlipped.length === 2) {
    const [a, b] = room.memFlipped;
    if (a.val === b.val) {
      room.memRevealed[a.idx] = true;
      room.memRevealed[b.idx] = true;
      room.memPairs[userId]++;
      broadcastToUser(userId, { type: 'mem_match', roomId: room.id, indices: [a.idx, b.idx], playerId: userId });
      broadcastToUser(oppId, { type: 'mem_match', roomId: room.id, indices: [a.idx, b.idx], playerId: userId });
    }
    room.memFlipped = [];
    room.memTurn++;

    const totalPairs = room.memPairs[room.players[0]] + room.memPairs[room.players[1]];
    if (totalPairs >= 8) {
      const p1 = room.players[0], p2 = room.players[1];
      endMatch(room, room.memPairs[p1] > room.memPairs[p2] ? p1 : room.memPairs[p2] > room.memPairs[p1] ? p2 : null);
    }
  }
}

function handleMathRush(room, userId, oppId, msg) {
  if (!room.mathQ) {
    room.mathQ = generateMathProblem();
    room.mathScores = { [room.players[0]]: 0, [room.players[1]]: 0 };
    room.mathRound = 0;
    room.mathAnswers = {};
    broadcastToUser(room.players[0], { type: 'math_new', roomId: room.id, question: room.mathQ.text });
    broadcastToUser(room.players[1], { type: 'math_new', roomId: room.id, question: room.mathQ.text });
  }

  if (msg.answer !== undefined && !room.mathAnswers[userId]) {
    room.mathAnswers[userId] = { answer: parseInt(msg.answer), time: Date.now() };
  }

  if (Object.keys(room.mathAnswers).length === 2) {
    const p1 = room.players[0], p2 = room.players[1];
    const a1 = room.mathAnswers[p1], a2 = room.mathAnswers[p2];
    if (a1 && a1.answer === room.mathQ.answer) room.mathScores[p1]++;
    if (a2 && a2.answer === room.mathQ.answer) room.mathScores[p2]++;
    room.mathRound++;
    room.mathAnswers = {};

    broadcastToUser(userId, { type: 'math_result', roomId: room.id, scores: room.mathScores, answer: room.mathQ.answer, round: room.mathRound });
    broadcastToUser(oppId, { type: 'math_result', roomId: room.id, scores: room.mathScores, answer: room.mathQ.answer, round: room.mathRound });

    if (room.mathRound >= 10) {
      endMatch(room, room.mathScores[p1] > room.mathScores[p2] ? p1 : room.mathScores[p2] > room.mathScores[p1] ? p2 : null);
    } else {
      room.mathQ = generateMathProblem();
      broadcastToUser(p1, { type: 'math_new', roomId: room.id, question: room.mathQ.text });
      broadcastToUser(p2, { type: 'math_new', roomId: room.id, question: room.mathQ.text });
    }
  }
}

// ===================== STREET RACER =====================
function handleStreetRacer(room, userId, oppId, msg) {
  if (!room.racerState) {
    room.racerState = { [room.players[0]]: { pos: 0, hp: 100 }, [room.players[1]]: { pos: 0, hp: 100 } };
    room.racerTurn = 0;
    room.racerRound = 0;
  }
  if (room.players[room.racerTurn % 2] !== userId) return;

  const action = msg.action;
  const state = room.racerState;
  const oppState = room.racerState[oppId];

  let speed = 0, dmg = 0;
  switch (action) {
    case 'boost': speed = Math.floor(Math.random() * 30) + 20; dmg = 0; break;
    case 'drift': speed = Math.floor(Math.random() * 15) + 10; dmg = 15; break;
    case 'slipstream': speed = Math.floor(Math.random() * 25) + 15; dmg = 10; break;
    case 'ram': speed = 10; dmg = 25; break;
    default: speed = Math.floor(Math.random() * 10) + 5;
  }

  state[userId].pos += speed;
  state[userId].hp = Math.max(0, state[userId].hp - Math.floor(Math.random() * 10));
  oppState.hp = Math.max(0, oppState.hp - dmg);
  room.racerTurn++;
  room.racerRound++;

  const finished = state[userId].pos >= 500 || oppState.hp <= 0 || state[userId].hp <= 0 || room.racerRound >= 20;
  broadcastToUser(userId, { type: 'racer_update', roomId: room.id, playerId: userId, action, speed, dmg, state: JSON.parse(JSON.stringify(state)), finished });
  broadcastToUser(oppId, { type: 'racer_update', roomId: room.id, playerId: userId, action, speed, dmg, state: JSON.parse(JSON.stringify(state)), finished });

  if (finished) {
    const p1 = room.players[0], p2 = room.players[1];
    const s1 = state[p1].pos, s2 = state[p2].pos;
    const w = s1 > s2 ? p1 : s2 > s1 ? p2 : null;
    endMatch(room, w);
  }
}

// ===================== BOXING =====================
function handleBoxing(room, userId, oppId, msg) {
  if (!room.boxState) {
    room.boxState = { [room.players[0]]: { hp: 100, stamina: 100 }, [room.players[1]]: { hp: 100, stamina: 100 } };
    room.boxTurn = 0;
    room.boxRound = 0;
  }
  if (room.players[room.boxTurn % 2] !== userId) return;

  const punch = msg.punch;
  const state = room.boxState;
  const myState = state[userId];
  const oppSt = state[oppId];

  let dmg = 0, stamCost = 0;
  switch (punch) {
    case 'jab': dmg = Math.floor(Math.random() * 8) + 5; stamCost = 5; break;
    case 'hook': dmg = Math.floor(Math.random() * 15) + 10; stamCost = 15; break;
    case 'uppercut': dmg = Math.floor(Math.random() * 20) + 15; stamCost = 25; break;
    case 'block': dmg = 0; stamCost = 3; myState.stamina = Math.min(100, myState.stamina + 8); break;
    case 'dodge': dmg = 0; stamCost = 8; break;
    default: dmg = Math.floor(Math.random() * 5); stamCost = 5;
  }

  if (punch !== 'block' && punch !== 'dodge' && myState.stamina < stamCost) {
    dmg = Math.floor(dmg * 0.3);
    stamCost = 2;
  }
  myState.stamina = Math.max(0, myState.stamina - stamCost);
  oppSt.hp = Math.max(0, oppSt.hp - dmg);
  myState.stamina = Math.min(100, myState.stamina + 3);
  room.boxTurn++;
  room.boxRound++;

  const ko = oppSt.hp <= 0 || room.boxRound >= 12;
  broadcastToUser(userId, { type: 'box_update', roomId: room.id, playerId: userId, punch, dmg, state: JSON.parse(JSON.stringify(state)), ko });
  broadcastToUser(oppId, { type: 'box_update', roomId: room.id, playerId: userId, punch, dmg, state: JSON.parse(JSON.stringify(state)), ko });

  if (ko) {
    const p1 = room.players[0], p2 = room.players[1];
    const w = state[p1].hp > state[p2].hp ? p1 : state[p2].hp > state[p1].hp ? p2 : null;
    endMatch(room, w);
  }
}

// ===================== STREET FIGHTER =====================
function handleStreetFighter(room, userId, oppId, msg) {
  if (!room.sfState) {
    room.sfState = { [room.players[0]]: { hp: 100, energy: 50, fighter: 'dragon' }, [room.players[1]]: { hp: 100, energy: 50, fighter: 'phoenix' } };
    room.sfTurn = 0;
  }
  if (room.players[room.sfTurn % 2] !== userId) return;

  const move = msg.move;
  const myState = room.sfState[userId];
  const oppSt = room.sfState[oppId];

  let dmg = 0, energyGain = 5;
  switch (move) {
    case 'punch': dmg = Math.floor(Math.random() * 8) + 4; energyGain = 8; break;
    case 'kick': dmg = Math.floor(Math.random() * 12) + 8; energyGain = 5; break;
    case 'fireball': dmg = myState.energy >= 30 ? Math.floor(Math.random() * 20) + 15 : 3; myState.energy -= myState.energy >= 30 ? 30 : 0; energyGain = 0; break;
    case 'shoryuken': dmg = myState.energy >= 40 ? Math.floor(Math.random() * 25) + 20 : 5; myState.energy -= myState.energy >= 40 ? 40 : 0; energyGain = 0; break;
    case 'block': dmg = 0; energyGain = 12; break;
    case 'heal': dmg = 0; myState.hp = Math.min(100, myState.hp + 10); energyGain = -5; break;
    default: dmg = 4; energyGain = 5;
  }

  myState.energy = Math.min(100, Math.max(0, myState.energy + energyGain));
  oppSt.hp = Math.max(0, oppSt.hp - dmg);
  room.sfTurn++;

  broadcastToUser(userId, { type: 'sf_update', roomId: room.id, playerId: userId, move, dmg, state: JSON.parse(JSON.stringify(room.sfState)) });
  broadcastToUser(oppId, { type: 'sf_update', roomId: room.id, playerId: userId, move, dmg, state: JSON.parse(JSON.stringify(room.sfState)) });

  const p1 = room.players[0], p2 = room.players[1];
  if (oppSt.hp <= 0 || room.sfState[p1].hp <= 0 || room.sfState[p2].hp <= 0) {
    const w = room.sfState[p1].hp > room.sfState[p2].hp ? p1 : room.sfState[p2].hp > room.sfState[p1].hp ? p2 : null;
    endMatch(room, w);
  }
}

// ===================== TETRIS CLASH =====================
function handleTetrisClash(room, userId, oppId, msg) {
  if (!room.tetrisState) {
    room.tetrisState = { [room.players[0]]: { score: 0, lines: 0 }, [room.players[1]]: { score: 0, lines: 0 } };
    room.tetrisPieces = {};
    room.tetrisRound = 0;
  }

  if (msg.type === 'tetris_init') {
    room.tetrisPieces[userId] = true;
    broadcastToUser(userId, { type: 'tetris_start', roomId: room.id, pieces: generateTetrisPieces(20) });
    return;
  }

  if (msg.linesCleared) {
    const lines = msg.linesCleared;
    room.tetrisState[userId].lines += lines;
    room.tetrisState[userId].score += lines * lines * 100;
    if (lines >= 2) {
      room.tetrisState[oppId].penalty = (room.tetrisState[oppId].penalty || 0) + (lines - 1) * 2;
    }
  }

  broadcastToUser(oppId, { type: 'tetris_garbage', roomId: room.id, playerId: userId, penalty: msg.linesCleared >= 2 ? (msg.linesCleared - 1) * 2 : 0 });

  if (msg.gameOver) {
    const p1 = room.players[0], p2 = room.players[1];
    const w = room.tetrisState[p1].score > room.tetrisState[p2].score ? p1 :
              room.tetrisState[p2].score > room.tetrisState[p1].score ? p2 : null;
    endMatch(room, w);
  }
}

function generateTetrisPieces(count) {
  const shapes = ['I','O','T','S','Z','J','L'];
  const pieces = [];
  for (let i = 0; i < count; i++) pieces.push(shapes[Math.floor(Math.random() * shapes.length)]);
  return pieces;
}

// ===================== BLOCK PUZZLE =====================
function handleBlockPuzzle(room, userId, oppId, msg) {
  if (!room.blockState) {
    room.blockState = { [room.players[0]]: { score: 0, rows: 0 }, [room.players[1]]: { score: 0, rows: 0 } };
    room.blockTurn = 0;
  }

  if (msg.type === 'block_init') {
    broadcastToUser(userId, { type: 'block_start', roomId: room.id });
    return;
  }

  if (msg.rowsCleared) {
    const rows = msg.rowsCleared;
    const points = rows === 1 ? 100 : rows === 2 ? 300 : rows === 3 ? 500 : 800;
    room.blockState[userId].score += points;
    room.blockState[userId].rows += rows;

    broadcastToUser(oppId, { type: 'block_penalty', roomId: room.id, playerId: userId, rows });
  }

  if (msg.gameOver) {
    const p1 = room.players[0], p2 = room.players[1];
    const w = room.blockState[p1].score > room.blockState[p2].score ? p1 :
              room.blockState[p2].score > room.blockState[p1].score ? p2 : null;
    endMatch(room, w);
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

function shuffleDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const deck = [];
  for (const s of suits) for (let v = 2; v <= 14; v++) deck.push({ suit: s, value: v, name: v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : v === 14 ? 'A' : v });
  return shuffleArray(deck);
}

function generateMathProblem() {
  const ops = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;
  switch (op) {
    case '+': a = Math.floor(Math.random() * 50) + 1; b = Math.floor(Math.random() * 50) + 1; answer = a + b; break;
    case '-': a = Math.floor(Math.random() * 50) + 10; b = Math.floor(Math.random() * a); answer = a - b; break;
    case '×': a = Math.floor(Math.random() * 12) + 1; b = Math.floor(Math.random() * 12) + 1; answer = a * b; break;
  }
  return { text: `${a} ${op} ${b} = ?`, answer };
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
