/**
 * Construction du payload d'entrée pour le LLM snapshot (étape 5.2).
 *
 * Pour un job snapshot_50 :
 *   A) Segment conversationnel — les 50 derniers messages role='user' de la
 *      conversation + les réponses assistant associées, le tout ordonné par
 *      msg_seq ASC (§V.4, l.2921–2934).
 *   B) Mémoire longue actuelle — les 8 domaines (§V.5, l.2935–2967), toutes
 *      les sections toujours présentes ([] ou null si vides).
 *
 * La sortie est un SnapshotPromptContext prêt à être injecté dans le prompt
 * système du LLM snapshot (snapshotSystemPrompt.ts).
 *
 * Propriétés :
 *   - Déterministe : même job + même état DB → même payload.
 *   - Sécurisée : vérifie que conversation.user_id === job.user_id.
 *   - Non-fatale sur les sections mémoire : une section en erreur → valeur
 *     par défaut (null / []), pas de crash du job entier.
 */

import { supabaseAdmin } from '../../supabase.js';
import type { MemoryJob } from '../memoryJobs.js';
import type { SnapshotPromptContext, KnownRelation } from '../../prompts/snapshotSystemPrompt.js';

// ─── Constantes (limites documentées) ───────────────────────────────────────

export { SEGMENT_USER_MESSAGES } from '../../constants.js';
import { SEGMENT_USER_MESSAGES } from '../../constants.js';

/** Limites par section mémoire (alignées sur chatContextService + §III.3). */
const LIMITS = {
  goals: 3,
  occupationNotes: 7,
  traits: 5,
  preferences: 20,
  relations: 10,
  ephemeralEvents: 30,
  lifeEvents: 10,
} as const;

/**
 * Budget de sécurité : taille max du JSON sérialisé (caractères).
 * Au-delà : troncature des messages du segment, puis réduction des tableaux
 * mémoire, puis champs texte de `user_identity` — avec recalcul réel après
 * chaque étape (pas d’estimation) et plafond d’itérations.
 */
const MAX_PAYLOAD_CHARS = 300_000;

/** Plafond d’étapes pour éviter toute boucle infinie si le budget reste hors cible. */
const MAX_PAYLOAD_SHRINK_STEPS = 300;

/** En dessous de ce seuil, on ne réduit plus un message du segment (sauf phase finale). */
const MIN_SEGMENT_MESSAGE_CHARS = 40;

// ─── Point d'entrée ─────────────────────────────────────────────────────────

/**
 * Construit le payload complet pour le LLM snapshot.
 * Lève une erreur si la conversation n'existe pas ou n'appartient pas au user.
 */
export async function buildSnapshotInputPayload(
  job: MemoryJob
): Promise<SnapshotPromptContext> {
  // 0. Vérifier que la conversation appartient bien à l'utilisateur du job.
  await verifyConversationOwnership(job.conversation_id, job.user_id);

  // 1. Charger le segment conversationnel et la mémoire longue en parallèle.
  const [conversationSegment, currentMemory] = await Promise.all([
    loadConversationSegment(job.conversation_id),
    loadCurrentMemory(job.user_id),
  ]);

  const payload: SnapshotPromptContext = {
    conversationSegment,
    currentMemory,
  };

  // 2. Garde-fou taille : tronquer si le payload dépasse le budget.
  enforcePayloadSizeLimit(payload);

  return payload;
}

// ─── Vérification propriétaire ──────────────────────────────────────────────

async function verifyConversationOwnership(
  conversationId: string,
  expectedUserId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[snapshot] Erreur vérification conversation ${conversationId}: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      `[snapshot] Conversation ${conversationId} introuvable`
    );
  }

  if (data.user_id !== expectedUserId) {
    throw new Error(
      `[snapshot] Conversation ${conversationId} n'appartient pas à l'utilisateur du job (expected=${expectedUserId}, actual=${data.user_id})`
    );
  }
}

// ─── Segment conversationnel (§V.4) ────────────────────────────────────────

