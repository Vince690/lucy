/**
 * Construction du contexte LLM pour le chat (plan §4.3, §7.1).
 *
 * Charge en parallèle :
 *   - les 30 derniers messages de la conversation (§IV, §VII)
 *   - la mémoire longue structurée de l'utilisateur
 *
 * Retourne un ChatContext déterministe :
 *   - sections toujours présentes (null / [] si vide)
 *   - ordres stables (tri explicite)
 *   - limites bornées par section
 *
 * Chaque section mémoire est non-fatale : si une requête échoue,
 * elle retourne sa valeur par défaut (null / []) et log l'erreur,
 * sans casser le flux /chat.
 */

import { supabaseAdmin } from '../supabase.js';
import type {
  ChatContext,
  ContextMessage,
  ContextIdentity,
  ContextGoal,
  ContextOccupationNote,
  ContextTrait,
  ContextPreference,
  ContextRelation,
  ContextEphemeralEvent,
  ContextLifeEvent,
  ContextMoodStats,
  OnboardingAnswers,
} from '../types/chatContext.js';
import {
  computeTraitPriorityScore,
  computeMoodStats,
  getDateStringInTimezone,
  computeAgeFromDateOfBirth,
  formatGenderForPrompt,
} from './chatContextUtils.js';
export {
  computeRecencyScore,
  computeTraitPriorityScore,
  computeMoodStats,
  getDateStringInTimezone,
} from './chatContextUtils.js';
export { CONTEXT_MESSAGES_LIMIT } from '../constants.js';
import { CONTEXT_MESSAGES_LIMIT } from '../constants.js';

// ============================================================================
// Limites (constantes stables, référencées par le plan §7.1 et §VII)
// ============================================================================

/** Top N traits par priority_score (§III.3d 886–904, §7.1). */
const TRAITS_LIMIT = 5;

/** Préférences max injectées (tri par récence). */
const PREFERENCES_LIMIT = 20;

/** Relations max (table limitée à 10 slots, on prend tout). */
const RELATIONS_LIMIT = 10;

/** Life events max (table limitée à 10 slots, on prend tout). */
const LIFE_EVENTS_LIMIT = 10;

/** Ephemeral events max (table limitée à 30 actifs). */
const EPHEMERAL_EVENTS_LIMIT = 30;

/** Goals max (table limitée à 3 slots). */
const GOALS_LIMIT = 3;

/** Occupation notes max (table limitée à 7 slots). */
const OCCUPATION_NOTES_LIMIT = 7;

/** Jours pour la moyenne glissante mood (§III.3i). */
const MOOD_ROLLING_DAYS = 7;
/** Cache mémoire longue (ms) pour limiter la charge DB sous rafales. */
const LONG_MEMORY_CACHE_TTL_MS = 10_000;
/**
 * Vérification périodique du marqueur de reset (ms) pour invalidation
 * cross-instance sans supprimer le bénéfice du cache.
 */
const RESET_MARKER_CHECK_INTERVAL_MS = 2_000;

interface LongMemorySnapshot {
  timezone: string;
  onboardingAnswers: OnboardingAnswers | null;
  identity: ContextIdentity | null;
  goals: ContextGoal[];
  occupationNotes: ContextOccupationNote[];
  traits: ContextTrait[];
  preferences: ContextPreference[];
  relations: ContextRelation[];
  ephemeralEvents: ContextEphemeralEvent[];
  lifeEvents: ContextLifeEvent[];
  mood: ContextMoodStats;
}

interface LongMemoryCacheEntry {
  expiresAt: number;
  builtAtMs: number;
  lastResetCheckAtMs: number;
  data: LongMemorySnapshot;
}

const longMemoryCache = new Map<string, LongMemoryCacheEntry>();

// ============================================================================
// Gestion du cache
// ============================================================================

/**
 * Invalide le cache mémoire longue d'un utilisateur.
 * Doit être appelé après tout reset mémoire (§VI) pour garantir
 * que le prochain appel /chat recharge depuis la DB.
 */
export function clearLongMemoryCache(userId: string): void {
  longMemoryCache.delete(userId);
}

// ============================================================================
// Point d'entrée
// ============================================================================

/**
 * Construit le contexte complet pour un appel LLM chat.
 * Toutes les requêtes mémoire sont exécutées en parallèle pour la latence.
 */
