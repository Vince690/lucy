import { describe, it, expect } from 'vitest';
import { cleanAssistantText } from '../cleanAssistantText.js';

describe('cleanAssistantText — tirets', () => {
  it('remplace un tiret cadratin au milieu d’une phrase par une virgule', () => {
    expect(cleanAssistantText('ok badass cuir — top. il est en quel état ?')).toBe(
      'ok badass cuir, top. il est en quel état ?'
    );
  });

  it('remplace aussi le demi-cadratin', () => {
    expect(cleanAssistantText('journée tranquille – habitués, touristes')).toBe(
      'journée tranquille, habitués, touristes'
    );
  });

  it('supprime un tiret placé juste avant un point ou une fin de ligne', () => {
    expect(cleanAssistantText('reviens — je serai là —.')).toBe('reviens, je serai là.');
    expect(cleanAssistantText('bon —\nsuite')).toBe('bon\nsuite');
  });

  it('entre deux nombres, le tiret devient un slash', () => {
    expect(cleanAssistantText('tu cours combien, 12–15 km ?')).toBe('tu cours combien, 12/15 km ?');
    expect(cleanAssistantText('genre 18h—19h ça te va')).toBe('genre 18h/19h ça te va');
    expect(cleanAssistantText('j’ai couru 12 km — 15 la semaine prochaine')).toBe(
      'j’ai couru 12 km, 15 la semaine prochaine'
    );
  });

  it('ne double jamais les virgules', () => {
    expect(cleanAssistantText('t’as raison, — c’est vrai')).toBe('t’as raison, c’est vrai');
  });

  it('laisse les traits d’union ordinaires intacts', () => {
    expect(cleanAssistantText('peut-être, dis-moi')).toBe('peut-être, dis-moi');
  });

  it('normalise les traits d’union insécables en trait d’union simple', () => {
    expect(cleanAssistantText('dis‑moi, tape‑à‑l’oeil')).toBe('dis-moi, tape-à-l’oeil');
  });
});

describe('cleanAssistantText — lignes, listes et titres', () => {
  it('garde un retour à la ligne (une ligne = une bulle) mais supprime les lignes vides', () => {
    expect(cleanAssistantText('haha ok ok je me calme.\n\ndonne juste 2 mots.')).toBe(
      'haha ok ok je me calme.\ndonne juste 2 mots.'
    );
    expect(cleanAssistantText('oui\n\n\n\nvas-y raconte  \n')).toBe('oui\nvas-y raconte');
  });

  it('ne plafonne pas le nombre de lignes', () => {
    expect(cleanAssistantText('a\nb\nc\nd\ne')).toBe('a\nb\nc\nd\ne');
  });

  it('retire les puces et numéros de liste, chaque élément devient une ligne', () => {
    expect(cleanAssistantText('- si c’est cuir : chiffon humide\n- si c’est denim : lessive froide')).toBe(
      'si c’est cuir : chiffon humide\nsi c’est denim : lessive froide'
    );
    expect(cleanAssistantText('1. lundi\n2) mardi')).toBe('lundi\nmardi');
  });

  it('retire les dièses de titre', () => {
    expect(cleanAssistantText('## Mon plan\nok on y va')).toBe('Mon plan\nok on y va');
  });

  it('garde les retours simples d’un texte long', () => {
    const long = `${'a'.repeat(250)}\n\n${'b'.repeat(250)}`;
    expect(cleanAssistantText(long)).toBe(`${'a'.repeat(250)}\n${'b'.repeat(250)}`);
  });

  it('réduit les espaces multiples au milieu d’une ligne', () => {
    expect(cleanAssistantText('hey   ça va')).toBe('hey ça va');
  });

  it('ne touche pas à une réponse déjà propre', () => {
    expect(cleanAssistantText('hey ! ça va oui, tranquille. et toi ?')).toBe(
      'hey ! ça va oui, tranquille. et toi ?'
    );
  });
});
