import 'dotenv/config';
import express from 'express';
import { config } from './config.js';
import chatRoutes from './routes/chat.js';
import memoryRoutes from './routes/memory.js';
import accountRoutes from './routes/account.js';

const app = express();

app.use(express.json());

// CORS — nécessaire pour Expo web (dev) ; en prod, restreindre l'origin.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-request-id');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'backend-lucy' });
});

app.use('/chat', chatRoutes);
app.use('/memory', memoryRoutes);
app.use('/account', accountRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.listen(config.port, () => {
  console.log(`[backend-lucy] Listening on port ${config.port} (env: ${config.env})`);
});