/**
 * Charge les 50 derniers messages utilisateur + leurs réponses assistant.
 *
 * Stratégie en 2 requêtes :
 *   1. Trouver le msg_seq minimum du segment (50ème user msg en partant de la fin).
 *   2. Charger tous les messages (user + assistant) avec msg_seq >= ce seuil.
 *
 * Le pairing user/assistant est implicite : les messages sont retournés en
 * ordre msg_seq ASC. Un message assistant est associé au user qui le précède
 * (son msg_seq est immédiatement supérieur).
 *
 * Edge cases :
 *   - < 50 user messages → on prend tout ce qui existe.
 *   - Messages assistant manquants → le segment est valide sans eux.
 *   - Conversation vide → segment vide [].
 */
async function loadConversationSegment(
  conversationId: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  // Étape 1 : trouver le msg_seq plancher pour le segment.
  // On sélectionne les 50 derniers user messages par msg_seq DESC.
  const { data: userMsgRows, error: userError } = await supabaseAdmin
    .from('messages')
    .select('msg_seq')
    .eq('conversation_id', conversationId)
    .eq('role', 'user')
    .order('msg_seq', { ascending: false })
    .limit(SEGMENT_USER_MESSAGES);

  if (userError) {
    throw new Error(
      `[snapshot] Erreur chargement user messages pour segment: ${userError.message}`
    );
  }

  if (!userMsgRows || userMsgRows.length === 0) {
    return [];
  }

  // Le plus petit msg_seq parmi les 50 derniers user messages.
  const minMsgSeq = Math.min(...userMsgRows.map((r) => r.msg_seq as number));

  // Étape 2 : charger tous les messages (user + assistant) à partir de ce seuil.
  const { data: segmentRows, error: segError } = await supabaseAdmin
    .from('messages')
    .select('role,content,msg_seq')
    .eq('conversation_id', conversationId)
    .gte('msg_seq', minMsgSeq)
    .order('msg_seq', { ascending: true });

  if (segError) {
    throw new Error(
      `[snapshot] Erreur chargement segment complet: ${segError.message}`
    );
  }

  if (!segmentRows || segmentRows.length === 0) {
    return [];
  }

  return segmentRows.map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
  }));
}

// ─── Mémoire longue actuelle (§V.5, partie B) ──────────────────────────────

/**
 * Charge les 8 domaines de mémoire longue pour l'utilisateur.
 * Chaque section est non-fatale : erreur → valeur par défaut.
 * Requêtes lancées en parallèle pour minimiser la latence.
 */
async function loadCurrentMemory(
  userId: string
): Promise<SnapshotPromptContext['currentMemory']> {
  const [
    identity,
    goals,
    occupationNotes,
    traits,
    preferences,
    relations,
    ephemeralEvents,
    lifeEvents,
  ] = await Promise.all([
    loadIdentity(userId),
    loadGoals(userId),
    loadOccupationNotes(userId),
    loadTraits(userId),
    loadPreferences(userId),
    loadRelations(userId),
    loadEphemeralEvents(userId),
    loadLifeEvents(userId),
  ]);

  return {
    user_identity: identity,
    user_identity_goals: goals,
    user_occupation_notes: occupationNotes,
    user_traits: traits,
    user_preferences: preferences,
    user_relations: relations,
    user_ephemeral_events: ephemeralEvents,
    user_life_events: lifeEvents,
  };
}

// ─── Loaders par section (non-fatale, chacun catch → valeur par défaut) ─────

async function loadIdentity(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_identity')
      .select('first_name,age,gender,location_general,occupation_status,occupation_position,occupation_domain')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      first_name: data.first_name ?? null,
      age: data.age ?? null,
      gender: data.gender ?? null,
      location_general: data.location_general ?? null,
      occupation_status: data.occupation_status ?? null,
      occupation_position: data.occupation_position ?? null,
      occupation_domain: data.occupation_domain ?? null,
    };
  } catch (err) {
    console.error('[snapshot] Erreur chargement identity:', err);
    return null;
  }
}

async function loadGoals(userId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_identity_goals')
      .select('goal_text,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(LIMITS.goals);

    if (error) throw error;
    return (data ?? []).map((r) => ({ goal_text: r.goal_text, last_seen_at: r.last_seen_at }));
  } catch (err) {
    console.error('[snapshot] Erreur chargement goals:', err);
    return [];
  }
}

async function loadOccupationNotes(userId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_occupation_notes')
      .select('note_text,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(LIMITS.occupationNotes);

    if (error) throw error;
    return (data ?? []).map((r) => ({ note_text: r.note_text, last_seen_at: r.last_seen_at }));
  } catch (err) {
    console.error('[snapshot] Erreur chargement occupation_notes:', err);
    return [];
  }
}

