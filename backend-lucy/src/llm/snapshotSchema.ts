/**
 * Schémas Zod pour la validation des snapshots mémoire.
 * Conformes aux contrats JSON définis dans algorithme-memoire-lucy.md (§I.B, §III.3, §V.6).
 *
 * Principe (§I.B) :
 * - Parser le JSON
 * - Valider chaque section individuellement
 * - Pour les sections à tableau : filtrer les items invalides, garder les valides
 * - Ignorer toute section structurellement invalide
 * - Appliquer uniquement ce qui est valide
 */

import { z } from 'zod';

// ============================================================================
// CONSTANTS (exported for reuse in backend application logic)
// ============================================================================

export const ALLOWED_TRAIT_KEYS = [
  'anxious',
  'joyful',
  'hypersensitive',
  'confident',
  'insecure',
  'ambitious',
  'optimistic',
  'introverted',
  'extroverted',
  'calm',
] as const;

export const ALLOWED_CATEGORY_KEYS = [
  'food_favorites',
  'food_dislikes',
  'drink_favorites',
  'drink_dislikes',
  'sports_liked',
  'sports_disliked',
  'music_genres',
  'music_artists',
  'movies_favorites',
  'series_favorites',
  'audiovisual_genres',
  'book_genres',
  'book_authors',
  'books_favorites',
  'videogames_favorites',
  'boardgames_favorites',
  'arts_preferred_forms',
  'vibe_preferences',
  'topics_interests',
  'travel_like',
  'travel_places_liked',
] as const;

/** Catégories dont la valeur doit être un boolean (§III.3e : travel_like est bool). */
export const BOOL_CATEGORY_KEYS = new Set<string>(['travel_like']);

/** Valeurs enum autorisées par category_key (§III.3e §6–7). */
export const ENUM_CATEGORY_VALUES: Partial<Record<string, readonly string[]>> = {
  arts_preferred_forms: ['cinema', 'music', 'literature', 'visual_arts', 'theatre', 'dance', 'architecture'],
  vibe_preferences: ['calm', 'lively', 'crowded', 'quiet', 'outdoors', 'indoors', 'cozy'],
};

export const RELATION_TYPES = [
  'unknown',
  'family',
  'friend',
  'partner',
  'coworker',
  'classmate',
  'roommate',
] as const;

// ============================================================================
// SHARED VALIDATORS
// ============================================================================

/**
 * Validateur ISO 8601 datetime permissif (§III.3g/h : "ISO datetime").
 * Accepte : local (sans offset), UTC (Z), offset (+HH:MM), avec/sans ms.
 * Rejette : date seule, texte libre.
 */
const isoDatetime = z.string().datetime({ offset: true, local: true });

// ============================================================================
// ITEM SCHEMAS (exported for tests and future reuse)
// ============================================================================

// ---------- 1. user_identity (§III.3a) ----------

const occupationStatusEnum = z.enum(['study', 'work', 'none']);

/**
 * Objet identity_update. Chaque champ est optionnel (.nullish()),
 * null, ou une valeur non vide. .strict() empêche les clés inconnues.
 * Conforme à §III.3a lignes 388–404.
 */
export const identityUpdateObjectSchema = z.object({
  location_general: z.string().min(1).nullish(),
  occupation_status: occupationStatusEnum.nullish(),
  occupation_position: z.string().min(1).nullish(),
  occupation_domain: z.string().min(1).nullish(),
}).strict();

// ---------- 2. user_identity_goals (§III.3b) ----------

export const goalObjectSchema = z.object({
  goal_text: z.string().min(1),
}).strict();

// ---------- 3. user_occupation_notes (§III.3c) ----------

export const noteObjectSchema = z.object({
  note_text: z.string().min(1),
}).strict();

// ---------- 4. user_traits (§III.3d) ----------

const traitKeyEnum = z.enum(ALLOWED_TRAIT_KEYS);
const traitStatusEnum = z.enum(['affirm', 'deny']);

export const traitObjectSchema = z.object({
  trait_key: traitKeyEnum,
  status: traitStatusEnum,
}).strict();

