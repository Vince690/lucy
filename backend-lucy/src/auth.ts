import { Request, Response, NextFunction } from 'express';
import { supabaseAuth } from './supabase.js';
import { User } from '@supabase/supabase-js';

export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

/**
 * Middleware qui vérifie le JWT Supabase dans le header Authorization
 * et attache l'utilisateur (req.user) et req.userId.
 * Répond 401 si token absent ou invalide.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'missing_auth', message: 'Token manquant (Authorization: Bearer <token>)' });
    return;
  }

  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'invalid_token', message: 'Token invalide ou expiré' });
      return;
    }
    req.user = user;
    req.userId = user.id;
    next();
  } catch (e) {
    console.error('[auth] Error verifying token:', e);
    res.status(500).json({ error: 'auth_error', message: 'Erreur lors de la vérification du token' });
  }
}
