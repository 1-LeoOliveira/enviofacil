#!/usr/bin/env node
/**
 * Envio Fácil - teste de integração e segurança ponta a ponta.
 *
 * Executa o fluxo real contra a API em execução: login, criação de sessão,
 * acesso do cidadão, upload, envio, análise, arquivos do atendente,
 * encerramento — e tenta explicitamente os acessos que devem falhar
 * (sessão de outro cidadão, atendimento de outro servidor, links forjados).
 *
 * Uso:
 *   node scripts/teste-integracao.mjs [http://localhost:4000/api]
 */

const BASE = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');

const CREDENCIAIS_ATENDENTE = { email: 'atendente@enviofacil.sc.gov.br', senha: 'Atende@2025' };
const CREDENCIAIS_ADMIN = { email: 'admin@enviofacil.sc.gov.br', senha: 'Admin@2025' };
const CPF_A = '52998224725';
const CPF_B = '11144477735';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC',
  'base64',
);
const PDF_SIMPLES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);
const PDF_COM_SCRIPT = Buffer.from('%PDF-1.4\n/JavaScript (app.alert(1))\n%%EOF\n', 'latin1');

let passou = 0;
let falhou = 0;
const falhas = [];

function ok(descricao) {
  passou += 1;
  console.log(`  ✓ ${descricao}`);
}

function erro(descricao, detalhe) {
  falhou += 1;
  falhas.push(descricao);
  console.log(`  ✗ ${descricao}`);
  if (detalhe) console.log(`      ${detalhe}`);
}

function verificar(condicao, descricao, detalhe) {
  if (condicao) ok(descricao);
  else erro(descricao, detalhe);
}

function secao(titulo) {
  console.log(`\n${titulo}`);
}

async function chamar(caminho, { metodo = 'GET', corpo, token, formulario } = {}) {
  const cabecalhos = {};
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: formulario ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
  });

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }
  return { status: resposta.status, dados, cabecalhos: resposta.headers };
}

function formularioArquivo(nome, conteudo, tipo, extras = {}) {
  const formulario = new FormData();
  formulario.append('arquivo', new Blob([conteudo], { type: tipo }), nome);
  for (const [chave, valor] of Object.entries(extras)) formulario.append(chave, valor);
  return formulario;
}