async function loadTraits(userId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_traits')
      .select('trait_key,strength,source,last_seen_at')
      .eq('user_id', userId);

    if (error) throw error;
    if (!data || data.length === 0) return [];

    const now = Date.now();
    const scored = data.map((row) => {
      const lastSeen = new Date(row.last_seen_at).getTime();
      const safeLastSeen = Number.isFinite(lastSeen) ? lastSeen : now;
      const daysSince = (now - safeLastSeen) / (1000 * 60 * 60 * 24);

      let recencyScore: number;
      if (daysSince <= 30) recencyScore = 1.0;
      else if (daysSince <= 90) recencyScore = 0.7;
      else recencyScore = 0.5;

      const strength = Number(row.strength);
      const priorityScore = 0.7 * strength + 0.3 * recencyScore;

      return {
        trait_key: row.trait_key,
        strength,
        source: row.source,
        priority_score: Math.round(priorityScore * 100) / 100,
      };
    });

    scored.sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return (a.trait_key as string).localeCompare(b.trait_key as string);
    });

    return scored.slice(0, LIMITS.traits);
  } catch (err) {
    console.error('[snapshot] Erreur chargement traits:', err);
    return [];
  }
}

async function loadPreferences(userId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .select('category_key,value_type,value_text,value_enum,value_bool,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(LIMITS.preferences);

    if (error) throw error;
    return (data ?? []).map((r) => ({
      category_key: r.category_key,
      value_type: r.value_type,
      value_text: r.value_text ?? null,
      value_enum: r.value_enum ?? null,
      value_bool: r.value_bool ?? null,
    }));
  } catch (err) {
    console.error('[snapshot] Erreur chargement preferences:', err);
    return [];
  }
}

async function loadRelations(userId: string): Promise<KnownRelation[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_relations')
      .select('id,name_raw,name_key,relation_type,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(LIMITS.relations);

    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      name_raw: r.name_raw as string,
      name_key: r.name_key as string,
      relation_type: r.relation_type as string,
    }));
  } catch (err) {
    console.error('[snapshot] Erreur chargement relations:', err);
    return [];
  }
}

async function loadEphemeralEvents(userId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_ephemeral_events')
      .select('event_text,event_at,expires_at')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('event_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(LIMITS.ephemeralEvents);

    if (error) throw error;
    return (data ?? []).map((r) => ({
      event_text: r.event_text,
      event_at: r.event_at ?? null,
      expires_at: r.expires_at,
    }));
  } catch (err) {
    console.error('[snapshot] Erreur chargement ephemeral_events:', err);
    return [];
  }
}

async function loadLifeEvents(userId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_life_events')
      .select('event_text,event_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIMITS.lifeEvents);

    if (error) throw error;
    return (data ?? []).map((r) => ({
      event_text: r.event_text,
      event_at: r.event_at ?? null,
    }));
  } catch (err) {
    console.error('[snapshot] Erreur chargement life_events:', err);
    return [];
  }
}

// ─── Garde-fou taille ───────────────────────────────────────────────────────

