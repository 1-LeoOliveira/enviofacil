import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { api, baixarArquivo, tokenCidadao } from '../../lib/api';
import { formatarDataHora, formatarTamanho, tempoRestante } from '../../lib/formato';
import { conectar, type EventoTempoReal } from '../../lib/socket';
import type { DetalheSessao, DocumentoSessao, ParametrosPublicos } from '../../lib/tipos';
import { Alerta, BarraProgresso, Carregando, EtiquetaDocumento, Marca, Modal } from '../../components/ui';
import { VisualizadorArquivo } from '../../components/VisualizadorArquivo';

type RespostaAcesso = DetalheSessao & { cidadaoToken: string };

export function PortalCidadao() {
  const { token: tokenUrl } = useParams();
  const [detalhe, setDetalhe] = useState<DetalheSessao | null>(null);
  const [parametros, setParametros] = useState<ParametrosPublicos | null>(null);
  const [erroFatal, setErroFatal] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<number | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [arquivoAberto, setArquivoAberto] = useState<{ id: string; nome: string } | null>(null);
  const [tokenAtivo, setTokenAtivo] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setDetalhe(await api.get<DetalheSessao>('/portal/sessao', 'cidadao'));
    } catch (e) {
      const mensagem = (e as Error).message;
      setErro(mensagem);
    }
  }, []);

  // Troca o token do QR Code por um token de sessão com escopo restrito.
  useEffect(() => {
    let ativo = true;

    async function iniciar() {
      try {
        if (tokenUrl) {
          const resposta = await api.post<RespostaAcesso>('/portal/acesso', { token: tokenUrl }, 'publico');
          if (!ativo) return;
          tokenCidadao.gravar(resposta.cidadaoToken);
          setTokenAtivo(resposta.cidadaoToken);
          const { cidadaoToken: _descartado, ...resto } = resposta;
          setDetalhe(resto);
        } else if (tokenCidadao.ler()) {
          setTokenAtivo(tokenCidadao.ler());
          await recarregar();
        } else {
          setErroFatal('Acesse pelo QR Code fornecido no guichê ou informe o código de acesso.');
        }
      } catch (e) {
        if (ativo) setErroFatal((e as Error).message);
      }
    }

    void iniciar();
    api
      .get<ParametrosPublicos>('/publico/parametros', 'publico')
      .then(setParametros)
      .catch(() => setParametros(null));

    return () => {
      ativo = false;
    };
  }, [tokenUrl, recarregar]);

  useEffect(() => {
    if (!tokenAtivo) return;
    const socket = conectar(tokenAtivo, 'cidadao');
    socketRef.current = socket;
    socket.on('sessao:evento', (evento: EventoTempoReal) => {
      if (evento.mensagem) setAviso(evento.mensagem);
      void recarregar();
    });
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [tokenAtivo, recarregar]);

  async function anexar(documento: DocumentoSessao, arquivo: File) {
    setErro(null);
    setEnviando(documento.id);
    try {
      const formulario = new FormData();
      formulario.append('arquivo', arquivo);
      await api.enviarArquivo(`/portal/documentos/${documento.id}/arquivos`, formulario, 'cidadao');
      await recarregar();
      setAviso(`Arquivo anexado em "${documento.nome}".`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(null);
    }
  }

  async function removerArquivo(arquivoId: string) {
    setErro(null);
    try {
      await api.delete(`/portal/arquivos/${arquivoId}`, 'cidadao');
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function enviarDocumentos() {
    setErro(null);
    setEnviando(-1);
    try {
      const resposta = await api.post<{ enviados: number; mensagem: string }>(
        '/portal/enviar',
        {},
        'cidadao',
      );
      await recarregar();
      setConfirmado(true);
      setAviso(resposta.mensagem);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(null);
    }
  }

  if (erroFatal) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-100">
        <CabecalhoPortal />
        <div className="mx-auto w-full max-w-md flex-1 p-4">
          <Alerta tipo="erro" titulo="Não foi possível abrir o atendimento">
            {erroFatal}
          </Alerta>
          <Link to="/acesso" className="botao-primario mt-4 w-full">
            Informar código de acesso
          </Link>
        </div>
        <RodapePortal />
      </div>
    );
  }

  if (!detalhe) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-100">
        <CabecalhoPortal />
        <Carregando texto="Abrindo seu atendimento..." />
      </div>
    );
  }

  const { sessao, documentos, progresso, arquivosDoAtendente } = detalhe;
  const encerrada = ['CONCLUIDA', 'CANCELADA', 'EXPIRADA'].includes(sessao.status);
  const temAnexoNovo = documentos.some((d) => d.status === 'ANEXADO');
  const faltamObrigatorios = documentos.filter(
    (d) => d.obrigatorio && d.arquivos.filter((a) => !a.substituido).length === 0 && d.status !== 'APROVADO',
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <CabecalhoPortal />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 pb-24">
        <section className="cartao cartao-corpo">
          <p className="text-sm text-slate-500">Olá,</p>
          <h1 className="text-xl font-bold text-detran-900">{sessao.cidadaoNome}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Este é o ambiente digital do DETRAN de Santa Catarina para envio de documentos durante o seu
            atendimento presencial.
          </p>
          <div className="mt-3 rounded-lg bg-detran-50 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-detran-700">
              Atendimento em andamento
            </p>
            <p className="font-semibold text-detran-900">{sessao.tipoAtendimento.nome}</p>
            <p className="mt-0.5 text-xs text-detran-700">
              {sessao.unidade.nome}
              {sessao.guiche ? ` · ${sessao.guiche.identificacao}` : ''} · atendente {sessao.atendente.nome}
            </p>
          </div>
          {!encerrada && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Este acesso é válido por tempo limitado: {tempoRestante(sessao.expiraEm)}.
            </p>
          )}
        </section>

        {encerrada ? (
          <Alerta
            tipo={sessao.status === 'CONCLUIDA' ? 'sucesso' : 'atencao'}
            titulo={
              sessao.status === 'CONCLUIDA'
                ? 'Atendimento concluído'
                : sessao.status === 'EXPIRADA'
                  ? 'Prazo encerrado'
                  : 'Atendimento encerrado'
            }
          >
            {sessao.status === 'CONCLUIDA'
              ? 'Seus documentos foram recebidos. Obrigado por utilizar o Envio Fácil.'
              : 'Procure o atendente no guichê para gerar um novo acesso, se necessário.'}
          </Alerta>
        ) : (
          <section className="cartao cartao-corpo">
            <BarraProgresso valor={progresso.enviados} total={progresso.total} rotulo="Documentos enviados" />
            {parametros && (
              <p className="mt-2 text-xs text-slate-500">
                Formatos aceitos: {parametros.upload.formatos.join(', ').toUpperCase()} · até{' '}
                {parametros.upload.tamanhoMaximoMb} MB por arquivo.
              </p>
            )}
          </section>
        )}

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {aviso && !erro && (
          <Alerta
            tipo="info"
            acao={
              <button type="button" className="text-xs font-semibold underline" onClick={() => setAviso(null)}>
                ok
              </button>
            }
          >
            {aviso}
          </Alerta>
        )}

        <section className="space-y-3">
          <h2 className="titulo-secao">Documentos solicitados</h2>
          {documentos.map((documento) => (
            <CartaoDocumento
              key={documento.id}
              documento={documento}
              bloqueado={encerrada}
              ocupado={enviando === documento.id}
              aoAnexar={(arquivo) => void anexar(documento, arquivo)}
              aoRemover={(arquivoId) => void removerArquivo(arquivoId)}
              aoVisualizar={(arquivoId, nome) => setArquivoAberto({ id: arquivoId, nome })}
            />
          ))}
        </section>

        {arquivosDoAtendente.length > 0 && (
          <section className="space-y-3">
            <h2 className="titulo-secao">Documentos disponibilizados pelo atendente</h2>
            {arquivosDoAtendente.map((arquivo) => (
              <div key={arquivo.id} className="cartao cartao-corpo">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{arquivo.titulo ?? arquivo.nomeOriginal}</p>
                    {arquivo.descricao && <p className="text-sm text-slate-500">{arquivo.descricao}</p>}
                    <p className="mt-1 text-xs text-slate-400">
                      Disponibilizado em {formatarDataHora(arquivo.criadoEm)} · {formatarTamanho(arquivo.tamanhoBytes)}
                    </p>
                  </div>
                  <span className="etiqueta bg-emerald-100 text-emerald-800">novo</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="botao-secundario flex-1"
                    onClick={() => setArquivoAberto({ id: arquivo.id, nome: arquivo.nomeOriginal })}
                  >
                    Visualizar
                  </button>
                  <button
                    type="button"
                    className="botao-primario flex-1"
                    onClick={() => void baixarArquivo(arquivo.id, 'cidadao')}
                  >
                    Baixar
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <p className="px-1 text-xs text-slate-400">
          Seus arquivos são usados exclusivamente para este atendimento, armazenados de forma cifrada e
          descartados conforme a política de retenção do DETRAN/SC (LGPD).
        </p>
      </main>

      {!encerrada && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-3 shadow-lg">
          <div className="mx-auto max-w-2xl">
            {faltamObrigatorios.length > 0 && (
              <p className="mb-2 text-center text-xs text-amber-700">
                Faltam {faltamObrigatorios.length} documento(s) obrigatório(s).
              </p>
            )}
            <button
              type="button"
              className="botao-primario botao-grande w-full"
              disabled={!temAnexoNovo || faltamObrigatorios.length > 0 || enviando !== null}
              onClick={() => void enviarDocumentos()}
            >
              {enviando === -1 ? 'Enviando...' : 'Enviar documentos'}
            </button>
          </div>
        </div>
      )}

      <VisualizadorArquivo
        arquivoId={arquivoAberto?.id ?? null}
        nome={arquivoAberto?.nome}
        escopo="cidadao"
        aoFechar={() => setArquivoAberto(null)}
      />

      <Modal aberto={confirmado} titulo="Documentos enviados" aoFechar={() => setConfirmado(false)}>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-slate-700">
            Seus documentos chegaram ao atendente. Aguarde a conferência — se algo precisar ser reenviado, a
            orientação aparecerá nesta tela.
          </p>
          <button type="button" className="botao-primario w-full" onClick={() => setConfirmado(false)}>
            Entendi
          </button>
        </div>
      </Modal>
    </div>
  );
}

function CartaoDocumento({
  documento,
  bloqueado,
  ocupado,
  aoAnexar,
  aoRemover,
  aoVisualizar,
}: {
  documento: DocumentoSessao;
  bloqueado: boolean;
  ocupado: boolean;
  aoAnexar: (arquivo: File) => void;
  aoRemover: (arquivoId: string) => void;
  aoVisualizar: (arquivoId: string, nome: string) => void;
}) {
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const entradaCamera = useRef<HTMLInputElement>(null);
  const arquivos = documento.arquivos.filter((a) => !a.substituido);
  const podeEnviar =
    !bloqueado && !['APROVADO'].includes(documento.status);
  const aguardandoCorrecao = ['REJEITADO', 'AGUARDANDO_NOVO_ENVIO'].includes(documento.status);

  return (
    <article
      className={`cartao cartao-corpo ${
        aguardandoCorrecao ? 'border-rose-200' : documento.status === 'APROVADO' ? 'border-emerald-200' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800">{documento.nome}</h3>
          {documento.descricao && <p className="mt-0.5 text-sm text-slate-500">{documento.descricao}</p>}
          {!documento.obrigatorio && <span className="mt-1 inline-block text-xs text-slate-400">opcional</span>}
        </div>
        <EtiquetaDocumento status={documento.status} />
      </div>

      {documento.motivoRejeicao && (
        <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <p className="font-semibold">Não foi possível validar o documento enviado.</p>
          <p className="mt-0.5">{documento.motivoRejeicao}</p>
          <p className="mt-1 text-xs">Envie uma nova imagem garantindo que todas as informações estejam legíveis.</p>
        </div>
      )}

      {documento.orientacao && (
        <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span className="font-semibold">Orientação do atendente:</span> {documento.orientacao}
        </p>
      )}

      {arquivos.length > 0 && (
        <ul className="mt-3 space-y-2">
          {arquivos.map((arquivo) => (
            <li key={arquivo.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-700">{arquivo.nomeOriginal}</p>
              <p className="text-xs text-slate-500">
                {formatarTamanho(arquivo.tamanhoBytes)} ·{' '}
                {arquivo.enviadoEm ? 'enviado ao atendente' : 'anexado, ainda não enviado'}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="botao-neutro flex-1 px-3 py-1.5 text-xs"
                  onClick={() => aoVisualizar(arquivo.id, arquivo.nomeOriginal)}
                >
                  Visualizar
                </button>
                {!arquivo.enviadoEm && !bloqueado && (
                  <button
                    type="button"
                    className="botao-perigo flex-1 px-3 py-1.5 text-xs"
                    onClick={() => aoRemover(arquivo.id)}
                  >
                    Substituir
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {podeEnviar && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            ref={entradaArquivo}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) aoAnexar(arquivo);
              e.target.value = '';
            }}
          />
          <input
            ref={entradaCamera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) aoAnexar(arquivo);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="botao-secundario"
            disabled={ocupado}
            onClick={() => entradaArquivo.current?.click()}
          >
            {ocupado ? 'Anexando...' : 'Escolher arquivo'}
          </button>
          <button
            type="button"
            className="botao-secundario"
            disabled={ocupado}
            onClick={() => entradaCamera.current?.click()}
          >
            Tirar foto
          </button>
        </div>
      )}
    </article>
  );
}

function CabecalhoPortal() {
  return (
    <header className="bg-detran-800 px-4 py-3 text-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        <Marca invertida />
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
          Ambiente oficial
        </span>
      </div>
    </header>
  );
}

function RodapePortal() {
  return (
    <footer className="px-4 py-4 text-center text-[11px] text-slate-400">
      DETRAN/SC · Envio Fácil · Não compartilhe o seu link de acesso
    </footer>
  );
}
