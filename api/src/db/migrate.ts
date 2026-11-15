import fs from 'node:fs';
import path from 'node:path';
import { consultar, executar, obterPool, type RowDataPacket } from './pool';
import { log } from '../lib/logger';

function localizarDiretorioMigracoes(): string {
  const candidatos = [
    process.env.MIGRATIONS_DIR,
    path.join(process.cwd(), 'db', 'migrations'),
    path.join(process.cwd(), '..', 'db', 'migrations'),
    path.resolve(__dirname, '..', '..', '..', 'db', 'migrations'),
    path.resolve(__dirname, '..', '..', '..', '..', 'db', 'migrations'),
  ].filter(Boolean) as string[];

  for (const dir of candidatos) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(
    `Diretório de migrações não encontrado. Procurado em: ${candidatos.join(', ')}`,
  );
}

interface LinhaMigracao extends RowDataPacket {
  nome: string;
}

/**
 * Quebra o arquivo em comandos; o esquema não usa procedures, então o `;` no
 * fim da linha basta. As linhas de comentário são removidas de cada bloco —
 * um bloco que começa com comentário continua sendo um comando válido.
 */
function separarComandos(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((bloco) =>
      bloco
        .split(/\r?\n/)
        .filter((linha) => !/^\s*--/.test(linha))
        .join('\n')
        .trim(),
    )
    .filter((comando) => comando.length > 0);
}

export async function rodarMigracoes(): Promise<string[]> {
  const dir = localizarDiretorioMigracoes();

  await executar(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nome        VARCHAR(160) NOT NULL,
      aplicado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (nome)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const aplicadas = new Set(
    (await consultar<LinhaMigracao>('SELECT nome FROM schema_migrations')).map((l) => l.nome),
  );

  const arquivos = fs
    .readdirSync(dir)
    .filter((a) => a.endsWith('.sql'))
    .sort();

  const novas: string[] = [];
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');
    const comandos = separarComandos(sql);
    const conexao = await obterPool().getConnection();
    try {
      for (const comando of comandos) {
        await conexao.query(comando);
      }
      await conexao.query('INSERT INTO schema_migrations (nome) VALUES (?)', [arquivo]);
      novas.push(arquivo);
      log.info('Migração aplicada', { arquivo, comandos: comandos.length });
    } catch (erro) {
      log.error('Falha ao aplicar migração', { arquivo, mensagem: (erro as Error).message });
      throw erro;
    } finally {
      conexao.release();
    }
  }

  if (!novas.length) log.info('Banco já está na versão mais recente');
  return novas;
}
