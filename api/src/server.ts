import http from 'node:http';
import { criarApp } from './app';
import { env } from './config/env';
import { aguardarBanco, encerrarPool } from './db/pool';
import { rodarMigracoes } from './db/migrate';
import { semear } from './db/seed';
import { iniciarRotinas, pararRotinas } from './jobs';
import { log } from './lib/logger';
import { encerrarTempoReal, iniciarTempoReal } from './realtime';
import { prepararArmazenamento } from './storage';

async function iniciar() {
  log.info('Iniciando Envio Fácil (API)', {
    ambiente: env.ambiente,
    provedorCidadaos: env.cidadaos.provedor,
    urlPublica: env.urlPublica,
  });

  await aguardarBanco();
  if (env.executarMigracoes) await rodarMigracoes();
  await semear({ demo: env.semearDemo });
  await prepararArmazenamento();

  const app = criarApp();
  const servidor = http.createServer(app);
  iniciarTempoReal(servidor);
  iniciarRotinas();

  servidor.listen(env.porta, () => {
    log.info('API ouvindo', { porta: env.porta });
  });

  const encerrar = async (sinal: string) => {
    log.info('Encerrando aplicação', { sinal });
    pararRotinas();
    servidor.close();
    await encerrarTempoReal();
    await encerrarPool();
    process.exit(0);
  };

  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));
}

iniciar().catch((erro) => {
  log.error('Falha ao iniciar a API', { mensagem: (erro as Error).message, stack: (erro as Error).stack });
  process.exit(1);
});