async function aguardarApi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const resposta = await fetch(`${BASE.replace(/\/api$/, '')}/health`);
      if (resposta.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function criarSessao(token, cpf, tipos) {
  const tipo = tipos[0];
  const resposta = await chamar('/sessoes', {
    metodo: 'POST',
    token,
    corpo: {
      cpf,
      tipoAtendimentoId: tipo.id,
      documentos: tipo.documentos.map((d) => ({
        documentoExigidoId: d.id,
        nome: d.nome,
        descricao: d.descricao ?? undefined,
        obrigatorio: d.obrigatorio,
      })),
    },
  });
  return resposta;
}

async function principal() {
  console.log(`Envio Fácil — teste de integração\nAPI: ${BASE}\n`);

  if (!(await aguardarApi())) {
    console.error('API indisponível. Suba a stack com "docker compose up -d" antes de rodar os testes.');
    process.exit(2);
  }

  // ------------------------------------------------------------ autenticação
  secao('1. Autenticação e permissões de acesso');

  const semToken = await chamar('/sessoes');
  verificar(semToken.status === 401, 'rota de sessões exige autenticação', `status ${semToken.status}`);

  const senhaErrada = await chamar('/auth/login', {
    metodo: 'POST',
    corpo: { email: CREDENCIAIS_ATENDENTE.email, senha: 'senhaerrada123' },
  });
  verificar(senhaErrada.status === 401, 'senha incorreta é rejeitada', `status ${senhaErrada.status}`);
  verificar(
    !JSON.stringify(senhaErrada.dados).toLowerCase().includes('usuário não'),
    'mensagem de erro não revela se o e-mail existe',
  );

  const login = await chamar('/auth/login', { metodo: 'POST', corpo: CREDENCIAIS_ATENDENTE });
  verificar(login.status === 200 && Boolean(login.dados?.token), 'login do atendente funciona', `status ${login.status}`);
  const tokenAtendente = login.dados?.token;
  if (!tokenAtendente) {
    console.error('\nSem token de atendente não é possível continuar. A carga inicial (SEED_DEMO) rodou?');
    process.exit(2);
  }

  const loginAdmin = await chamar('/auth/login', { metodo: 'POST', corpo: CREDENCIAIS_ADMIN });
  const tokenAdmin = loginAdmin.dados?.token;
  verificar(Boolean(tokenAdmin), 'login do administrador funciona');

  const adminNegado = await chamar('/admin/usuarios', { token: tokenAtendente });
  verificar(adminNegado.status === 403, 'atendente não acessa a área administrativa', `status ${adminNegado.status}`);

  // ------------------------------------------------------- consulta de CPF
  secao('2. Identificação do cidadão (camada de integração)');

  const cpfInvalido = await chamar('/cidadaos/consultar?cpf=11111111111', { token: tokenAtendente });
  verificar(cpfInvalido.status === 400, 'CPF inválido é recusado antes da consulta', `status ${cpfInvalido.status}`);

  const cpfInexistente = await chamar('/cidadaos/consultar?cpf=39053344705', { token: tokenAtendente });
  verificar(
    [200, 404].includes(cpfInexistente.status),
    'consulta responde encontrado ou não encontrado, sem erro interno',
    `status ${cpfInexistente.status}`,
  );

  const consulta = await chamar(`/cidadaos/consultar?cpf=${CPF_A}`, { token: tokenAtendente });
  verificar(consulta.status === 200 && Boolean(consulta.dados?.cidadao?.nome), 'CPF de demonstração é localizado');
  verificar(
    consulta.dados?.integracao?.demonstracao === true,
    'resposta marca explicitamente a origem de demonstração',
  );
  verificar(
    !JSON.stringify(consulta.dados).includes(CPF_A),
    'a resposta não devolve o CPF completo em claro',
  );

  // --------------------------------------------------------- criação da sessão
  secao('3. Criação da sessão digital e QR Code');

  const catalogo = await chamar('/catalogo/tipos-atendimento', { token: tokenAtendente });
  const tipos = catalogo.dados?.tipos ?? [];
  verificar(tipos.length > 0, 'catálogo de serviços tem itens', `${tipos.length} serviços`);
  verificar(
    tipos.every((t) => Array.isArray(t.documentos)),
    'cada serviço traz a própria lista de documentos',
  );

  const criada = await criarSessao(tokenAtendente, CPF_A, tipos);
  verificar(criada.status === 201, 'sessão criada pelo atendente', `status ${criada.status}`);
  const sessaoA = criada.dados?.sessao;
  const acessoA = criada.dados?.acesso;
  if (!sessaoA || !acessoA) {
    console.error('\nSessão não foi criada; interrompendo.');
    process.exit(2);
  }
  verificar(acessoA.qrCode?.startsWith('data:image/png;base64,'), 'QR Code gerado como imagem');
  verificar(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(acessoA.codigoCurto), 'código curto legível gerado');
  verificar(!acessoA.link.includes(CPF_A), 'a URL de acesso não contém o CPF');
  verificar(sessaoA.cpfMascarado.includes('*'), 'o CPF aparece mascarado na sessão');

  const tokenUrlA = acessoA.link.split('/s/')[1];
  verificar(Boolean(tokenUrlA) && tokenUrlA.length >= 42, 'token da URL tem entropia alta');

  const sessaoB = await criarSessao(tokenAtendente, CPF_B, tipos);
  verificar(sessaoB.status === 201, 'segunda sessão criada (para os testes de isolamento)');
  const tokenUrlB = sessaoB.dados?.acesso?.link.split('/s/')[1];

  // ------------------------------------------------------- portal do cidadão
  secao('4. Portal do cidadão: acesso, upload e validações');

  const tokenForjado = await chamar('/portal/acesso', {
    metodo: 'POST',
    corpo: { token: 'x'.repeat(43) },
  });
  verificar(tokenForjado.status === 404, 'token inexistente não abre sessão alguma', `status ${tokenForjado.status}`);

  const acessoCidadao = await chamar('/portal/acesso', { metodo: 'POST', corpo: { token: tokenUrlA } });
  verificar(acessoCidadao.status === 200, 'cidadão acessa a sessão pelo token do QR Code');
  const tokenCidadaoA = acessoCidadao.dados?.cidadaoToken;
  verificar(Boolean(tokenCidadaoA), 'token de sessão do cidadão é emitido');
  verificar(
    !JSON.stringify(acessoCidadao.dados?.sessao ?? {}).includes(CPF_A),
    'portal não expõe o CPF completo',
  );

  const acessoPorCodigo = await chamar('/portal/acesso', {
    metodo: 'POST',
    corpo: { codigo: sessaoB.dados.acesso.codigoCurto },
  });
  verificar(acessoPorCodigo.status === 200, 'acesso alternativo por código curto funciona');
  const tokenCidadaoB = acessoPorCodigo.dados?.cidadaoToken;

  const documentosA = acessoCidadao.dados?.documentos ?? [];
  verificar(documentosA.length > 0, 'cidadão recebe a lista de documentos solicitados');
  const primeiroDoc = documentosA[0];
  const obrigatorios = documentosA.filter((d) => d.obrigatorio);

  const extensaoProibida = await chamar(`/portal/documentos/${primeiroDoc.id}/arquivos`, {
    metodo: 'POST',
    token: tokenCidadaoA,
    formulario: formularioArquivo('malicioso.exe', Buffer.from('MZ'), 'application/octet-stream'),
  });
  verificar(extensaoProibida.status === 400, 'extensão não permitida é recusada', `status ${extensaoProibida.status}`);

  const conteudoFalso = await chamar(`/portal/documentos/${primeiroDoc.id}/arquivos`, {
    metodo: 'POST',
    token: tokenCidadaoA,
    formulario: formularioArquivo('fingindo.pdf', Buffer.from('isto nao e um pdf'), 'application/pdf'),
  });
  verificar(
    conteudoFalso.status === 400,
    'arquivo com extensão PDF mas conteúdo inválido é recusado (magic bytes)',
    `status ${conteudoFalso.status}`,
  );

  const pdfComScript = await chamar(`/portal/documentos/${primeiroDoc.id}/arquivos`, {
    metodo: 'POST',
    token: tokenCidadaoA,
    formulario: formularioArquivo('ativo.pdf', PDF_COM_SCRIPT, 'application/pdf'),
  });
  verificar(pdfComScript.status === 400, 'PDF com JavaScript embutido é recusado', `status ${pdfComScript.status}`);

  const envioSemTudo = await chamar('/portal/enviar', { metodo: 'POST', token: tokenCidadaoA, corpo: {} });
  verificar(
    envioSemTudo.status === 400 || envioSemTudo.status === 409,
    'envio sem os documentos obrigatórios é bloqueado',
    `status ${envioSemTudo.status}`,
  );

  const anexos = [];
  for (const [indice, documento] of obrigatorios.entries()) {
    const usarPdf = indice % 2 === 1;
    const resposta = await chamar(`/portal/documentos/${documento.id}/arquivos`, {
      metodo: 'POST',
      token: tokenCidadaoA,
      formulario: usarPdf
        ? formularioArquivo('documento.pdf', PDF_SIMPLES, 'application/pdf')
        : formularioArquivo('foto.png', PNG_1X1, 'image/png'),
    });
    if (resposta.status === 201) anexos.push(resposta.dados);
    else erro(`upload do documento "${documento.nome}"`, `status ${resposta.status}`);
  }
  verificar(anexos.length === obrigatorios.length, 'todos os documentos obrigatórios foram anexados');

  const substituir = await chamar(`/portal/arquivos/${anexos[0].arquivoId}`, {
    metodo: 'DELETE',
    token: tokenCidadaoA,
  });
  verificar(substituir.status === 204, 'cidadão pode substituir o arquivo antes do envio');
  const reenvio = await chamar(`/portal/documentos/${obrigatorios[0].id}/arquivos`, {
    metodo: 'POST',
    token: tokenCidadaoA,
    formulario: formularioArquivo('foto-corrigida.png', PNG_1X1, 'image/png'),
  });
  verificar(reenvio.status === 201, 'novo arquivo é aceito após a substituição');

  const envio = await chamar('/portal/enviar', { metodo: 'POST', token: tokenCidadaoA, corpo: {} });
  verificar(envio.status === 200 && envio.dados?.enviados > 0, 'envio dos documentos concluído', `status ${envio.status}`);

  // ------------------------------------------------- isolamento entre sessões
  secao('5. Isolamento entre cidadãos (tentativas de acesso indevido)');

  const sessaoDoOutro = await chamar('/portal/sessao', { token: tokenCidadaoB });
  verificar(
    sessaoDoOutro.dados?.sessao?.id === sessaoB.dados.sessao.id,
    'cada token de cidadão abre apenas a própria sessão',
  );

  const docDoOutro = (await chamar('/portal/sessao', { token: tokenCidadaoB })).dados.documentos[0];
  const uploadCruzado = await chamar(`/portal/documentos/${docDoOutro.id}/arquivos`, {
    metodo: 'POST',
    token: tokenCidadaoA,
    formulario: formularioArquivo('invasao.png', PNG_1X1, 'image/png'),
  });
  verificar(
    uploadCruzado.status === 404 || uploadCruzado.status === 403,
    'cidadão A não anexa arquivo em documento da sessão B',
    `status ${uploadCruzado.status}`,
  );

  const detalheA = await chamar(`/sessoes/${sessaoA.id}`, { token: tokenAtendente });
  const arquivoDeA = detalheA.dados?.documentos?.flatMap((d) => d.arquivos)?.[0];
  verificar(Boolean(arquivoDeA), 'arquivos do cidadão chegaram ao painel do atendente');

  const linkCruzado = await chamar(`/arquivos/${arquivoDeA.id}/link`, {
    metodo: 'POST',
    token: tokenCidadaoB,
  });
  verificar(linkCruzado.status === 403, 'cidadão B não gera link para arquivo da sessão A', `status ${linkCruzado.status}`);

  const linkProprio = await chamar(`/arquivos/${arquivoDeA.id}/link`, { metodo: 'POST', token: tokenCidadaoA });
  verificar(linkProprio.status === 200 && Boolean(linkProprio.dados?.url), 'cidadão gera link do próprio arquivo');

  const conteudoAssinado = await fetch(`${BASE}${linkProprio.dados.url}`);
  verificar(conteudoAssinado.status === 200, 'link assinado entrega o conteúdo do arquivo');
  verificar(
    (conteudoAssinado.headers.get('content-disposition') ?? '').startsWith('inline'),
    'resposta do arquivo define Content-Disposition',
  );
  verificar(
    conteudoAssinado.headers.get('x-content-type-options') === 'nosniff',
    'resposta do arquivo impede sniffing de tipo',
  );

  const semAssinatura = await fetch(`${BASE}/arquivos/conteudo?a=${arquivoDeA.id}&t=assinatura.falsa.aqui`);
  verificar(semAssinatura.status === 401, 'conteúdo não é entregue com assinatura forjada', `status ${semAssinatura.status}`);

  const linkDeOutroArquivo = linkProprio.dados.url.replace(arquivoDeA.id, docDoOutro.id);
  const trocaDeId = await fetch(`${BASE}${linkDeOutroArquivo}`);
  verificar(
    [400, 401, 404].includes(trocaDeId.status),
    'assinatura de um arquivo não serve para outro',
    `status ${trocaDeId.status}`,
  );

  // ------------------------------------------- isolamento entre atendentes
  secao('6. Isolamento entre servidores');

  const unidadeNova = await chamar('/admin/unidades', {
    metodo: 'POST',
    token: tokenAdmin,
    corpo: { nome: 'CIRETRAN Teste QA', sigla: `QA${Date.now().toString().slice(-4)}`, cidade: 'Chapecó', uf: 'SC', ativo: true },
  });
  verificar(unidadeNova.status === 201, 'administrador cria unidade');

  const emailOutro = `qa.${Date.now()}@enviofacil.sc.gov.br`;
  const outroAtendente = await chamar('/admin/usuarios', {
    metodo: 'POST',
    token: tokenAdmin,
    corpo: {
      nome: 'Atendente QA Outra Unidade',
      email: emailOutro,
      perfil: 'ATENDENTE',
      unidadeId: unidadeNova.dados.id,
      ativo: true,
      senha: 'SenhaQa@2025',
    },
  });
  verificar(outroAtendente.status === 201, 'administrador cria atendente em outra unidade');

  const loginOutro = await chamar('/auth/login', {
    metodo: 'POST',
    corpo: { email: emailOutro, senha: 'SenhaQa@2025' },
  });
  const tokenOutro = loginOutro.dados?.token;
  verificar(Boolean(tokenOutro), 'atendente de outra unidade consegue entrar');

  const sessaoAlheia = await chamar(`/sessoes/${sessaoA.id}`, { token: tokenOutro });
  verificar(sessaoAlheia.status === 403, 'atendente não abre atendimento de outro servidor', `status ${sessaoAlheia.status}`);

  const aprovarAlheio = await chamar(`/sessoes/${sessaoA.id}/documentos/${documentosA[0].id}/aprovar`, {
    metodo: 'POST',
    token: tokenOutro,
  });
  verificar(aprovarAlheio.status === 403, 'atendente não aprova documento de outro atendimento', `status ${aprovarAlheio.status}`);

  const listaOutro = await chamar('/sessoes', { token: tokenOutro });
  verificar(
    (listaOutro.dados?.itens ?? []).every((s) => s.id !== sessaoA.id),
    'listagem do outro atendente não inclui sessões alheias',
  );

  // ----------------------------------------------------- análise e devolutiva
  secao('7. Análise dos documentos e comunicação de volta');

  const emAnalise = await chamar(`/sessoes/${sessaoA.id}`, { token: tokenAtendente });
  verificar(
    ['EM_ANALISE', 'EM_ANDAMENTO'].includes(emAnalise.dados.sessao.status),
    'sessão reflete o envio do cidadão',
    `status ${emAnalise.dados.sessao.status}`,
  );
  const docsParaAnalise = emAnalise.dados.documentos.filter((d) => d.arquivos.length > 0);

  const aprovar = await chamar(`/sessoes/${sessaoA.id}/documentos/${docsParaAnalise[0].id}/aprovar`, {
    metodo: 'POST',
    token: tokenAtendente,
  });
  verificar(aprovar.status === 200, 'atendente aprova documento enviado', `status ${aprovar.status}`);

  const rejeicaoSemMotivo = await chamar(`/sessoes/${sessaoA.id}/documentos/${docsParaAnalise[0].id}/rejeitar`, {
    metodo: 'POST',
    token: tokenAtendente,
    corpo: { motivo: 'curto' },
  });
  verificar(rejeicaoSemMotivo.status === 400, 'rejeição exige motivo descritivo', `status ${rejeicaoSemMotivo.status}`);

  if (docsParaAnalise.length > 1) {
    const rejeitar = await chamar(`/sessoes/${sessaoA.id}/documentos/${docsParaAnalise[1].id}/rejeitar`, {
      metodo: 'POST',
      token: tokenAtendente,
      corpo: { motivo: 'A imagem está ilegível e não permite conferir o número do documento.', solicitarNovoEnvio: true },
    });
    verificar(rejeitar.status === 200, 'atendente rejeita documento e pede novo envio');

    const visaoCidadao = await chamar('/portal/sessao', { token: tokenCidadaoA });
    const rejeitado = visaoCidadao.dados.documentos.find((d) => d.id === docsParaAnalise[1].id);
    verificar(
      rejeitado?.status === 'AGUARDANDO_NOVO_ENVIO' && Boolean(rejeitado?.motivoRejeicao),
      'cidadão vê o status e o motivo da rejeição',
    );

    const novoEnvio = await chamar(`/portal/documentos/${docsParaAnalise[1].id}/arquivos`, {
      metodo: 'POST',
      token: tokenCidadaoA,
      formulario: formularioArquivo('corrigido.png', PNG_1X1, 'image/png'),
    });
    verificar(novoEnvio.status === 201, 'cidadão reenvia o documento corrigido');
  }

  const orientacao = await chamar(`/sessoes/${sessaoA.id}/documentos/${docsParaAnalise[0].id}/orientacao`, {
    metodo: 'POST',
    token: tokenAtendente,
    corpo: { orientacao: 'Fotografe o documento aberto, sobre superfície plana e com boa iluminação.' },
  });
  verificar(orientacao.status === 200, 'atendente envia orientação ao cidadão');

  // -------------------------------------- arquivos do atendente para o cidadão
  secao('8. Arquivos disponibilizados pelo atendente');

  const envioAtendente = await chamar(`/sessoes/${sessaoA.id}/arquivos`, {
    metodo: 'POST',
    token: tokenAtendente,
    formulario: formularioArquivo('comprovante.pdf', PDF_SIMPLES, 'application/pdf', {
      titulo: 'Comprovante de protocolo',
      descricao: 'Guarde este comprovante para acompanhar o processo.',
    }),
  });
  verificar(envioAtendente.status === 201, 'atendente disponibiliza arquivo ao cidadão', `status ${envioAtendente.status}`);

  const visaoFinal = await chamar('/portal/sessao', { token: tokenCidadaoA });
  verificar(
    (visaoFinal.dados?.arquivosDoAtendente ?? []).length === 1,
    'arquivo do atendente aparece no portal do cidadão',
  );
  const arquivoAtendente = visaoFinal.dados.arquivosDoAtendente[0];

  const linkDownloadCidadao = await chamar(`/arquivos/${arquivoAtendente.id}/link`, {
    metodo: 'POST',
    token: tokenCidadaoA,
  });
  verificar(linkDownloadCidadao.status === 200, 'cidadão gera link do arquivo recebido');
  const baixado = await fetch(`${BASE}${linkDownloadCidadao.dados.url}&modo=download`);
  const bytes = Buffer.from(await baixado.arrayBuffer());
  verificar(
    baixado.status === 200 && bytes.subarray(0, 5).toString('latin1') === '%PDF-',
    'conteúdo baixado é íntegro após decifragem',
  );

  const linkOutroCidadao = await chamar(`/arquivos/${arquivoAtendente.id}/link`, {
    metodo: 'POST',
    token: tokenCidadaoB,
  });
  verificar(linkOutroCidadao.status === 403, 'arquivo do atendente não é alcançável por outro cidadão');

  // ---------------------------------------------- encerramento e revogação
  secao('9. Encerramento da sessão e revogação do acesso');

  const encerrar = await chamar(`/sessoes/${sessaoA.id}/encerrar`, {
    metodo: 'POST',
    token: tokenAtendente,
    corpo: { motivo: 'Documentação conferida no guichê.' },
  });
  verificar(encerrar.status === 200, 'atendente encerra o atendimento', `status ${encerrar.status}`);

  const aposEncerrar = await chamar(`/portal/documentos/${documentosA[0].id}/arquivos`, {
    metodo: 'POST',
    token: tokenCidadaoA,
    formulario: formularioArquivo('tardio.png', PNG_1X1, 'image/png'),
  });
  verificar(aposEncerrar.status === 409, 'sessão encerrada não aceita novos arquivos', `status ${aposEncerrar.status}`);

  const reabrirPorToken = await chamar('/portal/acesso', { metodo: 'POST', corpo: { token: tokenUrlA } });
  verificar(reabrirPorToken.status === 409, 'token de sessão encerrada não gera novo acesso', `status ${reabrirPorToken.status}`);

  const alterarEncerrada = await chamar(`/sessoes/${sessaoA.id}/documentos`, {
    metodo: 'POST',
    token: tokenAtendente,
    corpo: { nome: 'Documento depois do encerramento' },
  });
  verificar(alterarEncerrada.status === 409, 'sessão encerrada não aceita novos documentos', `status ${alterarEncerrada.status}`);

  // ------------------------------------------------------ auditoria e métricas
  secao('10. Auditoria e indicadores');

  const auditoria = await chamar('/admin/auditoria?porPagina=200', { token: tokenAdmin });
  const acoes = (auditoria.dados?.registros ?? []).map((r) => r.acao);
  verificar(auditoria.status === 200, 'administrador consulta a trilha de auditoria');
  verificar(acoes.includes('SESSAO_CRIADA'), 'criação de sessão foi auditada');
  verificar(acoes.includes('DOCUMENTOS_ENVIADOS'), 'envio do cidadão foi auditado');
  verificar(acoes.includes('ARQUIVO_LINK_GERADO'), 'geração de link de arquivo foi auditada');
  verificar(
    !JSON.stringify(auditoria.dados ?? {}).includes(CPF_A),
    'a auditoria não guarda o CPF em claro',
  );

  const auditoriaNegada = await chamar('/admin/auditoria', { token: tokenAtendente });
  verificar(auditoriaNegada.status === 403, 'atendente não acessa a auditoria');

  const indicadores = await chamar('/admin/indicadores', { token: tokenAdmin });
  verificar(
    indicadores.status === 200 && indicadores.dados?.sessoes?.total >= 2,
    'indicadores consolidam as sessões criadas',
  );
  verificar(
    indicadores.dados?.documentos?.enviados > 0,
    'indicadores contam os documentos enviados digitalmente',
  );

  // --------------------------------------------------------------- resultado
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Aprovados: ${passou}   Falhas: ${falhou}`);
  if (falhou) {
    console.log('\nFalhas:');
    for (const f of falhas) console.log(`  - ${f}`);
  }
  console.log('='.repeat(60));
  process.exit(falhou ? 1 : 0);
}

principal().catch((erroFatal) => {
  console.error('\nErro inesperado no teste:', erroFatal);
  process.exit(2);
});
