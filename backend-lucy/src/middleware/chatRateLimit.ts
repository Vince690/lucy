import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth.js';
import { config } from '../config.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function getKey(req: AuthenticatedRequest): string {
  if (req.userId) {
    return `user:${req.userId}`;
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

function maybeCleanup(now: number): void {
  // Cleanup opportuniste pour éviter la croissance infinie de la map.
  if (buckets.size < 1000) return;
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function chatRateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const now = Date.now();
  const windowMs = config.chatRateLimitWindowMs;
  const maxRequests = config.chatRateLimitMaxRequests;
  const key = getKey(req);
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(maxRequests - 1, 0)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
    maybeCleanup(now);
    next();
    return;
  }

  existing.count += 1;
  const remaining = Math.max(maxRequests - existing.count, 0);
  res.setHeader('X-RateLimit-Limit', String(maxRequests));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(existing.resetAt / 1000)));

  if (existing.count > maxRequests) {
    const retryAfterSec = Math.max(Math.ceil((existing.resetAt - now) / 1000), 1);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'rate_limited',
      message: 'Trop de requêtes sur /chat. Réessaie dans quelques secondes.',
    });
    return;
  }

  next();
}
