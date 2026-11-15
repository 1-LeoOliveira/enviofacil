import { aguardarBanco, encerrarPool } from './pool';
import { rodarMigracoes } from './migrate';
import { semear } from './seed';
import { env } from '../config/env';
import { log } from '../lib/logger';

async function principal() {
  await aguardarBanco();
  await rodarMigracoes();
  await semear({ demo: env.semearDemo });
  log.info('Carga inicial concluída');
  await encerrarPool();
}

principal().catch((erro) => {
  log.error('Falha na carga inicial', { mensagem: (erro as Error).message });
  process.exit(1);
});
