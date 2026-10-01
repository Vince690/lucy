/**
 * Porte du chat (pré-essai à FREE_EXCHANGES_LIMIT échanges, puis abonnement).
 *
 * La décision est testée avec des dépendances injectées : ni base, ni RevenueCat.
 * Ce qu'on verrouille :
 *   - un échange offert disponible passe sans jamais interroger RevenueCat ;
 *   - quota épuisé + abonné → passe, en `premium` ;
 *   - quota épuisé + non abonné → 402 `free_exchanges_exhausted`, compteurs joints ;
 *   - quota épuisé + RevenueCat en panne → 503 `subscription_unverifiable`, jamais
 *     de passage (choix du 23 septembre 2026 : bloquer plutôt que laisser passer).
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

import { decideChatAccess, type ChatGateDeps } from '../chatGateService.js';
import { ChatServiceError } from '../chatService.js';
import { FREE_EXCHANGES_LIMIT } from '../../constants.js';

function deps(overrides: Partial<ChatGateDeps>): ChatGateDeps {
  return {
    consume: vi.fn(async () => ({ allowed: true, used: 1 })),
    isPremium: vi.fn(async () => false),
    markWall: vi.fn(async () => '2026-09-23T12:00:00.000Z'),
    ...overrides,
  };
}

describe('decideChatAccess', () => {
  it('la limite vaut 5 échanges, une seule fois pour toujours', () => {
    expect(FREE_EXCHANGES_LIMIT).toBe(5);
  });

  it('un échange offert disponible passe sans interroger RevenueCat', async () => {
    const d = deps({ consume: vi.fn(async () => ({ allowed: true, used: 3 })) });
    const decision = await decideChatAccess('u1', d);
    expect(decision).toEqual({ access: 'free', freeExchangesUsed: 3, freeExchangesLimit: 5 });
    expect(d.consume).toHaveBeenCalledWith('u1', 5);
    expect(d.isPremium).not.toHaveBeenCalled();
  });

  it('quota épuisé mais abonné : passe en premium', async () => {
    const d = deps({
      consume: vi.fn(async () => ({ allowed: false, used: 5 })),
      isPremium: vi.fn(async () => true),
    });
    const decision = await decideChatAccess('u1', d);
    expect(decision).toEqual({ access: 'premium', freeExchangesUsed: 5, freeExchangesLimit: 5 });
  });

  it('quota épuisé et pas abonné : 402 avec les compteurs, et le mur est marqué', async () => {
    const d = deps({ consume: vi.fn(async () => ({ allowed: false, used: 5 })) });
    await expect(decideChatAccess('u1', d)).rejects.toMatchObject({
      code: 'free_exchanges_exhausted',
      statusCode: 402,
      extra: {
        free_exchanges_used: 5,
        free_exchanges_limit: 5,
        chat_wall_reached_at: '2026-09-23T12:00:00.000Z',
      },
    });
    expect(d.markWall).toHaveBeenCalledWith('u1');
  });

  it('le marqueur du mur ne se pose pas tant que quelqu’un peut encore passer', async () => {
    const free = deps({});
    await decideChatAccess('u1', free);
    const premium = deps({
      consume: vi.fn(async () => ({ allowed: false, used: 5 })),
      isPremium: vi.fn(async () => true),
    });
    await decideChatAccess('u1', premium);
    expect(free.markWall).not.toHaveBeenCalled();
    expect(premium.markWall).not.toHaveBeenCalled();
  });

  it('marqueur impossible à poser : le 402 part quand même, daté de maintenant', async () => {
    const d = deps({
      consume: vi.fn(async () => ({ allowed: false, used: 5 })),
      markWall: vi.fn(async () => null),
    });
    const err = await decideChatAccess('u1', d).catch((e) => e);
    expect(err.statusCode).toBe(402);
    expect(typeof err.extra.chat_wall_reached_at).toBe('string');
  });

  it('quota épuisé et RevenueCat en panne : 503, jamais de passage', async () => {
    const d = deps({
      consume: vi.fn(async () => ({ allowed: false, used: 5 })),
      isPremium: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const err = await decideChatAccess('u1', d).catch((e) => e);
    expect(err).toBeInstanceOf(ChatServiceError);
    expect(err.code).toBe('subscription_unverifiable');
    expect(err.statusCode).toBe(503);
  });
});
