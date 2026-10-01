/**
 * Remplit un compte avec du contenu de démonstration, pour les captures App Store.
 *
 * Pourquoi : les visuels de la fiche doivent montrer l'app telle qu'elle est après
 * quelques semaines d'usage — un graphique d'humeur nourri, une conversation qui a
 * de la mémoire. Attendre trois semaines pour capturer un écran n'a pas de sens ;
 * ce script écrit les mêmes données que l'usage réel aurait produites.
 *
 * Ce n'est pas un maquillage : chaque écran capturé correspond à une fonctionnalité
 * qui existe. La directive App Store 2.3.3 impose que les captures montrent l'app en
 * usage, ce qui est exactement le cas.
 *
 * ⚠️ NE PAS lancer sur le compte de revue Apple : ce compte doit rester le reflet
 *    d'un parcours réel, effectué à la main.
 *
 * Usage :
 *   node scripts/seed-demo-content.mjs <email> [--lang en|fr] [--reset]
 *
 * Les identifiants sont lus dans backend-lucy/.env (SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY). La clé de service contourne les RLS : ne jamais
 * l'exposer côté client.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Configuration ──────────────────────────────────────────────────────────

function loadEnv() {
  const raw = readFileSync(join(ROOT, 'backend-lucy', '.env'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const args = process.argv.slice(2);

// `--lang` prend sa valeur dans l'argument suivant : celui-ci ne doit donc pas
// être confondu avec l'adresse e-mail, qui est le seul argument libre.
const langAt = args.indexOf('--lang');
const langValueAt = langAt === -1 ? -1 : langAt + 1;
const lang = args.includes('--fr') || args[langValueAt] === 'fr' ? 'fr' : 'en';
const email = args.find((a, i) => !a.startsWith('--') && i !== langValueAt);
const reset = args.includes('--reset');

if (!email) {
  console.error('Usage : node scripts/seed-demo-content.mjs <email> [--fr] [--reset]');
  process.exit(1);
}

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Contenu ────────────────────────────────────────────────────────────────

/**
 * Trois blocs, qui portent chacun une capture :
 *   J-5 → écran 1 : Lucy est là, elle écoute, elle n'analyse pas.
 *   J-4 → écran 6 : la nuit, à 1 h 47, elle est encore là.
 *   J-0 → écran 2 : elle se souvient d'elle-même du mariage de samedi.
 *
 * Histoire (choisie le 21 sept. 2026 pour les mots-clés Apple Ads : solitude,
 * parler, moral) : universelle, ni rupture ni entretien. Faire semblant devant
 * tout le monde, un mariage qu'on redoute, une sœur qui vient.
 *
 * TON — calqué sur les messages de bienvenue réels (`chat:welcomeSeq*` :
 * « first message. feels kinda special, ngl. ») : minuscules, phrases courtes,
 * pas de point final, un emoji par bloc au plus. Lucy écrit comme une amie par
 * texto, pas comme un assistant : aucune question de psy, aucun conseil en liste.
 */
