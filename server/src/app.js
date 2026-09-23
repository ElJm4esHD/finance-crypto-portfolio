import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createCryptoService } from './crypto/service.js';
import { createCedearService } from './cedears/service.js';
import { createSnapshotService } from './snapshots/service.js';
import { NotFoundError, UserError } from './lib/errors.js';

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError();
  return id;
}

export function buildApp({ db, cryptoPrices, marketPrices, publicDir, logger = false }) {
  const app = Fastify({ logger, disableRequestLogging: true });
  const crypto = createCryptoService(db, cryptoPrices);
  const cedears = createCedearService(db, marketPrices);
  const snapshots = createSnapshotService(db, { crypto, cedears }, app.log);

  // Keep today's snapshot in sync after every change (errors are logged inside).
  const refresh = (portfolio) => void snapshots.capture(portfolio);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof UserError) return reply.code(err.statusCode).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'Pedido inválido.' });
    req.log.error(err);
    return reply.code(500).send({ error: 'Error interno del servidor.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // ── Cripto ──────────────────────────────────────────────
  app.get('/api/crypto/holdings', () => crypto.getHoldings());

  app.put('/api/crypto/holdings', async (req) => {
    const row = crypto.setHolding(req.body?.asset, req.body?.amount);
    refresh('crypto');
    return row;
  });

  app.delete('/api/crypto/holdings/:asset', async (req, reply) => {
    crypto.deleteHolding(req.params.asset);
    refresh('crypto');
    return reply.code(204).send();
  });

  app.get('/api/crypto/exchanges', async () => crypto.listExchanges());

  app.post('/api/crypto/exchanges', async (req, reply) => {
    const ex = crypto.createExchange(req.body ?? {});
    refresh('crypto');
    return reply.code(201).send(ex);
  });

  app.delete('/api/crypto/exchanges/:id', async (req, reply) => {
    crypto.deleteExchange(parseId(req.params.id));
    refresh('crypto');
    return reply.code(204).send();
  });

  app.put('/api/crypto/goal', async (req) => ({ goal: crypto.setGoal(req.body?.amount ?? null) }));

  app.get('/api/crypto/growth', async () => ({ ...snapshots.getGrowth('crypto'), goal: crypto.getGoal() }));

  // ── CEDEARs / ETF ───────────────────────────────────────
  app.get('/api/cedears/portfolio', () => cedears.getPortfolio());

  app.get('/api/cedears/operations', async () => cedears.listOperations());

  app.post('/api/cedears/operations', async (req, reply) => {
    const op = cedears.createOperation(req.body ?? {});
    refresh('cedears');
    return reply.code(201).send(op);
  });

  app.delete('/api/cedears/operations/:id', async (req, reply) => {
    cedears.deleteOperation(parseId(req.params.id));
    refresh('cedears');
    return reply.code(204).send();
  });

  app.get('/api/cedears/cash-movements', async () => cedears.listCashMovements());

  app.post('/api/cedears/cash-movements', async (req, reply) => {
    const m = cedears.createCashMovement(req.body ?? {});
    refresh('cedears');
    return reply.code(201).send(m);
  });

  app.delete('/api/cedears/cash-movements/:id', async (req, reply) => {
    cedears.deleteCashMovement(parseId(req.params.id));
    refresh('cedears');
    return reply.code(204).send();
  });

  app.get('/api/cedears/growth', async () => snapshots.getGrowth('cedears'));

  // ── Frontend (built SPA, hash-routed) ───────────────────
  if (publicDir && fs.existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
  }

  return { app, snapshots };
}
