
// Bot "LAMABOT" — répond automatiquement aux messages
const { queries, db } = require('./db');

const BOT_NAME   = 'LamaaBot';
const BOT_AVATAR = '🤖';

// Créer le compte bot s'il n'existe pas
let botUser = queries.getUserByName.get(BOT_NAME);
if (!botUser) {
  const res = queries.createUser.run(BOT_NAME, 'bot_no_login', BOT_AVATAR);
  botUser = { id: res.lastInsertRowid, username: BOT_NAME, avatar: BOT_AVATAR };
  // Ajouter au Général
  queries.addMember.run(1, botUser.id);
}

// ── Réponses ────────────────────────────────────────────────
const TRIGGERS = [
  { match: /bonjour|salut|coucou|hello|hi\b|yo\b/i,
    replies: ['Salut ! 👋', 'Hey !', 'Coucou !', 'Yo yo yo !', 'Wesh !'] },
  { match: /bonsoir/i,
    replies: ['Bonsoir !', 'Soirée tranquille ?', 'Bonsoir bonsoir 🌙'] },
  { match: /bonne nuit|dodo/i,
    replies: ['Bonne nuit ! 🌙', 'Dors bien !', 'À demain !'] },
  { match: /merci/i,
    replies: ['De rien !', 'Avec plaisir 😊', 'C\'est mon boulot 🤖'] },
  { match: /qui es[- ]tu|t\'es qui|c'est qui/i,
    replies: ['Je suis LamaaBot, le bot officiel de Lamaat ! 🤖', 'Un bot au service de la team Lamaat 💪'] },
  { match: /ça va|ca va|comment tu vas/i,
    replies: ['Ça roule ! Et toi ?', 'Super, merci ! 😄', 'En pleine forme, je suis un bot 🤖'] },
  { match: /jeu|jouer|gaming/i,
    replies: ['Allez sur minilong-games.html pour jouer ! 🎮', 'Les jeux Lamaat sont les meilleurs ! 🏆', 'GG ! 🎮'] },
  { match: /alex/i,
    replies: ['Alex le meilleur ! 💪', 'Shoutout à Alex 🙌', 'Alex et Lucas = la team 🔥'] },
  { match: /lucas/i,
    replies: ['Lucas le crack ! 🎮', 'Big up Lucas 🙌', 'Alex et Lucas = la team 🔥'] },
  { match: /\?$/,
    replies: ['Bonne question... 🤔', 'Je sais pas trop honnêtement 😅', 'Demande à Alex ou Lucas !'] },
  { match: /lol|mdr|haha|xd/i,
    replies: ['haha 😂', 'MDR !', '💀', 'Trop drôle 😂'] },
  { match: /gg|bravo|félicitations/i,
    replies: ['GG ! 🏆', 'Bien joué 💪', 'Champion ! 🥇'] },
  { match: /aide|help/i,
    replies: ['Je peux pas faire grand chose... je suis qu\'un bot 😅', 'Demande à Lucas ou Alex !'] },
];

const RANDOM_REPLIES = [
  '👀', 'Intéressant...', 'Ok ok', 'C\'est noté !', '🔥',
  'Hm hm', 'Je t\'entends !', '💯', 'Fascinant 🤔', 'Ah ouais ?',
  'Sérieux ?', '🤖 *bip bop*', 'C\'est la vie !',
];

function pickReply(content, isBotDM) {
  for (const trigger of TRIGGERS) {
    if (trigger.match.test(content)) {
      const arr = trigger.replies;
      return arr[Math.floor(Math.random() * arr.length)];
    }
  }
  // Dans un DM privé, toujours répondre
  if (isBotDM) {
    return RANDOM_REPLIES[Math.floor(Math.random() * RANDOM_REPLIES.length)];
  }
  // Réponse aléatoire avec proba 40% dans les groupes
  if (Math.random() < 0.4) {
    return RANDOM_REPLIES[Math.floor(Math.random() * RANDOM_REPLIES.length)];
  }
  return null;
}

// ── Interface pour le serveur ────────────────────────────────
// Appelé depuis server.js à chaque message reçu
function handleMessage(io, roomId, userId, content, isBotDM = false) {
  if (userId === botUser.id) return;
  if (!queries.isMember.get(roomId, botUser.id)) return;

  const reply = pickReply(content, isBotDM);
  if (!reply) return;

  // Délai naturel (1 à 3 secondes)
  const delay = 1000 + Math.random() * 2000;
  setTimeout(() => {
    const result = queries.insertMsg.run(roomId, botUser.id, reply);
    const msg = {
      id: result.lastInsertRowid,
      room_id: roomId,
      content: reply,
      sent_at: Math.floor(Date.now() / 1000),
      user_id: botUser.id,
      username: BOT_NAME,
      avatar: BOT_AVATAR,
    };
    io.to(`room:${roomId}`).emit('message', msg);
  }, delay);
}

// Ajouter le bot à tous les salons existants (Général uniquement pour l'instant)
function joinAllRooms() {
  const rooms = db.prepare('SELECT id FROM rooms WHERE is_dm = 0').all();
  for (const r of rooms) queries.addMember.run(r.id, botUser.id);
}

joinAllRooms();

module.exports = { handleMessage, botUser };