const CONVERSATIONS = {
  en: [
    { role: 'user', content: "my sister's wedding is saturday and i'm dreading it", daysAgo: 5, at: [21, 14] },
    { role: 'assistant', content: 'oh right it\'s this saturday. dreading what exactly', daysAgo: 5, at: [21, 16] },
    { role: 'user', content: "smiling all day. everyone's gonna ask if i'm ok", daysAgo: 5, at: [21, 18] },
    { role: 'assistant', content: 'and you\'re not?', daysAgo: 5, at: [21, 20] },
    { role: 'user', content: 'no. but nobody knows that', daysAgo: 5, at: [21, 22] },
    { role: 'assistant', content: 'well i know now. text me from the bathroom saturday if you have to 💛', daysAgo: 5, at: [21, 24] },
    // Un échange de plus par bloc : sans lui, faire défiler jusqu'à la pastille
    // de date laissait voir le bloc suivant (ou du vide) sous les six bulles.
    { role: 'user', content: 'lol ok. it already feels better just saying it', daysAgo: 5, at: [21, 26] },
    { role: 'assistant', content: 'that\'s the point. and we talk again before saturday whenever you want', daysAgo: 5, at: [21, 28] },

    // Bloc nocturne : c'est lui, et lui seul, qui rend crédible la promesse
    // « à n'importe quelle heure ». Sans horodatage à 1 h du matin visible sur
    // la capture, la phrase n'est adossée à rien.
    { role: 'user', content: '2am and still not asleep', daysAgo: 4, at: [1, 47] },
    { role: 'assistant', content: 'i\'m here don\'t worry. is it saturday\'s wedding stressing you?', daysAgo: 4, at: [1, 48] },
    { role: 'user', content: 'yeah. i can already see myself faking it in front of everyone...', daysAgo: 4, at: [1, 51] },
    { role: 'assistant', content: 'you don\'t fake it with me. just be yourself, that\'s why people love you!', daysAgo: 4, at: [1, 53] },
    { role: 'user', content: 'ok. thanks for being here', daysAgo: 4, at: [1, 55] },
    { role: 'assistant', content: 'always. sleep if you can, otherwise i\'m not going anywhere 💛', daysAgo: 4, at: [1, 57] },
    { role: 'user', content: 'i\'ll try. goodnight', daysAgo: 4, at: [1, 59] },
    { role: 'assistant', content: 'goodnight. we\'ll talk tomorrow!', daysAgo: 4, at: [2, 1] },

    { role: 'user', content: "so. the wedding's done", daysAgo: 0, at: [21, 26] },
    { role: 'assistant', content: 'oh right! ok tell me everything', daysAgo: 0, at: [21, 28] },
    { role: 'user', content: 'better than expected. i broke down for 5 min outside and my sister came out', daysAgo: 0, at: [21, 30] },
    { role: 'assistant', content: 'she came to find you?', daysAgo: 0, at: [21, 32] },
    { role: 'user', content: "yeah. she didn't ask anything, she just stayed", daysAgo: 0, at: [21, 34] },
    { role: 'assistant', content: 'see. you weren\'t alone in there 🌸', daysAgo: 0, at: [21, 36] },
    { role: 'user', content: 'yeah. i\'m drained lol', daysAgo: 0, at: [21, 38] },
    { role: 'assistant', content: 'no wonder, you held it together all day. go rest, you earned it', daysAgo: 0, at: [21, 40] },
  ],
  fr: [
    { role: 'user', content: "le mariage de ma sœur c'est samedi et je le redoute", daysAgo: 5, at: [21, 14] },
    { role: 'assistant', content: 'ah oui c\'est ce samedi. tu redoutes quoi exactement', daysAgo: 5, at: [21, 16] },
    { role: 'user', content: 'sourire toute la journée. tout le monde va me demander si ça va', daysAgo: 5, at: [21, 18] },
    { role: 'assistant', content: 'et ça va pas ?', daysAgo: 5, at: [21, 20] },
    { role: 'user', content: 'non. mais ça personne le sait', daysAgo: 5, at: [21, 22] },
    { role: 'assistant', content: 'moi je le sais maintenant. samedi tu m\'écris depuis les toilettes si il faut 💛', daysAgo: 5, at: [21, 24] },
    { role: 'user', content: 'mdr ok. ça me fait déjà du bien de l\'avoir dit', daysAgo: 5, at: [21, 26] },
    { role: 'assistant', content: 'c\'est le but. et d\'ici samedi on en reparle quand tu veux', daysAgo: 5, at: [21, 28] },

    { role: 'user', content: '2h du mat et je dors toujours pas', daysAgo: 4, at: [1, 47] },
    { role: 'assistant', content: 'je suis là t\'inquiète. c\'est le mariage de samedi qui te stresse ?', daysAgo: 4, at: [1, 48] },
    { role: 'user', content: 'ouais. je me vois déjà faire semblant devant tout le monde...', daysAgo: 4, at: [1, 51] },
    { role: 'assistant', content: 'tu fais pas semblant avec moi, sois juste naturelle, c\'est comme ça que les gens t\'aiment !', daysAgo: 4, at: [1, 53] },
    { role: 'user', content: 'ok. merci d\'être là', daysAgo: 4, at: [1, 55] },
    { role: 'assistant', content: 'toujours. dors si tu peux, sinon je bouge pas 💛', daysAgo: 4, at: [1, 57] },
    { role: 'user', content: 'je vais essayer. bonne nuit', daysAgo: 4, at: [1, 59] },
    { role: 'assistant', content: 'bonne nuit. on se reparle demain !', daysAgo: 4, at: [2, 1] },

    { role: 'user', content: 'bon. le mariage est passé', daysAgo: 0, at: [21, 26] },
    { role: 'assistant', content: 'ah oui c\'est vrai ! alors raconte moi', daysAgo: 0, at: [21, 28] },
    { role: 'user', content: 'mieux que prévu. j\'ai craqué 5 min dehors et ma sœur est venue', daysAgo: 0, at: [21, 30] },
    { role: 'assistant', content: 'elle est venue te chercher ?', daysAgo: 0, at: [21, 32] },
    { role: 'user', content: 'ouais. elle a rien demandé, elle est juste restée', daysAgo: 0, at: [21, 34] },
    { role: 'assistant', content: 'voilà. tu vois, t\'étais pas seule là-dedans 🌸', daysAgo: 0, at: [21, 36] },
    { role: 'user', content: 'ouais. bon je suis vidée mdr', daysAgo: 0, at: [21, 38] },
    { role: 'assistant', content: 'normal, t\'as tenu toute la journée. va te poser, tu l\'as bien mérité', daysAgo: 0, at: [21, 40] },
  ],
};

