/**
 * Tests unitaires pour les fonctions pures de chatContextService (§7.1).
 *
 * Couvre :
 *   - computeRecencyScore : paliers 30/90 jours
 *   - computeTraitPriorityScore : formule 0.7*strength + 0.3*recency, arrondi
 *   - computeMoodStats : mood_today, rolling_avg_7, cas vides, cas partiels
 */

import { describe, it, expect } from 'vitest';
import {
  computeRecencyScore,
  computeTraitPriorityScore,
  computeMoodStats,
  getDateStringInTimezone,
} from '../chatContextUtils.js';

// ============================================================================
// computeRecencyScore (§III.3d 891–900)
// ============================================================================

describe('computeRecencyScore', () => {
  it('retourne 1.0 pour 0 jour (vu aujourd\'hui)', () => {
    expect(computeRecencyScore(0)).toBe(1.0);
  });

  it('retourne 1.0 pour exactement 30 jours', () => {
    expect(computeRecencyScore(30)).toBe(1.0);
  });

  it('retourne 0.7 pour 31 jours', () => {
    expect(computeRecencyScore(31)).toBe(0.7);
  });

  it('retourne 0.7 pour exactement 90 jours', () => {
    expect(computeRecencyScore(90)).toBe(0.7);
  });

  it('retourne 0.5 pour 91 jours', () => {
    expect(computeRecencyScore(91)).toBe(0.5);
  });

  it('retourne 0.5 pour 365 jours', () => {
    expect(computeRecencyScore(365)).toBe(0.5);
  });
});

// ============================================================================
// computeTraitPriorityScore (§III.3d 888, formule complète)
// ============================================================================

describe('computeTraitPriorityScore', () => {
  it('strength=1.0, daysSince=0 → 0.7*1 + 0.3*1 = 1.0', () => {
    expect(computeTraitPriorityScore(1.0, 0)).toBe(1.0);
  });

  it('strength=0.0, daysSince=0 → 0.7*0 + 0.3*1 = 0.3', () => {
    expect(computeTraitPriorityScore(0.0, 0)).toBe(0.3);
  });

  it('strength=1.0, daysSince=365 → 0.7*1 + 0.3*0.5 = 0.85', () => {
    expect(computeTraitPriorityScore(1.0, 365)).toBe(0.85);
  });

  it('strength=0.5, daysSince=60 → 0.7*0.5 + 0.3*0.7 = 0.35+0.21 = 0.56', () => {
    expect(computeTraitPriorityScore(0.5, 60)).toBe(0.56);
  });

  it('arrondi à 2 décimales (pas 0.555...)', () => {
    // strength=0.5, daysSince=31 → 0.7*0.5 + 0.3*0.7 = 0.35+0.21 = 0.56
    const score = computeTraitPriorityScore(0.5, 31);
    expect(Number.isFinite(score)).toBe(true);
    // vérifie que c'est bien arrondi (pas plus de 2 décimales)
    expect(score).toBe(Math.round(score * 100) / 100);
  });
});

// ============================================================================
// computeMoodStats (§III.3i 2470–2500)
// ============================================================================

describe('computeMoodStats', () => {
  it('retourne null/null si aucune donnée', () => {
    const result = computeMoodStats([], '2026-03-26');
    expect(result).toEqual({ mood_today: null, rolling_avg_7: null });
  });

  it('retourne mood_today correct si ligne présente', () => {
    const rows = [{ mood_date: '2026-03-26', mood_score: 4 }];
    const result = computeMoodStats(rows, '2026-03-26');
    expect(result.mood_today).toBe(4);
  });

  it('retourne mood_today null si pas de ligne pour aujourd\'hui', () => {
    const rows = [{ mood_date: '2026-03-25', mood_score: 3 }];
    const result = computeMoodStats(rows, '2026-03-26');
    expect(result.mood_today).toBeNull();
  });

  it('calcule rolling_avg_7 sur toutes les lignes disponibles', () => {
    const rows = [
      { mood_date: '2026-03-26', mood_score: 4 },
      { mood_date: '2026-03-25', mood_score: 3 },
      { mood_date: '2026-03-24', mood_score: 5 },
    ];
    // avg = (4+3+5)/3 = 4.0
    const result = computeMoodStats(rows, '2026-03-26');
    expect(result.rolling_avg_7).toBe(4.0);
  });

  it('arrondi rolling_avg_7 à 1 décimale', () => {
    const rows = [
      { mood_date: '2026-03-26', mood_score: 4 },
      { mood_date: '2026-03-25', mood_score: 3 },
    ];
    // avg = 3.5 → reste 3.5
    const result = computeMoodStats(rows, '2026-03-26');
    expect(result.rolling_avg_7).toBe(3.5);
  });

  it('rolling_avg_7 arrondi avec valeurs non entières — (1+2+3+4+5+4+3) / 7 = 3.14...', () => {
    const rows = [
      { mood_date: '2026-03-26', mood_score: 1 },
      { mood_date: '2026-03-25', mood_score: 2 },
      { mood_date: '2026-03-24', mood_score: 3 },
      { mood_date: '2026-03-23', mood_score: 4 },
      { mood_date: '2026-03-22', mood_score: 5 },
      { mood_date: '2026-03-21', mood_score: 4 },
      { mood_date: '2026-03-20', mood_score: 3 },
    ];
    // avg = 22/7 ≈ 3.14... → arrondi à 3.1
    const result = computeMoodStats(rows, '2026-03-26');
    expect(result.rolling_avg_7).toBe(3.1);
  });

  it('rolling_avg_7 non null même si mood_today est absent', () => {
    const rows = [{ mood_date: '2026-03-25', mood_score: 2 }];
    const result = computeMoodStats(rows, '2026-03-26');
    expect(result.mood_today).toBeNull();
    expect(result.rolling_avg_7).toBe(2.0);
  });
});

// ============================================================================
// getDateStringInTimezone (timezone-aware mood_today)
// ============================================================================

describe('getDateStringInTimezone', () => {
  it('retourne YYYY-MM-DD en UTC', () => {
    const date = new Date('2026-03-26T01:30:00.000Z');
    expect(getDateStringInTimezone(date, 'UTC')).toBe('2026-03-26');
  });

  it('respecte un fuseau non-UTC (America/Los_Angeles)', () => {
    const date = new Date('2026-03-26T01:30:00.000Z');
    // 18:30 la veille à Los Angeles (DST) → date locale 2026-03-25
    expect(getDateStringInTimezone(date, 'America/Los_Angeles')).toBe('2026-03-25');
  });

  it('fallback vers UTC si timezone invalide', () => {
    const date = new Date('2026-03-26T01:30:00.000Z');
    expect(getDateStringInTimezone(date, 'Invalid/Timezone')).toBe('2026-03-26');
  });
});
