const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── In-memory state ────────────────────────────────────────────────────────

const races = {};       // raceCode -> race object
const sseClients = {};  // raceCode -> [res, res, ...]

// ─── Question Generator ──────────────────────────────────────────────────────

const NAMES = ['עמי','דנה','יוסי','רינה','אדם','מיה','נועה','אורי','גל','שיר','טל','רון','לי','אבי','נתן','ספיר','דור','יעל','עומר','אריה'];
const OBJECTS = ['תפוחים','כדורים','עוגיות','ספרים','מטבעות','ארטיקים','גלידות','פרחים'];
const ACTIONS = ['קנה','מצא','אסף','נתן לחבר','חילק שווה'];
const OPERATORS = ['+', '-', '×', '÷'];

function generateQuestion(difficulty) {
  // difficulty: 1 (easy) .. 3 (hard)
  const type = Math.random() < 0.5 ? 'arithmetic' : 'word';

  if (type === 'arithmetic') {
    let a, b, op, answer;
    if (difficulty === 1) {
      a = rand(1, 20); b = rand(1, 20); op = randFrom(['+', '-']);
    } else if (difficulty === 2) {
      a = rand(5, 50); b = rand(2, 12);
      op = randFrom(['+', '-', '×']);
    } else {
      a = rand(10, 100); b = rand(2, 12);
      op = randFrom(['+', '-', '×', '÷']);
    }

    if (op === '+') answer = a + b;
    else if (op === '-') { if (a < b) [a, b] = [b, a]; answer = a - b; }
    else if (op === '×') answer = a * b;
    else { // ÷ - ensure clean division
      answer = rand(1, 12); a = answer * b;
    }

    return {
      text: `${a} ${op} ${b} = ?`,
      answer: String(answer),
      difficulty
    };
  } else {
    // word problem
    const name = randFrom(NAMES);
    const obj = randFrom(OBJECTS);
    const amount = rand(2, difficulty === 1 ? 10 : difficulty === 2 ? 20 : 50);
    const amount2 = rand(1, amount);
    const action = randFrom(['+', '-']);
    const answer = action === '+' ? amount + amount2 : amount - amount2;
    const actionWord = action === '+' ? 'קיבל עוד' : 'נתן';

    return {
      text: `ל${name} היו ${amount} ${obj}. הוא ${actionWord} ${amount2}. כמה ${obj} יש לו עכשיו?`,
      answer: String(answer),
      difficulty
    };
  }
}

function generateHighwayQuestion() {
  // Hard: multi-step
  const a = rand(10, 99), b = rand(2, 9), c = rand(1, 9);
  const answer = a * b + c;
  return {
    text: `(${a} × ${b}) + ${c} = ?`,
    answer: String(answer),
    difficulty: 3,
    isHighway: true
  };
}

function generateDirtQuestion() {
  const a = rand(1, 15), b = rand(1, 15);
  return {
    text: `${a} + ${b} = ?`,
    answer: String(a + b),
    difficulty: 1,
    isDirt: true
  };
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── SSE Helpers ─────────────────────────────────────────────────────────────

function addSSEClient(raceCode, res) {
  if (!sseClients[raceCode]) sseClients[raceCode] = [];
  sseClients[raceCode].push(res);
}

function removeSSEClient(raceCode, res) {
  if (!sseClients[raceCode]) return;
  sseClients[raceCode] = sseClients[raceCode].filter(r => r !== res);
}

function broadcast(raceCode, event, data) {
  const clients = sseClients[raceCode] || [];
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch(e) {}
  });
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

const RACE_LENGTH = 1000;
const MAX_PLAYERS = 8;
const ANSWER_TIME = 15; // seconds

function calcProgress(correct, difficulty, timeLeft) {
  const base = [0, 10, 20, 40][difficulty];
  const speedBonus = Math.floor((timeLeft / ANSWER_TIME) * 5);
  return base + speedBonus;
}

