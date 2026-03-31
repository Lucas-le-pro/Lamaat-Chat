
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path       = require('path');
const { queries } = require('./db');
const { handleMessage, botUser } = require('./bot');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: false } });

const PORT       = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'changez_ce_secret_en_prod';
const SALT_ROUNDS = 10;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Utilitaires auth ─────────────────────────────────────────
function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  const user  = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  req.user = user;
  next();
}

// ── Routes API ───────────────────────────────────────────────

// Inscription
app.post('/api/register', async (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ error: 'Pseudo : 2 à 20 caractères' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Mot de passe trop court (min 4 caractères)' });

  const existing = queries.getUserByName.get(username);
  if (existing) return res.status(409).json({ error: 'Pseudo déjà utilisé' });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const em   = avatar || '😀';
  const result = queries.createUser.run(username, hash, em);
  const userId = result.lastInsertRowid;

  // Ajouter au salon Général (id=1)
  queries.addMember.run(1, userId);

  // Créer DM privé avec le bot
  const botDmName = `dm_${Math.min(userId, botUser.id)}_${Math.max(userId, botUser.id)}`;
  const botDm = queries.createRoom.run(botDmName, 1, userId);
  const botRoomId = botDm.lastInsertRowid;
  queries.addMember.run(botRoomId, userId);
  queries.addMember.run(botRoomId, botUser.id);
  queries.insertMsg.run(botRoomId, botUser.id, `Salut ${username} ! 👋 Je suis LamaaBot, ton assistant perso. Pose-moi tes questions ici, je répondrai !`);

  const user  = { id: userId, username };
  const token = makeToken(user);
  res.cookie('token', token, { httpOnly: true, maxAge: 30*24*3600*1000, sameSite: 'lax' });
  res.json({ ok: true, user: { id: userId, username, avatar: em } });
});

// Connexion
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });

  const user = queries.getUserByName.get(username);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects' });

  const token = makeToken(user);
  res.cookie('token', token, { httpOnly: true, maxAge: 30*24*3600*1000, sameSite: 'lax' });
  res.json({ ok: true, user: { id: user.id, username: user.username, avatar: user.avatar } });
});

// Déconnexion
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// Utilisateur courant
app.get('/api/me', authMiddleware, (req, res) => {
  const user = queries.getUserById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  res.json(user);
});

// Liste des salons de l'utilisateur
app.get('/api/rooms', authMiddleware, (req, res) => {
  const rooms = queries.getUserRooms.all(req.user.id);
  // Pour les DMs, ajouter le nom de l'autre membre
  for (const r of rooms) {
    if (r.is_dm) {
      const members = queries.getMembers.all(r.id);
      const other = members.find(m => m.id !== req.user.id);
      if (other) { r._otherName = other.username; r._otherAvatar = other.avatar; }
    }
  }
  res.json(rooms);
});

// Créer un salon de groupe
app.post('/api/rooms', authMiddleware, (req, res) => {
  const { name, members } = req.body;
  if (!name || name.trim().length < 1) return res.status(400).json({ error: 'Nom requis' });

  const result = queries.createRoom.run(name.trim(), 0, req.user.id);
  const roomId = result.lastInsertRowid;
  queries.addMember.run(roomId, req.user.id);
  const allMembers = [req.user.id];
  if (Array.isArray(members)) {
    for (const uid of members) { queries.addMember.run(roomId, uid); allMembers.push(uid); }
  }
  const room = { id: roomId, name: name.trim(), is_dm: 0 };
  res.json(room);
  // Notifier tous les membres connectés
  notifyRoomAdded(allMembers, room);
});

// Ouvrir/trouver un DM avec un utilisateur
app.post('/api/dm', authMiddleware, (req, res) => {
  const { userId } = req.body;
  if (!userId || userId === req.user.id) return res.status(400).json({ error: 'Invalide' });

  // Chercher un DM existant entre les deux users
  const existing = queries.findDM.get(req.user.id, userId);

  if (existing) return res.json({ id: existing.id });

  const other = queries.getUserById.get(userId);
  if (!other) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const dmName = `dm_${Math.min(req.user.id, userId)}_${Math.max(req.user.id, userId)}`;
  const result = queries.createRoom.run(dmName, 1, req.user.id);
  const roomId = result.lastInsertRowid;
  queries.addMember.run(roomId, req.user.id);
  queries.addMember.run(roomId, userId);
  const me = queries.getUserById.get(req.user.id);
  res.json({ id: roomId, name: dmName, other });
  // Notifier les deux utilisateurs
  notifyRoomAdded([req.user.id], { id: roomId, name: dmName, is_dm: 1, _otherName: other.username, _otherId: other.id });
  notifyRoomAdded([userId],       { id: roomId, name: dmName, is_dm: 1, _otherName: me.username,   _otherId: req.user.id });
});

