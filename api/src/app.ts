import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { erroHandler, naoEncontradoHandler } from './lib/errors';
import { log } from './lib/logger';
import { limiteGeral } from './middleware/limites';
import { rotasAuth } from './modules/auth/routes';
import { rotasAdmin } from './modules/admin/routes';
import { rotasArquivos } from './modules/arquivos/routes';
import { rotasCatalogo, rotasCidadaos, rotasPublicas } from './modules/catalogo/routes';
import { rotasPortal } from './modules/portal/routes';
import { rotasPainel, rotasSessoes } from './modules/sessoes/routes';

export function criarApp(): Express {
  const app = express();

  if (env.confiarProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // A API não serve HTML; o front-end tem a própria política no Nginx.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origem, callback) {
        if (!origem || env.corsOrigens.includes(origem)) {
          callback(null, true);
          return;
        }
        log.warn('Origem bloqueada pelo CORS', { origem });
        callback(new Error('Origem não autorizada.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // Log de acesso enxuto: método, rota, status e duração. Sem corpo, sem query.
  app.use((req, res, inicio) => {
    const comeco = Date.now();
    res.on('finish', () => {
      log.debug('requisição', {
        metodo: req.method,
        rota: req.path,
        status: res.statusCode,
        ms: Date.now() - comeco,
      });
    });
    inicio();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ambiente: env.ambiente, em: new Date().toISOString() });
  });

  const api = express.Router();
  api.use(limiteGeral);

  api.use('/auth', rotasAuth);
  api.use('/publico', rotasPublicas);
  api.use('/catalogo', rotasCatalogo);
  api.use('/cidadaos', rotasCidadaos);
  api.use('/sessoes', rotasSessoes);
  api.use('/painel', rotasPainel);
  api.use('/portal', rotasPortal);
  api.use('/arquivos', rotasArquivos);
  api.use('/admin', rotasAdmin);

  app.use('/api', api);

  app.use(naoEncontradoHandler);
  app.use(erroHandler);

  return app;
}
