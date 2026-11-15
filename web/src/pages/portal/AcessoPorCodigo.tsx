import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokenCidadao } from '../../lib/api';
import type { DetalheSessao } from '../../lib/tipos';
import { Alerta, Marca } from '../../components/ui';

export function AcessoPorCodigo() {
  const navegar = useNavigate();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function formatar(valor: string) {
    const limpo = valor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return limpo.length > 4 ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : limpo;
  }

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const resposta = await api.post<DetalheSessao & { cidadaoToken: string }>(
        '/portal/acesso',
        { codigo },
        'publico',
      );
      tokenCidadao.gravar(resposta.cidadaoToken);
      navegar('/portal', { replace: true });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-detran-800">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full min-w-0 max-w-md">
          <div className="mb-6 flex justify-center">
            <Marca invertida />
          </div>

          <div className="cartao cartao-corpo">
            <h1 className="text-xl font-bold text-detran-900">Código de acesso</h1>
            <p className="mt-1 text-sm text-slate-500">
              Digite o código de 8 caracteres informado pelo atendente no guichê. Não é preciso criar conta nem
              instalar aplicativo.
            </p>

            <form onSubmit={submeter} className="mt-5 space-y-4">
              {erro && <Alerta tipo="erro">{erro}</Alerta>}

              <div>
                <label className="rotulo" htmlFor="codigo">
                  Código
                </label>
                <input
                  id="codigo"
                  className="campo text-center font-mono text-xl tracking-[0.18em] sm:text-2xl sm:tracking-[0.3em]"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="ABCD-2345"
                  value={codigo}
                  onChange={(e) => setCodigo(formatar(e.target.value))}
                  required
                />
              </div>

              <button
                type="submit"
                className="botao-primario botao-grande w-full"
                disabled={ocupado || codigo.replace(/\W/g, '').length < 8}
              >
                {ocupado ? 'Abrindo...' : 'Acessar meu atendimento'}
              </button>
            </form>

            <p className="mt-4 text-xs text-slate-400">
              O acesso é temporário e vinculado apenas ao seu atendimento. Não compartilhe este código.
            </p>
          </div>
        </div>
      </div>

      <footer className="px-4 py-4 text-center text-[11px] text-detran-200">
        DETRAN · Santa Catarina · Envio Fácil
      </footer>
    </div>
  );
}
