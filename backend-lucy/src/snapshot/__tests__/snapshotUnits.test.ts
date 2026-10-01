import { describe, it, expect } from 'vitest';
import { computeSnapshotUserMsgSeqRange } from '../seqBounds.js';
import { computeEphemeralExpiresAt } from '../ephemeralExpires.js';
import {
  preprocessTraits,
  computeNewTraitStrength,
  mergeEphemeralForKey,
  selectTopEphemeralEvents,
} from '../applySnapshotMemory.js';
import { collectNormalizeTexts } from '../normalizeBatch.js';

describe('computeSnapshotUserMsgSeqRange', () => {
  it('couvre 1-50 pour le premier snapshot', () => {
    expect(computeSnapshotUserMsgSeqRange(50)).toEqual({ seqFrom: 1, seqTo: 50 });
  });
  it('couvre 51-100 pour le deuxieme palier', () => {
    expect(computeSnapshotUserMsgSeqRange(100)).toEqual({ seqFrom: 51, seqTo: 100 });
  });
  it('rejette un trigger invalide', () => {
    expect(() => computeSnapshotUserMsgSeqRange(0)).toThrow();
  });
});

describe('computeEphemeralExpiresAt', () => {
  const t0 = new Date('2026-03-24T12:00:00.000Z').getTime();
  it('sans date : +14 jours', () => {
    const exp = computeEphemeralExpiresAt(null, t0)!;
    expect(exp.getTime()).toBe(t0 + 14 * 24 * 60 * 60 * 1000);
  });
  it('rejette si event_at + 7j <= maintenant', () => {
    const ev = new Date('2026-03-01T12:00:00.000Z');
    expect(computeEphemeralExpiresAt(ev, t0)).toBeNull();
  });
  it('accepte event_at + 7j > maintenant', () => {
    const ev = new Date('2026-06-01T12:00:00.000Z');
    const exp = computeEphemeralExpiresAt(ev, t0)!;
    expect(exp.getTime()).toBe(ev.getTime() + 7 * 24 * 60 * 60 * 1000);
  });
});

// ============================================================================
// preprocessTraits (§III.3d - dedup intra-snapshot, deny gagne)
// ============================================================================

