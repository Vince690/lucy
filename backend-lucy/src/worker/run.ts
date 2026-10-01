/**
 * Point d'entrée pour lancer le worker des jobs mémoire.
 * En production : à appeler par un cron (ex. toutes les minutes) ou une fonction planifiée Supabase.
 *
 * Usage: npm run worker
 */

import 'dotenv/config';
import { runMemoryJobsWorker } from './memoryJobs.js';

async function main() {
  const result = await runMemoryJobsWorker();
  console.log('Worker run finished:', result);
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
