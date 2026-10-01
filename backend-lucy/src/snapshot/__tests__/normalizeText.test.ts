/**
 * Tests unitaires pour l'algorithme normalize_text (§I.D de algorithme-memoire-lucy.md).
 *
 * La fonction canonique est la fonction SQL :
 *   supabase/migrations/20260313120000_add_normalize_text_function.sql
 *
 * Ce fichier definit un miroir TypeScript de cet algorithme et le teste.
 *
 * LIMITATION DOCUMENTEE : l'extension PostgreSQL `unaccent` gere un sur-ensemble de cas
 * par rapport a la decomposition NFD (ex: o-barré, ligatures, etc.).
 * Ce miroir couvre les diacritiques courants (e accent, c cedille, a grave, etc.) mais pas toutes
 * les substitutions specifiques a unaccent. Une couverture complete necessiterait des
 * tests d'integration contre Postgres (ex: avec un conteneur Docker ou une DB de test).
 *
 * Algorithme (dans l'ordre, cf. migration SQL) :
 *   1. trim
 *   2. lowercase
 *   3. supprimer la ponctuation de bordure : . , ! ? : ; ' "
 *   4. reduire les espaces multiples a un seul (\s+ => ' ')
 *   5. supprimer les accents (unaccent / NFD)
 *   6. trim final
 */

import { describe, it, expect } from 'vitest';

/**
 * Miroir TypeScript de normalize_text() pour les tests unitaires.
 * NE PAS utiliser en production : la source de verite est la fonction SQL.
 */
function normalizeTextMirror(input: string): string {
  // 1. Trim
  let s = input.trim();
  // 2. Lowercase
  s = s.toLowerCase();
  // 3a. Supprimer la ponctuation de bordure (debut) : . , ! ? : ; ' "
  s = s.replace(/^[.,!?:;'"]+/g, '');
  // 3b. Supprimer la ponctuation de bordure (fin)
  s = s.replace(/[.,!?:;'"]+$/g, '');
  // 4. Reduire espaces multiples => 1
  s = s.replace(/\s+/g, ' ');
  // 5. Supprimer les accents (approximation de unaccent via decomposition NFD)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // 6. Trim final (au cas ou la suppression de ponctuation laisse des espaces)
  s = s.trim();
  return s;
}

// ============================================================================
// §I.D - Regle 1 : trim + lowercase
// ============================================================================

describe('normalize_text : trim et lowercase (§I.D)', () => {
  it('chaine simple inchangee', () => {
    expect(normalizeTextMirror('hello')).toBe('hello');
  });

  it('espaces de bordure supprimes', () => {
    expect(normalizeTextMirror('  hello  ')).toBe('hello');
  });

  it('majuscules converties en minuscules', () => {
    expect(normalizeTextMirror('WORLD')).toBe('world');
  });

  it('mixte majuscules/minuscules', () => {
    expect(normalizeTextMirror('HeLLo WoRLd')).toBe('hello world');
  });
});

// ============================================================================
// §I.D - Regle 2 : suppression ponctuation de BORDURE uniquement
// ============================================================================

describe('normalize_text : ponctuation de bordure (§I.D)', () => {
  it('ponctuation de debut supprimee', () => {
    expect(normalizeTextMirror('...hello')).toBe('hello');
  });

  it('ponctuation de fin supprimee', () => {
    expect(normalizeTextMirror('hello!')).toBe('hello');
  });

  it('ponctuation des deux cotes supprimee', () => {
    expect(normalizeTextMirror('"hello!"')).toBe('hello');
  });

  it('guillemets simples de bordure supprimes', () => {
    expect(normalizeTextMirror("'hello'")).toBe('hello');
  });

  it('ponctuation interne conservee (virgule du milieu)', () => {
    expect(normalizeTextMirror('hello, world')).toBe('hello, world');
  });

  it("apostrophe interne conservee (it's)", () => {
    expect(normalizeTextMirror("it's nice")).toBe("it's nice");
  });

  it('virgule en bordure avec espace residuel - trim final efface espace', () => {
    // ', hello,' => strip leading ',' => ' hello,' => strip trailing ',' => ' hello' => trim => 'hello'
    expect(normalizeTextMirror(', hello,')).toBe('hello');
  });

  it('seule ponctuation => chaine vide', () => {
    expect(normalizeTextMirror('...')).toBe('');
  });

  it('chaine vide => chaine vide', () => {
    expect(normalizeTextMirror('')).toBe('');
  });

  it("tous les caracteres de ponctuation reconnus : . , ! ? : ; ' \"", () => {
    expect(normalizeTextMirror('.,!?:;\'"text.,!?:;\'"')).toBe('text');
  });
});

// ============================================================================
// §I.D - Regle 3 : espaces multiples => 1
// ============================================================================

describe('normalize_text : espaces multiples (§I.D)', () => {
  it('double espace reduit a un', () => {
    expect(normalizeTextMirror('a  b')).toBe('a b');
  });

  it('plusieurs espaces reduits a un', () => {
    expect(normalizeTextMirror('a   b   c')).toBe('a b c');
  });

  it('tabulation traitee comme espace', () => {
    expect(normalizeTextMirror('a\tb')).toBe('a b');
  });
});

// ============================================================================
// §I.D - Regle 4 : suppression des accents (unaccent / NFD)
// ============================================================================

describe('normalize_text : suppression accents (§I.D)', () => {
  it('e accent aigu => e', () => {
    expect(normalizeTextMirror('cafe')).toBe('cafe');
  });

  it('e accent aigu dans mot => remplace', () => {
    expect(normalizeTextMirror('cafe\u0301')).toBe('cafe'); // cafe + combining acute
  });

  it('E majuscule avec accent => e minuscule sans accent', () => {
    // Eleve avec accents (U+00C9 et U+00E8)
    expect(normalizeTextMirror('\u00C9l\u00E8ve')).toBe('eleve');
  });

  it('c cedille => c', () => {
    expect(normalizeTextMirror('fa\u00E7ade')).toBe('facade');
  });

  it('a grave, u accent circonf, i circonf couverts', () => {
    expect(normalizeTextMirror('\u00E0 c\u00E2lin vo\u00FBt\u00E9')).toBe('a calin voute');
  });

  it('combinaison complete : bordure + accents + espaces', () => {
    // '  Cafe accent, au lait!  ' => apres traitement => 'cafe accent, au lait'
    expect(normalizeTextMirror('  Caf\u00E9, au lait!  ')).toBe('cafe, au lait');
  });
});

// ============================================================================
// Cas d'usage reels (cles de deduplication)
// ============================================================================

describe("normalize_text : cas d'usage deduplication", () => {
  it('"Run every day" et "run every day" => meme cle', () => {
    expect(normalizeTextMirror('Run every day')).toBe(normalizeTextMirror('run every day'));
  });

  it('"Paris." et "paris" => meme cle', () => {
    expect(normalizeTextMirror('Paris.')).toBe(normalizeTextMirror('paris'));
  });

  it('"  Jazz  " et "jazz" => meme cle', () => {
    expect(normalizeTextMirror('  Jazz  ')).toBe(normalizeTextMirror('jazz'));
  });

  it('"Etre" accent et "etre" => meme cle', () => {
    // U+00CA = E avec accent circonf, puis tre
    expect(normalizeTextMirror('\u00CAtre')).toBe(normalizeTextMirror('etre'));
  });
});