describe('preprocessTraits', () => {
  it("deny l'emporte sur affirm pour le meme trait", () => {
    const out = preprocessTraits([
      { trait_key: 'anxious', status: 'affirm' },
      { trait_key: 'anxious', status: 'deny' },
    ]);
    expect(out).toEqual([{ trait_key: 'anxious', status: 'deny' }]);
  });

  it('affirm puis deny => deny', () => {
    const out = preprocessTraits([
      { trait_key: 'calm', status: 'affirm' },
      { trait_key: 'calm', status: 'deny' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('deny');
  });

  it('deny puis affirm => deny (deny gagne toujours)', () => {
    const out = preprocessTraits([
      { trait_key: 'calm', status: 'deny' },
      { trait_key: 'calm', status: 'affirm' },
    ]);
    expect(out[0].status).toBe('deny');
  });

  it('traits sans doublon passent tels quels', () => {
    const out = preprocessTraits([
      { trait_key: 'anxious', status: 'affirm' },
      { trait_key: 'calm', status: 'deny' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('tableau vide => tableau vide', () => {
    expect(preprocessTraits([])).toEqual([]);
  });

  it('trait unique affirm => conserve', () => {
    const out = preprocessTraits([{ trait_key: 'joyful', status: 'affirm' }]);
    expect(out).toEqual([{ trait_key: 'joyful', status: 'affirm' }]);
  });

  it('deny puis deny => deny (idempotent)', () => {
    const out = preprocessTraits([
      { trait_key: 'insecure', status: 'deny' },
      { trait_key: 'insecure', status: 'deny' },
    ]);
    expect(out).toEqual([{ trait_key: 'insecure', status: 'deny' }]);
  });
});

// ============================================================================
// collectNormalizeTexts (collecte des textes a normaliser)
// ============================================================================

describe('collectNormalizeTexts', () => {
  it('collecte les champs texte du snapshot valide', () => {
    const texts = collectNormalizeTexts({
      user_identity: null,
      user_identity_goals: { goal: { goal_text: 'run' } },
      user_occupation_notes: { notes: [{ note_text: 'dev' }] },
      user_traits: null,
      user_preferences: {
        preferences: [
          { category_key: 'food_favorites', value: 'pizza' },
          { category_key: 'travel_like', value: true },
        ],
      },
      user_relations: { relation: { match_id: null, name_raw: 'Sam', relation_type: 'friend' } },
      user_ephemeral_events: { events: [{ event_text: 'dentist', event_at: null }] },
      user_life_events: { events: [{ event_text: 'moved', event_at: null }] },
      errors: {},
    });
    expect(texts).toEqual(['run', 'dev', 'pizza', 'Sam', 'dentist', 'moved']);
  });

  it('toutes sections null => tableau vide', () => {
    const texts = collectNormalizeTexts({
      user_identity: null,
      user_identity_goals: null,
      user_occupation_notes: null,
      user_traits: null,
      user_preferences: null,
      user_relations: null,
      user_ephemeral_events: null,
      user_life_events: null,
      errors: {},
    });
    expect(texts).toEqual([]);
  });

  it('preference booleenne (travel_like) non incluse', () => {
    const texts = collectNormalizeTexts({
      user_identity: null,
      user_identity_goals: null,
      user_occupation_notes: null,
      user_traits: null,
      user_preferences: {
        preferences: [
          { category_key: 'travel_like', value: true },
          { category_key: 'food_favorites', value: 'sushi' },
        ],
      },
      user_relations: null,
      user_ephemeral_events: null,
      user_life_events: null,
      errors: {},
    });
    // travel_like (boolean) ne genere pas de cle de normalisation
    expect(texts).toEqual(['sushi']);
  });

  it('relation avec name_raw null non incluse', () => {
    const texts = collectNormalizeTexts({
      user_identity: null,
      user_identity_goals: null,
      user_occupation_notes: null,
      user_traits: null,
      user_preferences: null,
      user_relations: {
        relation: {
          match_id: '550e8400-e29b-41d4-a716-446655440000',
          name_raw: null,
          relation_type: 'family',
        },
      },
      user_ephemeral_events: null,
      user_life_events: null,
      errors: {},
    });
    expect(texts).toEqual([]);
  });

  it("plusieurs notes incluses dans l'ordre", () => {
    const texts = collectNormalizeTexts({
      user_identity: null,
      user_identity_goals: null,
      user_occupation_notes: { notes: [{ note_text: 'note A' }, { note_text: 'note B' }] },
      user_traits: null,
      user_preferences: null,
      user_relations: null,
      user_ephemeral_events: null,
      user_life_events: null,
      errors: {},
    });
    expect(texts).toEqual(['note A', 'note B']);
  });

  it('goal null => non inclus', () => {
    const texts = collectNormalizeTexts({
      user_identity: null,
      user_identity_goals: { goal: null },
      user_occupation_notes: null,
      user_traits: null,
      user_preferences: null,
      user_relations: null,
      user_ephemeral_events: null,
      user_life_events: null,
      errors: {},
    });
    expect(texts).toEqual([]);
  });
});

// ============================================================================
// computeNewTraitStrength (§III.3d)
// ============================================================================

describe('computeNewTraitStrength (§III.3d)', () => {
  it('affirm : force augmente de 0.15', () => {
    const result = computeNewTraitStrength(0.5, 'affirm');
    expect(result).toBeCloseTo(0.65, 5);
  });

  it('affirm plafonne a 1.0 si depassement', () => {
    expect(computeNewTraitStrength(0.9, 'affirm')).toBe(1.0);
    expect(computeNewTraitStrength(1.0, 'affirm')).toBe(1.0);
  });

  it('deny : force diminue de 0.25', () => {
    const result = computeNewTraitStrength(0.75, 'deny');
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('deny plancher a 0.0 si negatif', () => {
    expect(computeNewTraitStrength(0.2, 'deny')).toBe(0.0);
    expect(computeNewTraitStrength(0.0, 'deny')).toBe(0.0);
  });

  it('deny : resultat juste au-dessus de 0 (plancher non declenche)', () => {
    // 0.30 - 0.25 = 0.05 > 0.0
    expect(computeNewTraitStrength(0.30, 'deny')).toBeCloseTo(0.05, 5);
  });

  it('seuil de suppression : deny peut passer sous 0.4 (§III.3d)', () => {
    // si strength < 0.4 apres deny, le trait est supprime cote DB
    const result = computeNewTraitStrength(0.6, 'deny');
    expect(result).toBeCloseTo(0.35, 5);
    expect(result).toBeLessThan(0.4);
  });
});

// ============================================================================
// mergeEphemeralForKey (§III.3g - dedup intra-snapshot, event_at gagne)
// ============================================================================

describe('mergeEphemeralForKey (§III.3g)', () => {
  it("event_at prend le dessus si prev n'a pas de date", () => {
    const prev = { event_text: 'dentist', event_at: null };
    const next = { event_text: 'dentist', event_at: '2026-06-01T10:00:00Z' };
    expect(mergeEphemeralForKey(prev, next)).toBe(next);
  });

  it("prev conserve si next n'a pas de date et prev en a une", () => {
    const prev = { event_text: 'dentist', event_at: '2026-06-01T10:00:00Z' };
    const next = { event_text: 'dentist', event_at: null };
    expect(mergeEphemeralForKey(prev, next)).toBe(prev);
  });

  it('prev conserve si les deux ont une date', () => {
    const prev = { event_text: 'dentist', event_at: '2026-06-01T10:00:00Z' };
    const next = { event_text: 'dentist', event_at: '2026-07-01T10:00:00Z' };
    expect(mergeEphemeralForKey(prev, next)).toBe(prev);
  });

  it("prev conserve si aucun n'a de date", () => {
    const prev = { event_text: 'dentist', event_at: null };
    const next = { event_text: 'dentist', event_at: null };
    expect(mergeEphemeralForKey(prev, next)).toBe(prev);
  });
});

// ============================================================================
// selectTopEphemeralEvents (§III.3g - max 2 ops par snapshot, priorite dates)
// ============================================================================

describe('selectTopEphemeralEvents (§III.3g)', () => {
  it('2 evenements ou moins : passes tels quels', () => {
    const evs = [{ event_text: 'a', event_at: null }, { event_text: 'b', event_at: null }];
    expect(selectTopEphemeralEvents(evs)).toHaveLength(2);
  });

  it('tableau vide => tableau vide', () => {
    expect(selectTopEphemeralEvents([])).toHaveLength(0);
  });

  it('3 evenements : les 2 avec date passent en premier', () => {
    const evs = [
      { event_text: 'no-date', event_at: null },
      { event_text: 'with-date-b', event_at: '2026-06-01T10:00:00Z' },
      { event_text: 'with-date-a', event_at: '2026-07-01T10:00:00Z' },
    ];
    const result = selectTopEphemeralEvents(evs);
    expect(result).toHaveLength(2);
    expect(result.every(e => e.event_at !== null)).toBe(true);
  });

  it('3 evenements sans date : les 2 premiers alphabetiquement retenus', () => {
    const evs = [
      { event_text: 'zebra', event_at: null },
      { event_text: 'apple', event_at: null },
      { event_text: 'mango', event_at: null },
    ];
    const result = selectTopEphemeralEvents(evs);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.event_text)).toEqual(['apple', 'mango']);
  });

  it('3 evenements : 1 avec date + 2 sans => celui avec date est retenu', () => {
    const evs = [
      { event_text: 'zoo', event_at: null },
      { event_text: 'art', event_at: null },
      { event_text: 'meeting', event_at: '2026-06-01T10:00:00Z' },
    ];
    const result = selectTopEphemeralEvents(evs);
    expect(result).toHaveLength(2);
    expect(result[0].event_text).toBe('meeting'); // avec date en premier
    expect(result[1].event_text).toBe('art');      // premier alphabetiquement sans date
  });

  it('ne mute pas le tableau original', () => {
    const evs = [
      { event_text: 'c', event_at: null },
      { event_text: 'b', event_at: null },
      { event_text: 'a', event_at: null },
    ];
    const original = [...evs];
    selectTopEphemeralEvents(evs);
    expect(evs).toEqual(original); // ordre original preserve
  });
});