// ---------- 5. user_preferences (§III.3e) ----------
// Validation conditionnelle : type de value dépend du category_key.
// - travel_like → boolean
// - arts_preferred_forms, vibe_preferences → string parmi les enum autorisés
// - tout le reste → string non vide

const categoryKeyEnum = z.enum(ALLOWED_CATEGORY_KEYS);

export const preferenceObjectSchema = z.object({
  category_key: categoryKeyEnum,
  value: z.union([z.string().min(1), z.boolean()]),
}).strict().refine(
  (data) => {
    // Bool categories : value doit être boolean
    if (BOOL_CATEGORY_KEYS.has(data.category_key)) {
      return typeof data.value === 'boolean';
    }
    // Text/enum categories : value doit être string
    if (typeof data.value !== 'string') return false;
    // Enum categories : value doit être dans la liste autorisée
    const allowed = ENUM_CATEGORY_VALUES[data.category_key];
    if (allowed) return allowed.includes(data.value);
    // Text categories : string non vide (déjà garanti par min(1))
    return true;
  },
  { message: 'Value type or content invalid for this category_key' },
);

// ---------- 6. user_relations (§III.3f) ----------
// Règle conditionnelle : si match_id est null, name_raw est obligatoire.

const relationTypeEnum = z.enum(RELATION_TYPES);

export const relationObjectSchema = z.object({
  match_id: z.string().uuid().nullable(),
  name_raw: z.string().min(1).nullable(),
  relation_type: relationTypeEnum,
}).strict().refine(
  (data) => data.match_id !== null || data.name_raw !== null,
  { message: 'name_raw is required when match_id is null (§III.3f)', path: ['name_raw'] },
);

// ---------- 7. user_ephemeral_events (§III.3g) ----------
// event_at : ISO 8601 permissif (avec ou sans offset)

export const ephemeralEventObjectSchema = z.object({
  event_text: z.string().min(1),
  event_at: isoDatetime.nullable(),
}).strict();

// ---------- 8. user_life_events (§III.3h) ----------

export const lifeEventObjectSchema = z.object({
  event_text: z.string().min(1),
  event_at: isoDatetime.nullable(),
}).strict();

// ============================================================================
// SECTION SCHEMAS (for type inference)
// ============================================================================

export const userIdentitySchema = z.object({
  identity_update: identityUpdateObjectSchema.nullable(),
}).strict();

export const userIdentityGoalsSchema = z.object({
  goal: goalObjectSchema.nullable(),
}).strict();

export const userOccupationNotesSchema = z.object({
  notes: z.array(noteObjectSchema).max(2),
}).strict();

export const userTraitsSchema = z.object({
  traits: z.array(traitObjectSchema).max(3),
}).strict();

export const userPreferencesSchema = z.object({
  preferences: z.array(preferenceObjectSchema),
}).strict();

export const userRelationsSchema = z.object({
  relation: relationObjectSchema.nullable(),
}).strict();

export const userEphemeralEventsSchema = z.object({
  events: z.array(ephemeralEventObjectSchema).max(2),
}).strict();

export const userLifeEventsSchema = z.object({
  events: z.array(lifeEventObjectSchema).max(1),
}).strict();

// ============================================================================
// TYPES
// ============================================================================

export type UserIdentitySnapshot = z.infer<typeof userIdentitySchema>;
export type UserIdentityGoalsSnapshot = z.infer<typeof userIdentityGoalsSchema>;
export type UserOccupationNotesSnapshot = z.infer<typeof userOccupationNotesSchema>;
export type UserTraitsSnapshot = z.infer<typeof userTraitsSchema>;
export type UserPreferencesSnapshot = z.infer<typeof userPreferencesSchema>;
export type UserRelationsSnapshot = z.infer<typeof userRelationsSchema>;
export type UserEphemeralEventsSnapshot = z.infer<typeof userEphemeralEventsSchema>;
export type UserLifeEventsSnapshot = z.infer<typeof userLifeEventsSchema>;

