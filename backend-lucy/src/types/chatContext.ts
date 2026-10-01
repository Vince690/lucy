/**
 * Types pour le contexte LLM du chat (plan §4.3, §7.1).
 *
 * Structure déterministe : chaque section est toujours présente.
 *   - objet  → la valeur ou null
 *   - liste  → les éléments ou []
 *   - nombre → la valeur ou null
 */

// ============================================================================
// Messages de contexte (fenêtre glissante)
// ============================================================================

export interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Horodatage ISO du message (sert au bloc « Right now » : délai depuis le message précédent). */
  created_at: string;
}

// ============================================================================
// Mémoire longue — sections typées
// ============================================================================

export interface ContextIdentity {
  first_name: string | null;
  age: number | null;
  gender: string | null;
  location_general: string | null;
  occupation_status: string | null;
  occupation_position: string | null;
  occupation_domain: string | null;
}

export interface ContextGoal {
  goal_text: string;
  last_seen_at: string;
}

export interface ContextOccupationNote {
  note_text: string;
  last_seen_at: string;
}

export interface ContextTrait {
  trait_key: string;
  strength: number;
  source: string;
  priority_score: number;
}

export interface ContextPreference {
  category_key: string;
  value_type: string;
  value_text: string | null;
  value_enum: string | null;
  value_bool: boolean | null;
  last_seen_at: string;
}

export interface ContextRelation {
  id: string;
  name_raw: string;
  name_key: string;
  relation_type: string;
  last_seen_at: string;
}

export interface ContextEphemeralEvent {
  event_text: string;
  event_at: string | null;
  expires_at: string;
}

export interface ContextLifeEvent {
  event_text: string;
  event_at: string | null;
}

export interface ContextMoodStats {
  mood_today: number | null;
  rolling_avg_7: number | null;
}

// ============================================================================
// Réponses du questionnaire d'inscription (profiles.onboarding_answers)
// ============================================================================

/**
 * Clés d'options du questionnaire, telles que l'app les écrit à la fin de
 * l'onboarding. Jamais de texte libre. Chaque clé est traduite par la table
 * prompts/onboardingAnswerLabels.ts ; une clé inconnue est ignorée.
 */
export interface OnboardingAnswers {
  mood?: string | null;
  energy?: string | null;
  concerns?: string[] | null;
  stress?: string | null;
  talk_to?: string | null;
  openness?: string | null;
  goals?: string[] | null;
  pride?: string[] | null;
  understood?: string[] | null;
}

// ============================================================================
// Structure complète du contexte LLM
// ============================================================================

export interface ChatContext {
  /** CONTEXT_MESSAGES_LIMIT derniers messages, ordre chronologique (msg_seq ASC). */
  messages: ContextMessage[];

  /** Fuseau IANA du profil (ex. "Europe/Paris"), 'UTC' si absent. Sert à dater le prompt. */
  timezone: string;

  /**
   * Nombre de messages que l'utilisateur a envoyés dans cette conversation, message
   * courant inclus. Repart de 1 après un reset mémoire. Sert au bloc « Right now » à dire
   * à Lucy depuis combien de temps ils se connaissent, plutôt que de le lui faire deviner.
   */
  userMsgCount: number;

  /**
   * Ce que la personne a répondu au questionnaire d'inscription, ou null si rien
   * n'est enregistré (comptes antérieurs au 23 septembre 2026). Sert au bloc
   * « What they told you when they signed up » : sans lui, Lucy répondait au
   * premier message comme à une inconnue.
   */
  onboardingAnswers: OnboardingAnswers | null;

  /** Mémoire longue structurée. */
  memory: {
    identity: ContextIdentity | null;
    goals: ContextGoal[];
    occupation_notes: ContextOccupationNote[];
    traits: ContextTrait[];
    preferences: ContextPreference[];
    relations: ContextRelation[];
    ephemeral_events: ContextEphemeralEvent[];
    life_events: ContextLifeEvent[];
    mood: ContextMoodStats;
  };
}
