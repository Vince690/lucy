/**
 * Tests unitaires pour llmPromptService (§7.2 + §7.3).
 *
 * Couvre :
 *   - buildMemoryBlock : structure, sections présentes/absentes, format
 *   - formatPreferenceValue : text / enum / bool / fallback
 *   - buildSystemPromptWithMemory : fusion système + mémoire
 *   - §7.3 — règles de sécurité : présence, priorité, résistance à la dilution mémoire
 *
 * Les tests vérifient que :
 *   - le bloc mémoire est null si toutes les sections sont vides
 *   - l'échelle mood est bien /5 (pas /10)
 *   - les traits ne montrent pas le strength numérique
 *   - les booleans sont rendus "yes"/"no"
 *   - l'instruction mémoire organique est présente
 *   - §7.3 : le bloc sécurité est toujours présent et en dernier dans le prompt final
 */

import { describe, it, expect } from 'vitest';
import { buildMemoryBlock, buildSystemPromptWithMemory, buildNowBlock, describeRelationshipAge, formatPreferenceValue } from '../llmPromptService.js';
import { LUCY_CHAT_SYSTEM_PROMPT, LUCY_SAFETY_BLOCK, LUCY_BASE_PROMPT } from '../../prompts/chatSystemPrompt.js';
import type { ChatContext } from '../../types/chatContext.js';

// ============================================================================
// Helpers — contextes de test
// ============================================================================

function emptyMemory(): ChatContext['memory'] {
  return {
    identity: null,
    goals: [],
    occupation_notes: [],
    traits: [],
    preferences: [],
    relations: [],
    ephemeral_events: [],
    life_events: [],
    mood: { mood_today: null, rolling_avg_7: null },
  };
}

function emptyContext(): ChatContext {
  return { messages: [], timezone: 'Europe/Paris', userMsgCount: 1, onboardingAnswers: null, memory: emptyMemory() };
}

/** Instant fixe : samedi 5 septembre 2026, 14:32 à Paris (12:32 UTC). */
const NOW = new Date('2026-09-05T12:32:00Z');

// ============================================================================
// buildMemoryBlock — cas limite
// ============================================================================

describe('buildMemoryBlock — cas vides', () => {
  it('retourne null si toute la mémoire est vide', () => {
    expect(buildMemoryBlock(emptyContext())).toBeNull();
  });

  it('retourne non-null dès qu\'une section a du contenu', () => {
    const ctx = emptyContext();
    ctx.memory.identity = {
      first_name: 'Alice',
      age: null,
      gender: null,
      location_general: null,
      occupation_status: null,
      occupation_position: null,
      occupation_domain: null,
    };
    expect(buildMemoryBlock(ctx)).not.toBeNull();
  });
});

// ============================================================================
// buildMemoryBlock — identité
// ============================================================================

describe('buildMemoryBlock — identité', () => {
  it('inclut le prénom', () => {
    const ctx = emptyContext();
    ctx.memory.identity = {
      first_name: 'Marie',
      age: 25,
      gender: 'female',
      location_general: 'Paris',
      occupation_status: 'work',
      occupation_position: 'designer',
      occupation_domain: 'tech',
    };
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('Marie');
    expect(block).toContain('25 y/o');
    expect(block).toContain('Paris');
    expect(block).toContain('designer');
    expect(block).toContain('tech');
  });

  it('n\'inclut pas les champs null', () => {
    const ctx = emptyContext();
    ctx.memory.identity = {
      first_name: 'Bob',
      age: null,
      gender: null,
      location_general: null,
      occupation_status: null,
      occupation_position: null,
      occupation_domain: null,
    };
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('Bob');
    expect(block).not.toContain('null');
    expect(block).not.toContain('undefined');
  });
});

// ============================================================================
// buildMemoryBlock — traits
// ============================================================================

