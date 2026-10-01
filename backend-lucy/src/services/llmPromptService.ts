/**
 * Construction du prompt LLM complet pour le chat (plan §4.4, §7.2).
 *
 * Combine :
 *   - le system prompt de personnalité Lucy (Piliers 1–4, §3.2)
 *   - le bloc mémoire contextuelle injecté dynamiquement (§7.1–7.2)
 *   - les messages de conversation au format LLM
 *
 * Le bloc mémoire est ajouté au system prompt en section dédiée.
 * Les sections vides sont omises pour économiser des tokens.
 * Le framing du bloc rappelle les règles de mémoire organique (§7.2, règles 4–5).
 */

import { LUCY_BASE_PROMPT, LUCY_SAFETY_BLOCK } from '../prompts/chatSystemPrompt.js';
import { ONBOARDING_ANSWER_LABELS } from '../prompts/onboardingAnswerLabels.js';
import type {
  ChatContext,
  ContextTrait,
  ContextPreference,
  OnboardingAnswers,
} from '../types/chatContext.js';
import type { ChatMessage } from '../llm/chatClient.js';
import { formatLocalDateTime, describeGapSincePreviousUserMessage } from './chatContextUtils.js';

// ============================================================================
// Construction du system prompt enrichi
// ============================================================================

/**
 * Construit le system prompt complet : personnalité + instant présent + mémoire + sécurité.
 *
 * Structure (§7.3) :
 *   1. LUCY_BASE_PROMPT  — personnalité Lucy
 *   2. bloc « Right now » — date, heure locale, délai depuis le message précédent (toujours)
 *   2b. bloc questionnaire — ce que la personne a répondu à l'inscription (si présent)
 *   3. bloc mémoire      — contexte utilisateur injecté dynamiquement (si présent)
 *   4. LUCY_SAFETY_BLOCK — règles de sécurité, TOUJOURS en dernier
 *
 * Placer le bloc de sécurité après la mémoire garantit qu'il n'est jamais dilué
 * ou "oublié" par un bloc mémoire long, quelle que soit la quantité de contexte injectée.
 *
 * @param now        Instant de référence (injectable pour les tests).
 * @param appLocale  Langue de l'interface de l'app (`metadata.locale` de la requête), si envoyée.
 */
export function buildSystemPromptWithMemory(
  ctx: ChatContext,
  now: Date = new Date(),
  appLocale?: string
): string {
  const parts = [LUCY_BASE_PROMPT, buildNowBlock(ctx, now, appLocale)];
  const onboardingBlock = buildOnboardingBlock(ctx.onboardingAnswers);
  if (onboardingBlock) parts.push(onboardingBlock);
  const memoryBlock = buildMemoryBlock(ctx);
  if (memoryBlock) parts.push(memoryBlock);
  // Safety block toujours en fin de prompt — jamais dilué par la mémoire (§7.3)
  parts.push(LUCY_SAFETY_BLOCK);
  return parts.join('\n\n');
}

/**
 * Bloc « Right now » : date et heure locales de l'utilisateur, délai depuis son
 * message précédent quand il dépasse une heure, et ancienneté de la relation.
 *
 * Sans lui, Lucy proposait « vers 19h » à 21h, ignorait trois jours d'absence et
 * n'avait aucune saison pour ancrer ce qu'elle raconte d'elle.
 *
 * La langue de l'app est donnée comme un fait : sur un message court (« hi »), un
 * prénom français et un fuseau Europe/Paris suffisaient à faire répondre Lucy en
 * français (4 fois sur 6 mesurées le 17 sept. 2026 avec Luna). Une consigne « réponds
 * dans leur langue » n'y changeait presque rien ; cette ligne ramène à 0 sur 6.
 * Exporté pour les tests.
 */
export function buildNowBlock(ctx: ChatContext, now: Date, appLocale?: string): string {
  const lines = [
    '## Right now',
    `${formatLocalDateTime(now, ctx.timezone)}, their local time (${ctx.timezone}).`,
  ];
  const appLanguage = describeAppLanguage(appLocale);
  if (appLanguage) lines.push(`They use the app in ${appLanguage}.`);
  const gap = describeGapSincePreviousUserMessage(ctx.messages);
  if (gap) lines.push(gap);
  lines.push(describeRelationshipAge(ctx.userMsgCount));
  return lines.join('\n');
}

/**
 * Où en est la relation, en données et non en consigne : « lis où vous en êtes » était
 * trop abstrait pour le modèle, qui a dit « j'ai pensé à toi » au deuxième message.
 * Le compteur repart après un reset mémoire, ce qui est le comportement voulu.
 */
