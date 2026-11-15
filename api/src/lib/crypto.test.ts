import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assinarLinkArquivo,
  cifrarArquivo,
  cifrarTexto,
  cpfValido,
  decifrarArquivo,
  decifrarTexto,
  gerarCodigoCurto,
  gerarTokenSessao,
  hashToken,
  hmacCpf,
  mascararCpf,
  normalizarCodigoCurto,
  verificarLinkArquivo,
} from './crypto';

test('validação de CPF aceita números válidos e rejeita inválidos', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('11144477735'), true);
  assert.equal(cpfValido('111.111.111-11'), false);
  assert.equal(cpfValido('529.982.247-26'), false);
  assert.equal(cpfValido('123'), false);
  assert.equal(cpfValido(''), false);
});

test('CPF cifrado volta íntegro e o mascarado não revela o número', () => {
  const cpf = '52998224725';
  const pacote = cifrarTexto(cpf);
  assert.equal(decifrarTexto(pacote), cpf);
  assert.ok(!pacote.toString('utf8').includes(cpf), 'o texto em claro não pode estar no pacote');

  const mascarado = mascararCpf(cpf);
  assert.equal(mascarado, '***.982.247-**');
  assert.ok(!mascarado.includes('529'));
});

test('HMAC do CPF é determinístico e diferente entre CPFs', () => {
  assert.equal(hmacCpf('529.982.247-25'), hmacCpf('52998224725'));
  assert.notEqual(hmacCpf('52998224725'), hmacCpf('11144477735'));
  assert.equal(hmacCpf('52998224725').length, 64);
});

test('conteúdo de arquivo é recuperado apenas com IV e tag corretos', () => {
  const original = Buffer.from('%PDF-1.4 conteudo de teste');
  const { conteudo, iv, tag } = cifrarArquivo(original);

  assert.notEqual(conteudo.toString('latin1'), original.toString('latin1'));
  assert.deepEqual(decifrarArquivo(conteudo, iv, tag), original);

  const tagAdulterada = Buffer.from(tag);
  tagAdulterada[0] ^= 0xff;
  assert.throws(() => decifrarArquivo(conteudo, iv, tagAdulterada));
});

test('token de sessão é imprevisível e armazenado por hash', () => {
  const a = gerarTokenSessao();
  const b = gerarTokenSessao();
  assert.notEqual(a, b);
  assert.ok(a.length >= 42, 'o token deve ter 256 bits de entropia');
  assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), hashToken(b));
});

test('código curto não usa caracteres ambíguos e normaliza a digitação', () => {
  for (let i = 0; i < 50; i += 1) {
    const codigo = gerarCodigoCurto();
    assert.match(codigo, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }
  assert.equal(normalizarCodigoCurto('abcd2345'), 'ABCD-2345');
  assert.equal(normalizarCodigoCurto('ABCD 2345'), 'ABCD-2345');
});

test('link de arquivo só vale para o próprio arquivo e expira', () => {
  const assinatura = assinarLinkArquivo('arquivo-1', 'servidor', 120);
  assert.equal(verificarLinkArquivo('arquivo-1', assinatura).valido, true);
  assert.equal(verificarLinkArquivo('arquivo-2', assinatura).valido, false);

  const expirada = assinarLinkArquivo('arquivo-1', 'servidor', -10);
  assert.equal(verificarLinkArquivo('arquivo-1', expirada).valido, false);

  assert.equal(verificarLinkArquivo('arquivo-1', 'lixo.servidor.invalido').valido, false);
  assert.equal(verificarLinkArquivo('arquivo-1', '').valido, false);
});