// Messages d'un salon
app.get('/api/rooms/:id/messages', authMiddleware, (req, res) => {
  const roomId = parseInt(req.params.id);
  if (!queries.isMember.get(roomId, req.user.id)) return res.status(403).json({ error: 'Accès refusé' });
  const messages = queries.getMessages.all(roomId);
  res.json(messages);
});

// Membres d'un salon
app.get('/api/rooms/:id/members', authMiddleware, (req, res) => {
  const roomId = parseInt(req.params.id);
  if (!queries.isMember.get(roomId, req.user.id)) return res.status(403).json({ error: 'Accès refusé' });
  res.json(queries.getMembers.all(roomId));
});

// Liste de tous les utilisateurs
app.get('/api/users', authMiddleware, (req, res) => {
  res.json(queries.getAllUsers.all().filter(u => u.id !== botUser.id));
});

// ── Socket.io ─────────────────────────────────────────────────
const onlineUsers = new Map(); // socketId → { id, username, avatar }

// Envoyer un événement à tous les sockets d'un ou plusieurs userIds
function notifyRoomAdded(userIds, room) {
  for (const [socketId, user] of onlineUsers) {
    if (userIds.includes(user.id)) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(`room:${room.id}`);
        socket.emit('room_added', room);
      }
    }
  }
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie
    ?.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
  const user = verifyToken(token);
  if (!user) return next(new Error('Non authentifié'));
  socket.user = user;
  next();
});

io.on('connection', socket => {
  const user = queries.getUserById.get(socket.user.id);
  if (!user) { socket.disconnect(); return; }

  onlineUsers.set(socket.id, user);
  io.emit('online', [...new Set([...onlineUsers.values()].map(u => u.id))]);

  // Rejoindre tous les salons de l'utilisateur
  const rooms = queries.getUserRooms.all(user.id);
  for (const r of rooms) socket.join(`room:${r.id}`);

  // Envoyer un message
  socket.on('send_message', ({ roomId, content }) => {
    if (!content || !content.trim()) return;
    if (!queries.isMember.get(roomId, user.id)) return;

    const text = content.trim().slice(0, 500000); // audio base64 peut être grand
    const result = queries.insertMsg.run(roomId, user.id, text);
    const msg = {
      id: result.lastInsertRowid,
      room_id: roomId,
      content: text,
      sent_at: Math.floor(Date.now() / 1000),
      user_id: user.id,
      username: user.username,
      avatar: user.avatar,
    };
    io.to(`room:${roomId}`).emit('message', msg);

    // Bot : détecter si c'est un DM privé bot
    if (!text.startsWith('data:audio/')) {
      const roomMembers = queries.getMembers.all(roomId);
      const isBotDM = roomMembers.length === 2 && roomMembers.some(m => m.id === botUser.id);
      handleMessage(io, roomId, user.id, text, isBotDM);
    }
  });

  // Rejoindre un nouveau salon (après création)
  socket.on('join_room', (roomId) => {
    if (queries.isMember.get(roomId, user.id)) socket.join(`room:${roomId}`);
  });

  // Indicateur de frappe
  socket.on('typing', ({ roomId, typing }) => {
    socket.to(`room:${roomId}`).emit('typing', { userId: user.id, username: user.username, typing });
  });

  // ── WebRTC signaling ────────────────────────────────────────
  function toUser(userId, event, data) {
    for (const [sid, u] of onlineUsers) {
      if (u.id === userId) io.to(sid).emit(event, data);
    }
  }

  socket.on('call_request', ({ toUserId }) => {
    toUser(toUserId, 'call_incoming', { fromUserId: user.id, fromName: user.username, fromAvatar: user.avatar });
  });
  socket.on('call_offer', ({ toUserId, sdp }) => {
    toUser(toUserId, 'call_offer', { fromUserId: user.id, sdp });
  });
  socket.on('call_answer', ({ toUserId, sdp }) => {
    toUser(toUserId, 'call_answer', { sdp });
  });
  socket.on('call_ice', ({ toUserId, candidate }) => {
    toUser(toUserId, 'call_ice', { candidate });
  });
  socket.on('call_reject', ({ toUserId }) => {
    toUser(toUserId, 'call_rejected', {});
  });
  socket.on('call_end', ({ toUserId }) => {
    toUser(toUserId, 'call_ended', {});
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('online', [...new Set([...onlineUsers.values()].map(u => u.id))]);
  });
});

// ── Démarrage ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Lamaat Chat démarré sur le port ${PORT}`);
});