describe('buildMemoryBlock — traits', () => {
  it('liste les trait_key sans le strength numérique', () => {
    const ctx = emptyContext();
    ctx.memory.traits = [
      { trait_key: 'anxious', strength: 0.9, source: 'conversation', priority_score: 0.93 },
      { trait_key: 'ambitious', strength: 0.7, source: 'conversation', priority_score: 0.79 },
    ];
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('anxious');
    expect(block).toContain('ambitious');
    // Le strength numérique ne doit PAS apparaître
    expect(block).not.toContain('0.9');
    expect(block).not.toContain('0.7');
    expect(block).not.toContain('strength');
  });

  it('respecte l\'ordre (priority_score déjà trié en amont)', () => {
    const ctx = emptyContext();
    ctx.memory.traits = [
      { trait_key: 'confident', strength: 0.8, source: 'conversation', priority_score: 0.86 },
      { trait_key: 'introverted', strength: 0.6, source: 'conversation', priority_score: 0.57 },
    ];
    const block = buildMemoryBlock(ctx)!;
    const confIdx = block.indexOf('confident');
    const introIdx = block.indexOf('introverted');
    expect(confIdx).toBeLessThan(introIdx);
  });
});

// ============================================================================
// buildMemoryBlock — mood (échelle 1–5)
// ============================================================================

describe('buildMemoryBlock — mood', () => {
  it('affiche l\'échelle /5 pour mood_today', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 4, rolling_avg_7: null };
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('4/5');
    expect(block).not.toContain('4/10');
  });

  it('affiche l\'échelle /5 pour rolling_avg_7', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: null, rolling_avg_7: 3.5 };
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('3.5/5');
    expect(block).not.toContain('3.5/10');
  });

  it('affiche les deux quand disponibles', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 5, rolling_avg_7: 4.2 };
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('5/5');
    expect(block).toContain('4.2/5');
  });

  it('n\'inclut pas de section mood si tout est null', () => {
    const ctx = emptyContext();
    ctx.memory.identity = {
      first_name: 'Test',
      age: null, gender: null, location_general: null,
      occupation_status: null, occupation_position: null, occupation_domain: null,
    };
    ctx.memory.mood = { mood_today: null, rolling_avg_7: null };
    const block = buildMemoryBlock(ctx)!;
    expect(block).not.toContain('mood');
  });
});

// ============================================================================
// buildMemoryBlock — instruction mémoire organique (§7.2)
// ============================================================================

describe('buildMemoryBlock — instruction organique', () => {
  it('contient l\'instruction de mémoire organique', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 3, rolling_avg_7: null };
    const block = buildMemoryBlock(ctx)!;
    expect(block).toContain('What you remember about them');
    // Instruction organique — pas de "database"
    expect(block.toLowerCase()).toContain('naturally');
  });
});

// ============================================================================
// formatPreferenceValue
// ============================================================================

describe('formatPreferenceValue', () => {
  const base = { category_key: 'music', last_seen_at: '2026-03-26' };

  it('retourne value_text si présent', () => {
    expect(formatPreferenceValue({ ...base, value_type: 'text', value_text: 'jazz', value_enum: null, value_bool: null })).toBe('jazz');
  });

  it('retourne value_enum si value_text absent', () => {
    expect(formatPreferenceValue({ ...base, value_type: 'enum', value_text: null, value_enum: 'likes', value_bool: null })).toBe('likes');
  });

  it('retourne "yes" pour value_bool=true', () => {
    expect(formatPreferenceValue({ ...base, value_type: 'bool', value_text: null, value_enum: null, value_bool: true })).toBe('yes');
  });

  it('retourne "no" pour value_bool=false', () => {
    expect(formatPreferenceValue({ ...base, value_type: 'bool', value_text: null, value_enum: null, value_bool: false })).toBe('no');
  });

  it('retourne "?" si tout est null', () => {
    expect(formatPreferenceValue({ ...base, value_type: 'text', value_text: null, value_enum: null, value_bool: null })).toBe('?');
  });
});

// ============================================================================
// buildSystemPromptWithMemory
// ============================================================================

describe('buildSystemPromptWithMemory', () => {
  it('sans mémoire : base + « Right now » + sécurité, sans bloc mémoire', () => {
    const ctx = emptyContext();
    const result = buildSystemPromptWithMemory(ctx, NOW);
    expect(result).toBe(`${LUCY_BASE_PROMPT}\n\n${buildNowBlock(ctx, NOW)}\n\n${LUCY_SAFETY_BLOCK}`);
    expect(result).not.toContain('## What you remember about them');
  });

  it('concatène system prompt + bloc mémoire si données présentes', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 4, rolling_avg_7: 3.8 };
    const result = buildSystemPromptWithMemory(ctx, NOW);
    expect(result.startsWith(LUCY_BASE_PROMPT)).toBe(true);
    expect(result).toContain('4/5');
  });
});

