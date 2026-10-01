import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

/** Client Supabase avec clé anon : utilisé pour vérifier le JWT (auth.getUser). */
export const supabaseAuth: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey
);

/** Client Supabase avec service_role : utilisé pour les opérations DB côté backend (conversations, messages, memory_jobs, etc.). */
export const supabaseAdmin: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  { auth: { persistSession: false } }
);
