import type { ImageSourcePropType } from 'react-native';

/**
 * Identité des cinq niveaux d'humeur, partagée par le chat (cartes) et le
 * mood tracker (sélecteur, graphique, calendrier). Décidée avec Vincent le
 * 10 septembre 2026, sur la maquette Figma « Cartes humeur v2 », rangée B.
 *
 * L'échelle 1–5 est celle de la base (`mood_entries.mood`). Les mots sont
 * dans les traductions (`mood:levels.N`), ici seulement ce qui ne se traduit pas.
 */
export interface MoodLevel {
  level: 1 | 2 | 3 | 4 | 5;
  emoji: string;
  /** Couleur de base de la carte : sert de couleur d'accent dans le mood tracker. */
  color: string;
  /** Fond de carte exporté de Figma à 3x (164×96 pt), relief et bord compris. */
  card: ImageSourcePropType;
}

export const MOOD_LEVELS: readonly MoodLevel[] = [
  { level: 1, emoji: '😔', color: '#3730A3', card: require('../assets/images/mood-cards/mood-card-1.png') },
  { level: 2, emoji: '😕', color: '#6D28D9', card: require('../assets/images/mood-cards/mood-card-2.png') },
  { level: 3, emoji: '😐', color: '#0D9488', card: require('../assets/images/mood-cards/mood-card-3.png') },
  { level: 4, emoji: '😊', color: '#EA580C', card: require('../assets/images/mood-cards/mood-card-4.png') },
  { level: 5, emoji: '🤩', color: '#BE185D', card: require('../assets/images/mood-cards/mood-card-5.png') },
];

/** Index 0 = niveau 1, comme partout dans le mood tracker (`moodEmojis[mood - 1]`). */
export const MOOD_EMOJIS: readonly string[] = MOOD_LEVELS.map((m) => m.emoji);
export const MOOD_COLORS: readonly string[] = MOOD_LEVELS.map((m) => m.color);