// snapshotRootSchema: référence statique pour documentation et validation complète.
// Non utilisé par validateSnapshot() car celui-ci fait du filtrage item-par-item.
export const snapshotRootSchema = z.object({
  user_identity: userIdentitySchema,
  user_identity_goals: userIdentityGoalsSchema,
  user_occupation_notes: userOccupationNotesSchema,
  user_traits: userTraitsSchema,
  user_preferences: userPreferencesSchema,
  user_relations: userRelationsSchema,
  user_ephemeral_events: userEphemeralEventsSchema,
  user_life_events: userLifeEventsSchema,
}).strict();

export type SnapshotRoot = z.infer<typeof snapshotRootSchema>;

// ============================================================================
// VALIDATION (section par section, item par item pour les tableaux)
// ============================================================================

/** Les 8 clés racines attendues (§V.6). */
const EXPECTED_ROOT_KEYS = new Set([
  'user_identity',
  'user_identity_goals',
  'user_occupation_notes',
  'user_traits',
  'user_preferences',
  'user_relations',
  'user_ephemeral_events',
  'user_life_events',
]);

/**
 * Résultat de la validation d'un snapshot.
 * Chaque section est soit validée (présente), soit null (ignorée car invalide).
 * `errors` contient les détails pour chaque problème (section absente, items filtrés, etc.).
 */
export interface ValidatedSnapshot {
  user_identity: UserIdentitySnapshot | null;
  user_identity_goals: UserIdentityGoalsSnapshot | null;
  user_occupation_notes: UserOccupationNotesSnapshot | null;
  user_traits: UserTraitsSnapshot | null;
  user_preferences: UserPreferencesSnapshot | null;
  user_relations: UserRelationsSnapshot | null;
  user_ephemeral_events: UserEphemeralEventsSnapshot | null;
  user_life_events: UserLifeEventsSnapshot | null;
  errors: Record<string, string>;
}

// ---------- Helpers internes ----------

/**
 * Valide une section à valeur unique (identity, goals, relations).
 * En cas d'échec Zod → null + erreur.
 */
function parseSection<T>(
  obj: Record<string, unknown>,
  key: string,
  schema: z.ZodType<T>,
  errors: Record<string, string>,
): T | null {
  if (!(key in obj)) {
    errors[key] = 'Missing section';
    return null;
  }
  const result = schema.safeParse(obj[key]);
  if (result.success) {
    return result.data;
  }
  errors[key] = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  return null;
}

/**
 * Extrait et valide une section à tableau avec filtrage item-par-item.
 * Conforme au contrat §I.B : items invalides ignorés individuellement,
 * items valides conservés (dans la limite de maxItems).
 *
 * @returns Le tableau d'items valides, ou null si la structure de la section elle-même est invalide.
 */
function parseArraySection<TItem>(
  obj: Record<string, unknown>,
  sectionKey: string,
  arrayKey: string,
  itemSchema: z.ZodType<TItem>,
  maxItems: number,
  errors: Record<string, string>,
): TItem[] | null {
  // Section présente ?
  if (!(sectionKey in obj)) {
    errors[sectionKey] = 'Missing section';
    return null;
  }

  const section = obj[sectionKey];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    errors[sectionKey] = 'Section is not an object';
    return null;
  }

  const sectionObj = section as Record<string, unknown>;

  // Clé du tableau présente ?
  if (!(arrayKey in sectionObj)) {
    errors[sectionKey] = `Missing "${arrayKey}" key`;
    return null;
  }

  // Clés inattendues dans la section → erreur (section rejetée, conforme à .strict())
  const extraSectionKeys = Object.keys(sectionObj).filter(k => k !== arrayKey);
  if (extraSectionKeys.length > 0) {
    errors[sectionKey] = `Unexpected keys in section: ${extraSectionKeys.join(', ')}`;
    return null;
  }

  const arr = sectionObj[arrayKey];
  if (!Array.isArray(arr)) {
    errors[sectionKey] = `"${arrayKey}" is not an array`;
    return null;
  }

  // Filtrage item-par-item
  const validItems: TItem[] = [];
  let invalidCount = 0;
  for (const item of arr) {
    const result = itemSchema.safeParse(item);
    if (result.success) {
      validItems.push(result.data);
    } else {
      invalidCount++;
    }
  }

  if (invalidCount > 0) {
    errors[`${sectionKey}_items`] = `${invalidCount} invalid item(s) filtered out of ${arr.length}`;
  }

  return validItems.slice(0, maxItems);
}