// ============================================================================
// buildNowBlock — date, heure locale, délai depuis le message précédent
// ============================================================================

describe('buildNowBlock', () => {
  it('donne la date et l\'heure dans le fuseau de l\'utilisateur', () => {
    const block = buildNowBlock(emptyContext(), NOW);
    expect(block).toContain('## Right now');
    expect(block).toContain('Saturday');
    expect(block).toContain('5 September 2026');
    expect(block).toContain('14:32');
    expect(block).toContain('Europe/Paris');
  });

  it('ne mentionne pas de délai quand le message précédent date de moins d\'une heure', () => {
    const ctx = emptyContext();
    ctx.messages = [
      { role: 'user', content: 'a', created_at: '2026-09-05T12:10:00Z' },
      { role: 'assistant', content: 'b', created_at: '2026-09-05T12:10:05Z' },
      { role: 'user', content: 'c', created_at: '2026-09-05T12:32:00Z' },
    ];
    expect(buildNowBlock(ctx, NOW)).not.toContain('previous message');
  });

  it('mentionne le délai en heures puis en jours', () => {
    const ctx = emptyContext();
    ctx.messages = [
      { role: 'user', content: 'a', created_at: '2026-09-05T07:00:00Z' },
      { role: 'assistant', content: 'b', created_at: '2026-09-05T07:00:05Z' },
      { role: 'user', content: 'c', created_at: '2026-09-05T12:32:00Z' },
    ];
    expect(buildNowBlock(ctx, NOW)).toContain('about 6 hours ago');

    ctx.messages[0].created_at = '2026-09-02T12:00:00Z';
    expect(buildNowBlock(ctx, NOW)).toContain('3 days ago');
  });

  it('ignore les messages assistant pour trouver le message précédent', () => {
    const ctx = emptyContext();
    ctx.messages = [
      { role: 'assistant', content: 'welcome', created_at: '2026-09-05T12:31:00Z' },
      { role: 'user', content: 'c', created_at: '2026-09-05T12:32:00Z' },
    ];
    expect(buildNowBlock(ctx, NOW)).not.toContain('previous message');
  });

  it('retombe sur UTC si le fuseau est invalide', () => {
    const ctx = { ...emptyContext(), timezone: 'Mars/Olympus' };
    expect(buildNowBlock(ctx, NOW)).toContain('12:32');
  });
});

// ============================================================================
// §7.3 — Règles de sécurité : présence, contenu, priorité, résistance mémoire
// ============================================================================

describe('§7.3 — LUCY_SAFETY_BLOCK — contenu', () => {
  it('contient l\'interdiction de diagnostic médical/psy', () => {
    expect(LUCY_SAFETY_BLOCK).toContain('diagnosis');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('medical');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('psychological');
  });

  it('contient l\'interdiction d\'instructions dangereuses', () => {
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('harm');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('dangerous');
  });

  it('contient le protocole de crise (signaux suicidaires / détresse)', () => {
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('suicidal');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('self-harm');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('crisis');
  });

  it('contient la redirection vers aide humaine / urgences', () => {
    expect(LUCY_SAFETY_BLOCK).toContain("I'm an AI and I don't know how to handle this crisis well");
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('emergency');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('hotline');
  });

  it('est explicitement marqué comme priorité absolue surpassant tous les autres règles', () => {
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('absolute priority');
    expect(LUCY_SAFETY_BLOCK.toLowerCase()).toContain('overrides');
  });
});

describe('§7.3 — LUCY_CHAT_SYSTEM_PROMPT — cohérence base + safety', () => {
  it('contient LUCY_BASE_PROMPT en intégralité', () => {
    expect(LUCY_CHAT_SYSTEM_PROMPT).toContain(LUCY_BASE_PROMPT);
  });

  it('contient LUCY_SAFETY_BLOCK en intégralité', () => {
    expect(LUCY_CHAT_SYSTEM_PROMPT).toContain(LUCY_SAFETY_BLOCK);
  });

  it('le bloc safety apparaît APRÈS le contenu de personnalité dans le prompt complet', () => {
    const baseIdx = LUCY_CHAT_SYSTEM_PROMPT.indexOf('You are Lucy');
    const safetyIdx = LUCY_CHAT_SYSTEM_PROMPT.indexOf('SAFETY & ETHICS');
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(safetyIdx).toBeGreaterThan(baseIdx);
  });
});

