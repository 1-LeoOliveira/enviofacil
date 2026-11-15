import { env } from '../config/env';

/**
 * O banco grava e devolve tudo em UTC (ver pool: timezone 'Z').
 * Para os indicadores "de hoje" e para agrupar por dia, o que interessa é o dia
 * civil da unidade de atendimento — por isso convertemos explicitamente, em vez
 * de usar CURDATE()/DATE(), que responderiam no fuso do servidor.
 */

function partesNoFuso(data: Date, fuso: string) {
  const formatador = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const partes: Record<string, number> = {};
  for (const parte of formatador.formatToParts(data)) {
    if (parte.type !== 'literal') partes[parte.type] = Number(parte.value);
  }
  // 24h em alguns ambientes significa meia-noite do dia seguinte.
  if (partes.hour === 24) partes.hour = 0;
  return partes;
}

/** Deslocamento do fuso, em minutos, no instante informado (considera horário de verão). */
export function offsetMinutos(data = new Date(), fuso = env.fusoHorario): number {
  const p = partesNoFuso(data, fuso);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - data.getTime()) / 60000);
}

/** Instante (UTC) correspondente à meia-noite local do dia informado. */
export function inicioDoDiaLocal(data = new Date(), fuso = env.fusoHorario): Date {
  const p = partesNoFuso(data, fuso);
  const meiaNoiteComoUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const offset = offsetMinutos(new Date(meiaNoiteComoUtc), fuso) * 60000;
  return new Date(meiaNoiteComoUtc - offset);
}

/** Offset no formato aceito por CONVERT_TZ, ex.: '-03:00'. */
export function offsetSql(data = new Date(), fuso = env.fusoHorario): string {
  const minutos = offsetMinutos(data, fuso);
  const sinal = minutos < 0 ? '-' : '+';
  const absoluto = Math.abs(minutos);
  const horas = String(Math.floor(absoluto / 60)).padStart(2, '0');
  const resto = String(absoluto % 60).padStart(2, '0');
  return `${sinal}${horas}:${resto}`;
}
