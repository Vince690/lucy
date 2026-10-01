/**
 * Lecture de la réponse RevenueCat `GET /v1/subscribers/{id}`.
 * Pure, sans réseau : la forme du JSON, l'expiration, l'accès à vie, le bruit.
 */

import { describe, it, expect, vi } from 'vitest';

// Ni base ni RevenueCat ici : la config exige les variables Supabase à l'import.
vi.mock('../../supabase.js', () => ({ supabaseAdmin: {}, supabaseAuth: {} }));
vi.mock('../../config.js', () => ({
  config: {
    env: 'test',
    revenueCatSecretApiKey: '',
    revenueCatEntitlementId: 'Lucy Premium',
    revenueCatApiBaseUrl: 'https://api.revenuecat.com/v1',
  },
  hasLlmConfig: () => false,
}));

import { entitlementActiveFromSubscriber } from '../subscriptionService.js';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const ID = 'Lucy Premium';

function payload(entitlement: unknown) {
  return { subscriber: { entitlements: { [ID]: entitlement } } };
}

describe('entitlementActiveFromSubscriber', () => {
  it('actif quand expires_date est dans le futur', () => {
    expect(entitlementActiveFromSubscriber(payload({ expires_date: '2026-09-30T12:00:00Z' }), ID, NOW)).toBe(true);
  });

  it('inactif quand expires_date est passée', () => {
    expect(entitlementActiveFromSubscriber(payload({ expires_date: '2026-09-22T12:00:00Z' }), ID, NOW)).toBe(false);
  });

  it('actif à vie quand expires_date est null', () => {
    expect(entitlementActiveFromSubscriber(payload({ expires_date: null }), ID, NOW)).toBe(true);
  });

  it('inactif sans entitlement, sans abonné, ou avec un autre identifiant', () => {
    expect(entitlementActiveFromSubscriber({ subscriber: { entitlements: {} } }, ID, NOW)).toBe(false);
    expect(entitlementActiveFromSubscriber({}, ID, NOW)).toBe(false);
    expect(entitlementActiveFromSubscriber(null, ID, NOW)).toBe(false);
    expect(entitlementActiveFromSubscriber(payload({ expires_date: '2030-01-01T00:00:00Z' }), 'Autre', NOW)).toBe(false);
  });

  it('inactif sur une date illisible', () => {
    expect(entitlementActiveFromSubscriber(payload({ expires_date: 'demain' }), ID, NOW)).toBe(false);
    expect(entitlementActiveFromSubscriber(payload({ expires_date: 42 }), ID, NOW)).toBe(false);
  });
});