export function describeRelationshipAge(userMsgCount: number): string {
  if (userMsgCount <= 1) {
    return 'This is the very first message they ever send you: you are meeting right now.';
  }
  if (userMsgCount < 15) {
    return `You just met: this is only their ${ordinal(userMsgCount)} message to you, ever.`;
  }
  if (userMsgCount < 100) {
    return `You've been talking for a little while: ${userMsgCount} messages from them so far.`;
  }
  return `You know each other well by now: ${userMsgCount} messages from them so far.`;
}

/** « fr », « fr-FR », « en-US »… → nom de la langue en anglais ; null si inconnue. */
function describeAppLanguage(locale: string | undefined): string | null {
  const code = locale?.trim().toLowerCase().split(/[-_]/)[0];
  if (code === 'fr') return 'French';
  if (code === 'en') return 'English';
  return null;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Bloc « What they told you when they signed up » : les réponses du questionnaire
 * d'inscription, traduites par une table de libellés fixe (une clé inconnue est
 * ignorée, rien de la colonne n'atteint le modèle tel quel).
 *
 * Pourquoi : avec le pré-essai à cinq échanges, la première conversation est celle
 * qui décide. Sans ce bloc, Lucy ne savait au premier message que le prénom, l'âge et
 * trois traits, et répondait comme à une inconnue à quelqu'un qui venait de lui dire
 * que son sommeil l'inquiète. Le cadrage demande d'en faire quelque chose de confié,
 * pas un formulaire à réciter. Exporté pour les tests.
 */
export function buildOnboardingBlock(answers: OnboardingAnswers | null): string | null {
  if (!answers) return null;

  const one = (field: keyof typeof ONBOARDING_ANSWER_LABELS, key: string | null | undefined) => {
    if (!key) return null;
    const labels = ONBOARDING_ANSWER_LABELS[field] as Record<string, string>;
    return labels[key] ?? null;
  };
  const many = (field: keyof typeof ONBOARDING_ANSWER_LABELS, keys: string[] | null | undefined) => {
    if (!keys || keys.length === 0) return null;
    const labels = ONBOARDING_ANSWER_LABELS[field] as Record<string, string>;
    const found = keys.map((k) => labels[k]).filter((v): v is string => typeof v === 'string');
    return found.length > 0 ? found.join(', ') : null;
  };

  const lines: string[] = [];
  const push = (label: string, value: string | null) => {
    if (value) lines.push(`- ${label}: ${value}`);
  };
  push('How they said they were feeling lately', one('mood', answers.mood));
  push('Their energy at the time', one('energy', answers.energy));
  push("What's been on their mind", many('concerns', answers.concerns));
  push('How much stress affects them', one('stress', answers.stress));
  push('Who they can talk to when something bothers them', one('talk_to', answers.talk_to));
  push('Opening up to someone is', one('openness', answers.openness));
  push('What they hope to get from talking with you', many('goals', answers.goals));
  push("What they're proud of", many('pride', answers.pride));
  push('What they wish people understood better about them', many('understood', answers.understood));

  if (lines.length === 0) return null;

  const instruction = [
    '## What they told you when they signed up',
    '',
    'Before meeting you, they answered a short questionnaire. Treat it as something',
    'they confided, not a form: you know it, so let it guide what you notice and ask',
    'about, but never read it back to them or list it.',
  ].join('\n');

  return `${instruction}\n\n${lines.join('\n')}`;
}

/**
 * Convertit les messages du contexte au format attendu par le client LLM.
 */
export function contextMessagesToLlm(ctx: ChatContext): ChatMessage[] {
  return ctx.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

// ============================================================================
// Formatage du bloc mémoire (§7.2)
// ============================================================================

/**
 * Construit le bloc mémoire injecté dans le system prompt.
 *
 * Structure :
 *   1. Instruction d'utilisation organique (§7.2 — règles 4–5)
 *   2. Sections mémoire par catégorie, sections vides omises
 *
 * Les traits n'exposent jamais le score numérique de strength au LLM —
 * l'ordre (priority_score) suffit à guider l'importance relative.
 *
 * Le mood est sur une échelle 1–5 (contrainte DB `CHECK mood_score BETWEEN 1 AND 5`).
 *
 * Exporté pour faciliter les tests unitaires.
 */
export function buildMemoryBlock(ctx: ChatContext): string | null {
  const { memory } = ctx;
  const sections: string[] = [];

  // --- Identity (prénom, âge, genre, lieu, occupation) ---
  if (memory.identity) {
    const id = memory.identity;
    const parts: string[] = [];
    if (id.first_name) parts.push(id.first_name);
    if (id.age != null) parts.push(`${id.age} y/o`);
    if (id.gender) parts.push(id.gender);
    if (id.location_general) parts.push(id.location_general);
    if (id.occupation_status) {
      let occ = id.occupation_status;
      if (id.occupation_position) occ += ` — ${id.occupation_position}`;
      if (id.occupation_domain) occ += ` (${id.occupation_domain})`;
      parts.push(occ);
    }
    if (parts.length > 0) {
      sections.push(`Who they are: ${parts.join(', ')}`);
    }
  }

  // --- Goals ---
  if (memory.goals.length > 0) {
    const goals = memory.goals.map((g) => g.goal_text).join(' / ');
    sections.push(`Goals: ${goals}`);
  }

  // --- Occupation notes ---
  if (memory.occupation_notes.length > 0) {
    const notes = memory.occupation_notes.map((n) => n.note_text).join(' / ');
    sections.push(`Work/study context: ${notes}`);
  }

  // --- Traits (noms seuls, par ordre de priorité — §III.3d 902–906) ---
  // Le strength brut n'est jamais exposé au LLM ; l'ordre suffit.
  if (memory.traits.length > 0) {
    sections.push(`Their vibe: ${formatTraits(memory.traits)}`);
  }

  // --- Preferences ---
  if (memory.preferences.length > 0) {
    const prefs = formatPreferences(memory.preferences);
    if (prefs) sections.push(`What they like/dislike:\n${prefs}`);
  }

  // --- Relations ---
  if (memory.relations.length > 0) {
    const rels = memory.relations
      .map((r) => `${r.name_raw} (${r.relation_type})`)
      .join(', ');
    sections.push(`People they've mentioned: ${rels}`);
  }

  // --- Life events ---
  if (memory.life_events.length > 0) {
    const events = memory.life_events
      .map((e) => (e.event_at ? `${e.event_text} (${e.event_at})` : e.event_text))
      .join(' / ');
    sections.push(`Big things in their life: ${events}`);
  }

  // --- Ephemeral events (non expirés, déjà filtrés en amont) ---
  if (memory.ephemeral_events.length > 0) {
    const events = memory.ephemeral_events
      .map((e) => (e.event_at ? `${e.event_text} (${e.event_at})` : e.event_text))
      .join(' / ');
    sections.push(`Coming up / recent: ${events}`);
  }

  // --- Mood (échelle 1–5 — contrainte DB CHECK mood_score BETWEEN 1 AND 5) ---
  const { mood_today, rolling_avg_7 } = memory.mood;
  if (mood_today != null || rolling_avg_7 != null) {
    const parts: string[] = [];
    if (mood_today != null) parts.push(`today ${mood_today}/5`);
    if (rolling_avg_7 != null) parts.push(`7-day avg ${rolling_avg_7}/5`);
    sections.push(`Their mood: ${parts.join(' | ')}`);
  }

  if (sections.length === 0) return null;

  // Instruction de mémoire organique (§7.2 — règles 4–5) :
  // utiliser la mémoire pour renforcer le lien, jamais pour réciter mécaniquement.
  const instruction = [
    '## What you remember about them',
    '',
    'Use this to feel close to them — reference it when it flows naturally,',
    'not every message, never as a list. A best friend who just *remembers*,',
    'not a database reading back facts. Let it shape your tone and warmth.',
  ].join('\n');

  return `${instruction}\n\n${sections.map((s) => `- ${s}`).join('\n')}`;
}

// ============================================================================
// Helpers de formatage
// ============================================================================

/**
 * Formate les traits en liste de noms ordonnée par priorité.
 * Le strength numérique n'est pas exposé au LLM (§III.3d 902–906).
 */
function formatTraits(traits: ContextTrait[]): string {
  // Déjà triés par priority_score DESC depuis chatContextService
  return traits.map((t) => t.trait_key).join(', ');
}

/**
 * Formate les préférences en lignes concises.
 * Les valeurs booléennes sont rendues "yes"/"no" (lisible pour le LLM).
 */
function formatPreferences(prefs: ContextPreference[]): string {
  return prefs
    .map((p) => {
      const val = formatPreferenceValue(p);
      return `  - ${p.category_key}: ${val}`;
    })
    .join('\n');
}

/**
 * Détermine la valeur lisible d'une préférence selon son type.
 */
export function formatPreferenceValue(p: ContextPreference): string {
  if (p.value_text != null) return p.value_text;
  if (p.value_enum != null) return p.value_enum;
  if (p.value_bool != null) return p.value_bool ? 'yes' : 'no';
  return '?';
}