/**
 * Messages d'accueil, réinsérés après un `--reset` qui les aurait effacés.
 * Repris tels quels des locales pour ne pas diverger de ce que voit un vrai
 * nouvel utilisateur.
 */
const WELCOME = {
  en: ['hey! 🌼', 'first message. feels kinda special, ngl.', "i think we're gonna click.", "anyway, what's on your mind?"],
  fr: ['hey ! 🌼', 'premier message. ça fait un truc, je dois dire.', 'je crois qu’on va bien s’entendre.', 'bref, qu’est-ce qui te trotte dans la tête ?'],
};

/**
 * 24 jours d'humeur : on part bas et ça monte, avec des creux crédibles.
 * Une série parfaite sonnerait faux et rendrait le graphique plat ; ce qui doit
 * se lire, c'est la tendance. 24 jours consécutifs débloquent streak3 et streak7.
 */
const MOODS = [1, 2, 1, 2, 2, 3, 2, 3, 3, 2, 3, 4, 3, 3, 4, 4, 3, 4, 5, 4, 4, 5, 4, 5];

// ─── Exécution ──────────────────────────────────────────────────────────────

function isoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Horodatage à une heure plausible : personne n'écrit à Lucy à 4 h du matin pile.
 *
 * `hour` permet de sortir de la soirée par défaut. Le bloc de 1 h du matin sert
 * la capture « à n'importe quelle heure » : sans horodatage nocturne visible,
 * l'image ne dit rien de la disponibilité et la promesse tombe à plat.
 */
function timestamp(daysAgo, [hour, minute]) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, Math.floor(Math.random() * 60), 0);
  return d.toISOString();
}