export async function buildChatContext(
  conversationId: string,
  userId: string,
  userMsgCount: number
): Promise<ChatContext> {
  // Messages toujours frais (fenêtre conversationnelle).
  const messages = await loadContextMessages(conversationId);

  // La mémoire longue change peu d'un message à l'autre : cache court.
  const cachedMemory = longMemoryCache.get(userId);
  if (cachedMemory && await shouldServeCachedLongMemory(userId, cachedMemory)) {
    return {
      messages,
      timezone: cachedMemory.data.timezone,
      userMsgCount,
      onboardingAnswers: cachedMemory.data.onboardingAnswers,
      memory: {
        identity: cachedMemory.data.identity,
        goals: cachedMemory.data.goals,
        occupation_notes: cachedMemory.data.occupationNotes,
        traits: cachedMemory.data.traits,
        preferences: cachedMemory.data.preferences,
        relations: cachedMemory.data.relations,
        ephemeral_events: cachedMemory.data.ephemeralEvents,
        life_events: cachedMemory.data.lifeEvents,
        mood: cachedMemory.data.mood,
      },
    };
  }

  // Le profil (prénom, date de naissance, genre, fuseau) est la source de vérité pour
  // l'identité de base : c'est lui que l'écran Réglages modifie. La table user_identity
  // n'était remplie qu'à l'onboarding, d'où un prénom périmé après modification.
  const profile = await loadProfile(userId);

  // Lancer les requêtes mémoire longue en parallèle.
  const [
    identity,
    goals,
    occupationNotes,
    traits,
    preferences,
    relations,
    ephemeralEvents,
    lifeEvents,
    mood,
  ] = await Promise.all([
    loadIdentity(userId, profile),
    loadGoals(userId),
    loadOccupationNotes(userId),
    loadTraits(userId),
    loadPreferences(userId),
    loadRelations(userId),
    loadEphemeralEvents(userId),
    loadLifeEvents(userId),
    loadMoodStats(userId, profile.timezone),
  ]);
  const nowMs = Date.now();

  longMemoryCache.set(userId, {
    expiresAt: nowMs + LONG_MEMORY_CACHE_TTL_MS,
    builtAtMs: nowMs,
    lastResetCheckAtMs: nowMs,
    data: {
      timezone: profile.timezone,
      onboardingAnswers: profile.onboarding_answers,
      identity,
      goals,
      occupationNotes,
      traits,
      preferences,
      relations,
      ephemeralEvents,
      lifeEvents,
      mood,
    },
  });

  return {
    messages,
    timezone: profile.timezone,
    userMsgCount,
    onboardingAnswers: profile.onboarding_answers,
    memory: {
      identity,
      goals,
      occupation_notes: occupationNotes,
      traits,
      preferences,
      relations,
      ephemeral_events: ephemeralEvents,
      life_events: lifeEvents,
      mood,
    },
  };
}

/**
 * Décide si l'entrée cache est utilisable.
 * Vérifie périodiquement `user_memory_reset_log` pour invalidation multi-instance.
 */
async function shouldServeCachedLongMemory(
  userId: string,
  entry: LongMemoryCacheEntry
): Promise<boolean> {
  const now = Date.now();
  if (entry.expiresAt <= now) return false;
  if (entry.lastResetCheckAtMs + RESET_MARKER_CHECK_INTERVAL_MS > now) return true;

  try {
    const latestResetAtMs = await loadLatestResetAtMs(userId);
    entry.lastResetCheckAtMs = now;
    if (latestResetAtMs !== null && latestResetAtMs > entry.builtAtMs) {
      longMemoryCache.delete(userId);
      return false;
    }
    return true;
  } catch (err) {
    // Fail-open : on sert le cache existant pour éviter dégradation UX
    // sur une erreur transitoire de lecture du marqueur.
    console.error('[chatContext] Erreur vérification reset marker cache:', err);
    return true;
  }
}