// ---------- Fonction principale ----------

/**
 * Valide un snapshot brut section par section.
 * Conforme au contrat §I.B : parse, valide chaque section, ignore les sections invalides,
 * retourne uniquement les parties valides.
 *
 * Stratégie pour les clés racines inattendues (§V.6 + §I.B) :
 * Le contrat dit "aucun champ supplémentaire n'est autorisé" ET "ignorer toute partie invalide".
 * Interprétation retenue : les clés inattendues sont signalées dans errors._extra_root_keys
 * mais les 8 sections valides sont quand même parsées. Justification : une clé en plus
 * n'invalide pas le contenu des sections légitimes, et rejeter tout serait fragile face
 * aux variations de modèles LLM.
 *
 * @param raw Objet JSON brut retourné par le LLM.
 * @returns Snapshot validé avec sections invalides à null + détail des erreurs.
 */
export function validateSnapshot(raw: unknown): ValidatedSnapshot {
  const allNull: ValidatedSnapshot = {
    user_identity: null,
    user_identity_goals: null,
    user_occupation_notes: null,
    user_traits: null,
    user_preferences: null,
    user_relations: null,
    user_ephemeral_events: null,
    user_life_events: null,
    errors: {},
  };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    allNull.errors._root = 'Snapshot is not a valid object';
    return allNull;
  }

  const obj = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};

  // Détection des clés racines inattendues (§V.6)
  const extraRootKeys = Object.keys(obj).filter(k => !EXPECTED_ROOT_KEYS.has(k));
  if (extraRootKeys.length > 0) {
    errors._extra_root_keys = `Unexpected root keys ignored: ${extraRootKeys.join(', ')}`;
  }

  // --- Sections à valeur unique (safeParse direct) ---

  const user_identity = parseSection(obj, 'user_identity', userIdentitySchema, errors);
  const user_identity_goals = parseSection(obj, 'user_identity_goals', userIdentityGoalsSchema, errors);
  const user_relations = parseSection(obj, 'user_relations', userRelationsSchema, errors);

  // --- Sections à tableau (filtrage item-par-item) ---

  const notesItems = parseArraySection(obj, 'user_occupation_notes', 'notes', noteObjectSchema, 2, errors);
  const user_occupation_notes: UserOccupationNotesSnapshot | null =
    notesItems !== null ? { notes: notesItems } : null;

  const traitsItems = parseArraySection(obj, 'user_traits', 'traits', traitObjectSchema, 3, errors);
  const user_traits: UserTraitsSnapshot | null =
    traitsItems !== null ? { traits: traitsItems } : null;

  const prefsItems = parseArraySection(obj, 'user_preferences', 'preferences', preferenceObjectSchema, ALLOWED_CATEGORY_KEYS.length, errors);
  const user_preferences: UserPreferencesSnapshot | null =
    prefsItems !== null ? { preferences: prefsItems } : null;

  const ephemeralItems = parseArraySection(obj, 'user_ephemeral_events', 'events', ephemeralEventObjectSchema, 2, errors);
  const user_ephemeral_events: UserEphemeralEventsSnapshot | null =
    ephemeralItems !== null ? { events: ephemeralItems } : null;

  const lifeItems = parseArraySection(obj, 'user_life_events', 'events', lifeEventObjectSchema, 1, errors);
  const user_life_events: UserLifeEventsSnapshot | null =
    lifeItems !== null ? { events: lifeItems } : null;

  return {
    user_identity,
    user_identity_goals,
    user_occupation_notes,
    user_traits,
    user_preferences,
    user_relations,
    user_ephemeral_events,
    user_life_events,
    errors,
  };
}
