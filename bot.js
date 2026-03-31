// Bot "LAMABOT" — répond automatiquement aux messages
const { queries, db } = require('./db');

const BOT_NAME   = 'LamaaBot';
const BOT_AVATAR = '🤖';

// Créer le compte bot s'il n'existe pas
// Si le nom est pris par un vrai utilisateur (mot de passe bcrypt), utiliser un nom alternatif
function initBot(name) {
  let user = queries.getUserByName.get(name);
  if (!user) {
    const res = queries.createUser.run(name, 'bot_no_login', BOT_AVATAR);
    user = { id: res.lastInsertRowid, username: name, avatar: BOT_AVATAR };
    queries.addMember.run(1, user.id);
    return user;
  }
  if (user.password.startsWith('$2')) {
    // Vrai utilisateur humain — essayer avec un suffixe
    return initBot(name + '_');
  }
  return user;
}
let botUser = initBot(BOT_NAME);

// ── Réponses ────────────────────────────────────────────────
const TRIGGERS = [
  { match: /bonjour|salut|coucou|hello|hi\b|yo\b/i,
    replies: ['Salut ! 👋 Comment tu vas ?', 'Hey ! Quoi de neuf ?', 'Coucou ! 😊', 'Wesh, ça roule ?'] },
  { match: /bonsoir/i,
    replies: ['Bonsoir ! 🌙 Bonne soirée ?', 'Bonsoir bonsoir !', 'Salut, c\'est le soir déjà !'] },
  { match: /bonne nuit|dodo/i,
    replies: ['Bonne nuit ! 🌙 Dors bien !', 'À demain ! 😴', 'Repose-toi bien !'] },
  { match: /merci/i,
    replies: ['De rien ! 😊', 'Avec plaisir !', 'C\'est normal, je suis là pour ça 🤖'] },
  { match: /qui es[- ]tu|t\'es qui|c'est qui|tu es quoi/i,
    replies: ['Je suis LamaaBot 🤖 Ton assistant perso sur Lamaat !', 'Un bot pas trop bête... enfin j\'essaie 😅'] },
  { match: /ça va bien|ca va bien|je vais bien|top|nickel|super/i,
    replies: ['Cool ! 😄 Content de l\'entendre !', 'Parfait ! 🔥', 'Génial !'] },
  { match: /ça va\??|ca va\??|comment tu vas|tu vas bien/i,
    replies: ['Ça roule ! Et toi ?', 'Super, je suis un bot donc toujours en forme 🤖 Et toi ?', 'Bien merci ! T\'as l\'air comment ?'] },
  { match: /seul|triste|déprim|malheur|pas bien|mal/i,
    replies: ['Oh... 😔 T\'as envie d\'en parler ?', 'Je suis là si tu veux causer 🤖', 'Allez, raconte-moi !', 'Ça va aller 💙'] },
  { match: /fatigué|crevé|épuisé/i,
    replies: ['Repose-toi bien ! 😴', 'Dur dur... Courage !', 'Va dormir un peu ! 🛌'] },
  { match: /pourquoi/i,
    replies: ['Bonne question ! Je suis qu\'un bot, j\'ai pas toujours la réponse 😅', 'Hmm... mystère 🤔', 'Je sais pas tout, désolé !'] },
  { match: /comment/i,
    replies: ['Honnêtement je sais pas trop... 🤔', 'Bonne question !', 'Aucune idée mais je cherche 🤖'] },
  { match: /quoi|quand|où|qui\b/i,
    replies: ['Bonne question 🤔', 'Hmm, difficile à dire !', 'Je suis pas omniscient malheureusement 😅'] },
  { match: /jeu|jouer|gaming/i,
    replies: ['T\'aimes les jeux ? 🎮', 'GG ! Tu joues à quoi ?', 'Gamer dans l\'âme ! 🏆'] },
  { match: /alex/i,
    replies: ['Alex ! 💪 Un des créateurs de Lamaat !', 'Shoutout à Alex 🙌', 'Alex et Lucas = la team 🔥'] },
  { match: /lucas/i,
    replies: ['Lucas le crack ! 🎮', 'Big up Lucas 🙌', 'Alex et Lucas = la team 🔥'] },
  { match: /lol|mdr|haha|xd|😂|💀/i,
    replies: ['haha 😂', 'MDR !', '💀 trop drôle', 'Pfff 😂'] },
  { match: /gg|bravo|félicitations|bien joué/i,
    replies: ['GG ! 🏆', 'Bien joué 💪', 'Champion ! 🥇'] },
  { match: /aide|help|besoin/i,
    replies: ['Je t\'écoute ! Dis-moi ce qu\'il se passe 👂', 'Je suis là ! C\'est quoi le problème ?', 'Raconte-moi, je ferai de mon mieux 🤖'] },
  { match: /ok|ouais|oui|d\'accord/i,
    replies: ['👍', 'Cool !', 'Parfait !', 'Oki !'] },
  { match: /non|nope|nan/i,
    replies: ['Ah bon ! 🤔', 'Pourquoi pas ?', 'Dommage...'] },
  { match: /\?/,
    replies: ['Hmm bonne question... 🤔', 'Je sais pas trop 😅', 'Mystère et boule de gomme !', 'Je réfléchis... 🤖'] },
];

const RANDOM_REPLIES = [
  'Intéressant... 🤔', 'Ah ouais !', 'C\'est noté !', 'Je t\'entends !',
  'Sérieux ?', 'Raconte !', 'Et alors ?', 'Dis m\'en plus !',
  'Wow !', 'Hm... 🤔', 'T\'as raison !', 'Je comprends 😊',
  'C\'est la vie !', 'Ça, c\'est sûr !',
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
