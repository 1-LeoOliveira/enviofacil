import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, tokenServidor } from './api';
import type { ParametrosPublicos, Perfil, Usuario, UsuarioDemonstracao } from './tipos';

interface EstadoAutenticacao {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<Usuario>;
  sair: () => Promise<void>;
  recarregar: () => Promise<void>;
  token: string | null;
  /** Modo de demonstração: a interface entra direto, sem tela de login. */
  loginDesabilitado: boolean;
  usuariosDemonstracao: UsuarioDemonstracao[];
  trocarUsuario: (usuarioId: number) => Promise<void>;
}

const Contexto = createContext<EstadoAutenticacao | null>(null);

const CHAVE_PREFERIDO = 'envio-facil.usuario-demo';

export function ProvedorAutenticacao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [token, setToken] = useState<string | null>(() => tokenServidor.ler());
  const [loginDesabilitado, setLoginDesabilitado] = useState(false);
  const [usuariosDemonstracao, setUsuariosDemonstracao] = useState<UsuarioDemonstracao[]>([]);
  const iniciado = useRef(false);

  const acessoDireto = useCallback(async (usuarioId?: number) => {
    const resposta = await api.post<{ token: string; usuario: Usuario }>(
      '/auth/acesso-direto',
      usuarioId ? { usuarioId } : {},
      'publico',
    );
    tokenServidor.gravar(resposta.token);
    setToken(resposta.token);
    setUsuario(resposta.usuario);
    localStorage.setItem(CHAVE_PREFERIDO, String(resposta.usuario.id));
    return resposta.usuario;
  }, []);

  const recarregar = useCallback(async () => {
    if (!tokenServidor.ler()) {
      setUsuario(null);
      return;
    }
    try {
      const resposta = await api.get<{ usuario: Usuario }>('/auth/eu');
      setUsuario(resposta.usuario);
      setToken(tokenServidor.ler());
    } catch {
      tokenServidor.limpar();
      setUsuario(null);
      setToken(null);
    }
  }, []);

  // Descobre o modo da plataforma e, se o login estiver desabilitado, entra sozinho.
  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;

    (async () => {
      let parametros: ParametrosPublicos | null = null;
      try {
        parametros = await api.get<ParametrosPublicos>('/publico/parametros', 'publico');
        setLoginDesabilitado(parametros.autenticacao?.loginDesabilitado ?? false);
        setUsuariosDemonstracao(parametros.autenticacao?.usuarios ?? []);
      } catch {
        // Sem parâmetros, seguimos com o login tradicional.
      }

      await recarregar();

      if (!tokenServidor.ler() && parametros?.autenticacao?.loginDesabilitado) {
        const preferido = Number(localStorage.getItem(CHAVE_PREFERIDO) ?? 0);
        try {
          await acessoDireto(preferido > 0 ? preferido : undefined);
        } catch {
          // Deixa a interface seguir; a tela indicará o problema.
        }
      }

      setCarregando(false);
    })();
  }, [recarregar, acessoDireto]);

  const entrar = useCallback(async (email: string, senha: string) => {
    const resposta = await api.post<{ token: string; usuario: Usuario }>(
      '/auth/login',
      { email, senha },
      'publico',
    );
    tokenServidor.gravar(resposta.token);
    setToken(resposta.token);
    setUsuario(resposta.usuario);
    return resposta.usuario;
  }, []);

  const sair = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Encerrar a sessão local é o que importa aqui.
    }
    tokenServidor.limpar();
    setToken(null);
    setUsuario(null);
  }, []);

  const trocarUsuario = useCallback(
    async (usuarioId: number) => {
      tokenServidor.limpar();
      await acessoDireto(usuarioId);
    },
    [acessoDireto],
  );

  const valor = useMemo<EstadoAutenticacao>(
    () => ({
      usuario,
      carregando,
      entrar,
      sair,
      recarregar,
      token,
      loginDesabilitado,
      usuariosDemonstracao,
      trocarUsuario,
    }),
    [usuario, carregando, entrar, sair, recarregar, token, loginDesabilitado, usuariosDemonstracao, trocarUsuario],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAutenticacao(): EstadoAutenticacao {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useAutenticacao precisa estar dentro de ProvedorAutenticacao.');
  return contexto;
}

/** Bloqueia a rota no cliente; o servidor repete a verificação em cada chamada. */
export function RotaProtegida({
  children,
  perfis,
}: {
  children: ReactNode;
  perfis?: Perfil[];
}) {
  const { usuario, carregando } = useAutenticacao();
  const local = useLocation();

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-detran-300 border-t-detran-700" />
          Carregando...
        </div>
      </div>
    );
  }

  if (!usuario) return <Navigate to="/entrar" state={{ de: local.pathname }} replace />;

  if (perfis && !perfis.includes(usuario.perfil)) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-detran-900">Acesso restrito</h1>
        <p className="mt-2 text-slate-600">
          Seu perfil ({usuario.perfil.toLowerCase()}) não tem permissão para esta área.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
