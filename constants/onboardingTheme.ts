/**
 * Design tokens de l'onboarding Lucy.
 *
 * Source de vérité pour couleurs / espacements / rayons / typographie de tout le flow
 * d'onboarding. Aligné sur l'existant (orange #F97316 + blanc), centralisé pour cohérence.
 */

export const OnbColors = {
  // Fonds
  bg: '#FFFFFF',
  bgWarm: '#FFF7ED', // très léger voile chaud
  bgWarmDeep: '#FFEDD5',
  surface: '#F9FAFB',

  // Orange (marque)
  primary: '#F97316',
  primaryDeep: '#EA580C',
  primarySoft: '#FED7AA',
  selectedBg: '#FFF7ED',

  // Texte
  ink: '#111827',
  inkSoft: '#1F2937',
  muted: '#6B7280',
  mutedLight: '#9CA3AF',

  // Traits
  hairline: '#E5E7EB',
  white: '#FFFFFF',
} as const;

export const OnbSpacing = {
  screenX: 24,
  screenTop: 12,
  screenBottom: 20,
  /** Position verticale FIXE du titre des écrans question à peu de réponses (sous le QuestionHeader).
      Les écrans denses (ex. traits) gardent leur titre haut (marginTop 52). */
  questionTitleTop: 150,
  /** Espace fixe entre le titre et l'élément de réponse. */
  questionAnswerGap: 44,
} as const;

export const OnbRadius = {
  button: 16,
  card: 20,
  pill: 999,
  chip: 14,
} as const;

/** Ombre douce et discrète (style iOS) pour cartes/boutons. */
export const OnbShadow = {
  card: {
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  button: {
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
} as const;

/** Presets typographiques (police système = SF Pro sur iOS, qualité Apple native). */
export const OnbType = {
  display: { fontSize: 34, fontWeight: '700' as const, lineHeight: 41, letterSpacing: -0.5 },
  title: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34, letterSpacing: -0.3 },
  headline: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  body: { fontSize: 17, fontWeight: '400' as const, lineHeight: 25 },
  bodyStrong: { fontSize: 17, fontWeight: '600' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
} as const;
