import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDataHora } from '../../lib/formato';
import { Alerta, Carregando } from '../../components/ui';

interface Configuracao {
  chave: string;
  valor: string;
  tipo: 'INTEIRO' | 'TEXTO' | 'BOOLEANO' | 'LISTA';
  descricao: string | null;
  grupo: string;
  atualizado_em: string;
}

const NOMES_GRUPO: Record<string, string> = {
  SESSAO: 'Sessões digitais',
  ARQUIVOS: 'Arquivos e uploads',
  LGPD: 'Retenção e proteção de dados',
  ATENDIMENTO: 'Atendimento',
  GERAL: 'Geral',
};

export function Configuracoes() {
  const [configuracoes, setConfiguracoes] = useState<Configuracao[]>([]);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await api.get<{ configuracoes: Configuracao[] }>('/admin/configuracoes');
      setConfiguracoes(resposta.configuracoes);
      setRascunho(Object.fromEntries(resposta.configuracoes.map((c) => [c.chave, c.valor])));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(chave: string) {
    setErro(null);
    setSalvando(chave);
    try {
      await api.put(`/admin/configuracoes/${chave}`, { valor: rascunho[chave] });
      setAviso(`Configuração "${chave}" atualizada.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  if (carregando) return <Carregando />;

  const grupos = [...new Set(configuracoes.map((c) => c.grupo))];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-detran-900">Configurações da plataforma</h1>
        <p className="text-sm text-slate-500">
          Parâmetros operacionais aplicados imediatamente nas próximas sessões e envios.
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {aviso && (
        <Alerta tipo="sucesso" acao={<button type="button" className="text-xs underline" onClick={() => setAviso(null)}>ok</button>}>
          {aviso}
        </Alerta>
      )}

      {grupos.map((grupo) => (
        <section key={grupo} className="cartao">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="titulo-secao">{NOMES_GRUPO[grupo] ?? grupo}</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {configuracoes
              .filter((c) => c.grupo === grupo)
              .map((configuracao) => {
                const alterado = rascunho[configuracao.chave] !== configuracao.valor;
                return (
                  <li key={configuracao.chave} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="font-mono text-xs text-slate-400">{configuracao.chave}</p>
                      <p className="text-sm font-medium text-slate-700">{configuracao.descricao ?? '—'}</p>
                      <p className="text-xs text-slate-400">
                        Atualizado em {formatarDataHora(configuracao.atualizado_em)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {configuracao.tipo === 'BOOLEANO' ? (
                        <select
                          className="campo w-32"
                          value={rascunho[configuracao.chave]}
                          onChange={(e) => setRascunho({ ...rascunho, [configuracao.chave]: e.target.value })}
                        >
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      ) : (
                        <input
                          className="campo w-44"
                          inputMode={configuracao.tipo === 'INTEIRO' ? 'numeric' : 'text'}
                          value={rascunho[configuracao.chave]}
                          onChange={(e) => setRascunho({ ...rascunho, [configuracao.chave]: e.target.value })}
                        />
                      )}
                      <button
                        type="button"
                        className="botao-primario px-3 py-2 text-xs"
                        disabled={!alterado || salvando === configuracao.chave}
                        onClick={() => void salvar(configuracao.chave)}
                      >
                        {salvando === configuracao.chave ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <Alerta tipo="info" titulo="Chaves de segurança">
        Chaves de cifra, segredo do JWT e credenciais de integração não ficam no banco: são variáveis de
        ambiente do servidor, trocadas sem passar por esta tela.
      </Alerta>
    </div>
  );
}
