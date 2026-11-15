import { aguardarBanco, encerrarPool } from './pool';
import { rodarMigracoes } from './migrate';
import { log } from '../lib/logger';

async function principal() {
  await aguardarBanco();
  const novas = await rodarMigracoes();
  log.info('Migrações concluídas', { aplicadas: novas });
  await encerrarPool();
}

principal().catch((erro) => {
  log.error('Falha nas migrações', { mensagem: (erro as Error).message });
  process.exit(1);
});
