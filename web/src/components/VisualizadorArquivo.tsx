import { useEffect, useState } from 'react';
import { baixarArquivo, obterLinkArquivo, type LinkArquivo } from '../lib/api';
import { formatarTamanho } from '../lib/formato';
import { Alerta, Carregando, Modal } from './ui';

interface Props {
  arquivoId: string | null;
  nome?: string;
  escopo: 'servidor' | 'cidadao';
  aoFechar: () => void;
}

/**
 * Abre o arquivo por link assinado de curta duração. O conteúdo nunca fica em
 * uma URL permanente nem é exposto sem autorização.
 */
export function VisualizadorArquivo({ arquivoId, nome, escopo, aoFechar }: Props) {
  const [link, setLink] = useState<(LinkArquivo & { urlCompleta: string }) | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!arquivoId) {
      setLink(null);
      setErro(null);
      return;
    }
    let ativo = true;
    setLink(null);
    setErro(null);
    obterLinkArquivo(arquivoId, escopo)
      .then((resultado) => {
        if (ativo) setLink(resultado);
      })
      .catch((e: Error) => {
        if (ativo) setErro(e.message);
      });
    return () => {
      ativo = false;
    };
  }, [arquivoId, escopo]);

  const ehImagem = link?.mime.startsWith('image/');

  return (
    <Modal
      aberto={Boolean(arquivoId)}
      titulo={nome ?? link?.nomeOriginal ?? 'Documento'}
      aoFechar={aoFechar}
      largura="max-w-3xl"
    >
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {!link && !erro && <Carregando texto="Abrindo documento..." />}
      {link && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <span>
              {link.nomeOriginal} · {formatarTamanho(link.tamanhoBytes)}
            </span>
            <button
              type="button"
              className="botao-secundario"
              onClick={() => void baixarArquivo(link ? (arquivoId as string) : '', escopo)}
            >
              Baixar arquivo
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {ehImagem ? (
              <img
                src={link.urlCompleta}
                alt={link.nomeOriginal}
                className="mx-auto max-h-[65vh] w-auto object-contain"
              />
            ) : (
              <iframe
                src={link.urlCompleta}
                title={link.nomeOriginal}
                className="h-[65vh] w-full"
                sandbox=""
              />
            )}
          </div>

          <p className="text-xs text-slate-400">
            Link de acesso temporário, válido por poucos minutos e restrito a este documento.
          </p>
        </div>
      )}
    </Modal>
  );
}
