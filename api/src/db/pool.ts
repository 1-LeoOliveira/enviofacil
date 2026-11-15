import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env';
import { log } from '../lib/logger';

let pool: Pool | null = null;

export function obterPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.porta,
      user: env.db.usuario,
      password: env.db.senha,
      database: env.db.banco,
      waitForConnections: true,
      connectionLimit: env.db.poolLimite,
      queueLimit: 0,
      charset: 'utf8mb4_general_ci',
      timezone: 'Z',
      dateStrings: false,
      namedPlaceholders: false,
      supportBigNumbers: true,
      decimalNumbers: true,
    });
  }
  return pool;
}

/** SELECT parametrizado. Nunca interpolar valores em SQL. */
export async function consultar<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [linhas] = await obterPool().query<T[]>(sql, params);
  return linhas;
}

export async function consultarUm<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const linhas = await consultar<T>(sql, params);
  return linhas.length ? linhas[0] : null;
}

export async function executar(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [resultado] = await obterPool().execute<ResultSetHeader>(sql, params);
  return resultado;
}

export async function comTransacao<T>(fn: (conexao: PoolConnection) => Promise<T>): Promise<T> {
  const conexao = await obterPool().getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await fn(conexao);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/** Aguarda o MySQL subir (importante no docker compose). */
export async function aguardarBanco(tentativas = 30, intervaloMs = 2000): Promise<void> {
  for (let i = 1; i <= tentativas; i += 1) {
    try {
      await obterPool().query('SELECT 1');
      log.info('Banco de dados disponível');
      return;
    } catch (erro) {
      const mensagem = (erro as Error).message;
      log.warn('Banco indisponível, tentando novamente', { tentativa: i, mensagem });
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  }
  throw new Error('Não foi possível conectar ao banco de dados.');
}

export async function encerrarPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type { RowDataPacket, ResultSetHeader, PoolConnection };
