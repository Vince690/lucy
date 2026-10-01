import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth.js';
import { MemoryResetError, resetUserMemory } from '../services/memoryResetService.js';
import { clearLongMemoryCache } from '../services/chatContextService.js';
import { logEvent } from '../logger.js';

const router = Router();

/**
 * POST /memory/reset
 * Effacement mémoire Lucy (§VI) : conversations (cascade messages/jobs/snapshots),
 * tables mémoire utilisateur, journal `user_memory_reset_log`.
 *
 * Réservé à l’utilisateur authentifié : `reason` forcé à `user_action` (pas d’admin via cette route).
 */
router.post('/reset', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const startedAt = Date.now();

  try {
    const result = await resetUserMemory(userId, 'user_action');
    // Invalider le cache mémoire longue pour que le prochain /chat
    // recharge depuis la DB (données post-reset).
    clearLongMemoryCache(userId);
    logEvent('info', 'memory.reset', {
      user_id: userId,
      outcome: 'ok',
      reason: result.reason,
      duration_ms: Date.now() - startedAt,
    });
    res.status(200).json({
      ok: true,
      reason: result.reason,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('error', 'memory.reset', {
      user_id: userId,
      outcome: 'failed',
      err_msg: msg,
      duration_ms: Date.now() - startedAt,
    });
    if (err instanceof MemoryResetError) {
      res.status(500).json({
        error: 'reset_failed',
        message: 'Impossible de réinitialiser la mémoire pour le moment.',
      });
      return;
    }
    res.status(500).json({
      error: 'reset_failed',
      message: 'Impossible de réinitialiser la mémoire pour le moment.',
    });
  }
});

export default router;
