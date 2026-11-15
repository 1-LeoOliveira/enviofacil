import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAutenticacao } from '../../lib/autenticacao';
import { cpfValido, mascararCpfEntrada } from '../../lib/formato';
import type { AcessoSessao, Sessao, TipoAtendimento } from '../../lib/tipos';
import { Alerta, Carregando } from '../../components/ui';

interface DocumentoSelecionado {
  chave: string;
  documentoExigidoId: number | null;
  nome: string;
  descricao: string;
  obrigatorio: boolean;
  selecionado: boolean;
}

interface RespostaConsulta {
  cidadao: { nome: string; cpfMascarado: string; nascimento: string | null };
  integracao: { provedor: string; origem: string; demonstracao: boolean; aviso: string | null };
}

type Etapa = 1 | 2 | 3 | 4;

export function NovoAtendimento() {
  const { usuario } = useAutenticacao();
  const navegar = useNavigate();

  const [etapa, setEtapa] = useState<Etapa>(1);
  const [cpf, setCpf] = useState('');
  const [consulta, setConsulta] = useState<RespostaConsulta | null>(null);
  const [tipos, setTipos] = useState<TipoAtendimento[]>([]);
  const [tipoId, setTipoId] = useState<number | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoSelecionado[]>([]);
  const [guicheId, setGuicheId] = useState<number | null>(usuario?.guiche?.id ?? null);
  const [guiches, setGuiches] = useState<Array<{ id: number; identificacao: string }>>([]);
  const [observacoes, setObservacoes] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ sessao: Sessao; acesso: AcessoSessao } | null>(null);

  const [novoNome, setNovoNome] = useState('');
  const [novaDescricao, setNovaDescricao] = useState('');

  useEffect(() => {
    api
      .get<{ tipos: TipoAtendimento[] }>('/catalogo/tipos-atendimento')
      .then((r) => setTipos(r.tipos))
      .catch((e: Error) => setErro(e.message));
    api
      .get<{ guiches: Array<{ id: number; identificacao: string }> }>('/catalogo/guiches')
      .then((r) => setGuiches(r.guiches))
      .catch(() => setGuiches([]));
  }, []);

  const tipoSelecionado = useMemo(() => tipos.find((t) => t.id === tipoId) ?? null, [tipos, tipoId]);

  async function consultarCpf(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    if (!cpfValido(cpf)) {
      setErro('CPF inválido. Confira os números digitados.');
      return;
    }
    setOcupado(true);
    try {
      const resposta = await api.get<RespostaConsulta>(
        `/cidadaos/consultar?cpf=${encodeURIComponent(cpf.replace(/\D/g, ''))}`,
      );
      setConsulta(resposta);
      setEtapa(2);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function escolherServico(id: number) {
    setTipoId(id);
    const tipo = tipos.find((t) => t.id === id);
    setDocumentos(
      (tipo?.documentos ?? []).map((d) => ({
        chave: `exigido-${d.id}`,
        documentoExigidoId: d.id,
        nome: d.nome,
        descricao: d.descricao ?? '',
        obrigatorio: d.obrigatorio,
        selecionado: true,
      })),
    );
  }

  function adicionarDocumento() {
    if (novoNome.trim().length < 3) {
      setErro('Informe o nome do documento adicional (mínimo 3 caracteres).');
      return;
    }
    setErro(null);
    setDocumentos((atual) => [
      ...atual,
      {
        chave: `extra-${Date.now()}`,
        documentoExigidoId: null,
        nome: novoNome.trim(),
        descricao: novaDescricao.trim(),
        obrigatorio: false,
        selecionado: true,
      },
    ]);
    setNovoNome('');
    setNovaDescricao('');
  }

  async function criarSessao() {
    setErro(null);
    const selecionados = documentos.filter((d) => d.selecionado);
    if (!tipoId) {
      setErro('Selecione o tipo de atendimento.');
      return;
    }
    if (!selecionados.length) {
      setErro('Selecione pelo menos um documento para solicitar ao cidadão.');
      return;
    }

    setOcupado(true);
    try {
      const resposta = await api.post<{ sessao: Sessao; acesso: AcessoSessao }>('/sessoes', {
        cpf: cpf.replace(/\D/g, ''),
        tipoAtendimentoId: tipoId,
        guicheId: guicheId ?? null,
        observacoes: observacoes.trim() || undefined,
        documentos: selecionados.map((d) => ({
          documentoExigidoId: d.documentoExigidoId,
          nome: d.nome,
          descricao: d.descricao || undefined,
          obrigatorio: d.obrigatorio,
        })),
      });
      setResultado(resposta);
      setEtapa(4);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const passos = ['Identificação', 'Confirmação', 'Serviço e documentos', 'QR Code'];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-detran-900">Novo atendimento</h1>
        <p className="text-sm text-slate-500">
          Identifique o cidadão, selecione o serviço e gere o acesso digital em poucos passos.
        </p>
      </div>

      <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        {passos.map((passo, indice) => {
          const numero = (indice + 1) as Etapa;
          const ativo = etapa === numero;
          const concluido = etapa > numero;
          return (
            <li
              key={passo}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                ativo
                  ? 'border-detran-300 bg-detran-50 text-detran-800'
                  : concluido
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-400'
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px]">
                {concluido ? '✓' : numero}
              </span>
              {passo}
            </li>
          );
        })}
      </ol>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {/* Etapa 1 - CPF */}
      {etapa === 1 && (
        <form onSubmit={consultarCpf} className="cartao cartao-corpo max-w-xl space-y-4">
          <div>
            <label className="rotulo" htmlFor="cpf">
              CPF do cidadão
            </label>
            <input
              id="cpf"
              className="campo font-mono text-lg tracking-wide"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(mascararCpfEntrada(e.target.value))}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              A consulta usa a camada de integração institucional. Nenhuma base paralela de cidadãos é mantida pela plataforma.
            </p>
          </div>
          <button type="submit" className="botao-primario" disabled={ocupado}>
            {ocupado ? 'Consultando...' : 'Consultar CPF'}
          </button>
        </form>
      )}

      {/* Etapa 2 - confirmação */}
      {etapa === 2 && consulta && (
        <div className="cartao cartao-corpo max-w-xl space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cidadão identificado</p>
            <p className="mt-1 text-xl font-bold text-detran-900">{consulta.cidadao.nome}</p>
            <p className="font-mono text-sm text-slate-600">{consulta.cidadao.cpfMascarado}</p>
            {consulta.cidadao.nascimento && (
              <p className="text-sm text-slate-500">
                Nascimento: {new Date(`${consulta.cidadao.nascimento}T12:00:00`).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>

          {consulta.integracao.demonstracao && (
            <Alerta tipo="atencao" titulo="Dado de demonstração">
              {consulta.integracao.aviso}
            </Alerta>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="botao-primario" onClick={() => setEtapa(3)}>
              Confirmar identificação
            </button>
            <button
              type="button"
              className="botao-neutro"
              onClick={() => {
                setConsulta(null);
                setEtapa(1);
              }}
            >
              Corrigir CPF
            </button>
          </div>
        </div>
      )}

      {/* Etapa 3 - serviço e documentos */}
      {etapa === 3 && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-3">
            <div className="cartao cartao-corpo">
              <h2 className="titulo-secao mb-3">Tipo de atendimento</h2>
              {!tipos.length ? (
                <Carregando texto="Carregando catálogo..." />
              ) : (
                <div className="space-y-2">
                  {tipos.map((tipo) => (
                    <label
                      key={tipo.id}
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                        tipoId === tipo.id
                          ? 'border-detran-400 bg-detran-50'
                          : 'border-slate-200 hover:border-detran-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="tipo"
                        className="mt-1"
                        checked={tipoId === tipo.id}
                        onChange={() => escolherServico(tipo.id)}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-800">{tipo.nome}</span>
                        {tipo.descricao && <span className="block text-xs text-slate-500">{tipo.descricao}</span>}
                        <span className="mt-1 block text-[11px] font-medium text-detran-700">
                          {tipo.documentos.length} documento(s) previsto(s)
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="cartao cartao-corpo space-y-3">
              <h2 className="titulo-secao">Dados do atendimento</h2>
              <div>
                <label className="rotulo" htmlFor="guiche">
                  Guichê
                </label>
                <select
                  id="guiche"
                  className="campo"
                  value={guicheId ?? ''}
                  onChange={(e) => setGuicheId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sem guichê vinculado</option>
                  {guiches.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.identificacao}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="rotulo" htmlFor="observacoes">
                  Observações internas (opcional)
                </label>
                <textarea
                  id="observacoes"
                  className="campo"
                  rows={3}
                  maxLength={600}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Anotações visíveis apenas para a equipe."
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 space-y-3">
            <div className="cartao cartao-corpo">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="titulo-secao">Documentos solicitados</h2>
                {tipoSelecionado && (
                  <span className="text-xs text-slate-500">
                    {documentos.filter((d) => d.selecionado).length} selecionado(s)
                  </span>
                )}
              </div>

              {!tipoSelecionado ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  Escolha um tipo de atendimento para carregar a lista de documentos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {documentos.map((documento, indice) => (
                    <li
                      key={documento.chave}
                      className={`rounded-lg border p-3 ${
                        documento.selecionado ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={documento.selecionado}
                          onChange={(e) =>
                            setDocumentos((atual) =>
                              atual.map((d, i) => (i === indice ? { ...d, selecionado: e.target.checked } : d)),
                            )
                          }
                          aria-label={`Solicitar ${documento.nome}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800">{documento.nome}</p>
                          {documento.descricao && (
                            <p className="text-xs text-slate-500">{documento.descricao}</p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                            <label className="inline-flex items-center gap-1.5 text-slate-600">
                              <input
                                type="checkbox"
                                checked={documento.obrigatorio}
                                onChange={(e) =>
                                  setDocumentos((atual) =>
                                    atual.map((d, i) => (i === indice ? { ...d, obrigatorio: e.target.checked } : d)),
                                  )
                                }
                              />
                              Obrigatório
                            </label>
                            {documento.documentoExigidoId === null && (
                              <>
                                <span className="etiqueta bg-detran-50 text-detran-700">adicional</span>
                                <button
                                  type="button"
                                  className="font-semibold text-rose-600 hover:underline"
                                  onClick={() =>
                                    setDocumentos((atual) => atual.filter((_, i) => i !== indice))
                                  }
                                >
                                  remover
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {tipoSelecionado && (
              <div className="cartao cartao-corpo space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Adicionar documento específico</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="campo"
                    placeholder="Nome do documento"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    maxLength={140}
                  />
                  <input
                    className="campo"
                    placeholder="Orientação ao cidadão (opcional)"
                    value={novaDescricao}
                    onChange={(e) => setNovaDescricao(e.target.value)}
                    maxLength={400}
                  />
                </div>
                <button type="button" className="botao-secundario" onClick={adicionarDocumento}>
                  Adicionar à lista
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="botao-primario botao-grande" onClick={() => void criarSessao()} disabled={ocupado}>
                {ocupado ? 'Gerando sessão...' : 'Gerar sessão e QR Code'}
              </button>
              <button type="button" className="botao-neutro" onClick={() => setEtapa(2)}>
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Etapa 4 - QR */}
      {etapa === 4 && resultado && (
        <div className="cartao cartao-corpo">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col items-center justify-center rounded-xl border border-detran-100 bg-detran-50 p-5 text-center">
              <img
                src={resultado.acesso.qrCode}
                alt="QR Code de acesso do cidadão"
                className="h-56 w-56 rounded-lg bg-white p-2 shadow-sm"
              />
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-detran-700">
                Código de acesso
              </p>
              <p className="font-mono text-2xl font-bold tracking-widest text-detran-900">
                {resultado.acesso.codigoCurto}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Alternativa ao QR: o cidadão digita este código em {window.location.origin}/acesso
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <h2 className="titulo-secao">Sessão criada</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Peça ao cidadão para apontar a câmera do celular para o QR Code.
                </p>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">Cidadão</dt>
                  <dd className="font-medium text-slate-800">{resultado.sessao.cidadaoNome}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">CPF</dt>
                  <dd className="font-mono text-slate-800">{resultado.sessao.cpfMascarado}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">Serviço</dt>
                  <dd className="text-right font-medium text-slate-800">{resultado.sessao.tipoAtendimento.nome}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">Validade</dt>
                  <dd className="text-slate-800">
                    {new Date(resultado.acesso.expiraEm).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="botao-primario"
                  onClick={() => navegar(`/app/atendimentos/${resultado.sessao.id}`)}
                >
                  Abrir painel de recebimento
                </button>
                <button type="button" className="botao-neutro nao-imprimir" onClick={() => window.print()}>
                  Imprimir QR
                </button>
                <Link to="/app/novo" className="botao-neutro nao-imprimir" onClick={() => window.location.reload()}>
                  Novo atendimento
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
