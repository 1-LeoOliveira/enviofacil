import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAutenticacao } from '../lib/autenticacao';
import { Alerta, Marca } from '../components/ui';

export function Entrar() {
  const { entrar, usuario, carregando } = useAutenticacao();
  const navegar = useNavigate();
  const local = useLocation() as { state?: { de?: string } };

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!carregando && usuario) {
    return <Navigate to={local.state?.de ?? '/app'} replace />;
  }

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
      navegar(local.state?.de ?? '/app', { replace: true });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-detran-800">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full min-w-0 max-w-md">
          <div className="mb-6 flex justify-center">
            <Marca invertida />
          </div>

          <div className="cartao">
            <div className="cartao-corpo">
              <h1 className="text-xl font-bold text-detran-900">Acesso do servidor</h1>
              <p className="mt-1 text-sm text-slate-500">
                Área restrita aos servidores do DETRAN/SC. O cidadão acessa pelo QR Code, sem login.
              </p>

              <form onSubmit={submeter} className="mt-5 space-y-4">
                {erro && <Alerta tipo="erro">{erro}</Alerta>}

                <div>
                  <label className="rotulo" htmlFor="email">
                    E-mail institucional
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="campo"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@detran.sc.gov.br"
                  />
                </div>

                <div>
                  <label className="rotulo" htmlFor="senha">
                    Senha
                  </label>
                  <input
                    id="senha"
                    type="password"
                    className="campo"
                    autoComplete="current-password"
                    required
                    minLength={8}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                <button type="submit" className="botao-primario botao-grande w-full" disabled={enviando}>
                  {enviando ? 'Entrando...' : 'Entrar'}
                </button>
              </form>

              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Ambiente de demonstração</p>
                <p className="mt-1">
                  Atendente: <span className="font-mono">atendente@enviofacil.sc.gov.br</span> / <span className="font-mono">Atende@2025</span>
                  <br />
                  Administrador: <span className="font-mono">admin@enviofacil.sc.gov.br</span> / <span className="font-mono">Admin@2025</span>
                </p>
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-sm text-detran-100">
            É o cidadão?{' '}
            <Link to="/acesso" className="font-semibold text-white underline underline-offset-2">
              Entrar com código de acesso
            </Link>
          </p>
        </div>
      </div>

      <footer className="px-4 py-4 text-center text-[11px] text-detran-200">
        Plataforma institucional de troca digital de documentos · Protótipo sem uso de logotipos oficiais
      </footer>
    </div>
  );
}
