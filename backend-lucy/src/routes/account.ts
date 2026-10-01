import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../auth.js';
import { supabaseAdmin } from '../supabase.js';
import { clearLongMemoryCache } from '../services/chatContextService.js';
import { logEvent } from '../logger.js';

const router = Router();

/**
 * POST /account/delete
 * Suppression complète du compte utilisateur (Apple guideline 5.1.1(v) + RGPD Art. 17).
 * Supprime l'entrée auth.users → CASCADE sur toutes les tables liées
 * (profiles, mood_entries, conversations, mémoire Lucy, etc.).
 */
router.post('/delete', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const startedAt = Date.now();

  try {
    clearLongMemoryCache(userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      throw error;
    }

    logEvent('info', 'account.delete', {
      user_id: userId,
      outcome: 'ok',
      duration_ms: Date.now() - startedAt,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('error', 'account.delete', {
      user_id: userId,
      outcome: 'failed',
      err_msg: msg,
      duration_ms: Date.now() - startedAt,
    });
    res.status(500).json({
      error: 'delete_failed',
      message: 'Impossible de supprimer le compte pour le moment.',
    });
  }
});

export default router;