async function loadLatestResetAtMs(userId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('user_memory_reset_log')
    .select('reset_at')
    .eq('user_id', userId)
    .order('reset_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.reset_at) return null;
  const ms = new Date(data.reset_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ============================================================================
// Messages de contexte
// ============================================================================

/**
 * Charge les CONTEXT_MESSAGES_LIMIT derniers messages de la conversation triés par
 * msg_seq DESC, puis les retourne en ordre chronologique (ASC) pour le LLM.
 */
async function loadContextMessages(conversationId: string): Promise<ContextMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('role,content,msg_seq,created_at')
    .eq('conversation_id', conversationId)
    .order('msg_seq', { ascending: false })
    .limit(CONTEXT_MESSAGES_LIMIT);

  if (error) {
    // Les messages sont critiques — on propage l'erreur
    throw new Error(`[chatContext] Erreur chargement messages: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  // Inverser pour obtenir l'ordre chronologique
  return data
    .reverse()
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content as string,
      created_at: row.created_at as string,
    }));
}

// ============================================================================
// Mémoire longue — chaque fonction est non-fatale (sauf messages)
// ============================================================================

/**
 * Identité = profil (prénom, âge calculé, genre) + user_identity (lieu, occupation).
 * Le profil prime : c'est lui que l'utilisateur modifie dans les Réglages.
 * user_identity reste la source pour ce que le snapshot met à jour (lieu, occupation).
 */
async function loadIdentity(userId: string, profile: UserProfile): Promise<ContextIdentity | null> {
  let row: {
    first_name: string | null;
    age: number | null;
    gender: string | null;
    location_general: string | null;
    occupation_status: string | null;
    occupation_position: string | null;
    occupation_domain: string | null;
  } | null = null;

  try {
    const { data, error } = await supabaseAdmin
      .from('user_identity')
      .select('first_name,age,gender,location_general,occupation_status,occupation_position,occupation_domain')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    row = data ?? null;
  } catch (err) {
    console.error('[chatContext] Erreur chargement identity:', err);
  }

  const today = getDateStringInTimezone(new Date(), profile.timezone);
  const ageFromProfile = profile.date_of_birth
    ? computeAgeFromDateOfBirth(profile.date_of_birth, today)
    : null;

  const identity: ContextIdentity = {
    first_name: profile.first_name || row?.first_name || null,
    age: ageFromProfile ?? row?.age ?? null,
    gender: formatGenderForPrompt(profile.gender ?? row?.gender),
    location_general: row?.location_general ?? null,
    occupation_status: row?.occupation_status ?? null,
    occupation_position: row?.occupation_position ?? null,
    occupation_domain: row?.occupation_domain ?? null,
  };

  const hasAnything = Object.values(identity).some((v) => v !== null);
  return hasAnything ? identity : null;
}

async function loadGoals(userId: string): Promise<ContextGoal[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_identity_goals')
      .select('goal_text,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(GOALS_LIMIT);

    if (error) throw error;
    return (data ?? []).map((row) => ({
      goal_text: row.goal_text,
      last_seen_at: row.last_seen_at,
    }));
  } catch (err) {
    console.error('[chatContext] Erreur chargement goals:', err);
    return [];
  }
}

async function loadOccupationNotes(userId: string): Promise<ContextOccupationNote[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_occupation_notes')
      .select('note_text,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(OCCUPATION_NOTES_LIMIT);

    if (error) throw error;
    return (data ?? []).map((row) => ({
      note_text: row.note_text,
      last_seen_at: row.last_seen_at,
    }));
  } catch (err) {
    console.error('[chatContext] Erreur chargement occupation_notes:', err);
    return [];
  }
}

/**
 * Charge les traits et calcule priority_score dynamiquement (§III.3d 886–904).
 *
 *   priority_score = 0.7 * strength + 0.3 * recency_score
 *   recency_score :
 *     1.0  → vu dans les 30 derniers jours
 *     0.7  → vu entre 31 et 90 jours
 *     0.5  → vu il y a plus de 90 jours
 *
 * Retourne le top N trié par priority_score DESC.
 */
async function loadTraits(userId: string): Promise<ContextTrait[]> {
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

      const strength = Number(row.strength);
      const priorityScore = computeTraitPriorityScore(strength, daysSince);

      return {
        trait_key: row.trait_key as string,
        strength,
        source: row.source as string,
        priority_score: priorityScore,
      };
    });

    // Tri stable : priority_score DESC, puis trait_key ASC pour déterminisme
    scored.sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return a.trait_key.localeCompare(b.trait_key);
    });

    return scored.slice(0, TRAITS_LIMIT);
  } catch (err) {
    console.error('[chatContext] Erreur chargement traits:', err);
    return [];
  }
}

async function loadPreferences(userId: string): Promise<ContextPreference[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .select('category_key,value_type,value_text,value_enum,value_bool,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(PREFERENCES_LIMIT);

    if (error) throw error;
    return (data ?? []).map((row) => ({
      category_key: row.category_key,
      value_type: row.value_type,
      value_text: row.value_text ?? null,
      value_enum: row.value_enum ?? null,
      value_bool: row.value_bool ?? null,
      last_seen_at: row.last_seen_at,
    }));
  } catch (err) {
    console.error('[chatContext] Erreur chargement preferences:', err);
    return [];
  }
}

async function loadRelations(userId: string): Promise<ContextRelation[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_relations')
      .select('id,name_raw,name_key,relation_type,last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(RELATIONS_LIMIT);

    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      name_raw: row.name_raw,
      name_key: row.name_key,
      relation_type: row.relation_type,
      last_seen_at: row.last_seen_at,
    }));
  } catch (err) {
    console.error('[chatContext] Erreur chargement relations:', err);
    return [];
  }
}

/**
 * Charge les événements éphémères non expirés uniquement (expires_at > now()).
 * Tri par event_at ASC (les plus proches dans le temps d'abord),
 * puis created_at ASC pour déterminisme.
 */
async function loadEphemeralEvents(userId: string): Promise<ContextEphemeralEvent[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_ephemeral_events')
      .select('event_text,event_at,expires_at')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('event_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(EPHEMERAL_EVENTS_LIMIT);

    if (error) throw error;
    return (data ?? []).map((row) => ({
      event_text: row.event_text,
      event_at: row.event_at ?? null,
      expires_at: row.expires_at,
    }));
  } catch (err) {
    console.error('[chatContext] Erreur chargement ephemeral_events:', err);
    return [];
  }
}

async function loadLifeEvents(userId: string): Promise<ContextLifeEvent[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_life_events')
      .select('event_text,event_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIFE_EVENTS_LIMIT);

    if (error) throw error;
    return (data ?? []).map((row) => ({
      event_text: row.event_text,
      event_at: row.event_at ?? null,
    }));
  } catch (err) {
    console.error('[chatContext] Erreur chargement life_events:', err);
    return [];
  }
}

/**
 * Charge mood_today et rolling_avg_7 (§III.3i 2470–2499).
 *
 * mood_today : mood du jour (date locale calculée via profiles.timezone).
 * rolling_avg_7 : AVG(mood_score) sur les 7 derniers jours calendaires, arrondi 1 décimale.
 */
async function loadMoodStats(userId: string, timezone: string): Promise<ContextMoodStats> {
  try {
    const today = getDateStringInTimezone(new Date(), timezone);

    // Une seule requête bornée : 7 derniers points jusqu'à "today" local.
    const { data, error } = await supabaseAdmin
      .from('user_mood_stats')
      .select('mood_date,mood_score')
      .eq('user_id', userId)
      .lte('mood_date', today)
      .order('mood_date', { ascending: false })
      .limit(MOOD_ROLLING_DAYS);

    if (error) throw error;

    return computeMoodStats(
      (data ?? []) as { mood_date: string; mood_score: number }[],
      today
    );
  } catch (err) {
    console.error('[chatContext] Erreur chargement mood_stats:', err);
    return { mood_today: null, rolling_avg_7: null };
  }
}

interface UserProfile {
  timezone: string;
  first_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  onboarding_answers: OnboardingAnswers | null;
}

/**
 * Relit `profiles.onboarding_answers` en ne gardant que des chaînes et des listes
 * de chaînes sous les clés connues. La colonne est écrite par l'app : on ne fait
 * confiance ni à sa forme ni à son contenu (les libellés font le reste).
 */
export function sanitizeOnboardingAnswers(raw: unknown): OnboardingAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);
  const strList = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64).slice(0, 20)
      : null;
  const answers: OnboardingAnswers = {
    mood: str(r.mood),
    energy: str(r.energy),
    concerns: strList(r.concerns),
    stress: str(r.stress),
    talk_to: str(r.talk_to),
    openness: str(r.openness),
    goals: strList(r.goals),
    pride: strList(r.pride),
    understood: strList(r.understood),
  };
  const hasAnything = Object.values(answers).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null));
  return hasAnything ? answers : null;
}

/** Profil utilisateur (Réglages). Non-fatal : valeurs par défaut si erreur. */
async function loadProfile(userId: string): Promise<UserProfile> {
  const fallback: UserProfile = {
    timezone: 'UTC',
    first_name: null,
    date_of_birth: null,
    gender: null,
    onboarding_answers: null,
  };
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('timezone,first_name,date_of_birth,gender,onboarding_answers')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fallback;
    const tz = data.timezone;
    const firstName = typeof data.first_name === 'string' ? data.first_name.trim() : '';
    return {
      timezone: typeof tz === 'string' && tz.trim().length > 0 ? tz : 'UTC',
      first_name: firstName.length > 0 ? firstName : null,
      date_of_birth: typeof data.date_of_birth === 'string' ? data.date_of_birth : null,
      gender: typeof data.gender === 'string' ? data.gender : null,
      onboarding_answers: sanitizeOnboardingAnswers(data.onboarding_answers),
    };
  } catch (err) {
    console.error('[chatContext] Erreur chargement profil:', err);
    return fallback;
  }
}