function measurePayloadSize(payload: SnapshotPromptContext): number {
  try {
    return JSON.stringify(payload).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Tronque avec tête + marqueur + queue pour garder un peu de contexte. */
function truncateTextPreservingEnds(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const marker = ' …[tronqué]… ';
  const budget = maxChars - marker.length;
  if (budget < 24) return content.slice(0, maxChars);
  const head = Math.floor(budget / 2);
  const tail = budget - head;
  return content.slice(0, head) + marker + content.slice(-tail);
}

function findLongestSegmentMessageIndex(
  segment: SnapshotPromptContext['conversationSegment'],
  minLength: number
): number {
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < segment.length; i++) {
    const len = segment[i].content.length;
    if (len >= minLength && len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return best;
}

/** Retire une entrée du tableau mémoire le plus « lourd » en JSON (meilleur gain / étape). */
function shrinkCurrentMemoryOneStep(mem: SnapshotPromptContext['currentMemory']): boolean {
  type MemKey = keyof SnapshotPromptContext['currentMemory'];
  const arrayKeys: MemKey[] = [
    'user_ephemeral_events',
    'user_preferences',
    'user_life_events',
    'user_identity_goals',
    'user_occupation_notes',
    'user_traits',
    'user_relations',
  ];

  let bestKey: MemKey | null = null;
  let bestScore = -1;

  for (const key of arrayKeys) {
    const arr = mem[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const score = JSON.stringify(arr).length;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey) {
    (mem[bestKey] as unknown[]).pop();
    return true;
  }
  return false;
}

/** Réduit les champs texte de user_identity (snapshot n’édite pas prénom/âge/genre côté prompt, mais le payload peut les contenir). */
function shrinkUserIdentityStrings(mem: SnapshotPromptContext['currentMemory']): boolean {
  const id = mem.user_identity;
  if (!id || typeof id !== 'object') return false;

  let changed = false;
  const maxField = 120;
  for (const key of Object.keys(id)) {
    const v = id[key];
    if (typeof v === 'string' && v.length > maxField) {
      (id as Record<string, unknown>)[key] = truncateTextPreservingEnds(v, maxField);
      changed = true;
    }
  }
  return changed;
}

/**
 * Ramène le payload sous MAX_PAYLOAD_CHARS en mutuant in-place.
 * Recalcule la taille réelle après chaque modification ; plafond d’itérations.
 */
function enforcePayloadSizeLimit(payload: SnapshotPromptContext): void {
  if (measurePayloadSize(payload) <= MAX_PAYLOAD_CHARS) return;

  for (let step = 0; step < MAX_PAYLOAD_SHRINK_STEPS; step++) {
    const size = measurePayloadSize(payload);
    if (size <= MAX_PAYLOAD_CHARS) return;

    // 1) Réduire le message du segment encore au-dessus du plancher (~50 %).
    const idx = findLongestSegmentMessageIndex(payload.conversationSegment, MIN_SEGMENT_MESSAGE_CHARS + 1);
    if (idx >= 0) {
      const msg = payload.conversationSegment[idx];
      const target = Math.max(MIN_SEGMENT_MESSAGE_CHARS, Math.floor(msg.content.length * 0.5));
      msg.content = truncateTextPreservingEnds(msg.content, target);
      continue;
    }

    // 2) Alléger la mémoire longue (un élément à la fois).
    if (shrinkCurrentMemoryOneStep(payload.currentMemory)) {
      continue;
    }

    // 3) Compacter les chaînes dans user_identity.
    if (shrinkUserIdentityStrings(payload.currentMemory)) {
      continue;
    }

    // 4) Phase finale : tout message du segment encore > plancher minimal.
    let truncatedAny = false;
    for (const m of payload.conversationSegment) {
      if (m.content.length > MIN_SEGMENT_MESSAGE_CHARS) {
        m.content = truncateTextPreservingEnds(m.content, MIN_SEGMENT_MESSAGE_CHARS);
        truncatedAny = true;
      }
    }
    if (truncatedAny) continue;

    // 5) Dernier recours : vider les tableaux mémoire (sections toujours présentes, mais vides).
    const cm = payload.currentMemory;
    if (
      cm.user_identity_goals.length > 0 ||
      cm.user_occupation_notes.length > 0 ||
      cm.user_traits.length > 0 ||
      cm.user_preferences.length > 0 ||
      cm.user_relations.length > 0 ||
      cm.user_ephemeral_events.length > 0 ||
      cm.user_life_events.length > 0
    ) {
      cm.user_identity_goals = [];
      cm.user_occupation_notes = [];
      cm.user_traits = [];
      cm.user_preferences = [];
      cm.user_relations = [];
      cm.user_ephemeral_events = [];
      cm.user_life_events = [];
      continue;
    }

    // 6) Encore trop gros : segment réduit à un marqueur minimal.
    if (payload.conversationSegment.length > 0 && measurePayloadSize(payload) > MAX_PAYLOAD_CHARS) {
      payload.conversationSegment = [
        {
          role: 'user',
          content: '[segment tronqué : payload trop volumineux]',
        },
      ];
      continue;
    }

    break;
  }

  const finalSize = measurePayloadSize(payload);
  if (finalSize > MAX_PAYLOAD_CHARS) {
    console.warn(
      `[snapshot] enforcePayloadSizeLimit: budget encore dépassé après ${MAX_PAYLOAD_SHRINK_STEPS} étapes (${finalSize} > ${MAX_PAYLOAD_CHARS})`
    );
  }
}
