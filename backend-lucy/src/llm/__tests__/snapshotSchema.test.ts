import { describe, it, expect } from 'vitest';
import { validateSnapshot } from '../snapshotSchema.js';
import { buildSnapshotUserMessage, type KnownRelation } from '../../prompts/snapshotSystemPrompt.js';

// ---------- Helper: snapshot complet et vide (toutes sections présentes, rien à extraire) ----------

function emptySnapshot() {
  return {
    user_identity: { identity_update: null },
    user_identity_goals: { goal: null },
    user_occupation_notes: { notes: [] },
    user_traits: { traits: [] },
    user_preferences: { preferences: [] },
    user_relations: { relation: null },
    user_ephemeral_events: { events: [] },
    user_life_events: { events: [] },
  };
}

// ============================================================================
// A) identity_update — champs absents autorisés
// ============================================================================

describe('user_identity: champs optionnels dans identity_update', () => {
  it('accepte identity_update null', () => {
    const snap = { ...emptySnapshot(), user_identity: { identity_update: null } };
    const result = validateSnapshot(snap);
    expect(result.user_identity).toEqual({ identity_update: null });
    expect(result.errors).not.toHaveProperty('user_identity');
  });

  it('accepte identity_update avec un seul champ', () => {
    const snap = { ...emptySnapshot(), user_identity: { identity_update: { location_general: 'Paris' } } };
    const result = validateSnapshot(snap);
    expect(result.user_identity).toEqual({ identity_update: { location_general: 'Paris' } });
    expect(result.errors).not.toHaveProperty('user_identity');
  });

  it('accepte identity_update avec un sous-ensemble de champs', () => {
    const snap = {
      ...emptySnapshot(),
      user_identity: {
        identity_update: {
          occupation_status: 'work',
          occupation_domain: 'tech',
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_identity!.identity_update).toEqual({
      occupation_status: 'work',
      occupation_domain: 'tech',
    });
  });

  it('accepte identity_update avec champs explicitement null', () => {
    const snap = {
      ...emptySnapshot(),
      user_identity: {
        identity_update: {
          location_general: null,
          occupation_status: 'study',
          occupation_position: null,
          occupation_domain: null,
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_identity!.identity_update!.occupation_status).toBe('study');
  });

  it('accepte identity_update objet vide (aucun champ)', () => {
    const snap = { ...emptySnapshot(), user_identity: { identity_update: {} } };
    const result = validateSnapshot(snap);
    expect(result.user_identity).toEqual({ identity_update: {} });
    expect(result.errors).not.toHaveProperty('user_identity');
  });

  it('rejette identity_update avec un champ inconnu', () => {
    const snap = {
      ...emptySnapshot(),
      user_identity: { identity_update: { first_name: 'Toto' } },
    };
    const result = validateSnapshot(snap);
    expect(result.user_identity).toBeNull();
    expect(result.errors).toHaveProperty('user_identity');
  });

  it('rejette identity_update avec occupation_status invalide', () => {
    const snap = {
      ...emptySnapshot(),
      user_identity: { identity_update: { occupation_status: 'freelance' } },
    };
    const result = validateSnapshot(snap);
    expect(result.user_identity).toBeNull();
  });

  it('rejette identity_update avec string vide', () => {
    const snap = {
      ...emptySnapshot(),
      user_identity: { identity_update: { location_general: '' } },
    };
    const result = validateSnapshot(snap);
    expect(result.user_identity).toBeNull();
  });
});

// ============================================================================
// B) Root keys — détection des clés inattendues
// ============================================================================

describe('root: clés inattendues', () => {
  it('signale les clés racines inattendues sans rejeter le snapshot', () => {
    const snap = { ...emptySnapshot(), unknown_section: { foo: 'bar' } };
    const result = validateSnapshot(snap);
    expect(result.errors).toHaveProperty('_extra_root_keys');
    // Les sections valides sont quand même parsées
    expect(result.user_identity).not.toBeNull();
    expect(result.user_traits).not.toBeNull();
  });

  it('accepte un snapshot avec exactement les 8 clés', () => {
    const result = validateSnapshot(emptySnapshot());
    expect(result.errors).not.toHaveProperty('_extra_root_keys');
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('signale les sections manquantes individuellement', () => {
    const { user_traits, user_life_events, ...partial } = emptySnapshot();
    void user_traits;
    void user_life_events;
    const result = validateSnapshot(partial);
    expect(result.user_traits).toBeNull();
    expect(result.user_life_events).toBeNull();
    expect(result.errors).toHaveProperty('user_traits', 'Missing section');
    expect(result.errors).toHaveProperty('user_life_events', 'Missing section');
    // Les autres sections sont toujours valides
    expect(result.user_identity).not.toBeNull();
  });
});

// ============================================================================
// C) Filtrage item-par-item dans les sections array
// ============================================================================

describe('user_traits: filtrage item-par-item', () => {
  it('filtre un item avec trait_key inconnu, garde les valides', () => {
    const snap = {
      ...emptySnapshot(),
      user_traits: {
        traits: [
          { trait_key: 'anxious', status: 'affirm' },
          { trait_key: 'INVALID_KEY', status: 'affirm' },
          { trait_key: 'calm', status: 'deny' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_traits).not.toBeNull();
    expect(result.user_traits!.traits).toHaveLength(2);
    expect(result.user_traits!.traits[0].trait_key).toBe('anxious');
    expect(result.user_traits!.traits[1].trait_key).toBe('calm');
    expect(result.errors).toHaveProperty('user_traits_items');
  });

  it('filtre un item avec status invalide', () => {
    const snap = {
      ...emptySnapshot(),
      user_traits: {
        traits: [
          { trait_key: 'joyful', status: 'maybe' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_traits!.traits).toHaveLength(0);
    expect(result.errors).toHaveProperty('user_traits_items');
  });

  it('applique le max (3) après filtrage', () => {
    const snap = {
      ...emptySnapshot(),
      user_traits: {
        traits: [
          { trait_key: 'anxious', status: 'affirm' },
          { trait_key: 'joyful', status: 'affirm' },
          { trait_key: 'calm', status: 'deny' },
          { trait_key: 'confident', status: 'affirm' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_traits!.traits).toHaveLength(3);
  });

  it('retourne section null si la structure wrapper est invalide', () => {
    const snap = {
      ...emptySnapshot(),
      user_traits: { wrong_key: [] },
    };
    const result = validateSnapshot(snap);
    expect(result.user_traits).toBeNull();
    expect(result.errors).toHaveProperty('user_traits');
  });

  it('retourne section null si traits n\'est pas un tableau', () => {
    const snap = {
      ...emptySnapshot(),
      user_traits: { traits: 'not_an_array' },
    };
    const result = validateSnapshot(snap);
    expect(result.user_traits).toBeNull();
  });
});

describe('user_occupation_notes: filtrage item-par-item', () => {
  it('filtre les notes avec note_text vide', () => {
    const snap = {
      ...emptySnapshot(),
      user_occupation_notes: {
        notes: [
          { note_text: 'valid note' },
          { note_text: '' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_occupation_notes!.notes).toHaveLength(1);
    expect(result.user_occupation_notes!.notes[0].note_text).toBe('valid note');
  });

  it('applique le max (2) après filtrage', () => {
    const snap = {
      ...emptySnapshot(),
      user_occupation_notes: {
        notes: [
          { note_text: 'a' },
          { note_text: 'b' },
          { note_text: 'c' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_occupation_notes!.notes).toHaveLength(2);
  });
});

describe('user_ephemeral_events: filtrage item-par-item', () => {
  it('filtre un event avec event_at mal formaté, garde le valide', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [
          { event_text: 'dentist', event_at: '2026-03-20T10:00:00+02:00' },
          { event_text: 'party', event_at: 'not-a-date' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
    expect(result.user_ephemeral_events!.events[0].event_text).toBe('dentist');
    expect(result.errors).toHaveProperty('user_ephemeral_events_items');
  });

  it('accepte event_at null', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'something', event_at: null }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
    expect(result.user_ephemeral_events!.events[0].event_at).toBeNull();
  });

  it('accepte event_at avec offset Z', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'test', event_at: '2026-03-20T10:00:00Z' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
  });
});

describe('user_life_events: max 1', () => {
  it('tronque à 1 item si le LLM en renvoie 2', () => {
    const snap = {
      ...emptySnapshot(),
      user_life_events: {
        events: [
          { event_text: 'moved to NYC', event_at: null },
          { event_text: 'graduated', event_at: '2025-06-01T00:00:00Z' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_life_events!.events).toHaveLength(1);
    expect(result.user_life_events!.events[0].event_text).toBe('moved to NYC');
  });
});

describe('user_preferences: filtrage item-par-item', () => {
  it('filtre une preference avec category_key inconnu', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [
          { category_key: 'music_genres', value: 'jazz' },
          { category_key: 'UNKNOWN_CAT', value: 'test' },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
    expect(result.user_preferences!.preferences[0].category_key).toBe('music_genres');
  });

  it('accepte une preference bool (travel_like)', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'travel_like', value: true }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
    expect(result.user_preferences!.preferences[0].value).toBe(true);
  });

  it('rejette une preference avec value string vide', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'music_genres', value: '' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(0);
  });
});

describe('user_relations: section à valeur unique', () => {
  it('accepte relation null', () => {
    const snap = { ...emptySnapshot(), user_relations: { relation: null } };
    const result = validateSnapshot(snap);
    expect(result.user_relations).toEqual({ relation: null });
  });

  it('accepte une relation avec match_id', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: {
          match_id: '550e8400-e29b-41d4-a716-446655440000',
          name_raw: null,
          relation_type: 'family',
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations!.relation!.match_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.user_relations!.relation!.relation_type).toBe('family');
  });

  it('accepte une relation sans match_id', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: {
          match_id: null,
          name_raw: 'Virginie',
          relation_type: 'unknown',
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations!.relation!.name_raw).toBe('Virginie');
  });

  it('rejette une relation avec relation_type invalide', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: {
          match_id: null,
          name_raw: 'Bob',
          relation_type: 'enemy',
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations).toBeNull();
  });
});

// ============================================================================
// Edge cases globaux
// ============================================================================

describe('edge cases', () => {
  it('retourne tout null si le raw n\'est pas un objet', () => {
    const result = validateSnapshot('not an object');
    expect(result.user_identity).toBeNull();
    expect(result.errors._root).toBe('Snapshot is not a valid object');
  });

  it('retourne tout null si le raw est null', () => {
    const result = validateSnapshot(null);
    expect(result.errors._root).toBe('Snapshot is not a valid object');
  });

  it('retourne tout null si le raw est un tableau', () => {
    const result = validateSnapshot([]);
    expect(result.errors._root).toBe('Snapshot is not a valid object');
  });

  it('accepte un snapshot complet et vide', () => {
    const result = validateSnapshot(emptySnapshot());
    expect(Object.keys(result.errors)).toHaveLength(0);
    expect(result.user_identity).toEqual({ identity_update: null });
    expect(result.user_traits).toEqual({ traits: [] });
    expect(result.user_preferences).toEqual({ preferences: [] });
    expect(result.user_ephemeral_events).toEqual({ events: [] });
    expect(result.user_life_events).toEqual({ events: [] });
  });

  it('rejette une section array qui a des clés supplémentaires', () => {
    const snap = {
      ...emptySnapshot(),
      user_traits: { traits: [], extra: true },
    };
    const result = validateSnapshot(snap);
    expect(result.user_traits).toBeNull();
    expect(result.errors.user_traits).toContain('Unexpected keys');
  });
});

// ============================================================================
// 1A) user_preferences — validation conditionnelle du type de value
// ============================================================================

describe('user_preferences: validation conditionnelle value type (§III.3e)', () => {
  it('rejette music_genres avec value boolean (doit être string)', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'music_genres', value: true }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(0);
    expect(result.errors).toHaveProperty('user_preferences_items');
  });

  it('rejette travel_like avec value string (doit être boolean)', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'travel_like', value: 'yes' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(0);
  });

  it('accepte travel_like avec true', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'travel_like', value: true }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
    expect(result.user_preferences!.preferences[0].value).toBe(true);
  });

  it('accepte travel_like avec false', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'travel_like', value: false }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
    expect(result.user_preferences!.preferences[0].value).toBe(false);
  });

  it('accepte arts_preferred_forms avec valeur enum autorisée', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'arts_preferred_forms', value: 'cinema' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
  });

  it('rejette arts_preferred_forms avec valeur enum non autorisée', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'arts_preferred_forms', value: 'cooking' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(0);
  });

  it('accepte vibe_preferences avec valeur enum autorisée', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'vibe_preferences', value: 'cozy' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
  });

  it('rejette vibe_preferences avec valeur enum non autorisée', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'vibe_preferences', value: 'wild' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(0);
  });

  it('accepte food_favorites avec n\'importe quelle string non vide (text)', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [{ category_key: 'food_favorites', value: 'sushi' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(1);
  });

  it('mix valide/invalide : filtre correctement', () => {
    const snap = {
      ...emptySnapshot(),
      user_preferences: {
        preferences: [
          { category_key: 'music_genres', value: 'jazz' },        // OK (text + string)
          { category_key: 'music_genres', value: true },           // KO (text + boolean)
          { category_key: 'travel_like', value: false },           // OK (bool + boolean)
          { category_key: 'arts_preferred_forms', value: 'dance' }, // OK (enum + valeur autorisée)
          { category_key: 'arts_preferred_forms', value: 'yoga' }, // KO (enum + valeur non autorisée)
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_preferences!.preferences).toHaveLength(3);
    expect(result.errors).toHaveProperty('user_preferences_items');
  });
});

// ============================================================================
// 1B) user_relations — name_raw conditionnel selon match_id
// ============================================================================

describe('user_relations: règle conditionnelle name_raw (§III.3f)', () => {
  it('rejette match_id=null ET name_raw=null (incohérent)', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: { match_id: null, name_raw: null, relation_type: 'unknown' },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations).toBeNull();
    expect(result.errors).toHaveProperty('user_relations');
  });

  it('accepte match_id=null ET name_raw="Virginie"', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: { match_id: null, name_raw: 'Virginie', relation_type: 'friend' },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations!.relation!.name_raw).toBe('Virginie');
  });

  it('accepte match_id=uuid ET name_raw=null', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: {
          match_id: '550e8400-e29b-41d4-a716-446655440000',
          name_raw: null,
          relation_type: 'family',
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations!.relation!.match_id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('accepte match_id=uuid ET name_raw="Maman" (les deux fournis)', () => {
    const snap = {
      ...emptySnapshot(),
      user_relations: {
        relation: {
          match_id: '550e8400-e29b-41d4-a716-446655440000',
          name_raw: 'Maman',
          relation_type: 'family',
        },
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_relations!.relation).not.toBeNull();
  });
});

// ============================================================================
// 1C) event_at — ISO datetime permissif (avec/sans offset)
// ============================================================================

describe('event_at: ISO 8601 permissif (§III.3g/h)', () => {
  it('accepte datetime sans offset (local)', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'meeting', event_at: '2026-03-20T10:00:00' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
  });

  it('accepte datetime avec offset Z', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'call', event_at: '2026-03-20T10:00:00Z' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
  });

  it('accepte datetime avec offset numérique', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'flight', event_at: '2026-03-20T10:00:00+05:30' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
  });

  it('accepte datetime avec millisecondes', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'sync', event_at: '2026-03-20T10:00:00.123Z' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
  });

  it('accepte event_at null', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'something', event_at: null }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(1);
  });

  it('rejette date seule (pas un datetime)', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'party', event_at: '2026-03-20' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(0);
  });

  it('rejette texte libre', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [{ event_text: 'party', event_at: 'next tuesday' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(0);
  });

  it('fonctionne aussi pour user_life_events', () => {
    const snap = {
      ...emptySnapshot(),
      user_life_events: {
        events: [{ event_text: 'moved', event_at: '2025-01-15T00:00:00' }],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_life_events!.events).toHaveLength(1);
  });
});

// ============================================================================
// 1D) Root strict — stratégie "warn + continue" documentée et testée
// ============================================================================

describe('root strict: stratégie warn+continue (§I.B + §V.6)', () => {
  it('extra root keys → erreur signalée, sections valides parsées', () => {
    const snap = { ...emptySnapshot(), foo: 'bar', baz: 42 };
    const result = validateSnapshot(snap);
    expect(result.errors._extra_root_keys).toContain('foo');
    expect(result.errors._extra_root_keys).toContain('baz');
    // Toutes les sections valides sont quand même retournées
    expect(result.user_identity).not.toBeNull();
    expect(result.user_traits).not.toBeNull();
    expect(result.user_preferences).not.toBeNull();
  });

  it('pas d\'erreur si exactement les 8 clés', () => {
    const result = validateSnapshot(emptySnapshot());
    expect(result.errors).not.toHaveProperty('_extra_root_keys');
  });
});

// ============================================================================
// 1E') user_identity_goals — section à valeur unique
// ============================================================================

describe('user_identity_goals: section à valeur unique', () => {
  it('accepte goal null', () => {
    const snap = { ...emptySnapshot(), user_identity_goals: { goal: null } };
    const result = validateSnapshot(snap);
    expect(result.user_identity_goals).toEqual({ goal: null });
    expect(result.errors).not.toHaveProperty('user_identity_goals');
  });

  it('accepte goal valide', () => {
    const snap = { ...emptySnapshot(), user_identity_goals: { goal: { goal_text: 'run every day' } } };
    const result = validateSnapshot(snap);
    expect(result.user_identity_goals!.goal!.goal_text).toBe('run every day');
  });

  it('rejette goal_text vide (min 1)', () => {
    const snap = { ...emptySnapshot(), user_identity_goals: { goal: { goal_text: '' } } };
    const result = validateSnapshot(snap);
    expect(result.user_identity_goals).toBeNull();
    expect(result.errors).toHaveProperty('user_identity_goals');
  });

  it('rejette goal avec clé inconnue', () => {
    const snap = { ...emptySnapshot(), user_identity_goals: { goal: { goal_text: 'run', extra: 'x' } } };
    const result = validateSnapshot(snap);
    expect(result.user_identity_goals).toBeNull();
  });

  it('rejette section sans clé "goal"', () => {
    const snap = { ...emptySnapshot(), user_identity_goals: { wrong_key: null } };
    const result = validateSnapshot(snap);
    expect(result.user_identity_goals).toBeNull();
    expect(result.errors).toHaveProperty('user_identity_goals');
  });
});

// ============================================================================
// 1F') user_ephemeral_events — max 2 items valides
// ============================================================================

describe('user_ephemeral_events: troncature à 2 items valides (§III.3g)', () => {
  it('tronque à 2 si 3 événements valides fournis', () => {
    const snap = {
      ...emptySnapshot(),
      user_ephemeral_events: {
        events: [
          { event_text: 'dentist', event_at: null },
          { event_text: 'gym', event_at: null },
          { event_text: 'party', event_at: null },
        ],
      },
    };
    const result = validateSnapshot(snap);
    expect(result.user_ephemeral_events!.events).toHaveLength(2);
  });
});

// ============================================================================
// 1G') known_relations cap à 10 dans buildSnapshotUserMessage
// ============================================================================

describe('buildSnapshotUserMessage: known_relations cap (§III.3f)', () => {
  function makeRelations(count: number): KnownRelation[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      name_raw: `Person ${i}`,
      name_key: `person ${i}`,
      relation_type: 'unknown',
    }));
  }

  it('injecte toutes les relations si <= 10', () => {
    const msg = buildSnapshotUserMessage({
      conversationSegment: [{ role: 'user', content: 'hello' }],
      currentMemory: {
        user_identity: null,
        user_identity_goals: [],
        user_occupation_notes: [],
        user_traits: [],
        user_preferences: [],
        user_relations: makeRelations(5),
        user_ephemeral_events: [],
        user_life_events: [],
      },
    });
    // Vérifie que les 5 relations sont toutes présentes
    for (let i = 0; i < 5; i++) {
      expect(msg).toContain(`Person ${i}`);
    }
  });

  it('tronque à 10 si > 10 relations', () => {
    const msg = buildSnapshotUserMessage({
      conversationSegment: [{ role: 'user', content: 'hello' }],
      currentMemory: {
        user_identity: null,
        user_identity_goals: [],
        user_occupation_notes: [],
        user_traits: [],
        user_preferences: [],
        user_relations: makeRelations(15),
        user_ephemeral_events: [],
        user_life_events: [],
      },
    });
    // Extraire uniquement la section KNOWN RELATIONS (le cap s'applique là, pas au CURRENT MEMORY STATE)
    const knownRelationsSection = msg.split('# KNOWN RELATIONS')[1]!.split('# INSTRUCTION')[0]!;
    // Les 10 premières sont présentes dans KNOWN RELATIONS
    for (let i = 0; i < 10; i++) {
      expect(knownRelationsSection).toContain(`id-${i}`);
    }
    // Les 5 suivantes ne le sont pas dans KNOWN RELATIONS
    for (let i = 10; i < 15; i++) {
      expect(knownRelationsSection).not.toContain(`id-${i}`);
    }
  });

  it('injecte le bloc KNOWN RELATIONS même avec 0 relations', () => {
    const msg = buildSnapshotUserMessage({
      conversationSegment: [{ role: 'user', content: 'hello' }],
      currentMemory: {
        user_identity: null,
        user_identity_goals: [],
        user_occupation_notes: [],
        user_traits: [],
        user_preferences: [],
        user_relations: [],
        user_ephemeral_events: [],
        user_life_events: [],
      },
    });
    expect(msg).toContain('KNOWN RELATIONS');
    expect(msg).toContain('[]');
  });
});