async function findUser() {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Aucun compte pour ${email}. Crée-le d'abord dans l'app.`);
  return user;
}

async function seedMoods(userId) {
  const rows = MOODS.map((mood, i) => ({
    user_id: userId,
    date: isoDate(MOODS.length - 1 - i),
    mood,
    modified: false,
  }));

  const { error } = await supabase
    .from('mood_entries')
    .upsert(rows, { onConflict: 'user_id,date' });
  if (error) throw error;
  return rows.length;
}

async function seedConversation(userId) {
  const script = CONVERSATIONS[lang];

  // La PLUS RÉCENTE, et jamais une autre : l'app garde le conversation_id en
  // AsyncStorage et n'interroge que celui-là. Écrire dans un fil plus ancien
  // reviendrait à écrire dans le vide.
  let { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: userId })
      .select('id')
      .single();
    if (error) throw error;
    conv = data;
  }

  // msg_seq doit rester unique et croissant : on repart du maximum existant.
  const { data: last } = await supabase
    .from('messages')
    .select('msg_seq')
    .eq('conversation_id', conv.id)
    .order('msg_seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = (last?.msg_seq ?? 0) + 1;

  // Les messages de bienvenue ont été écrits à la fin de l'onboarding, donc datés
  // d'aujourd'hui. Les laisser tels quels placerait l'accueil de Lucy APRÈS la
  // conversation d'il y a cinq jours : on les recule pour que le fil se lise dans
  // l'ordre. Après un `--reset`, ils n'existent plus : on les réinsère.
  const { data: existing } = await supabase
    .from('messages')
    .select('id, msg_seq')
    .eq('conversation_id', conv.id)
    .order('msg_seq', { ascending: true });

  if (existing?.length) {
    for (const [i, m] of existing.entries()) {
      await supabase
        .from('messages')
        .update({ created_at: timestamp(6, [20, 5 + i]) })
        .eq('id', m.id);
    }
  } else {
    const welcome = WELCOME[lang].map((content, i) => ({
      conversation_id: conv.id,
      user_id: userId,
      role: 'assistant',
      content,
      msg_seq: seq++,
      created_at: timestamp(6, [20, 5 + i]),
    }));
    const { error } = await supabase.from('messages').insert(welcome);
    if (error) throw error;
  }

  // L'app lit les messages par `msg_seq` (app/(app)/index.tsx:150), pas par
  // date : l'ordre du tableau doit donc rester chronologique, sinon un bloc
  // ancien s'afficherait en bas du fil sous un séparateur de date incohérent.
  const rows = script.map((m) => ({
    conversation_id: conv.id,
    user_id: userId,
    role: m.role,
    content: m.content,
    msg_seq: seq++,
    created_at: timestamp(m.daysAgo, m.at),
  }));

  const { error } = await supabase.from('messages').insert(rows);
  if (error) throw error;

  // Le compteur pilote le déclenchement des snapshots mémoire : le laisser
  // désynchronisé fausserait la planification du worker.
  const userMsgs = script.filter((m) => m.role === 'user').length;
  const { data: current } = await supabase
    .from('conversations')
    .select('user_msg_count')
    .eq('id', conv.id)
    .single();

  await supabase
    .from('conversations')
    .update({
      next_msg_seq: seq,
      user_msg_count: (current?.user_msg_count ?? 0) + userMsgs,
    })
    .eq('id', conv.id);

  return rows.length;
}

/**
 * Efface le contenu SANS toucher aux conversations.
 *
 * Supprimer la conversation cassait tout : l'app garde son identifiant en
 * AsyncStorage, ne trouvait plus rien, en concluait que le fil était vide et
 * rejouait la séquence de bienvenue dans une conversation neuve. Les messages
 * fraîchement écrits se retrouvaient dans un fil orphelin, invisible.
 *
 * Ce comportement de l'app est le bon — c'est ce qui doit arriver après une
 * réinitialisation de mémoire depuis les Réglages. C'est au script de ne pas
 * tirer le tapis sous ses pieds.
 */
async function resetContent(userId) {
  await supabase.from('mood_entries').delete().eq('user_id', userId);
  await supabase.from('messages').delete().eq('user_id', userId);

  // Fils orphelins d'un ancien reset : l'app n'en connaît qu'un, les autres
  // ne feraient que brouiller le diagnostic la prochaine fois.
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  for (const c of (convs ?? []).slice(1)) {
    await supabase.from('conversations').delete().eq('id', c.id);
  }

  // Le fil conservé repart à zéro : ses messages viennent d'être supprimés.
  if (convs?.[0]) {
    await supabase
      .from('conversations')
      .update({ next_msg_seq: 1, user_msg_count: 0 })
      .eq('id', convs[0].id);
  }
}

async function main() {
  const user = await findUser();
  console.log(`Compte : ${user.email} (${user.id})`);

  if (reset) {
    await resetContent(user.id);
    console.log('Contenu précédent supprimé.');
  }

  const moods = await seedMoods(user.id);
  const messages = await seedConversation(user.id);

  console.log(`✓ ${moods} entrées d'humeur (${MOODS.length} jours consécutifs)`);
  console.log(`✓ ${messages} messages en « ${lang} »`);
  console.log('\nOuvre l’app sur ce compte pour prendre les captures.');
}

main().catch((e) => {
  console.error('Échec :', e.message);
  process.exit(1);
});
