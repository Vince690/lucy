/**
 * Extraction du prénom depuis les métadonnées OAuth (Google / Apple) d'un user Supabase.
 * Retourne null si l'inscription s'est faite par e-mail (aucun nom fourni).
 */

import type { User } from '@supabase/supabase-js';

export function getOAuthFirstName(user: User | null | undefined): string | null {
  const meta = user?.user_metadata;
  if (!meta) return null;

  const direct = meta.given_name || meta.first_name;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const full = meta.full_name || meta.name;
  if (typeof full === 'string' && full.trim()) {
    return full.trim().split(/\s+/)[0];
  }

  return null;
}
