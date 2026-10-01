/**
 * Pool Postgres pour transactions ACID (étapes 5.4–5.5).
 * Le client Supabase JS ne gère pas les transactions multi-requêtes.
 *
 * Priorité de configuration :
 *   1. Variables individuelles PG_HOST / PG_USER / PG_PASSWORD / PG_DATABASE / PG_PORT
 *   2. DATABASE_URL (fallback, sslmode stripped automatiquement)
 */

import fs from 'fs';
import pg, { type PoolClient } from 'pg';
import { config, requireDatabaseUrl } from '../config.js';

const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | null = null;

function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } {
  if (!config.pgSslCaPath) {
    throw new Error(
      'PG_SSL_CA_PATH est requis pour vérifier le certificat du serveur Postgres. ' +
        'Télécharge prod-ca-2021.crt depuis Dashboard Supabase → Project Settings → Database → SSL Configuration.'
    );
  }
  return {
    rejectUnauthorized: true,
    ca: fs.readFileSync(config.pgSslCaPath, 'utf8'),
  };
}

function buildPoolConfig(): ConstructorParameters<typeof Pool>[0] {
  const ssl = buildSslConfig();

  // Priorité 1 : variables individuelles (évite tous les problèmes de parsing d'URL)
  if (config.pgHost) {
    return {
      host: config.pgHost,
      port: config.pgPort,
      user: config.pgUser || undefined,
      password: config.pgPassword || undefined,
      database: config.pgDatabase,
      max: 8,
      connectionTimeoutMillis: 15_000,
      ssl,
    };
  }

  // Priorité 2 : DATABASE_URL (sslmode retiré pour éviter le conflit avec ssl config)
  const url = requireDatabaseUrl();
  const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]$/, '');
  return {
    connectionString: cleanUrl,
    max: 8,
    connectionTimeoutMillis: 15_000,
    ssl,
  };
}

export function getPgPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool(buildPoolConfig());
  }
  return _pool;
}

export function _resetPgPoolForTests(): void {
  if (_pool) {
    void _pool.end();
    _pool = null;
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  const timeoutMs = Math.max(1000, config.dbStatementTimeoutMs);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout TO ${timeoutMs}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