describe('§7.3 — buildSystemPromptWithMemory — safety toujours présent et en dernier', () => {
  it('contient le bloc safety même quand la mémoire est vide', () => {
    const result = buildSystemPromptWithMemory(emptyContext());
    expect(result).toContain(LUCY_SAFETY_BLOCK);
  });

  it('contient le bloc safety quand la mémoire est riche', () => {
    const ctx = emptyContext();
    ctx.memory.identity = {
      first_name: 'Alice', age: 28, gender: 'female',
      location_general: 'Lyon', occupation_status: 'work',
      occupation_position: 'engineer', occupation_domain: 'tech',
    };
    ctx.memory.traits = [
      { trait_key: 'anxious', strength: 0.8, source: 'conversation', priority_score: 0.85 },
    ];
    ctx.memory.mood = { mood_today: 2, rolling_avg_7: 2.5 };
    const result = buildSystemPromptWithMemory(ctx);
    expect(result).toContain(LUCY_SAFETY_BLOCK);
  });

  it('le bloc safety apparaît APRÈS le bloc mémoire quand les deux sont présents', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 3, rolling_avg_7: null };
    const result = buildSystemPromptWithMemory(ctx);
    const memoryIdx = result.indexOf('What you remember about them');
    const safetyIdx = result.indexOf('SAFETY & ETHICS');
    expect(memoryIdx).toBeGreaterThanOrEqual(0);
    expect(safetyIdx).toBeGreaterThan(memoryIdx);
  });

  it('le bloc safety est le dernier élément du prompt composé (mémoire présente)', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 4, rolling_avg_7: 3.8 };
    const result = buildSystemPromptWithMemory(ctx);
    expect(result.trimEnd().endsWith(LUCY_SAFETY_BLOCK.trimEnd())).toBe(true);
  });

  it('le bloc safety est le dernier élément du prompt composé (mémoire absente)', () => {
    const result = buildSystemPromptWithMemory(emptyContext());
    expect(result.trimEnd().endsWith(LUCY_SAFETY_BLOCK.trimEnd())).toBe(true);
  });

  it('le bloc mémoire ne contient pas les règles de sécurité (séparation claire)', () => {
    const ctx = emptyContext();
    ctx.memory.mood = { mood_today: 3, rolling_avg_7: null };
    const memoryBlock = buildMemoryBlock(ctx)!;
    expect(memoryBlock).not.toContain('SAFETY');
    expect(memoryBlock).not.toContain('CRISIS PROTOCOL');
    expect(memoryBlock).not.toContain('diagnosis');
  });
});

// ============================================================================
// describeRelationshipAge — ancienneté de la relation, en données
// ============================================================================

describe('describeRelationshipAge', () => {
  it('premier message : rencontre en cours', () => {
    expect(describeRelationshipAge(1)).toMatch(/very first message/);
    expect(describeRelationshipAge(0)).toMatch(/very first message/);
  });

  it('moins de 15 messages : on vient de se rencontrer, avec le rang', () => {
    expect(describeRelationshipAge(2)).toBe('You just met: this is only their 2nd message to you, ever.');
    expect(describeRelationshipAge(3)).toMatch(/3rd message/);
    expect(describeRelationshipAge(11)).toMatch(/11th message/);
  });

  it('au-delà : le nombre de messages, sans « just met »', () => {
    expect(describeRelationshipAge(15)).toBe("You've been talking for a little while: 15 messages from them so far.");
    expect(describeRelationshipAge(240)).toMatch(/know each other well.*240 messages/);
  });

  it('le bloc Right now contient toujours la ligne', () => {
    const ctx = { ...emptyContext(), userMsgCount: 2 };
    expect(buildNowBlock(ctx, NOW)).toContain('2nd message to you');
  });
});
