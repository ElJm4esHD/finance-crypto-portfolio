import fs from 'node:fs';
import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { createCryptoService } from './crypto/service.js';
import { createCedearService } from './cedears/service.js';
import { createSnapshotService } from './snapshots/service.js';
import { NotFoundError, UserError } from './lib/errors.js';
import { localDate } from './lib/dates.js';
import { cryptoCsv, cedearsCsv } from './export/csv.js';

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError();
  return id;
}

const NO_FX = { get: () => null };

// fx: dólar MEP service (prices/fx.js); its value travels with every portfolio
// so the UI can convert ARS ↔ USD.
export function buildApp({ db, cryptoPrices, marketPrices, fx = NO_FX, publicDir, logger = false }) {
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }) });
  const crypto = createCryptoService(db, cryptoPrices, { log: app.log });
  const cedears = createCedearService(db, marketPrices, { fx, log: app.log });
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

  app.get('/api/fx/mep', async () => ({ mep: fx.get() }));

  const sendCsv = (reply, name, csv) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}-${localDate()}.csv"`)
      .send(csv);

  // ── Cripto ──────────────────────────────────────────────
  app.get('/api/crypto/holdings', async () => ({ ...(await crypto.getHoldings()), fx: fx.get() }));

  app.get('/api/crypto/chart/:asset', async (req) => crypto.getIntraday(req.params.asset));

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

  app.get('/api/crypto/export.csv', async (req, reply) => sendCsv(reply, 'cripto', await cryptoCsv(crypto)));

  // ── CEDEARs / ETF ───────────────────────────────────────
  app.get('/api/cedears/portfolio', async () => ({ ...(await cedears.getPortfolio()), fx: fx.get() }));

  app.get('/api/cedears/chart/:ticker', async (req) => cedears.getIntraday(req.params.ticker));

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

  app.get('/api/cedears/export.csv', async (req, reply) => sendCsv(reply, 'cedears', await cedearsCsv(cedears)));

  // ── Frontend (built SPA, hash-routed) ───────────────────
  if (publicDir && fs.existsSync(publicDir)) {
    app.register(fastifyStatic, { root: publicDir });
  }

  return { app, snapshots };
}