function checkLuckEvent(player) {
  // Players behind get higher luck
  const race = races[player.raceCode];
  if (!race) return null;
  const positions = Object.values(race.players).map(p => p.position);
  const maxPos = Math.max(...positions);
  const isLagging = player.position < maxPos * 0.5 && maxPos > 100;
  const luckChance = isLagging ? 0.25 : 0.08;

  if (Math.random() < luckChance) {
    const events = [
      { type: 'turbo', label: '🚀 טורבו!', effect: 80 },
      { type: 'turbo', label: '⚡ בוסט!', effect: 50 },
    ];
    if (!isLagging) {
      events.push({ type: 'breakdown', label: '🔧 תקלה ברכב!', effect: -0, slowDuration: 8000 });
    }
    return randFrom(events);
  }
  return null;
}

function shouldTriggerDecision(player) {
  // Accumulates decision meter
  player.decisionMeter = (player.decisionMeter || 0) + rand(15, 35);
  if (player.decisionMeter >= 100) {
    player.decisionMeter = 0;
    return true;
  }
  return false;
}

function sendNextQuestion(raceCode, playerId) {
  const race = races[raceCode];
  const player = race?.players[playerId];
  if (!race || !player || race.status !== 'running') return;
  if (player.waitingDecision || player.inDirt) return;

  const diff = player.position < 300 ? 1 : player.position < 600 ? 2 : 3;
  const q = generateQuestion(diff);
  player.currentQuestion = q;
  player.questionSentAt = Date.now();

  // Send question only to this player
  const clients = sseClients[raceCode] || [];
  const payload = `event: question\ndata: ${JSON.stringify({ playerId, question: q, timeLimit: ANSWER_TIME })}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch(e) {}
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, '../public/teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/race', (req, res) => res.sendFile(path.join(__dirname, '../public/race.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/dashboard.html')));

// Teacher: create race
app.post('/api/race/create', (req, res) => {
  const code = Math.random().toString(36).substring(2, 7).toUpperCase();
  races[code] = {
    code,
    status: 'waiting', // waiting | running | finished
    players: {},
    createdAt: Date.now(),
    winner: null
  };
  res.json({ code });
});

// Student: join race
app.post('/api/race/join', (req, res) => {
  const { code, name } = req.body;
  const race = races[code];
  if (!race) return res.status(404).json({ error: 'קוד חדר לא נמצא' });
  if (race.status !== 'waiting') return res.status(400).json({ error: 'המרוץ כבר התחיל' });
  if (Object.keys(race.players).length >= MAX_PLAYERS) return res.status(400).json({ error: 'החדר מלא' });

  const playerId = uuidv4();
  const vehicles = ['🏎️','🚗','🚕','🚙','🛻','🚓','🚑','🚒'];
  const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F'];
  const idx = Object.keys(race.players).length;

  race.players[playerId] = {
    id: playerId,
    name,
    raceCode: code,
    position: 0,
    vehicle: vehicles[idx % vehicles.length],
    color: colors[idx % colors.length],
    currentQuestion: null,
    questionSentAt: null,
    decisionMeter: 0,
    waitingDecision: false,
    inDirt: false,
    dirtQuestionsLeft: 0,
    slowUntil: 0,
    score: 0,
    correctCount: 0,
    wrongCount: 0,
    finished: false
  };

  broadcast(code, 'playerJoined', {
    players: sanitizePlayers(race.players),
    count: Object.keys(race.players).length
  });

  res.json({ playerId, vehicle: race.players[playerId].vehicle, color: race.players[playerId].color });
});

// Get race info
app.get('/api/race/:code', (req, res) => {
  const race = races[req.params.code];
  if (!race) return res.status(404).json({ error: 'לא נמצא' });
  res.json({
    code: race.code,
    status: race.status,
    players: sanitizePlayers(race.players),
    winner: race.winner
  });
});

// Teacher: end race manually
app.post('/api/race/:code/end', (req, res) => {
  const race = races[req.params.code];
  if (!race) return res.status(404).json({ error: 'לא נמצא' });
  race.status = 'finished';
  const standings = getFinalStandings(race);
  const leader = standings[0];
  race.winner = leader ? leader.name : 'אף אחד';
  broadcast(race.code, 'raceFinished', {
    winner: race.winner,
    winnerId: leader ? Object.values(race.players).find(p => p.name === race.winner)?.id : null,
    finalStandings: standings
  });
  res.json({ ok: true });
});

// Teacher: start race
app.post('/api/race/:code/start', (req, res) => {
  const race = races[req.params.code];
  if (!race) return res.status(404).json({ error: 'לא נמצא' });
  if (Object.keys(race.players).length < 1) return res.status(400).json({ error: 'אין שחקנים' });

  race.status = 'running';
  broadcast(race.code, 'raceStarted', { players: sanitizePlayers(race.players) });

  // Send first question to each player after a short delay
  setTimeout(() => {
    Object.keys(race.players).forEach(pid => sendNextQuestion(race.code, pid));
  }, 3000);

  res.json({ ok: true });
});

// Student: submit answer
app.post('/api/race/:code/answer', (req, res) => {
  const { playerId, answer } = req.body;
  const race = races[req.params.code];
  if (!race || race.status !== 'running') return res.status(400).json({ error: 'מרוץ לא פעיל' });

  const player = race.players[playerId];
  if (!player || !player.currentQuestion) return res.status(400).json({ error: 'אין שאלה פעילה' });

  const q = player.currentQuestion;
  const timeLeft = Math.max(0, ANSWER_TIME - (Date.now() - player.questionSentAt) / 1000);
  const correct = answer.trim() === q.answer.trim();

  player.currentQuestion = null;

  if (correct) {
    player.correctCount++;
    let progress = calcProgress(correct, q.difficulty, timeLeft);

    // Apply slow effect
    if (Date.now() < player.slowUntil) progress = Math.floor(progress * 0.5);

    player.position = Math.min(RACE_LENGTH, player.position + progress);
    player.score += progress;

    // Check luck event
    const luck = checkLuckEvent(player);
    if (luck) {
      if (luck.type === 'turbo') {
        player.position = Math.min(RACE_LENGTH, player.position + luck.effect);
        player.score += luck.effect;
      } else if (luck.type === 'breakdown') {
        player.slowUntil = Date.now() + luck.slowDuration;
      }
      broadcast(race.code, 'luckEvent', { playerId, event: luck, position: player.position });
    }

    // Check win
    if (player.position >= RACE_LENGTH && !player.finished) {
      player.finished = true;
      if (!race.winner) {
        race.winner = player.name;
        race.status = 'finished';
        broadcast(race.code, 'raceFinished', {
          winner: player.name,
          winnerId: playerId,
          finalStandings: getFinalStandings(race)
        });
        return res.json({ correct: true, result: 'win' });
      }
    }

    // Broadcast position update
    broadcast(race.code, 'positionUpdate', {
      playerId,
      position: player.position,
      players: sanitizePlayers(race.players)
    });

    // Decision event?
    if (!player.finished && shouldTriggerDecision(player)) {
      player.waitingDecision = true;
      const clients = sseClients[race.code] || [];
      const payload = `event: decisionEvent\ndata: ${JSON.stringify({ playerId })}\n\n`;
      clients.forEach(r => { try { r.write(payload); } catch(e) {} });
      return res.json({ correct: true, progress, decision: true });
    }

    // Dirt road continuation
    if (player.inDirt) {
      player.dirtQuestionsLeft--;
      if (player.dirtQuestionsLeft <= 0) {
        player.inDirt = false;
        broadcast(race.code, 'dirtFinished', { playerId });
      }
    }

    res.json({ correct: true, progress, position: player.position });
    if (!player.finished) setTimeout(() => sendNextQuestion(race.code, playerId), 800);

  } else {
    player.wrongCount++;
    res.json({ correct: false, correctAnswer: q.answer });
    if (!player.finished) setTimeout(() => sendNextQuestion(race.code, playerId), 1500);
  }
});

// Student: choose highway or dirt road
app.post('/api/race/:code/decision', (req, res) => {
  const { playerId, choice } = req.body; // choice: 'highway' | 'dirt'
  const race = races[req.params.code];
  const player = race?.players[playerId];
  if (!player) return res.status(404).json({ error: 'לא נמצא' });

  player.waitingDecision = false;

  if (choice === 'highway') {
    const q = generateHighwayQuestion();
    player.currentQuestion = q;
    player.questionSentAt = Date.now();
    const clients = sseClients[race.code] || [];
    const payload = `event: highwayQuestion\ndata: ${JSON.stringify({ playerId, question: q, timeLimit: 20 })}\n\n`;
    clients.forEach(r => { try { r.write(payload); } catch(e) {} });
    res.json({ ok: true });
  } else {
    // Dirt road: 4 easy questions
    player.inDirt = true;
    player.dirtQuestionsLeft = 4;
    broadcast(race.code, 'choseDirt', { playerId });
    res.json({ ok: true });
    setTimeout(() => sendNextQuestion(race.code, playerId), 500);
  }
});

// Student: highway answer
app.post('/api/race/:code/highway-answer', (req, res) => {
  const { playerId, answer } = req.body;
  const race = races[req.params.code];
  const player = race?.players[playerId];
  if (!player || !player.currentQuestion) return res.status(400).json({ error: '' });

  const q = player.currentQuestion;
  const correct = answer.trim() === q.answer.trim();
  player.currentQuestion = null;

  if (correct) {
    const bonus = 200; // ~10 normal correct answers
    player.position = Math.min(RACE_LENGTH, player.position + bonus);
    player.score += bonus;
    broadcast(race.code, 'highwayResult', { playerId, success: true, bonus, position: player.position });
    broadcast(race.code, 'positionUpdate', { playerId, position: player.position, players: sanitizePlayers(race.players) });
  } else {
    const penalty = -80;
    player.position = Math.max(0, player.position + penalty);
    player.score = Math.max(0, player.score - 80);
    broadcast(race.code, 'highwayResult', { playerId, success: false, penalty, position: player.position });
    broadcast(race.code, 'positionUpdate', { playerId, position: player.position, players: sanitizePlayers(race.players) });
  }

  res.json({ correct, position: player.position });
  if (!player.finished) setTimeout(() => sendNextQuestion(race.code, playerId), 1500);
});

// Timeout: player didn't answer in time
app.post('/api/race/:code/timeout', (req, res) => {
  const { playerId } = req.body;
  const race = races[req.params.code];
  const player = race?.players[playerId];
  if (!player) return res.status(404).json({ error: '' });

  player.currentQuestion = null;
  res.json({ ok: true });
  if (!player.finished) setTimeout(() => sendNextQuestion(race.code, playerId), 500);
});

// SSE endpoint — all clients (teacher dashboard + students) connect here
app.get('/api/race/:code/events', (req, res) => {
  const race = races[req.params.code];
  if (!race) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state
  res.write(`event: init\ndata: ${JSON.stringify({
    status: race.status,
    players: sanitizePlayers(race.players)
  })}\n\n`);

  // Heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch(e) {}
  }, 20000);

  addSSEClient(req.params.code, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(req.params.code, res);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizePlayers(players) {
  return Object.values(players).map(p => ({
    id: p.id,
    name: p.name,
    position: p.position,
    vehicle: p.vehicle,
    color: p.color,
    score: p.score,
    correctCount: p.correctCount,
    wrongCount: p.wrongCount,
    finished: p.finished,
    slowUntil: p.slowUntil
  }));
}

function getFinalStandings(race) {
  return Object.values(race.players)
    .sort((a, b) => b.position - a.position)
    .map((p, i) => ({ rank: i + 1, name: p.name, position: p.position, score: p.score, vehicle: p.vehicle }));
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🏁 Math Race server running at http://localhost:${PORT}\n`);
  console.log('   Teacher dashboard: http://localhost:3000/teacher');
  console.log('   Student page:      http://localhost:3000/student\n');
});
