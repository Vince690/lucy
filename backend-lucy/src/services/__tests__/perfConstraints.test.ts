/**
 * Tests de verrouillage des contraintes performance & couts (§VII).
 *
 * Ces tests ne valident pas une logique metier complexe : ils verrouillent
 * les valeurs des constantes critiques afin qu'une modification accidentelle
 * echoue en CI et force une revue consciente.
 *
 * Regles MVP (algorithme-memoire-lucy.md §VII) :
 *   - Fenetre LLM chat : 50 derniers messages max (evite les fenetres de contexte trop larges).
 *   - Declenchement snapshot : a 15 messages utilisateur, puis tous les 50 (batch, pas par message).
 *   - Pas d'embeddings / vector DB : memoire structuree + scoring recence uniquement.
 *
 * Si tu modifies ces valeurs, mets aussi a jour :
 *   - v_snapshot_user_msg_period dans la derniere migration write_user_message.
 *   - La section "Contraintes performance & couts" du README.
 *   - Le document algorithme-memoire-lucy.md (§VII).
 */

import { describe, it, expect } from 'vitest';
import {
  CONTEXT_MESSAGES_LIMIT,
  SEGMENT_USER_MESSAGES,
  SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES,
} from '../../constants.js';

describe('Contraintes performance & couts (§VII)', () => {
  it('fenetre LLM chat = 50 messages (§VII)', () => {
    expect(CONTEXT_MESSAGES_LIMIT).toBe(50);
  });

  it('premier snapshot a 15 messages utilisateur, avant la periode de 50', () => {
    expect(SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES).toBe(15);
    expect(SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES).toBeLessThan(SEGMENT_USER_MESSAGES);
  });

  it('declenchement snapshot = 50 messages utilisateur (§V.4, §VII)', () => {
    expect(SEGMENT_USER_MESSAGES).toBe(50);
  });

  it('fenetre chat <= batch snapshot (invariant architectural)', () => {
    // Le LLM chat ne voit jamais un batch snapshot complet :
    // 50 messages (user + assistant) <= 50 messages utilisateur du segment (~100 messages).
    expect(CONTEXT_MESSAGES_LIMIT).toBeLessThanOrEqual(SEGMENT_USER_MESSAGES);
  });
});

/**
 * Audit embeddings / vector DB : aucun package de ce type ne doit figurer
 * dans backend-lucy/package.json (pgvector, pinecone, chromadb, etc.).
 *
 * Verification : cf. audit package.json en §9.3 — confirme aucune dependance
 * embedding. Pas de test automatique ici (npm ls suffit) mais documente
 * l'intention MVP : la couche memoire repose exclusivement sur du texte
 * structure + scoring recence/force, sans couche vectorielle.
 */
