/* =========================================================
   Estoque de Modeladores — aplicativo
   Sem dependências além do Chart.js (gráficos).
   ========================================================= */
(() => {
'use strict';

const CFG = window.CONFIG || {};
const TZ = 'America/Sao_Paulo';
const MOTIVOS_ENTRADA = ['Compra de fornecedor', 'Consignação recebida', 'Devolução de paciente', 'Troca recebida', 'Outro'];
const MOTIVOS_SAIDA = ['Venda à paciente', 'Incluído no pacote cirúrgico', 'Cortesia', 'Troca', 'Perda / avaria', 'Uso interno', 'Devolução ao fornecedor'];
// Próteses mamárias
const ehProtese = (tipo) => /^pr[óo]tese/i.test(tipo || '');
const P_FORMATOS = ['Redonda', 'Anatômica'];
const P_PERFIS = ['Perfil baixo', 'Perfil moderado', 'Perfil alto', 'Perfil extra alto', 'Perfil super alto'];
const P_SUPERFICIES = ['Texturizada', 'Microtexturizada', 'Nanotexturizada', 'Lisa', 'Poliuretano'];
const MOTIVOS_VENDA = ['Venda à paciente', 'Incluído no pacote cirúrgico'];
const MOTIVOS_PACIENTE = ['Venda à paciente', 'Incluído no pacote cirúrgico', 'Cortesia', 'Troca', 'Implantada na paciente'];
const MOTIVOS_SAIDA_PROTESE = ['Implantada na paciente', 'Troca', 'Devolução ao fornecedor', 'Perda / avaria'];
const MOTIVOS_PERDA = ['Cortesia', 'Perda / avaria', 'Uso interno', 'Troca'];
const IDLE_MIN = 30;

const S = { token: null, user: null, produtos: [], listas: {}, pendentes: 0 };
const $app = document.getElementById('app');

/* ---------------- utilidades ---------------- */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brlF = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n) => brlF.format(Number(n) || 0);
const numF = new Intl.NumberFormat('pt-BR');
const nf = (n) => numF.format(Number(n) || 0);
const pctF = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const pct = (n) => (isFinite(n) ? pctF.format(n) : '—');
const dtF = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dF = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const hF = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dt = (s) => (s ? dtF.format(new Date(s)) : '');
const dOnly = (s) => (s ? (s.length === 10 ? s.split('-').reverse().join('/') : dF.format(new Date(s))) : '');
const hora = (s) => (s ? hF.format(new Date(s)) : '');
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const isoShift = (iso, { d = 0, m = 0 } = {}) => {
  const [y, mo, da] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + m, da + d));
  return x.toISOString().slice(0, 10);
};
const inicioMes = (iso) => iso.slice(0, 8) + '01';
const fimMes = (iso) => isoShift(inicioMes(isoShift(inicioMes(iso), { m: 1 })), { d: -1 });
const parseNum = (v) => {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
};
const money2 = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(2).replace('.', ','));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isAdmin = () => S.user && S.user.perfil === 'admin';
const isGerente = () => S.user && S.user.perfil === 'gerente';   // gerente de estoque: tudo do estoque, sem custos/lucro
const isGestor = () => isAdmin() || isGerente();
const PERFIS = { admin: 'Administrador', gerente: 'Gerente de estoque', operador: 'Operador' };
const nomePerfil = (p) => PERFIS[p] || p;
// admin, ou operador com liberação temporária para cadastrar produtos novos
const liberadoAte = () => (S.user && S.user.perfil === 'operador' && S.user.cadastro_ate && new Date(S.user.cadastro_ate) > new Date() ? new Date(S.user.cadastro_ate) : null);
const podeCadastrar = () => !!S.user; // todos cadastram e editam produtos (custo só o administrador)
// Orientações por tipo de produto (aparecem no cadastro e nas telas de entrada/saída)
const ehPorPar = (tipo) => /lateral|flanco/i.test(tipo || '') && /placa/i.test(tipo || '');
const unidade = (p, n) => (p && ehPorPar(p.tipo) ? (n === 1 ? 'par' : 'pares') : (n === 1 ? 'unidade' : 'unidades'));
const unid = (p) => (p && ehPorPar(p.tipo) ? 'par(es)' : 'un.');
function dicaTipo(tipo) {
  const t = String(tipo || '');
  if (ehProtese(t)) return { modelo: 'Ex.: Lumina', dica: 'Prótese: cada unidade é controlada pelo nº de série e lote (registrados na Entrada). Sem valores: a prótese é paga pela paciente. Cadastre um item por volume — pode digitar vários volumes de uma vez.' };
  if (/^meia/i.test(t)) return { modelo: 'Ex.: Meia coxa antitrombo', dica: 'A clínica usa um modelo de meia: Meia coxa antitrombo. Para um tamanho novo, repita o mesmo Modelo e marque o tamanho.' };
  if (ehPorPar(t)) return { modelo: 'Ex.: Rígida reta 26 x 10 cm  ou  Flexível 26 x 10 cm', dica: 'Placa lateral vem em PAR: o estoque conta pares (1 = 1 par). No Modelo, escreva se é rígida ou flexível e a medida.', unico: true };
  if (/^placa/i.test(t)) return { modelo: 'Ex.: Coração rígida 35 x 28 cm  ou  Flexível oval', dica: 'No Modelo, escreva se a placa é rígida ou flexível e a medida. Tamanho: Único.', unico: true };
  if (/^espuma/i.test(t)) return { modelo: 'Ex.: Espuma abdominal 30 x 40 cm', dica: 'No Modelo, escreva a região e a medida. Tamanho: Único.', unico: true };
  return { modelo: 'Ex.: Abdominal 3 fechos', dica: '' };
}
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

/* ---------------- ícones ---------------- */
const ICON = {
  saida: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  entrada: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  estoque: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  hoje: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  painel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  produtos: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  estornos: '<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/>',
  relatorios: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  usuarios: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M17 11a3 3 0 100-6M22 21a5 5 0 00-4-4.9"/>',
  auditoria: '<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  proteses: '<path d="M4 15c0-4 3.5-8 8-8s8 4 8 8"/><path d="M4 15c1.5 2 4.5 3 8 3s6.5-1 8-3"/><circle cx="12" cy="12.5" r="1.2"/>',
  camera: '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16.5 8v8"/>',
  etiquetas: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  sair: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;

/* ---------------- avisos e janelas ---------------- */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
}

function modal(title, bodyHtml, { onMount, onClose, wide } = {}) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="max-width:900px"' : ''}>
    <div class="modal-head no-print"><h2>${esc(title)}</h2><button class="x" data-x aria-label="Fechar">×</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`;
  let fechado = false;
  const close = () => {
    if (fechado) return; fechado = true;
    back.remove(); document.body.classList.remove('imprimir-modal'); document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-x]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(back);
  const body = back.querySelector('.modal-body');
  if (onMount) onMount(body, close);
  const first = body.querySelector('input:not([type=hidden]),select,textarea');
  if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  return close;
}

function confirmar(title, msg, { ok = 'Confirmar', kind = 'primary', campo } = {}) {
  return new Promise((resolve) => {
    let valor = false;
    modal(title, `<p>${msg}</p>
      ${campo ? `<div class="field"><label for="cf-campo">${esc(campo)}</label><textarea id="cf-campo"></textarea></div>` : ''}
      <div class="btn-row end"><button class="btn" data-c>Cancelar</button><button class="btn ${kind}" data-ok>${esc(ok)}</button></div>`, {
      onClose: () => resolve(valor),
      onMount(b, cl) {
        b.querySelector('[data-c]').onclick = () => cl();
        b.querySelector('[data-ok]').onclick = () => {
          const v = campo ? b.querySelector('#cf-campo').value.trim() : true;
          if (campo && !v) { toast('Preencha o campo para continuar.', 'err'); return; }
          valor = v; cl();
        };
      },
    });
  });
}

/* ---------------- API (Supabase RPC) ---------------- */
class ApiError extends Error {}

async function rpc(fn, args = {}, { auth = true } = {}) {
  const url = CFG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn;
  const headers = { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY };
  if (CFG.SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + CFG.SUPABASE_KEY;
  const body = auth ? { p_token: S.token, ...args } : args;
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) {
    const msg = (data && data.message) || ('Erro ' + r.status);
    if (msg === 'SESSAO_EXPIRADA') { sair('Sua sessão expirou. Entre novamente.'); throw new ApiError('Sessão expirada.'); }
    if (msg === 'TROCAR_SENHA') { S.user.trocar_senha = true; render(); throw new ApiError('Troque sua senha para continuar.'); }
    if (r.status === 404) throw new ApiError('Função do banco não encontrada. Rode o arquivo supabase/schema.sql no Supabase.');
    if (r.status === 401 || r.status === 403) throw new ApiError('Chave do Supabase inválida. Confira o arquivo js/config.js.');
    throw new ApiError(msg);
  }
  return data;
}

async function tentar(fn, btn) {
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.innerHTML; btn.innerHTML = 'Aguarde…'; }
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'err'); return undefined; }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.txt; } }
}

// Cópia local (neste aparelho) dos produtos e listas: as telas abrem na hora e se atualizam em seguida
const CACHE_KEY = 'estoque_cache_v1';
function salvarCache() {
  if (!S.user || !S.carregado) return;
  storage.set(CACHE_KEY, JSON.stringify({ uid: S.user.id, user: S.user, produtos: S.produtos, listas: S.listas, pendentes: S.pendentes, t: Date.now() }));
}
function lerCache() {
  try { const c = JSON.parse(storage.get(CACHE_KEY) || 'null'); return c && c.user && Array.isArray(c.produtos) ? c : null; } catch { return null; }
}
let aoAtualizarDados = null; // a tela aberta registra como se redesenhar quando chegam dados novos
function avisarTela() { if (aoAtualizarDados) { try { aoAtualizarDados(); } catch { /* tela já fechou */ } } }

// Uma consulta só: usuário + produtos + listas + estornos pendentes
async function carregarBase() {
  const r = await rpc('inicio');
  if (!r || !S.user) return;
  Object.assign(S.user, r.usuario || {});
  if (r.usuario && r.usuario.trocar_senha) return;
  S.produtos = r.produtos || [];
  S.listas = r.listas || {};
  S.pendentes = r.pendentes || 0;
  S.carregado = Date.now();
  ultimaVerificacao = Date.now(); agendarFimPrazo();
  salvarCache();
}
async function recarregarProdutos() { S.produtos = (await rpc('produtos')) || []; S.carregado = Date.now(); salvarCache(); avisarTela(); }
// Se já há dados, a tela abre na hora e os produtos se atualizam em segundo plano
async function produtosRapido() {
  if (S.carregado) { if (Date.now() - S.carregado > 5000) recarregarProdutos().catch(() => {}); return; }
  await recarregarProdutos();
}

/* ---------------- sessão ---------------- */
let idleTimer = null;
function marcarAtividade() {
  if (!S.token) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => sair('Você ficou 30 minutos sem usar o sistema e foi desconectado.'), IDLE_MIN * 60 * 1000);
}
['click', 'keydown', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, marcarAtividade, { passive: true }));

async function sair(msg) {
  const t = S.token;
  S.token = null; S.user = null;
  storage.del('estoque_token'); storage.del(CACHE_KEY);
  S.produtos = []; S.listas = {}; S.carregado = 0;
  clearTimeout(idleTimer);
  document.getElementById('modal-root').innerHTML = '';
  if (t) rpc('logout', { p_token: t }, { auth: false }).catch(() => {});
  telaLogin(msg);
}

/* ---------------- telas de entrada ---------------- */
function telaConfig() {
  $app.innerHTML = `<div class="login-wrap"><div class="login-card" style="max-width:560px">
    <div class="brand"><div class="brand-mark">EM</div><div><div class="brand-title">Estoque de Modeladores</div><div class="brand-sub">Configuração pendente</div></div></div>
    <div class="warn-box">O aplicativo ainda não está ligado ao banco de dados.</div>
    <ol>
      <li>Crie um projeto gratuito em <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
      <li>No Supabase, abra <b>SQL Editor</b>, cole o conteúdo de <code>supabase/schema.sql</code> e clique em <b>Run</b>.</li>
      <li>Copie a <b>URL</b> e a <b>chave pública</b> (Project Settings › API) para o arquivo <code>js/config.js</code>.</li>
    </ol>
    <p class="muted small">O passo a passo completo está no arquivo README.md do repositório.</p>
  </div></div>`;
}

function telaLogin(msg) {
  $app.innerHTML = `<div class="login-wrap"><form class="login-card" id="f-login" autocomplete="on">
    <div class="brand"><div class="brand-mark">EM</div><div><div class="brand-title">Estoque de Modeladores</div><div class="brand-sub">${esc(CFG.CLINICA || '')}</div></div></div>
    ${msg ? `<div class="info-box">${esc(msg)}</div>` : ''}
    <div id="login-erro"></div>
    <div class="field"><label for="l-user">Usuário</label><input id="l-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
    <div class="field"><label for="l-pass">Senha</label><div class="pass-wrap"><input id="l-pass" type="password" autocomplete="current-password" required><button type="button" id="l-show">Mostrar</button></div></div>
    <button class="btn primary block big" type="submit">Entrar</button>
  </form></div>`;
  const f = document.getElementById('f-login');
  document.getElementById('l-show').onclick = (e) => {
    const p = document.getElementById('l-pass');
    p.type = p.type === 'password' ? 'text' : 'password';
    e.target.textContent = p.type === 'password' ? 'Mostrar' : 'Ocultar';
  };
  document.getElementById('l-user').focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const res = await tentar(() => rpc('login', { p_login: f.querySelector('#l-user').value, p_senha: f.querySelector('#l-pass').value }, { auth: false }), btn);
    if (!res) return;
    if (!res.ok) { document.getElementById('login-erro').innerHTML = `<div class="erro-box">${esc(res.erro)}</div>`; f.querySelector('#l-pass').select(); return; }
    S.token = res.token;
    S.user = { id: res.id, nome: res.nome, login: res.login, perfil: res.perfil, trocar_senha: res.trocar_senha };
    storage.set('estoque_token', S.token);
    marcarAtividade();
    await iniciar();
  };
}

function telaTrocarSenha(obrigatoria) {
  const html = `<form id="f-senha">
    ${obrigatoria ? '<div class="info-box">Por segurança, crie uma senha nova antes de continuar.</div>' : ''}
    <div class="field"><label for="s-atual">Senha atual</label><input id="s-atual" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="s-nova">Nova senha</label><input id="s-nova" type="password" autocomplete="new-password" minlength="6" required><span class="hint">Pelo menos 6 caracteres.</span></div>
    <div class="field"><label for="s-conf">Repita a nova senha</label><input id="s-conf" type="password" autocomplete="new-password" required></div>
    <button class="btn primary block big" type="submit">Salvar nova senha</button>
    ${obrigatoria ? '<button class="btn ghost block" type="button" id="s-sair" style="margin-top:10px">Sair</button>' : ''}
  </form>`;
  const bind = (root, close) => {
    const f = root.querySelector('#f-senha');
    const s = root.querySelector('#s-sair'); if (s) s.onclick = () => sair();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const nova = f.querySelector('#s-nova').value;
      if (nova !== f.querySelector('#s-conf').value) { toast('As senhas novas não são iguais.', 'err'); return; }
      const ok = await tentar(async () => { await rpc('trocar_senha', { p_senha_atual: f.querySelector('#s-atual').value, p_senha_nova: nova }); return true; }, f.querySelector('[type=submit]'));
      if (!ok) return;
      toast('Senha alterada.', 'ok');
      S.user.trocar_senha = false;
      if (close) close(); else iniciar();
    };
  };
  if (obrigatoria) {
    $app.innerHTML = `<div class="login-wrap"><div class="login-card"><div class="brand"><div class="brand-mark">EM</div><div><div class="brand-title">Nova senha</div><div class="brand-sub">${esc(S.user.nome)}</div></div></div>${html}</div></div>`;
    bind($app);
  } else {
    modal('Trocar minha senha', html, { onMount: bind });
  }
}

/* ---------------- estrutura e navegação ---------------- */
const NAV_OPER = [
  ['saida', 'Saída'], ['entrada', 'Entrada'], ['estoque', 'Estoque'], ['proteses', 'Próteses'], ['hoje', 'Lançamentos'], ['produtos', 'Produtos'],
];
const NAV_ADMIN = [
  ['painel', 'Painel'], ['saida', 'Saída'], ['entrada', 'Entrada'], ['estoque', 'Estoque'],
  ['proteses', 'Próteses'], ['hoje', 'Lançamentos'], ['relatorios', 'Relatórios'], ['produtos', 'Produtos'], ['etiquetas', 'Etiquetas'], ['estornos', 'Estornos'],
  ['usuarios', 'Usuários'], ['auditoria', 'Auditoria'], ['config', 'Configurações'],
];
const NAV_GERENTE = [
  ['estoque', 'Estoque'], ['saida', 'Saída'], ['entrada', 'Entrada'], ['proteses', 'Próteses'],
  ['hoje', 'Lançamentos'], ['produtos', 'Produtos'], ['etiquetas', 'Etiquetas'], ['estornos', 'Estornos'], ['relatorios', 'Relatórios'],
];
const ROTAS = {};
const navAtual = () => (isAdmin() ? NAV_ADMIN : isGerente() ? NAV_GERENTE : NAV_OPER);
const rotaInicial = () => (isAdmin() ? 'painel' : isGerente() ? 'estoque' : 'saida');
const rotaAtual = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || rotaInicial());

function shell() {
  const nav = navAtual();
  const r = rotaAtual();
  const badge = (k) => (k === 'estornos' && S.pendentes ? ` <span class="badge count">${S.pendentes}</span>` : '');
  const bottom = nav.length > 6 ? nav.slice(0, 4) : nav;
  $app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">EM</div><div style="min-width:0"><div class="brand-title">Estoque de Modeladores</div><div class="brand-sub">${esc(CFG.CLINICA || '')}</div></div></div>
      <div class="spacer"></div>
      <div class="user-chip"><div class="who"><b>${esc(S.user.nome)}</b><span>${esc(nomePerfil(S.user.perfil))}</span></div>
        <button class="btn sm" id="b-senha" title="Trocar senha">Senha</button>
        <button class="btn sm" id="b-sair">${icon('sair')}Sair</button></div>
    </header>
    <div class="layout">
      <nav class="sidenav" aria-label="Menu"></nav>
      <main class="content" id="content"></main>
    </div>
    <nav class="bottomnav" aria-label="Menu"></nav>
  </div>`;
  desenharNav();
  document.getElementById('b-sair').onclick = () => sair();
  document.getElementById('b-senha').onclick = () => telaTrocarSenha(false);
}

// (re)desenha só os menus, sem mexer na tela aberta
function desenharNav() {
  const side = document.querySelector('.sidenav'), bot = document.querySelector('.bottomnav');
  if (!side || !bot) return;
  const nav = navAtual();
  const r = rotaAtual();
  const badge = (k) => (k === 'estornos' && S.pendentes ? ` <span class="badge count">${S.pendentes}</span>` : '');
  const bottom = nav.length > 6 ? nav.slice(0, 4) : nav;
  side.innerHTML = nav.map(([k, t]) => `<a href="#/${k}" class="${r === k ? 'on' : ''}">${icon(k)}${t}${badge(k)}</a>`).join('');
  bot.innerHTML = bottom.map(([k, t]) => `<a href="#/${k}" class="${r === k ? 'on' : ''}">${icon(k)}${t}</a>`).join('')
    + (nav.length > 6 ? `<button id="b-mais" class="${bottom.some(([k]) => k === r) ? '' : 'on'}">${icon('menu')}Mais${S.pendentes ? ` <span class="badge count" style="font-size:.7rem">${S.pendentes}</span>` : ''}</button>` : '');
  const mais = document.getElementById('b-mais');
  if (mais) mais.onclick = () => {
    const back = document.createElement('div'); back.className = 'drawer-back';
    const dr = document.createElement('div'); dr.className = 'drawer';
    dr.innerHTML = '<div class="grab"></div>' + nav.slice(4).map(([k, t]) => `<a href="#/${k}" class="${r === k ? 'on' : ''}">${icon(k)}${t}${badge(k)}</a>`).join('');
    const fechar = () => { back.remove(); dr.remove(); };
    back.onclick = fechar; dr.onclick = (e) => { if (e.target.closest('a')) fechar(); };
    document.body.append(back, dr);
  };
}

// Operador: confere se a liberação de cadastro mudou (ao usar o app, ao voltar para ele e quando o prazo vence)
let ultimaVerificacao = 0, timerPrazo = null;
async function verificarLiberacao(forcar = false) {
  return; // liberação temporária não é mais necessária: todos cadastram produtos
  // eslint-disable-next-line no-unreachable
  if (!S.user || S.user.perfil !== 'operador' || S.user.trocar_senha) return;
  if (!forcar && Date.now() - ultimaVerificacao < 60000) return;
  ultimaVerificacao = Date.now();
  const antes = podeCadastrar();
  try { Object.assign(S.user, await rpc('sessao')); } catch { return; }
  agendarFimPrazo();
  if (antes === podeCadastrar()) return;
  if (!navAtual().some(([k]) => k === rotaAtual())) { render(); return; }
  desenharNav();
  toast(podeCadastrar() ? 'Cadastro de produtos liberado para você (menu Produtos).' : 'A liberação de cadastro de produtos terminou.', podeCadastrar() ? 'ok' : '');
}
function agendarFimPrazo() {
  clearTimeout(timerPrazo);
  const ate = liberadoAte();
  if (ate) timerPrazo = setTimeout(() => verificarLiberacao(true), Math.min(ate - Date.now() + 1500, 2 ** 31 - 1));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarLiberacao(true); });
['click', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => verificarLiberacao(), { passive: true }));

async function render() {
  if (!S.user) return telaLogin();
  if (S.user.trocar_senha) return telaTrocarSenha(true);
  const r = rotaAtual();
  // operador: a tela Produtos depende da liberação, então confere na hora; nas outras, em segundo plano
  if (!S.user) return;
  const permitido = navAtual().some(([k]) => k === r);
  if (!permitido) { location.hash = '#/' + rotaInicial(); return; }
  aoLerCodigo = null; aoAtualizarDados = null; // a tela nova registra os seus
  shell();
  const el = document.getElementById('content');
  el.innerHTML = '<div class="carregando">Carregando…</div>';
  window.scrollTo(0, 0);
  try { await ROTAS[r](el); }
  catch (e) { if (!(e instanceof ApiError && /Sessão expirada|Troque sua senha/.test(e.message))) el.innerHTML = `<div class="erro-box">${esc(e.message || e)}</div>`; }
}
window.addEventListener('hashchange', () => { if (S.user) render(); });

async function iniciar() {
  if (S.user && S.user.trocar_senha) return render();
  try { await carregarBase(); } catch (e) { if (S.user) toast(e.message, 'err'); }
  render();
}

/* =========================================================
   LEITURA DE CÓDIGOS
   - câmera do celular/iPad (código de barras e QR code)
   - leitor de mão USB/Bluetooth (funciona como teclado: digita o código e aperta Enter)
   ========================================================= */
const LIBS = {
  leitor: 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  qr: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
};
const scriptsCarregando = {};
function carregarScript(url) {
  if (!scriptsCarregando[url]) {
    scriptsCarregando[url] = new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = url; s.async = true; s.onload = ok;
      s.onerror = () => { delete scriptsCarregando[url]; erro(new Error('Não foi possível carregar o leitor. Verifique a internet.')); };
      document.head.appendChild(s);
    });
  }
  return scriptsCarregando[url];
}

const limpaCodigo = (c) => String(c ?? '').trim().replace(/\s+/g, '');
function produtoPorCodigo(cod) {
  const g = lerGS1(cod);
  const c = limpaCodigo(g ? g.gtin : cod); if (!c) return null;
  const cu = c.toUpperCase();
  const semZeros = (x) => (/^\d+$/.test(x) ? x.replace(/^0+/, '') : x); // EAN-13 = GTIN-14 com zero à esquerda
  return S.produtos.find((p) => p.codigo_barras && p.codigo_barras === c)
    || S.produtos.find((p) => p.codigo_barras && /^\d+$/.test(c) && semZeros(p.codigo_barras) === semZeros(c))
    || S.produtos.find((p) => p.sku && p.sku.toUpperCase() === cu)
    || null;
}

// Código GS1 das embalagens (DataMatrix / GS1-128): (01) GTIN · (17) validade AAMMDD · (10) lote · (21) nº de série
function lerGS1(txt) {
  let s = String(txt ?? '').trim().replace(/^\](d2|C1|Q3|e0)/, '');
  if (!s) return null;
  const GS = '\x1d';
  const out = {}; let incerto = false;
  if (/^\(\d{2,4}\)/.test(s)) {
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]] = m[2].replace(/\x1d/g, '').trim();
  } else {
    s = s.replace(/[\x1d|]/g, GS); // alguns leitores trocam o separador por '|'
    if (!/^(01|02)\d{14}/.test(s)) return null;
    const fixo = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
    const variavel = ['10', '21', '22', '30', '37', '90', '91', '92', '240', '241', '250', '251'];
    const temGS = s.includes(GS);
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const ai2 = s.substr(i, 2), ai3 = s.substr(i, 3);
      if (fixo[ai2]) { out[ai2] = s.substr(i + 2, fixo[ai2]); i += 2 + fixo[ai2]; continue; }
      const ai = variavel.includes(ai3) ? ai3 : variavel.includes(ai2) ? ai2 : null;
      if (!ai) break;
      let fim = s.indexOf(GS, i + ai.length); if (fim < 0) fim = s.length;
      let v = s.slice(i + ai.length, fim);
      if (!temGS) { // sem separador: tenta achar onde começa o próximo campo
        const m = v.match(/^(.{3,}?)(17\d{6}|21.{3,}|10.{2,})$/);
        if (m && !(m[2].slice(0, 2) in out) && m[2].slice(0, 2) !== ai) { v = m[1]; fim = i + ai.length + m[1].length; incerto = true; }
      }
      out[ai] = v; i = fim;
    }
  }
  const gtin = out['01'] || out['02'];
  if (!gtin) return null;
  let validade = null;
  if (/^\d{6}$/.test(out['17'] || '')) {
    const a = 2000 + Number(out['17'].slice(0, 2)), m = Number(out['17'].slice(2, 4)); let d = Number(out['17'].slice(4, 6));
    if (!d) d = new Date(Date.UTC(a, m, 0)).getUTCDate(); // dia 00 = último dia do mês
    validade = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return { gtin, lote: out['10'] || '', serie: out['21'] || '', validade, incerto };
}

function bip() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ctx = bip.ctx || (bip.ctx = new Ctx());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1750; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.09);
  } catch { /* sem som */ }
  try { if (navigator.vibrate) navigator.vibrate(60); } catch { /* sem vibração */ }
}

// Abre a câmera e devolve o texto lido (ou null se cancelar)
function lerCodigoCamera(titulo = 'Ler código') {
  return new Promise((resolve) => {
    let leitor = null, resultado = null, fechado = false;
    const pararCamera = async () => {
      const l = leitor; leitor = null;
      if (!l) return;
      try { await l.stop(); } catch { /* já parado */ }
      try { l.clear(); } catch { /* idem */ }
    };
    modal(titulo, `<p class="leitor-dica">Aponte a câmera para o <b>código de barras</b> ou <b>QR code</b>.</p>
      <div id="leitor-cam" class="leitor-cam"><div class="carregando" style="color:#fff">Abrindo a câmera…</div></div>
      <div id="leitor-erro"></div>
      <form id="leitor-manual" class="leitor-manual" autocomplete="off">
        <label for="lm-cod">Ou digite o código (ou use o leitor de mão)</label>
        <div class="busca-linha"><input id="lm-cod" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn primary" type="submit">OK</button></div>
      </form>
      <div class="btn-row end" style="margin-top:12px"><button type="button" class="btn" data-x>Cancelar</button></div>`, {
      onClose: () => { fechado = true; pararCamera(); resolve(resultado); },
      async onMount(b, close) {
        const terminar = (txt) => {
          if (resultado !== null || fechado) return;
          resultado = limpaCodigo(txt); bip(); close();
        };
        b.querySelector('#leitor-manual').onsubmit = (e) => { e.preventDefault(); const v = b.querySelector('#lm-cod').value; if (limpaCodigo(v)) terminar(v); };
        const cam = b.querySelector('#leitor-cam');
        try {
          if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Este navegador não liberou a câmera para o site.');
          }
          await carregarScript(LIBS.leitor);
          if (fechado) return;
          const F = window.Html5QrcodeSupportedFormats;
          cam.innerHTML = '';
          const l = new window.Html5Qrcode('leitor-cam', {
            verbose: false,
            formatsToSupport: [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.DATA_MATRIX],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          });
          leitor = l;
          await l.start({ facingMode: 'environment' }, {
            fps: 12,
            qrbox: (w, h) => ({ width: Math.max(120, Math.floor(Math.min(w * 0.88, 460))), height: Math.max(80, Math.floor(Math.min(h * 0.6, 240))) }),
          }, (txt) => terminar(txt), () => {});
          if (fechado) pararCamera();
        } catch (e) {
          const nome = String((e && (e.name || e.message)) || e);
          const msg = /NotAllowed|Permission|denied/i.test(nome)
            ? 'A câmera foi bloqueada. Para liberar: no iPhone/iPad vá em Ajustes › Safari › Câmera › Permitir; no Android toque no cadeado ao lado do endereço › Permissões › Câmera.'
            : /NotFound|Requested device|no camera|Overconstrained/i.test(nome) ? 'Nenhuma câmera encontrada neste aparelho.'
            : /NotReadable|in use|Could not start/i.test(nome) ? 'A câmera está sendo usada por outro aplicativo. Feche-o e tente de novo.'
            : (e && e.message) || 'Não foi possível abrir a câmera.';
          leitor = null;
          cam.classList.add('hidden');
          b.querySelector('#leitor-erro').innerHTML = `<div class="warn-box">${esc(msg)}<br>Você pode digitar o código abaixo.</div>`;
          b.querySelector('#lm-cod').focus();
        }
      },
    });
  });
}

// Leitor de mão (USB/Bluetooth): caracteres digitados muito rápido + Enter, fora de campos de texto
let aoLerCodigo = null; // cada tela registra o que fazer com o código lido
const wedge = { buf: '', ultimo: 0, inicio: 0 };
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const agora = performance.now();
  if (e.key === 'Enter') {
    const ok = wedge.buf.length >= 4 && (agora - wedge.inicio) < wedge.buf.length * 50 + 150;
    const cod = wedge.buf; wedge.buf = '';
    if (ok && aoLerCodigo && !document.querySelector('.modal-back')) { e.preventDefault(); bip(); aoLerCodigo(cod); }
    return;
  }
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  if (agora - wedge.ultimo > 80) { wedge.buf = ''; wedge.inicio = agora; }
  wedge.buf += e.key; wedge.ultimo = agora;
});

// volumes de prótese digitados ("250 275 300") → [250, 275, 300]
const volumesDe = (txt) => [...new Set((String(txt || '').match(/\d{2,4}/g) || []).map(Number))].filter((v) => v >= 50 && v <= 1500).sort((x, y) => x - y);

// Código lido que não está cadastrado
function codigoNaoCadastrado(cod, aoVincular) {
  if (!podeCadastrar()) {
    modal('Código não cadastrado', `<p class="leitor-dica">O código <b class="codigo-grande">${esc(cod)}</b> não está cadastrado em nenhum produto.</p>
      <p>Peça ao administrador para cadastrar este código, ou procure o produto pelo nome.</p>
      <div class="btn-row end"><button class="btn primary" data-x>Entendi</button></div>`);
    return;
  }
  modal('Código não cadastrado', `<p class="leitor-dica">O código <b class="codigo-grande">${esc(cod)}</b> ainda não está em nenhum produto.</p>
    <p>Este é o código de barras de qual produto?</p>
    <div class="field"><div id="vinc-pk"></div></div>
    <div class="btn-row end"><button type="button" class="btn" data-x>Cancelar</button><button type="button" class="btn" id="vinc-novo">Cadastrar produto novo</button><button type="button" class="btn primary" id="vinc-ok" disabled>Gravar código neste produto</button></div>`, {
    onMount(b, close) {
      const okBtn = b.querySelector('#vinc-ok');
      const pk = seletorProduto(b.querySelector('#vinc-pk'), { semLeitor: true, onChange: (p) => { okBtn.disabled = !p; } });
      okBtn.onclick = async () => {
        const p = pk.get(); if (!p) return;
        if (p.codigo_barras && !isGestor()) { toast('Este produto já tem outro código de barras. Somente o administrador ou o gerente podem trocar.', 'err'); return; }
        if (p.codigo_barras && !(await confirmar('Trocar código', `Este produto já tem o código ${esc(p.codigo_barras)}. Trocar por ${esc(cod)}?`, { ok: 'Trocar' }))) return;
        const r = await tentar(() => rpc('vincular_codigo', { p_produto: p.id, p_codigo: cod }), okBtn);
        if (!r) return;
        toast('Código gravado no produto.', 'ok'); close();
        await recarregarProdutos();
        if (aoVincular) aoVincular(produtoPorCodigo(cod));
      };
      b.querySelector('#vinc-novo').onclick = () => { close(); formProduto(null, () => { const p = produtoPorCodigo(cod); if (p && aoVincular) aoVincular(p); }, { codigo_barras: cod }); };
    },
  });
}

// Botão "Ler código" (câmera)
const botaoCamera = (attr = 'data-cam') => `<button type="button" class="btn cam" ${attr} aria-label="Ler código pela câmera">${icon('camera')}<span>Ler código</span></button>`;

/* =========================================================
   SELETOR DE PRODUTO (usado em entrada, saída e ajustes)
   ========================================================= */
function seletorProduto(container, { onChange, exigeSaldo = false, semLeitor = false, onUnidade, codigoSemProduto, bloquearTroca } = {}) {
  let escolhido = null;
  // aplica um código lido (câmera, leitor de mão ou digitado + Enter)
  // onUnidade(produto, gs1|null, codigo): a tela trata série/lote/validade (próteses)
  // codigoSemProduto(codigo, gs1): a tela tenta outra coisa (ex.: nº de série) antes do "não cadastrado"
  const usarProduto = (p, g, cod) => {
    if (!p.ativo) { toast(`${p.nome} está inativo.`, 'err'); return; }
    if (exigeSaldo && p.saldo <= 0) { toast(`Sem estoque de ${p.nome}.`, 'err'); return; }
    if (!escolhido || escolhido.id !== p.id) {
      const msg = escolhido && bloquearTroca && bloquearTroca(p);
      if (msg) { toast(msg, 'err'); return; }
      escolhido = p; desenhar(); onChange && onChange(p); if (!g) toast(p.nome, 'ok');
    }
    if (onUnidade) onUnidade(p, g, cod);
  };
  const aplicarCodigo = async (cod) => {
    const g = lerGS1(cod);
    const p = produtoPorCodigo(cod);
    if (p) { usarProduto(p, g, cod); return; }
    if (codigoSemProduto && await codigoSemProduto(limpaCodigo(cod), g)) return;
    codigoNaoCadastrado(limpaCodigo(g ? g.gtin : cod), (np) => { if (np) usarProduto(np, g, cod); });
  };
  if (!semLeitor) aoLerCodigo = (cod) => { if (container.isConnected) aplicarCodigo(cod); };
  if (!semLeitor) aoAtualizarDados = () => {
    if (!container.isConnected) return;
    if (escolhido) { const n = S.produtos.find((x) => x.id === escolhido.id); if (n) { escolhido = n; desenhar(); } return; }
    const i = container.querySelector('input'); if (i) i.dispatchEvent(new Event('input'));
  };
  const desenhar = () => {
    if (escolhido) {
      const p = escolhido;
      container.innerHTML = `<div class="picked"><div class="main"><div class="title">${esc(p.nome)}</div>
        <div class="meta small muted">${esc(p.sku)}${p.marca ? ' · ' + esc(p.marca) : ''} · Em estoque: <b>${nf(p.saldo)} ${unidade(p, p.saldo)}</b></div></div>
        <button type="button" class="btn sm" data-trocar>Trocar</button></div>`;
      container.querySelector('[data-trocar]').onclick = () => { escolhido = null; desenhar(); onChange && onChange(null); container.querySelector('input').focus(); };
      return;
    }
    container.innerHTML = `<div class="busca-linha"><input type="search" placeholder="Buscar produto" aria-label="Buscar produto por nome, tamanho ou código" autocomplete="off" enterkeyhint="search">${semLeitor ? '' : botaoCamera()}</div>
      <div class="picker-results"></div>`;
    const inp = container.querySelector('input');
    const cam = container.querySelector('[data-cam]');
    if (cam) cam.onclick = async () => { const cod = await lerCodigoCamera(); if (cod) aplicarCodigo(cod); };
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = limpaCodigo(inp.value); if (!v) return;
      if (produtoPorCodigo(v) || lerGS1(v)) { aplicarCodigo(v); return; }
      const itens = [...res.querySelectorAll('.pick-item:not([disabled])')];
      if (itens.length === 1) { itens[0].click(); return; }
      if (/^[0-9]{6,}$/.test(v) && !semLeitor) aplicarCodigo(v); // parece código de barras
    });
    const res = container.querySelector('.picker-results');
    const filtrar = () => {
      const termos = norm(inp.value).split(/\s+/).filter(Boolean);
      const lista = S.produtos.filter((p) => p.ativo).filter((p) => {
        const alvo = norm([p.nome, p.sku, p.marca, p.tipo, p.tamanho, p.cor, p.codigo_barras].join(' '));
        const palavras = alvo.split(/[\s·\-\/]+/);
        return termos.every((t) => (t.length === 1 ? palavras.includes(t) : t.length === 2 ? palavras.some((w) => w.startsWith(t)) : alvo.includes(t)));
      }).slice(0, 60);
      res.innerHTML = lista.length ? lista.map((p) => {
        const sem = exigeSaldo && p.saldo <= 0;
        return `<button type="button" class="pick-item" data-id="${p.id}" ${sem ? 'disabled' : ''}>
          <div class="main"><div>${esc(p.nome)}</div><div class="sku">${esc(p.sku)}${p.marca ? ' · ' + esc(p.marca) : ''}</div></div>
          <span class="badge ${p.saldo <= 0 ? 'out' : p.saldo <= p.estoque_minimo ? 'warn' : 'in'}">${nf(p.saldo)} ${unid(p)}</span></button>`;
      }).join('') : `<div class="empty" style="border:0">${S.produtos.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.' + (podeCadastrar() ? ' Cadastre em <a href="#/produtos">Produtos</a>.' : ' Peça ao administrador para cadastrar.')}</div>`;
    };
    inp.oninput = filtrar;
    res.onclick = (e) => {
      const b = e.target.closest('.pick-item'); if (!b || b.disabled) return;
      escolhido = S.produtos.find((p) => p.id === Number(b.dataset.id));
      desenhar(); onChange && onChange(escolhido);
    };
    filtrar();
  };
  desenhar();
  return {
    get: () => escolhido,
    lerCodigo: (cod) => aplicarCodigo(cod),
    set: (p) => { escolhido = p; desenhar(); onChange && onChange(p); },
    reset: () => { escolhido = null; desenhar(); onChange && onChange(null); },
  };
}

function stepperHtml(id, v = 1) {
  return `<div class="stepper"><button type="button" data-step="-1" aria-label="Diminuir">−</button>
    <input id="${id}" type="number" inputmode="numeric" min="1" step="1" value="${v}" aria-label="Quantidade">
    <button type="button" data-step="1" aria-label="Aumentar">+</button></div>`;
}
function bindStepper(root) {
  root.querySelectorAll('.stepper').forEach((st) => {
    const inp = st.querySelector('input');
    st.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
      inp.value = Math.max(1, (parseInt(inp.value, 10) || 0) + Number(b.dataset.step));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}
const pillsHtml = (name, opts, cls = '') => `<div class="pills ${cls}" role="radiogroup">${opts.map((o) => `<label class="pill"><input type="radio" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</div>`;
const optionsHtml = (arr, sel, vazio) => (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '') + (arr || []).map((v) => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
const datalist = (id, arr) => `<datalist id="${id}">${(arr || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

/* =========================================================
   COMPROVANTE
   ========================================================= */
function comprovante(m) {
  const saida = m.tipo === 'saida';
  const qtd = Math.abs(m.qtd);
  const linhas = [
    ['Data', dt(m.data)], ['Lançamento', '#' + m.id], ['Tipo', saida ? 'Saída' : m.tipo === 'entrada' ? 'Entrada' : m.tipo], ['Motivo', m.motivo],
    ['Produto', m.produto], ['Código', m.sku], ['Quantidade', nf(qtd) + ' ' + unidade({ tipo: m.tipo_produto }, qtd)],
  ];
  if (saida) {
    if (m.paciente_nome) linhas.push(['Paciente', m.paciente_nome]);
    if (m.cirurgia) linhas.push(['Cirurgia', m.cirurgia + (m.data_cirurgia ? ' (' + dOnly(m.data_cirurgia) + ')' : '')]);
    if (!ehProtese(m.tipo_produto)) {
      linhas.push(['Valor unitário', brl(m.valor_unitario)]);
      if (Number(m.desconto)) linhas.push(['Desconto', '− ' + brl(m.desconto)]);
      if (m.forma_pagamento) linhas.push(['Pagamento', m.forma_pagamento]);
    }
  } else {
    if (m.fornecedor) linhas.push(['Fornecedor', m.fornecedor]);
    if (m.nota_fiscal) linhas.push(['Nota fiscal', m.nota_fiscal]);
  }
  (m.unidades || []).forEach((u, i) => linhas.push([`Prótese ${i + 1}`, `Nº ${u.numero_serie}${u.lote ? ' · lote ' + u.lote : ''}${u.lado ? ' · ' + u.lado.toUpperCase() : ''}`]));
  if (m.observacao) linhas.push(['Observação', m.observacao]);
  linhas.push(['Registrado por', m.usuario], ['Saldo atual do item', nf(m.saldo_atual)]);
  const mostraTotal = (saida || isAdmin()) && !ehProtese(m.tipo_produto);
  modal('Comprovante', `<div class="recibo">
    <div class="r-head"><b>${esc(CFG.CLINICA || '')}</b><br>Comprovante de ${saida ? 'saída' : 'entrada'} de ${ehProtese(m.tipo_produto) ? 'prótese mamária' : 'produto'}</div>
    <dl>${linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${mostraTotal ? `<div class="r-total"><span>Total</span><span>${brl(m.valor_total)}</span></div>` : ''}
    ${saida && m.paciente_nome ? '<div class="assin">Assinatura da paciente</div>' : ''}
  </div>
  <div class="btn-row end no-print" style="margin-top:18px"><button class="btn" data-x>Fechar</button><button class="btn primary" data-print>Imprimir</button></div>`, {
    onMount(b) { b.querySelector('[data-print]').onclick = () => { document.body.classList.add('imprimir-modal'); window.print(); setTimeout(() => document.body.classList.remove('imprimir-modal'), 500); }; },
  });
}

/* =========================================================
   SAÍDA
   ========================================================= */
ROTAS.saida = async (el) => {
  await produtosRapido();
  const L = S.listas;
  el.innerHTML = `<div class="page-head"><h1>Registrar saída</h1></div>
  <form class="card" id="f-saida" novalidate>
    <div class="field"><span class="label">1. Produto</span><div id="pk"></div></div>
    <div class="field" id="sd-qtd-campo"><label for="sd-qtd">2. Quantidade <span class="qtd-par hidden">— em <b>pares</b> (1 = 1 par)</span></label>${stepperHtml('sd-qtd')}</div>
    <div class="field hidden" id="sd-unid"><span class="label">2. Qual prótese? <span class="muted">Toque para marcar ou leia o código da caixa</span></span>
      <div id="sd-lista" class="list"></div></div>
    <div class="field"><span class="label">3. Motivo</span><div id="sd-motivos">${pillsHtml('motivo', MOTIVOS_SAIDA, 'out')}</div></div>
    <div id="sd-pac" class="hidden">
      <div class="field"><label for="sd-nome">Nome da paciente</label><input id="sd-nome" type="text" autocomplete="off" autocapitalize="words"></div>
      <div class="grid2">
        <div class="field"><label for="sd-cir">Cirurgia</label><input id="sd-cir" type="text" list="dl-cir" autocomplete="off">${datalist('dl-cir', L.cirurgia)}</div>
        <div class="field"><label for="sd-dcir">Data da cirurgia <span class="muted">(opcional)</span></label><input id="sd-dcir" type="date"></div>
      </div>
    </div>
    <div class="grid3" id="sd-valores">
      <div class="field"><label for="sd-vu">Valor unitário (R$)</label><input id="sd-vu" type="text" inputmode="decimal"></div>
      <div class="field"><label for="sd-desc">Desconto (R$)</label><input id="sd-desc" type="text" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label for="sd-pag">Forma de pagamento</label><select id="sd-pag">${optionsHtml(L.forma_pagamento, '', 'Selecione')}</select></div>
    </div>
    <div class="total-line" id="sd-total-linha"><span>Total</span><span class="v" id="sd-total">${brl(0)}</span></div>
    <div class="field"><label for="sd-obs">Observação <span class="muted">(opcional)</span></label><textarea id="sd-obs"></textarea></div>
    <button class="btn out block big" type="submit">Registrar saída</button>
  </form>`;
  const f = el.querySelector('#f-saida');
  // próteses: unidades disponíveis do produto escolhido; marcadas = { id: lado }
  let unids = [], marcadas = {};
  const serial = () => { const p = pk && pk.get(); return !!(p && p.controla_serie); };
  const quantidade = () => (serial() ? Object.keys(marcadas).length : parseInt(qtd.value, 10) || 0);
  const vaiParaPaciente = () => MOTIVOS_PACIENTE.includes(motivo());
  const venc = () => false; // próteses: validade indeterminada
  const diasPara = (d) => Math.round((new Date(d + 'T12:00:00Z') - new Date(hojeISO() + 'T12:00:00Z')) / 864e5);
  const seloValidade = (u) => {
    if (!u.validade) return '<span class="badge">sem validade</span>';
    const dd = diasPara(u.validade);
    return dd < 0 ? '<span class="badge out">VENCIDA</span>' : dd <= 90 ? `<span class="badge warn">vence em ${dd} dia(s)</span>` : `<span class="badge in">val. ${esc(dOnly(u.validade))}</span>`;
  };
  const desenharUnids = () => {
    const box = f.querySelector('#sd-lista'); const pac = vaiParaPaciente();
    box.innerHTML = unids.length ? unids.map((u) => {
      const bloq = pac && venc(u); const on = u.id in marcadas;
      return `<div class="row-item unid ${on ? 'unid-on' : ''} ${bloq ? 'dim' : ''}" data-u="${u.id}">
        <label class="check unid-check"><input type="checkbox" data-sel="${u.id}" ${on ? 'checked' : ''} ${bloq ? 'disabled' : ''}>
          <span><b>Nº ${esc(u.numero_serie)}</b>${u.lote ? ' · lote ' + esc(u.lote) : ''}<br><span class="small muted">entrada ${esc(dOnly(u.entrada_data))}</span></span></label>
        ${on && pac ? `<div class="pills lado">${['Direita', 'Esquerda'].map((l) => `<label class="pill"><input type="radio" name="lado-${u.id}" value="${l}" ${marcadas[u.id] === l ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>` : ''}
      </div>`;
    }).join('') : '<div class="empty">Nenhuma prótese deste produto em estoque.</div>';
    f.querySelector('#sd-unid .label').firstChild.textContent = `2. Qual prótese? (${Object.keys(marcadas).length} marcada(s)) `;
    calc();
  };
  const marcar = (id, on) => {
    if (on) { const usados = Object.values(marcadas); marcadas[id] = !usados.includes('Direita') ? 'Direita' : !usados.includes('Esquerda') ? 'Esquerda' : ''; }
    else delete marcadas[id];
    desenharUnids();
  };
  f.querySelector('#sd-lista').addEventListener('change', (e) => {
    const c = e.target.closest('[data-sel]'); if (c) { marcar(Number(c.dataset.sel), c.checked); return; }
    const r = e.target.closest('input[type=radio]'); if (r) { marcadas[Number(r.name.split('-')[1])] = r.value; }
  });
  const carregarUnids = async (p) => {
    unids = []; marcadas = {};
    if (!p || !p.controla_serie) return desenharUnids();
    f.querySelector('#sd-lista').innerHTML = '<div class="carregando">Carregando próteses…</div>';
    unids = (await rpc('unidades', { p_produto: p.id, p_status: 'estoque' }).catch((e) => { toast(e.message, 'err'); return []; })) || [];
    desenharUnids();
  };
  // ler o código de uma prótese marca a unidade certa (pelo nº de série)
  const marcarPorSerie = (serie) => {
    const u = unids.find((x) => x.numero_serie.toUpperCase() === String(serie).toUpperCase());
    if (!u) return false;
    if (vaiParaPaciente() && venc(u)) { toast(`A prótese nº ${u.numero_serie} está VENCIDA e não pode ir para paciente.`, 'err'); return true; }
    if (!(u.id in marcadas)) marcar(u.id, true); bip(); toast(`Prótese nº ${u.numero_serie} marcada.`, 'ok'); return true;
  };
  const pk = seletorProduto(f.querySelector('#pk'), { exigeSaldo: true,
    onUnidade: async (p, g) => { if (!p.controla_serie || !g || !g.serie) return; if (!unids.length) await carregarUnids(p); if (!marcarPorSerie(g.serie)) toast(`A prótese nº ${g.serie} não está no estoque.`, 'err'); },
    codigoSemProduto: async (cod) => { // etiqueta só com o nº de série: procura a prótese em todo o estoque
      if (serial() && marcarPorSerie(cod)) return true;
      const r = (await rpc('unidades', { p_status: 'estoque', p_busca: cod }).catch(() => [])) || [];
      const u = r.find((x) => x.numero_serie.toUpperCase() === cod.toUpperCase());
      if (!u) return false;
      const p = S.produtos.find((x) => x.id === u.produto_id); if (!p) return false;
      if (!pk.get() || pk.get().id !== p.id) { pk.set(p); await carregarUnids(p); }
      marcarPorSerie(cod); return true;
    },
    onChange: (p) => {
      const pr = !!(p && p.controla_serie);
      f.querySelector('#sd-qtd-campo').classList.toggle('hidden', pr);
      f.querySelector('#sd-unid').classList.toggle('hidden', !pr);
      f.querySelector('#sd-valores').classList.toggle('hidden', pr);
      f.querySelector('#sd-total-linha').classList.toggle('hidden', pr);
      // motivos conforme o produto (prótese: implantada, troca, devolução, perda)
      const lista = pr ? MOTIVOS_SAIDA_PROTESE : MOTIVOS_SAIDA;
      const atual = motivo();
      f.querySelector('#sd-motivos').innerHTML = pillsHtml('motivo', lista, 'out');
      if (atual && lista.includes(atual)) f.querySelector(`input[name=motivo][value="${atual}"]`).checked = true;
      else f.querySelector('#sd-pac').classList.add('hidden');
      ligarMotivos();
      carregarUnids(p);
      f.querySelector('.qtd-par').classList.toggle('hidden', !(p && ehPorPar(p.tipo))); preencherValor(); calc();
    } });
  bindStepper(f);
  const motivo = () => (f.querySelector('input[name=motivo]:checked') || {}).value;
  const vu = f.querySelector('#sd-vu'), desc = f.querySelector('#sd-desc'), qtd = f.querySelector('#sd-qtd'), pag = f.querySelector('#sd-pag');
  let vuEditado = false;
  vu.addEventListener('input', () => { vuEditado = true; });
  const preencherValor = () => {
    if (vuEditado) return;
    const p = pk.get(); const m = motivo();
    vu.value = p && m ? money2(MOTIVOS_VENDA.includes(m) ? p.preco : 0) : (p ? money2(p.preco) : '');
  };
  const calc = () => {
    const t = (parseNum(vu.value) || 0) * quantidade() - (parseNum(desc.value) || 0);
    f.querySelector('#sd-total').textContent = brl(Math.max(t, 0));
  };
  f.addEventListener('input', calc);
  const ligarMotivos = () => f.querySelectorAll('input[name=motivo]').forEach((r) => r.addEventListener('change', () => {
    const m = motivo();
    f.querySelector('#sd-pac').classList.toggle('hidden', !MOTIVOS_PACIENTE.includes(m));
    if (m === 'Incluído no pacote cirúrgico') pag.value = (L.forma_pagamento || []).includes('Incluso no pacote') ? 'Incluso no pacote' : pag.value;
    if (['Cortesia', 'Perda / avaria', 'Uso interno', 'Troca', 'Devolução ao fornecedor'].includes(m)) pag.value = (L.forma_pagamento || []).includes('Sem cobrança') ? 'Sem cobrança' : '';
    if (serial()) desenharUnids();
    vuEditado = false; preencherValor(); calc();
  }));
  ligarMotivos();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const p = pk.get(); const m = motivo(); const q = quantidade();
    if (!p) return toast('Escolha o produto.', 'err');
    if (p.controla_serie && !q) return toast('Marque qual(is) prótese(s) está(ão) saindo.', 'err');
    if (p.controla_serie && MOTIVOS_PACIENTE.includes(m) && Object.values(marcadas).some((l) => !l)) return toast('Marque o lado (direita ou esquerda) de cada prótese.', 'err');
    if (!q || q < 1) return toast('Informe a quantidade.', 'err');
    if (q > p.saldo) return toast(`Só há ${p.saldo} ${unidade(p, p.saldo)} em estoque.`, 'err');
    if (!m) return toast('Escolha o motivo da saída.', 'err');
    const nome = f.querySelector('#sd-nome').value.trim();
    if (MOTIVOS_PACIENTE.includes(m) && !nome) return toast('Informe o nome da paciente.', 'err');
    const v = parseNum(vu.value), d = parseNum(desc.value);
    if (Number.isNaN(v) || Number.isNaN(d)) return toast('Confira os valores digitados.', 'err');
    const res = await tentar(() => rpc('registrar_saida', { p: {
      produto_id: p.id, quantidade: q, motivo: m, valor_unitario: v, desconto: d || 0, forma_pagamento: pag.value || null,
      paciente_nome: MOTIVOS_PACIENTE.includes(m) ? nome : null, cirurgia: f.querySelector('#sd-cir').value.trim() || null,
      data_cirurgia: f.querySelector('#sd-dcir').value || null, observacao: f.querySelector('#sd-obs').value.trim() || null,
      unidades: p.controla_serie ? Object.entries(marcadas).map(([id, lado]) => ({ id: Number(id), lado: MOTIVOS_PACIENTE.includes(m) ? lado : null })) : undefined,
      ...(p.controla_serie ? { valor_unitario: 0, desconto: 0, forma_pagamento: null } : {}),
    } }), f.querySelector('[type=submit]'));
    if (!res) return;
    toast('Saída registrada.', 'ok');
    unids = []; marcadas = {};
    await recarregarProdutos();
    f.reset(); pk.reset(); vuEditado = false; f.querySelector('#sd-pac').classList.add('hidden'); calc();
    comprovante(res);
  };
};

/* =========================================================
   ENTRADA
   ========================================================= */
ROTAS.entrada = async (el) => {
  await produtosRapido();
  const L = S.listas;
  el.innerHTML = `<div class="page-head"><h1>Registrar entrada</h1></div>
  <form class="card" id="f-ent" novalidate>
    <div class="field"><span class="label">1. Produto</span><div id="pk"></div></div>
    <div class="field" id="en-qtd-campo"><label for="en-qtd">2. Quantidade <span class="qtd-par hidden">— em <b>pares</b> (1 = 1 par)</span></label>${stepperHtml('en-qtd')}</div>
    <div class="field hidden" id="en-unid"><span class="label">2. Próteses que chegaram — uma linha por unidade</span>
      <div class="info-box dica-tipo">Leia o <b>código de barras da caixa</b> (câmera ou leitor de mão): o nº de série e o lote são preenchidos sozinhos. Confira e leia a próxima.</div>
      <div id="en-linhas" class="list"></div>
      <div class="btn-row" style="margin-top:10px"><button type="button" class="btn" id="en-add">+ Digitar prótese</button><button type="button" class="btn cam" id="en-cam">${icon('camera')}<span>Ler próxima caixa</span></button></div>
    </div>
    <div class="field"><span class="label">3. Motivo</span>${pillsHtml('motivo', MOTIVOS_ENTRADA, 'in')}</div>
    <div class="grid2">
      <div class="field"><label for="en-custo">Custo unitário (R$)</label><input id="en-custo" type="text" inputmode="decimal" placeholder="${isAdmin() ? '' : 'Deixe vazio para usar o custo cadastrado'}"></div>
      <div class="field"><label for="en-forn">Fornecedor</label><input id="en-forn" type="text" list="dl-forn" autocomplete="off">${datalist('dl-forn', L.fornecedor)}</div>
    </div>
    <div class="grid2">
      <div class="field"><label for="en-nf">Nº da nota fiscal <span class="muted">(opcional)</span></label><input id="en-nf" type="text" autocomplete="off"></div>
      <div class="field"><label for="en-obs">Observação <span class="muted">(opcional)</span></label><input id="en-obs" type="text" autocomplete="off"></div>
    </div>
    ${isAdmin() ? '<div class="total-line"><span>Total da entrada</span><span class="v" id="en-total">R$ 0,00</span></div>' : ''}
    <button class="btn in block big" type="submit">Registrar entrada</button>
  </form>`;
  const f = el.querySelector('#f-ent');
  const custo = f.querySelector('#en-custo'), forn = f.querySelector('#en-forn'), qtd = f.querySelector('#en-qtd');
  // próteses: linhas {serie, lote, validade}
  let linhas = [];
  const serial = () => { const p = pk && pk.get(); return !!(p && p.controla_serie); };
  const quantidade = () => (serial() ? linhas.length : parseInt(qtd.value, 10) || 0);
  const calc = () => { const t = f.querySelector('#en-total'); if (t) t.textContent = brl((parseNum(custo.value) || 0) * quantidade()); };
  const desenharLinhas = () => {
    const box = f.querySelector('#en-linhas');
    box.innerHTML = linhas.length ? linhas.map((l, i) => `<div class="row-item unid-linha" data-i="${i}">
      <div class="main"><div class="grid2">
        <div class="field" style="margin:0"><label>Nº de série</label><input type="text" data-k="serie" value="${esc(l.serie)}" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>
        <div class="field" style="margin:0"><label>Lote</label><input type="text" data-k="lote" value="${esc(l.lote)}" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>
      </div>${l.incerto ? '<div class="small" style="color:var(--warn);margin-top:6px">Confira lote e série: o leitor não separou os campos com certeza.</div>' : ''}</div>
      <button type="button" class="x" data-del="${i}" aria-label="Remover">×</button></div>`).join('')
      : '<div class="empty">Nenhuma prótese ainda. Leia o código da primeira caixa.</div>';
    f.querySelector('#en-unid .label').textContent = `2. Próteses que chegaram — ${linhas.length} unidade(s)`;
    calc();
  };
  const addLinha = async (l) => {
    if (l.serie && linhas.some((x) => x.serie.toUpperCase() === l.serie.toUpperCase())) { toast(`A prótese nº ${l.serie} já está na lista.`, 'err'); return; }
    if (l.serie) { // já foi registrada antes?
      const r = (await rpc('unidades', { p_busca: l.serie }).catch(() => [])) || [];
      const u = r.find((x) => x.numero_serie.toUpperCase() === l.serie.toUpperCase());
      if (u) { toast(u.status === 'estoque' ? `A prótese nº ${u.numero_serie} já está no estoque (entrada em ${dOnly(u.entrada_data)}).` : `A prótese nº ${u.numero_serie} já foi registrada e saiu em ${dOnly(u.saida_data)}${u.paciente_nome ? ' (' + u.paciente_nome + ')' : ''}.`, 'err'); return; }
    }
    linhas.push({ serie: l.serie || '', lote: l.lote || '', incerto: !!l.incerto });
    desenharLinhas(); bip();
    if (!l.serie) { const ins = f.querySelectorAll('#en-linhas [data-k=serie]'); if (ins.length) ins[ins.length - 1].focus(); }
  };
  f.querySelector('#en-linhas').addEventListener('input', (e) => { const i = e.target.closest('[data-i]'); if (!i) return; linhas[Number(i.dataset.i)][e.target.dataset.k] = e.target.value.trim(); });
  f.querySelector('#en-linhas').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { linhas.splice(Number(d.dataset.del), 1); desenharLinhas(); } });
  f.querySelector('#en-linhas').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  f.querySelector('#en-add').onclick = () => addLinha({});
  f.querySelector('#en-cam').onclick = async () => { const c = await lerCodigoCamera('Ler código da caixa'); if (c) pk.lerCodigo(c); };
  const aoLerUnidade = (p, g, cod) => {
    if (!p.controla_serie) return;
    if (g) { addLinha({ serie: g.serie, lote: g.lote, incerto: g.incerto }); if (!g.serie) toast('O código não trouxe o nº de série: digite-o na linha.', ''); return; }
    if (produtoPorCodigo(cod)) { addLinha({}); return; } // leu o código do produto: abre linha para digitar a série
  };
  const pk = seletorProduto(f.querySelector('#pk'), { onUnidade: aoLerUnidade,
    bloquearTroca: (novo) => (linhas.length ? `Esta caixa é de outro produto (${novo.nome}). Registre primeiro as ${linhas.length} prótese(s) da lista, ou remova-as.` : null),
    codigoSemProduto: async (cod) => { // com uma prótese escolhida, um código solto é o nº de série da etiqueta
      if (!serial()) return false;
      addLinha({ serie: cod }); return true;
    },
    onChange: (p) => {
    const pr = !!(p && p.controla_serie);
    f.querySelector('#en-qtd-campo').classList.toggle('hidden', pr);
    f.querySelector('#en-custo').closest('.field').classList.toggle('hidden', pr);
    const tot = f.querySelector('#en-total'); if (tot) tot.closest('.total-line').classList.toggle('hidden', pr);
    f.querySelector('#en-unid').classList.toggle('hidden', !pr);
    if (!pr) linhas = [];
    desenharLinhas();
    f.querySelector('.qtd-par').classList.toggle('hidden', !(p && ehPorPar(p.tipo)));
    if (p && isAdmin() && p.custo !== undefined) custo.value = money2(p.custo);
    if (!isAdmin()) custo.closest('.field').classList.add('hidden');
    if (p && !forn.value) forn.value = p.fornecedor || '';
    calc();
  } });
  bindStepper(f);
  f.addEventListener('input', calc);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const p = pk.get(); const m = (f.querySelector('input[name=motivo]:checked') || {}).value; const q = quantidade();
    if (!p) return toast('Escolha o produto.', 'err');
    if (p.controla_serie) {
      if (!linhas.length) return toast('Leia ou digite pelo menos uma prótese.', 'err');
      if (linhas.some((l) => !l.serie)) return toast('Falta o nº de série em alguma linha.', 'err');
    }
    if (!q || q < 1) return toast('Informe a quantidade.', 'err');
    if (!m) return toast('Escolha o motivo da entrada.', 'err');
    const c = parseNum(custo.value);
    if (Number.isNaN(c)) return toast('Confira o custo digitado.', 'err');
    const res = await tentar(() => rpc('registrar_entrada', { p: {
      produto_id: p.id, quantidade: q, motivo: m, custo_unitario: c, fornecedor: forn.value.trim() || null,
      nota_fiscal: f.querySelector('#en-nf').value.trim() || null, observacao: f.querySelector('#en-obs').value.trim() || null,
      unidades: p.controla_serie ? linhas.map((l) => ({ numero_serie: l.serie, lote: l.lote || null })) : undefined,
    } }), f.querySelector('[type=submit]'));
    if (!res) return;
    toast('Entrada registrada.', 'ok');
    linhas = [];
    await recarregarProdutos();
    f.reset(); pk.reset(); calc();
    comprovante(res);
  };
};

/* =========================================================
   ESTOQUE (consulta) + ajuste de inventário
   ========================================================= */
ROTAS.estoque = async (el) => {
  await produtosRapido();
  const tipos = [...new Set(S.produtos.map((p) => p.tipo))].sort();
  const nRepor = S.produtos.filter(precisaRepor).length;
  el.innerHTML = `<div class="page-head"><h1>Estoque</h1><button class="btn ${nRepor ? 'out' : ''}" id="es-repor">Lista de reposição${nRepor ? ` <span class="badge count" style="background:#fff;color:var(--out)">${nRepor}</span>` : ''}</button>${isGestor() ? '<a class="btn" href="#/produtos">Gerenciar produtos</a>' : ''}</div>
    <div class="toolbar">
      <div class="field grow"><label for="es-q">Buscar</label><div class="busca-linha"><input id="es-q" type="search" placeholder="Nome, tamanho, código…" enterkeyhint="search">${botaoCamera()}</div></div>
      <div class="field"><label for="es-tipo">Tipo</label><select id="es-tipo">${optionsHtml(tipos, '', 'Todos')}</select></div>
      <label class="check"><input type="checkbox" id="es-low"> Só no mínimo / abaixo</label>
    </div>
    <div id="es-resumo"></div>
    <div class="list" id="es-lista"></div>`;
  const q = el.querySelector('#es-q'), tipo = el.querySelector('#es-tipo'), low = el.querySelector('#es-low');
  const desenhar = () => {
    const termos = norm(q.value).split(/\s+/).filter(Boolean);
    const lista = S.produtos.filter((p) => (isGestor() ? true : p.ativo))
      .filter((p) => !tipo.value || p.tipo === tipo.value)
      .filter((p) => !low.checked || (p.ativo && p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo))
      .filter((p) => { const a = norm([p.nome, p.sku, p.marca, p.cor, p.codigo_barras].join(' ')); return termos.every((t) => a.includes(t)); });
    const totQ = sum(lista, (p) => Math.max(p.saldo, 0));
    el.querySelector('#es-resumo').innerHTML = `<p class="muted">${nf(lista.length)} itens · ${nf(totQ)} unidades${isAdmin() ? ` · Valor a custo: <b>${brl(sum(lista, (p) => Math.max(p.saldo, 0) * p.custo))}</b> · a preço de venda: <b>${brl(sum(lista, (p) => Math.max(p.saldo, 0) * p.preco))}</b>` : ''}</p>`;
    el.querySelector('#es-lista').innerHTML = lista.length ? lista.map((p) => {
      const baixo = p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo;
      return `<div class="row-item ${p.ativo ? '' : 'dim'}"><div class="main">
        <div class="title">${esc(p.nome)} ${p.ativo ? '' : '<span class="badge">inativo</span>'} ${baixo && p.ativo ? '<span class="badge out">repor</span>' : ''}</div>
        <div class="meta">${esc(p.sku)}${p.marca ? ' · ' + esc(p.marca) : ''} · mínimo ${nf(p.estoque_minimo)}${p.controla_serie ? '' : ` · venda ${brl(p.preco)}${isAdmin() ? ' · custo ' + brl(p.custo) : ''}`}</div>
        ${p.controla_serie || isGestor() ? `<div class="row-actions">${p.controla_serie ? '<a class="btn sm" href="#/proteses">Ver unidades (nº de série)</a>' : `<button class="btn sm" data-aj="${p.id}">Ajustar contagem</button>`}${isAdmin() ? `<button class="btn sm danger" data-apg="${p.id}">Apagar</button>` : ''}</div>` : ''}
      </div><div class="side"><div class="saldo ${baixo ? 'low' : ''}">${nf(p.saldo)}</div><div class="small muted">${unidade(p, p.saldo)}</div></div></div>`;
    }).join('') : '<div class="empty">Nenhum item para mostrar.</div>';
  };
  [q, tipo, low].forEach((x) => x.addEventListener('input', desenhar));
  el.querySelector('#es-repor').onclick = () => tentar(listaReposicao);
  const mostrarCodigo = (cod) => {
    const p = produtoPorCodigo(cod);
    if (!p) { codigoNaoCadastrado(limpaCodigo(cod), (np) => { if (np) { q.value = np.sku; desenhar(); } }); return; }
    tipo.value = ''; low.checked = false; q.value = p.sku; desenhar();
  };
  aoLerCodigo = mostrarCodigo;
  el.querySelector('[data-cam]').onclick = async () => { const c = await lerCodigoCamera(); if (c) mostrarCodigo(c); };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = limpaCodigo(q.value); if (produtoPorCodigo(v) || /^[0-9]{6,}$/.test(v)) mostrarCodigo(v); } });
  el.querySelector('#es-lista').onclick = (e) => {
    const ap = e.target.closest('[data-apg]');
    if (ap) { apagarProduto(S.produtos.find((p) => p.id === Number(ap.dataset.apg)), () => desenhar()); return; }
    const b = e.target.closest('[data-aj]'); if (!b) return;
    ajusteInventario(S.produtos.find((p) => p.id === Number(b.dataset.aj)), () => desenhar());
  };
  const botaoRepor = () => {
    const n = S.produtos.filter(precisaRepor).length, bt = el.querySelector('#es-repor'); if (!bt) return;
    bt.className = 'btn ' + (n ? 'out' : '');
    bt.innerHTML = 'Lista de reposição' + (n ? ` <span class="badge count" style="background:#fff;color:var(--out)">${n}</span>` : '');
  };
  aoAtualizarDados = () => { if (el.isConnected) { desenhar(); botaoRepor(); } };
  desenhar();
};

function ajusteInventario(p, depois) {
  modal('Ajuste de inventário', `<form id="f-aj">
    <p><b>${esc(p.nome)}</b><br><span class="muted">${esc(p.sku)}</span></p>
    <div class="grid2 keep"><div class="kpi"><div class="k-label">No sistema</div><div class="k-val">${nf(p.saldo)}</div></div>
      <div class="field" style="margin:0"><label for="aj-q">Contagem física</label><input id="aj-q" type="number" inputmode="numeric" min="0" step="1" required></div></div>
    <p id="aj-dif" class="muted" style="margin-top:12px">&nbsp;</p>
    <div class="field"><label for="aj-j">Justificativa (obrigatória)</label><textarea id="aj-j" required placeholder="Ex.: contagem mensal, peça danificada encontrada…"></textarea></div>
    <div class="btn-row end"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Salvar ajuste</button></div></form>`, {
    onMount(b, close) {
      const qi = b.querySelector('#aj-q');
      qi.oninput = () => { const d = (parseInt(qi.value, 10) || 0) - p.saldo; b.querySelector('#aj-dif').innerHTML = qi.value === '' ? '&nbsp;' : `Diferença: <b>${d > 0 ? '+' : ''}${nf(d)}</b> unidade(s)${isAdmin() ? ' · ' + brl(d * p.custo) : ''}`; };
      b.querySelector('#f-aj').onsubmit = async (e) => {
        e.preventDefault();
        const v = parseInt(qi.value, 10);
        if (Number.isNaN(v) || v < 0) return toast('Informe a contagem.', 'err');
        const ok = await tentar(() => rpc('ajustar_inventario', { p_produto: p.id, p_contada: v, p_justificativa: b.querySelector('#aj-j').value }), e.submitter);
        if (!ok) return;
        toast('Ajuste registrado.', 'ok'); close(); await recarregarProdutos(); depois && depois();
      };
    },
  });
}

// Apagar produto (somente administrador)
function apagarProduto(p, depois) {
  const tem = p.saldo > 0;
  modal('Apagar produto', `<form id="f-ap">
    <p><b>${esc(p.nome)}</b><br><span class="muted">${esc(p.sku)}${p.codigo_barras ? ' · código ' + esc(p.codigo_barras) : ''}</span></p>
    ${tem ? `<div class="warn-box">Há <b>${nf(p.saldo)} ${unidade(p, p.saldo)}</b> em estoque. ${p.controla_serie ? 'Essas próteses serão baixadas do estoque.' : 'Essas peças serão baixadas (o estoque fica zerado).'}</div>` : ''}
    <p class="small muted">O produto some do estoque, das listas e do cadastro. Se ele já teve entradas ou saídas, esse histórico continua nos relatórios e na auditoria. O código de barras fica livre para outro produto.</p>
    <div class="field"><label for="ap-m">Motivo (obrigatório)</label><textarea id="ap-m" required placeholder="Ex.: cadastrado errado, produto descontinuado…"></textarea></div>
    <div class="btn-row end"><button type="button" class="btn" data-x>Cancelar</button><button class="btn danger-solid" type="submit">Apagar produto</button></div></form>`, {
    onMount(b, close) {
      b.querySelector('#f-ap').onsubmit = async (e) => {
        e.preventDefault();
        const motivo = b.querySelector('#ap-m').value.trim();
        if (!motivo) return toast('Informe o motivo.', 'err');
        const r = await tentar(() => rpc('apagar_produto', { p_produto: p.id, p_motivo: motivo }), e.submitter);
        if (!r) return;
        toast(r.baixadas ? `Produto apagado e ${nf(r.baixadas)} ${unidade(p, r.baixadas)} baixada(s) do estoque.` : 'Produto apagado.', 'ok');
        close(); await recarregarProdutos(); depois && depois();
      };
    },
  });
}

/* =========================================================
   PRÓTESES MAMÁRIAS — estoque por unidade e rastreabilidade
   ========================================================= */
const diasAte = (d) => Math.round((new Date(d + 'T12:00:00Z') - new Date(hojeISO() + 'T12:00:00Z')) / 864e5);
function seloVal(validade) {
  if (!validade) return '<span class="badge">sem validade</span>';
  const dd = diasAte(validade);
  return dd < 0 ? `<span class="badge out">VENCIDA ${esc(dOnly(validade))}</span>`
    : dd <= 90 ? `<span class="badge warn">vence em ${dd} dia(s) · ${esc(dOnly(validade))}</span>`
    : `<span class="badge in">val. ${esc(dOnly(validade))}</span>`;
}

ROTAS.proteses = async (el) => {
  await produtosRapido();
  el.innerHTML = `<div class="page-head"><h1>Próteses mamárias</h1>
      <a class="btn in" href="#/entrada">+ Entrada</a><a class="btn out" href="#/saida">Saída</a>
      ${podeCadastrar() ? '<button class="btn" id="pt-novo">Cadastrar volume</button>' : ''}</div>
    <div id="pt-alerta"></div>
    <div class="tabs no-print" id="pt-tabs"><button data-t="estoque" class="on">Em estoque</button><button data-t="saiu">Implantadas / saídas</button></div>
    <div class="toolbar no-print"><div class="field grow"><label for="pt-q">Buscar</label>
      <div class="busca-linha"><input id="pt-q" type="search" placeholder="Nº de série, lote, paciente ou volume" enterkeyhint="search">${botaoCamera()}</div></div>
      <button class="btn" id="pt-print">Imprimir</button></div>
    <div id="relatorio-saida"></div>`;
  const $ = (x) => el.querySelector(x);
  let aba = 'estoque', dados = [];
  const prots = () => S.produtos.filter((p) => p.controla_serie);
  const alerta = () => {
    const repor = prots().filter((p) => p.ativo && p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo);
    $('#pt-alerta').innerHTML = repor.length ? `<div class="warn-box">Para repor: <b>${repor.map((p) => esc(p.tamanho)).join(', ')}</b> (no estoque mínimo ou abaixo).</div>` : '';
  };
  const desenhar = () => {
    const out = $('#relatorio-saida');
    const t = norm($('#pt-q').value);
    if (aba === 'estoque') {
      const lista = dados.filter((u) => !t || norm([u.numero_serie, u.lote, u.produto, u.tamanho, u.marca].join(' ')).includes(t));
      const grupos = groupBy(lista, (u) => u.produto_id);
      const semUnid = prots().filter((p) => p.ativo && !grupos[p.id] && !t);
      out.innerHTML = `<p class="print-only"><b>${esc(CFG.CLINICA || '')}</b> — Próteses em estoque — ${esc(dOnly(new Date().toISOString()))}</p>
        <p class="muted">${nf(lista.length)} prótese(s) em estoque</p>` + (Object.keys(grupos).length ? Object.entries(grupos)
        .sort((a, b) => (parseInt(a[1][0].tamanho, 10) || 0) - (parseInt(b[1][0].tamanho, 10) || 0))
        .map(([pid, us]) => {
          const p = S.produtos.find((x) => x.id === Number(pid)) || {};
          const baixo = p.estoque_minimo > 0 && us.length <= p.estoque_minimo;
          return `<div class="card prot-grupo"><div class="prot-cab"><div><div class="prot-vol">${esc(us[0].tamanho)}</div>
              <div class="muted small">${esc([us[0].marca, us[0].produto.replace(/ · \d+ ml.*$/, '').replace(/^Pr[óo]tese mamária /i, '')].filter(Boolean).join(' · '))}</div></div>
              <div class="side"><div class="saldo ${baixo ? 'low' : ''}">${nf(us.length)}</div><div class="small muted">unid.${baixo ? ' · repor' : ''}</div></div></div>
            <div class="unid-lista">${us.map((u) => `<div class="unid-item"><div><b>Nº ${esc(u.numero_serie)}</b>${u.lote ? ' · lote ' + esc(u.lote) : ''}</div>
              <div class="small muted">Entrada ${esc(dOnly(u.entrada_data))} · ${esc(u.entrada_motivo)}${u.fornecedor ? ' · ' + esc(u.fornecedor) : ''}${u.nota_fiscal ? ' · NF ' + esc(u.nota_fiscal) : ''}</div></div>`).join('')}
            </div></div>`;
        }).join('') : '<div class="empty">Nenhuma prótese em estoque' + (t ? ' com essa busca.' : '. Registre a chegada em <a href="#/entrada">Entrada</a>.') + '</div>')
        + (semUnid.length ? `<p class="muted small" style="margin-top:12px">Sem estoque: ${semUnid.map((p) => esc(p.tamanho)).join(', ')}</p>` : '');
    } else {
      out.innerHTML = `<p class="print-only"><b>${esc(CFG.CLINICA || '')}</b> — Rastreabilidade de próteses — ${esc(dOnly(new Date().toISOString()))}</p>
        <p class="muted">${nf(dados.length)} registro(s)${t ? ' para “' + esc($('#pt-q').value) + '”' : ' (últimos 1000)'}</p>` + (dados.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Data</th><th>Paciente / destino</th><th>Lado</th><th>Prótese</th><th>Nº de série</th><th>Lote</th></tr></thead><tbody>
        ${dados.map((u) => `<tr><td class="nowrap">${esc(dOnly(u.data_cirurgia || u.saida_data))}</td>
          <td>${u.paciente_nome ? `<b>${esc(u.paciente_nome)}</b>` : esc(u.saida_motivo)}${u.cirurgia ? `<div class="small muted">${esc(u.cirurgia)}</div>` : ''}<div class="small muted">${esc(u.saida_motivo)} · ${esc(u.usuario_saida || '')}</div></td>
          <td><b>${esc(u.lado || '—')}</b></td><td>${esc(u.tamanho)}<div class="small muted">${esc(u.marca || '')}</div></td>
          <td><b>${esc(u.numero_serie)}</b></td><td>${esc(u.lote || '—')}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Nada encontrado.</div>');
    }
  };
  let pedido = 0;
  const carregar = async () => {
    const meu = ++pedido;
    const busca = aba === 'saiu' ? $('#pt-q').value.trim() || null : null;
    const r = (await rpc('unidades', { p_status: aba, p_busca: busca })) || [];
    if (meu !== pedido) return;
    dados = r; desenhar();
  };
  $('#pt-tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; aba = b.dataset.t; el.querySelectorAll('#pt-tabs button').forEach((x) => x.classList.toggle('on', x === b)); $('#relatorio-saida').innerHTML = '<div class="carregando">Carregando…</div>'; tentar(carregar); };
  let tq = null;
  $('#pt-q').oninput = () => { if (aba === 'estoque') desenhar(); else { clearTimeout(tq); tq = setTimeout(() => tentar(carregar), 350); } };
  const buscarCodigo = (cod) => { const g = lerGS1(cod); $('#pt-q').value = g && g.serie ? g.serie : limpaCodigo(cod); $('#pt-q').dispatchEvent(new Event('input')); };
  aoLerCodigo = buscarCodigo;
  el.querySelector('[data-cam]').onclick = async () => { const c = await lerCodigoCamera('Ler prótese'); if (c) buscarCodigo(c); };
  $('#pt-print').onclick = () => { document.body.classList.add('imprimir-relatorio'); window.print(); setTimeout(() => document.body.classList.remove('imprimir-relatorio'), 500); };
  const novoB = $('#pt-novo'); if (novoB) novoB.onclick = () => formProduto(null, () => { alerta(); desenhar(); }, { tipo: 'Prótese mamária' });
  aoAtualizarDados = () => { if (el.isConnected) alerta(); };
  alerta();
  await carregar();
};

/* =========================================================
   LISTA DE REPOSIÇÃO (itens que chegaram no estoque mínimo)
   ========================================================= */
const precisaRepor = (p) => p.ativo && p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo;
const sugestaoCompra = (p) => Math.max(p.estoque_minimo * 2 - Math.max(p.saldo, 0), 1);

async function listaReposicao() {
  await recarregarProdutos();
  const itens = S.produtos.filter(precisaRepor);
  if (!itens.length) {
    modal('Lista de reposição', `<p class="leitor-dica">Nenhum produto chegou no estoque mínimo. Não há nada para repor agora.</p>
      <p class="muted">O aviso aparece quando a quantidade fica igual ou menor que o <b>Estoque mínimo</b> cadastrado no produto.</p>
      <div class="btn-row end"><button class="btn primary" data-x>Fechar</button></div>`);
    return;
  }
  const comprar = {}; itens.forEach((p) => { comprar[p.id] = sugestaoCompra(p); });
  const grupos = Object.entries(groupBy(itens, (p) => p.fornecedor || 'Sem fornecedor')).sort((a, b) => (a[0] === 'Sem fornecedor') - (b[0] === 'Sem fornecedor') || a[0].localeCompare(b[0]));
  const hoje = dOnly(new Date().toISOString());
  const custoTotal = () => sum(itens, (p) => (comprar[p.id] || 0) * (p.custo || 0));

  const texto = () => {
    const linhas = [`*Lista de reposição* — ${CFG.CLINICA || ''}`, hoje, ''];
    grupos.forEach(([forn, ps]) => {
      const pedir = ps.filter((p) => comprar[p.id] > 0);
      if (!pedir.length) return;
      linhas.push(`*${forn}*`);
      pedir.forEach((p) => linhas.push(`• ${p.nome} — ${nf(comprar[p.id])} ${unidade(p, comprar[p.id])} (tem ${nf(Math.max(p.saldo, 0))}, mín. ${nf(p.estoque_minimo)})`));
      linhas.push('');
    });
    return linhas.join('\n').trim();
  };

  modal('Lista de reposição', `<div class="repor">
    <p class="print-only"><b>${esc(CFG.CLINICA || '')}</b> — Lista de reposição — ${esc(hoje)}</p>
    <p class="leitor-dica no-print"><b>${nf(itens.length)}</b> produto(s) chegaram no mínimo. Confira a quantidade a comprar (já vem uma sugestão) e envie ou imprima.</p>
    ${grupos.map(([forn, ps]) => `<h3 class="repor-forn">${esc(forn)}</h3>
      <div class="list">${ps.map((p) => `<div class="row-item repor-item"><div class="main">
          <div class="title">${esc(p.nome)}</div>
          <div class="meta">Tem <b style="color:var(--out)">${nf(Math.max(p.saldo, 0))}</b> · mínimo ${nf(p.estoque_minimo)}${p.marca ? ' · ' + esc(p.marca) : ''} · ${esc(p.sku)}</div></div>
        <div class="side"><label class="small muted" for="rp-${p.id}">Comprar</label>
          <input id="rp-${p.id}" class="repor-qtd" data-rp="${p.id}" type="number" inputmode="numeric" min="0" value="${comprar[p.id]}">
          <div class="small muted">${ehPorPar(p.tipo) ? 'pares' : 'unidades'}</div></div></div>`).join('')}</div>`).join('')}
    ${isAdmin() ? '<div class="total-line"><span>Custo estimado da compra</span><span class="v" id="rp-custo"></span></div>' : ''}
    <p class="muted small no-print">Sugestão = o suficiente para chegar ao dobro do estoque mínimo. Mude à vontade; 0 tira o item da lista.</p>
    <div class="btn-row no-print" style="margin-top:10px">
      <button class="btn primary" id="rp-enviar">${navigator.share ? 'Enviar (WhatsApp, e-mail…)' : 'Enviar pelo WhatsApp'}</button>
      <button class="btn" id="rp-copiar">Copiar texto</button>
      <button class="btn" id="rp-imprimir">Imprimir</button>
      ${isAdmin() ? '<button class="btn" id="rp-excel">Baixar Excel</button>' : ''}
    </div></div>`, {
    wide: true,
    onMount(b) {
      const atual = () => { const c = b.querySelector('#rp-custo'); if (c) c.textContent = brl(custoTotal()); };
      b.addEventListener('input', (e) => { const i = e.target.closest('[data-rp]'); if (!i) return; comprar[Number(i.dataset.rp)] = Math.max(0, parseInt(i.value, 10) || 0); atual(); });
      atual();
      b.querySelector('#rp-enviar').onclick = async () => {
        const t = texto();
        if (navigator.share) { try { await navigator.share({ title: 'Lista de reposição', text: t }); } catch { /* cancelado */ } return; }
        window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
      };
      b.querySelector('#rp-copiar').onclick = async () => {
        const t = texto();
        try { await navigator.clipboard.writeText(t); toast('Lista copiada. Cole no WhatsApp ou no e-mail.', 'ok'); }
        catch { modal('Copiar lista', `<p>Selecione o texto e copie:</p><textarea style="min-height:300px">${esc(t)}</textarea>`); }
      };
      b.querySelector('#rp-imprimir').onclick = () => { document.body.classList.add('imprimir-modal'); window.print(); setTimeout(() => document.body.classList.remove('imprimir-modal'), 500); };
      const x = b.querySelector('#rp-excel');
      if (x) x.onclick = () => exportarCSV({ titulo: 'Lista de reposição', periodo: hoje, secoes: [{
        cols: [C('Fornecedor', 'forn'), C('Código', 'sku'), C('Produto', 'nome'), C('Tem', 'saldo', 'int'), C('Mínimo', 'minimo', 'int'), C('Comprar', 'qtd', 'int'), C('Unidade', 'un'), C('Custo un.', 'custo', 'brl'), C('Custo total', 'total', 'brl')],
        rows: itens.filter((p) => comprar[p.id] > 0).map((p) => ({ forn: p.fornecedor || 'Sem fornecedor', sku: p.sku, nome: p.nome, saldo: Math.max(p.saldo, 0), minimo: p.estoque_minimo, qtd: comprar[p.id], un: ehPorPar(p.tipo) ? 'par' : 'unidade', custo: p.custo, total: comprar[p.id] * p.custo })),
        totais: ['qtd', 'total'] }] });
    },
  });
}

/* =========================================================
   LANÇAMENTOS DO DIA
   ========================================================= */
ROTAS.hoje = async (el) => {
  el.innerHTML = `<div class="page-head"><h1>Lançamentos</h1></div>
    <div class="toolbar"><div class="field" style="max-width:240px"><label for="hj-d">Dia</label><input id="hj-d" type="date" value="${hojeISO()}" max="${hojeISO()}"></div>
    <p class="muted small" style="flex:3 1 260px;margin:0 0 6px">${isGestor() ? 'Todos os lançamentos do dia.' : 'Seus lançamentos do dia. Para corrigir um lançamento, peça o estorno — o administrador aprova.'}</p></div>
    <div id="hj-resumo"></div><div class="list" id="hj-lista"></div>`;
  const d = el.querySelector('#hj-d');
  let movs = [];
  const carregar = async () => {
    el.querySelector('#hj-lista').innerHTML = '<div class="carregando">Carregando…</div>';
    movs = (await rpc('lancamentos_dia', { p_dia: d.value })) || [];
    const vivos = movs.filter((m) => !m.estornado && m.tipo !== 'estorno');
    const sai = vivos.filter((m) => m.tipo === 'saida');
    el.querySelector('#hj-resumo').innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k-label">Saídas</div><div class="k-val">${nf(sum(sai, (m) => -m.qtd))}</div><div class="k-sub">unidades</div></div>
      <div class="kpi"><div class="k-label">Entradas</div><div class="k-val">${nf(sum(vivos.filter((m) => m.tipo === 'entrada'), (m) => m.qtd))}</div><div class="k-sub">unidades</div></div>
      <div class="kpi"><div class="k-label">Valor das saídas</div><div class="k-val">${brl(sum(sai, (m) => m.valor_total))}</div></div></div>`;
    el.querySelector('#hj-lista').innerHTML = movs.length ? movs.map(linhaMov).join('') : '<div class="empty">Nenhum lançamento neste dia.</div>';
  };
  d.onchange = () => tentar(carregar);
  el.querySelector('#hj-lista').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const m = movs.find((x) => x.id === Number(b.dataset.id));
    if (b.dataset.act === 'ver') return comprovante(m);
    if (b.dataset.act === 'pedir') {
      const mot = await confirmar('Pedir estorno', `Lançamento #${m.id}: ${esc(m.produto)} (${nf(Math.abs(m.qtd))} un.). O administrador precisa aprovar.`, { ok: 'Enviar pedido', campo: 'Motivo do estorno' });
      if (!mot) return;
      if (await tentar(async () => { await rpc('solicitar_estorno', { p_mov: m.id, p_motivo: mot }); return true; })) { toast('Pedido enviado ao administrador.', 'ok'); carregar(); }
    }
    if (b.dataset.act === 'estornar') {
      const mot = await confirmar('Estornar lançamento', `Desfazer o lançamento #${m.id}: ${esc(m.produto)} (${nf(Math.abs(m.qtd))} un.)? O estoque será corrigido.`, { ok: 'Estornar', kind: 'out', campo: 'Motivo do estorno' });
      if (!mot) return;
      if (await tentar(async () => { await rpc('estornar', { p_mov: m.id, p_motivo: mot }); return true; })) { toast('Lançamento estornado.', 'ok'); carregar(); }
    }
  };
  await carregar();
};

function rotuloTipo(m) {
  if (m.tipo === 'saida') return '<span class="badge out">Saída</span>';
  if (m.tipo === 'entrada') return '<span class="badge in">Entrada</span>';
  if (m.tipo === 'ajuste') return '<span class="badge warn">Ajuste</span>';
  return '<span class="badge">Estorno</span>';
}
function linhaMov(m) {
  const podeEstornar = ['entrada', 'saida'].includes(m.tipo) && !m.estornado;
  const sit = m.estornado ? '<span class="badge">estornado</span>' : m.estorno_pendente ? '<span class="badge warn">estorno pedido</span>' : '';
  return `<div class="row-item ${m.estornado ? 'dim' : ''}"><div class="main">
    <div class="title">${rotuloTipo(m)} ${esc(m.produto)} ${sit}</div>
    <div class="meta">${hora(m.data)} · ${esc(m.motivo)}${m.paciente_nome ? ' · ' + esc(m.paciente_nome) : ''}${m.observacao ? ' · ' + esc(m.observacao) : ''} · ${esc(m.usuario)}</div>
    <div class="row-actions">
      ${['entrada', 'saida'].includes(m.tipo) ? `<button class="btn sm" data-act="ver" data-id="${m.id}">Comprovante</button>` : ''}
      ${podeEstornar && !isGestor() && !m.estorno_pendente ? `<button class="btn sm" data-act="pedir" data-id="${m.id}">Pedir estorno</button>` : ''}
      ${podeEstornar && isGestor() ? `<button class="btn sm danger" data-act="estornar" data-id="${m.id}">Estornar</button>` : ''}
    </div></div>
    <div class="side"><div class="saldo">${m.qtd > 0 ? '+' : ''}${nf(m.qtd)}</div><div class="small muted">${m.tipo === 'saida' || isAdmin() ? brl(m.valor_total) : ''}</div></div></div>`;
}

/* =========================================================
   PAINEL (admin)
   ========================================================= */
const graficos = [];
// A biblioteca de gráficos (60 KB) só é baixada quando alguma tela precisa dela
const garantirChart = () => (window.Chart ? Promise.resolve() : carregarScript('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js').catch(() => {}));
function grafico(canvas, cfg) {
  if (!window.Chart || !canvas) { if (canvas) canvas.parentElement.innerHTML = '<p class="muted small">Gráfico indisponível (sem internet para carregar a biblioteca).</p>'; return; }
  const cs = getComputedStyle(document.documentElement);
  window.Chart.defaults.color = cs.getPropertyValue('--ink-2').trim();
  window.Chart.defaults.borderColor = cs.getPropertyValue('--line').trim();
  window.Chart.defaults.font.family = cs.getPropertyValue('--font').trim();
  window.Chart.defaults.font.size = 13;
  graficos.push(new window.Chart(canvas, { ...cfg, options: { responsive: true, maintainAspectRatio: false, animation: false, ...(cfg.options || {}) } }));
}
const corVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const limparGraficos = () => { while (graficos.length) graficos.pop().destroy(); };
window.addEventListener('hashchange', limparGraficos);

const ehVenda = (m) => m.tipo === 'saida' && !m.estornado && MOTIVOS_VENDA.includes(m.motivo);
const custoMov = (m) => Math.abs(m.qtd) * Number(m.custo_unitario || 0);

ROTAS.painel = async (el) => {
  const hoje = hojeISO();
  const de = inicioMes(isoShift(inicioMes(hoje), { m: -5 }));
  const [movs] = await Promise.all([rpc('movimentacoes', { p_de: de, p_ate: hoje }), produtosRapido()]);
  // pedidos de estorno: o número já veio ao abrir; confere de novo em segundo plano
  rpc('estornos', { p_status: 'pendente' }).then((pend) => { const n = (pend || []).length; if (n !== S.pendentes) { S.pendentes = n; desenharNav(); } }).catch(() => {});
  const ativos = S.produtos.filter((p) => p.ativo);
  const baixos = ativos.filter((p) => p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo).sort((a, b) => a.saldo - b.saldo);
  const mes = inicioMes(hoje);
  const doMes = (movs || []).filter((m) => m.data && new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(m.data)) >= mes);
  const vivosMes = doMes.filter((m) => !m.estornado && m.tipo !== 'estorno');
  const vendasMes = vivosMes.filter(ehVenda);
  const fat = sum(vendasMes, (m) => m.valor_total), cus = sum(vendasMes, custoMov);
  const ent = vivosMes.filter((m) => m.tipo === 'entrada');
  const sai = vivosMes.filter((m) => m.tipo === 'saida');
  const valCusto = sum(S.produtos, (p) => Math.max(p.saldo, 0) * p.custo);
  const valVenda = sum(S.produtos, (p) => Math.max(p.saldo, 0) * p.preco);
  const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(mes + 'T12:00:00Z'));

  el.innerHTML = `<div class="page-head"><h1>Painel</h1><span class="muted">Mês de ${esc(nomeMes)}</span></div>
    ${S.pendentes ? `<a href="#/estornos" class="warn-box" style="display:block;text-decoration:none"><b>${S.pendentes}</b> pedido(s) de estorno aguardando sua aprovação →</a>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Estoque a custo</div><div class="k-val">${brl(valCusto)}</div><div class="k-sub">${nf(sum(S.produtos, (p) => Math.max(p.saldo, 0)))} unidades</div></div>
      <div class="kpi"><div class="k-label">Estoque a preço de venda</div><div class="k-val">${brl(valVenda)}</div></div>
      <div class="kpi ${baixos.length ? 'alert' : ''}"><div class="k-label">Itens para repor</div><div class="k-val">${nf(baixos.length)}</div><div class="k-sub">no mínimo ou abaixo</div></div>
      <div class="kpi"><div class="k-label">Faturamento do mês</div><div class="k-val">${brl(fat)}</div><div class="k-sub">${nf(sum(vendasMes, (m) => -m.qtd))} peças vendidas</div></div>
      <div class="kpi"><div class="k-label">Lucro bruto do mês</div><div class="k-val">${brl(fat - cus)}</div><div class="k-sub">margem ${pct(fat ? (fat - cus) / fat : NaN)}</div></div>
      <div class="kpi"><div class="k-label">Entradas do mês</div><div class="k-val">${nf(sum(ent, (m) => m.qtd))}</div><div class="k-sub">${brl(sum(ent, (m) => m.valor_total))} em compras</div></div>
      <div class="kpi"><div class="k-label">Saídas do mês</div><div class="k-val">${nf(sum(sai, (m) => -m.qtd))}</div><div class="k-sub">todas as saídas</div></div>
      ${S.produtos.some((p) => p.controla_serie) ? (() => { const pr = S.produtos.filter((p) => p.controla_serie); const venc = sum(pr, (p) => p.vencidas), v90 = sum(pr, (p) => p.vence_90);
        void venc; void v90; const rep = pr.filter((p) => p.ativo && p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo).length;
        return `<a class="kpi ${rep ? 'alert' : ''}" href="#/proteses" style="text-decoration:none;color:inherit"><div class="k-label">Próteses em estoque</div><div class="k-val">${nf(sum(pr, (p) => Math.max(p.saldo, 0)))}</div><div class="k-sub">${rep ? `${nf(rep)} volume(s) para repor` : 'ver por volume'}</div></a>`; })() : ''}
    </div>
    <div class="cols2">
      <div class="card"><h2>Faturamento e lucro — últimos 6 meses</h2><div class="chart-box"><canvas id="g-meses"></canvas></div></div>
      <div class="card"><h2>Mais vendidos no mês</h2><div class="chart-box"><canvas id="g-top"></canvas></div></div>
    </div>
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2 style="margin:0;flex:1">Para repor</h2>${baixos.length ? '<button class="btn out sm" id="pn-repor">Criar lista de reposição</button>' : ''}</div>${baixos.length ? `<div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Saldo</th><th class="num">Mínimo</th></tr></thead><tbody>
      ${baixos.slice(0, 15).map((p) => `<tr><td>${esc(p.nome)}<div class="small muted">${esc(p.sku)}</div></td><td class="num"><b style="color:var(--out)">${nf(p.saldo)}</b></td><td class="num">${nf(p.estoque_minimo)}</td></tr>`).join('')}
      </tbody></table></div>${baixos.length > 15 ? `<p class="muted small" style="margin-top:8px">E mais ${baixos.length - 15}. Veja o relatório de reposição.</p>` : ''}` : '<p class="muted">Nenhum item abaixo do mínimo. </p>'}</div>`;

  const bRepor = el.querySelector('#pn-repor'); if (bRepor) bRepor.onclick = () => tentar(listaReposicao);
  await garantirChart();
  // gráfico por mês
  const meses = []; for (let i = 5; i >= 0; i--) meses.push(isoShift(inicioMes(hoje), { m: -i }).slice(0, 7));
  const porMes = groupBy((movs || []).filter(ehVenda), (m) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(m.data)).slice(0, 7));
  const rot = meses.map((k) => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(k + '-15T12:00:00Z')).replace('.', ''));
  const fatM = meses.map((k) => sum(porMes[k] || [], (m) => m.valor_total));
  const lucM = meses.map((k, i) => fatM[i] - sum(porMes[k] || [], custoMov));
  grafico(el.querySelector('#g-meses'), { type: 'bar', data: { labels: rot, datasets: [
    { label: 'Faturamento', data: fatM, backgroundColor: corVar('--accent'), borderRadius: 4 },
    { label: 'Lucro bruto', data: lucM, backgroundColor: corVar('--in'), borderRadius: 4 }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + brl(c.raw) } } }, scales: { y: { ticks: { callback: (v) => brl(v).replace(',00', '') } } } } });
  const top = Object.entries(groupBy(vendasMes, (m) => m.produto)).map(([k, v]) => [k, sum(v, (m) => -m.qtd)]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!top.length) el.querySelector('#g-top').parentElement.innerHTML = '<div class="empty">Ainda não há vendas neste mês.</div>';
  else grafico(el.querySelector('#g-top'), { type: 'bar', data: { labels: top.map((t) => t[0].length > 34 ? t[0].slice(0, 33) + '…' : t[0]), datasets: [{ label: 'Peças', data: top.map((t) => t[1]), backgroundColor: corVar('--out'), borderRadius: 4, maxBarThickness: 40 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } } } } });
};

/* =========================================================
   PRODUTOS (admin)
   ========================================================= */
ROTAS.produtos = async (el) => {
  await produtosRapido();
  rpc('listas').then((l) => { if (l) { S.listas = l; salvarCache(); } }).catch(() => {});
  const adm = isAdmin(), gest = true;
  const ate = liberadoAte();
  el.innerHTML = `<div class="page-head"><h1>Produtos</h1><button class="btn primary" id="pr-novo">+ Novo produto</button></div>
    ${gest || !ate ? '' : `<div class="info-box">Cadastro de produtos novos liberado para você até <b>${esc(dt(ate.toISOString()))}</b>. Produtos já cadastrados só podem ser alterados pelo administrador.</div>`}
    <div class="toolbar"><div class="field grow"><label for="pr-q">Buscar</label><div class="busca-linha"><input id="pr-q" type="search" placeholder="Nome, tamanho, código, marca…" enterkeyhint="search">${botaoCamera()}</div></div>
    <label class="check ${isGestor() ? '' : 'hidden'}"><input type="checkbox" id="pr-inat"> Mostrar inativos</label></div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Produto</th>${adm ? '<th class="num">Custo</th>' : ''}<th class="num">Venda</th>${adm ? '<th class="num">Margem</th>' : ''}<th class="num">Mín.</th><th class="num">Saldo</th>${gest ? '<th></th>' : ''}</tr></thead><tbody id="pr-body"></tbody></table></div>`;
  const q = el.querySelector('#pr-q'), inat = el.querySelector('#pr-inat');
  const desenhar = () => {
    const termos = norm(q.value).split(/\s+/).filter(Boolean);
    const lista = S.produtos.filter((p) => inat.checked || p.ativo).filter((p) => { const a = norm([p.nome, p.sku, p.marca, p.fornecedor, p.codigo_barras].join(' ')); return termos.every((t) => a.includes(t)); });
    el.querySelector('#pr-body').innerHTML = lista.length ? lista.map((p) => `<tr class="${p.ativo ? '' : 'estornado'}">
      <td class="nowrap">${esc(p.sku)}${p.codigo_barras ? `<div class="small muted">${esc(p.codigo_barras)}</div>` : ''}</td><td>${esc(p.nome)}<div class="small muted">${esc([p.marca, p.fornecedor].filter(Boolean).join(' · '))}</div></td>
      ${adm ? `<td class="num">${p.controla_serie ? '—' : brl(p.custo)}</td>` : ''}<td class="num">${p.controla_serie ? '—' : brl(p.preco)}</td>${adm ? `<td class="num">${p.controla_serie ? '—' : pct(p.preco ? (p.preco - p.custo) / p.preco : NaN)}</td>` : ''}
      <td class="num">${nf(p.estoque_minimo)}</td><td class="num"><b>${nf(p.saldo)}</b></td>
      ${gest ? `<td><button class="btn sm" data-ed="${p.id}">Editar</button></td>` : ''}</tr>`).join('') : `<tr><td colspan="${adm ? 8 : gest ? 6 : 5}" class="muted">Nenhum produto. Clique em “+ Novo produto”.</td></tr>`;
  };
  [q, inat].forEach((x) => x.addEventListener('input', desenhar));
  el.querySelector('#pr-novo').onclick = () => formProduto(null, desenhar);
  const abrirCodigo = (cod) => {
    const p = produtoPorCodigo(cod);
    if (p) { inat.checked = inat.checked || !p.ativo; q.value = p.sku; desenhar(); if (gest) formProduto(p, desenhar); return; }
    codigoNaoCadastrado(limpaCodigo(cod), () => desenhar());
  };
  aoLerCodigo = abrirCodigo;
  el.querySelector('[data-cam]').onclick = async () => { const c = await lerCodigoCamera(); if (c) abrirCodigo(c); };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = limpaCodigo(q.value); if (produtoPorCodigo(v) || /^[0-9]{6,}$/.test(v)) abrirCodigo(v); } });
  el.querySelector('#pr-body').onclick = (e) => { const b = e.target.closest('[data-ed]'); if (b) formProduto(S.produtos.find((p) => p.id === Number(b.dataset.ed)), desenhar); };
  aoAtualizarDados = () => { if (el.isConnected) desenhar(); };
  desenhar();
};

function formProduto(p, depois, inicial = {}) {
  const L = S.listas; const novo = !p; p = p || { ativo: true, estoque_minimo: 0, ...inicial };
  const tamanhos = L.tamanho || [];
  modal(novo ? 'Novo produto' : 'Editar produto', `<form id="f-prod" novalidate>
    <div class="grid2">
      <div class="field"><label for="p-tipo">Tipo</label><select id="p-tipo" required>${optionsHtml(L.tipo, p.tipo, 'Selecione')}</select></div>
      <div class="field" id="p-modelo-campo"><label for="p-modelo">Modelo</label><input id="p-modelo" type="text" value="${esc(p.modelo)}" placeholder="${esc(dicaTipo(p.tipo).modelo)}" required></div>
    </div>
    <div id="p-prot" class="hidden">${(() => {
      const partes = String(p.modelo || '').split(' · ');
      const pega = (lista) => partes.find((x) => lista.includes(x)) || '';
      const linha = partes.filter((x) => ![...P_FORMATOS, ...P_PERFIS, ...P_SUPERFICIES].includes(x)).join(' · ');
      return `<div class="grid2">
        <div class="field"><label for="pp-linha">Linha / modelo</label><input id="pp-linha" type="text" value="${esc(ehProtese(p.tipo) ? linha : '')}" placeholder="Ex.: Lumina, Inspira, Ergonomix"></div>
        <div class="field"><label for="pp-formato">Formato</label><select id="pp-formato">${optionsHtml(P_FORMATOS, pega(P_FORMATOS) || 'Redonda')}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="pp-perfil">Perfil</label><select id="pp-perfil">${optionsHtml(P_PERFIS, pega(P_PERFIS), 'Selecione')}</select></div>
        <div class="field"><label for="pp-sup">Superfície</label><select id="pp-sup">${optionsHtml(P_SUPERFICIES, pega(P_SUPERFICIES), 'Selecione')}</select></div>
      </div>
      <div class="field"><label for="pp-vol">${novo ? 'Volumes (ml)' : 'Volume (ml)'}</label>
        <input id="pp-vol" type="text" inputmode="numeric" value="${esc(novo ? '' : String(parseInt(p.tamanho, 10) || ''))}" placeholder="${novo ? 'Ex.: 250 275 300 325' : 'Ex.: 300'}">
        <span class="hint">${novo ? 'Digite um ou vários volumes separados por espaço: cada volume vira um item de estoque.' : ''}</span></div>`;
    })()}</div>
    <div class="info-box dica-tipo ${dicaTipo(p.tipo).dica ? '' : 'hidden'}" id="p-dica">${esc(dicaTipo(p.tipo).dica)}</div>
    <div>
    </div>
    <div id="p-tams-bloco">${novo ? `<div class="field"><span class="label">Tamanhos</span><span class="hint">Marque um ou vários — cada tamanho vira um item de estoque.</span>
        <div class="pills">${tamanhos.map((t) => `<label class="pill"><input type="checkbox" name="tam" value="${esc(t)}"><span>${esc(t)}</span></label>`).join('')}</div></div>`
      : `<div class="field"><label for="p-tam">Tamanho</label><select id="p-tam">${optionsHtml([...new Set([...tamanhos, p.tamanho])], p.tamanho)}</select></div>`}</div>
    <div class="grid3">
      <div class="field" id="p-cor-campo"><label for="p-cor">Cor</label><input id="p-cor" type="text" value="${esc(p.cor)}"></div>
      <div class="field"><label for="p-marca">Marca</label><input id="p-marca" type="text" value="${esc(p.marca)}"></div>
      <div class="field"><label for="p-forn">Fornecedor</label><input id="p-forn" type="text" list="dl-pforn" value="${esc(p.fornecedor)}">${datalist('dl-pforn', L.fornecedor)}</div>
    </div>
    <div class="grid3" id="p-valores">
      <div class="field" id="p-custo-campo"><label for="p-custo">Custo (R$)${isAdmin() ? '' : ' <span class="muted">(se souber)</span>'}</label><input id="p-custo" type="text" inputmode="decimal" value="${money2(p.custo)}"></div>
      <div class="field" id="p-preco-campo"><label for="p-preco">Preço de venda (R$)</label><input id="p-preco" type="text" inputmode="decimal" value="${money2(p.preco)}"></div>
      <div class="field"><label for="p-min">Estoque mínimo</label><input id="p-min" type="number" inputmode="numeric" min="0" value="${p.estoque_minimo ?? 0}"><span class="hint">Quando o estoque chegar a esse número, aparece o aviso <b>repor</b>. Use 0 para não avisar.</span></div>
    </div>
    <p class="muted small" id="p-margem"></p>
    ${novo ? `<div class="field"><span class="label">Código de barras de cada tamanho <span class="muted">(opcional)</span></span>
      <span class="hint">Leia a embalagem de cada tamanho com a câmera ou o leitor de mão — cada tamanho tem um código diferente. Pode deixar vazio e gravar depois.</span>
      <div id="p-cbs" class="cb-lista"></div></div>`
    : `<div class="field"><label for="p-cb">Código de barras do fabricante <span class="muted">(opcional)</span></label>
      <div class="busca-linha"><input id="p-cb" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" value="${esc(p.codigo_barras)}" placeholder="Leia com a câmera ou o leitor de mão">${botaoCamera('data-cbcam')}</div>
      <span class="hint">Cada tamanho/cor tem o seu próprio código de barras.</span></div>`}
    <div class="grid2 ${isGestor() ? '' : 'hidden'}">
      <div class="field"><label for="p-sku">Código (SKU)</label><input id="p-sku" type="text" value="${esc(novo ? '' : p.sku)}" placeholder="${novo ? 'Automático se vazio' : ''}" ${novo ? 'disabled title="Gerado automaticamente"' : ''}></div>
      <div class="field"><span class="label">Situação</span><label class="check"><input type="checkbox" id="p-ativo" ${p.ativo ? 'checked' : ''}> Ativo (aparece para os operadores)</label></div>
    </div>
    <div class="field"><label for="p-obs">Observações</label><textarea id="p-obs">${esc(p.observacoes)}</textarea></div>
    <div class="btn-row end">${novo || !isAdmin() ? '' : '<button type="button" class="btn danger" id="p-apagar">Apagar</button><button type="button" class="btn" id="p-hist">Histórico de preços</button>'}<button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div>
  </form>`, {
    onMount(b, close) {
      const mg = () => { const c = parseNum(b.querySelector('#p-custo').value) || 0, v = parseNum(b.querySelector('#p-preco').value) || 0; b.querySelector('#p-margem').textContent = v ? `Margem: ${pct((v - c) / v)} · lucro por ${ehPorPar(b.querySelector('#p-tipo').value) ? 'par' : 'peça'} ${brl(v - c)}` : ''; };
      const modoProtese = () => {
        const pr = ehProtese(b.querySelector('#p-tipo').value);
        b.querySelector('#p-prot').classList.toggle('hidden', !pr);
        b.querySelector('#p-tams-bloco').classList.toggle('hidden', pr);
        b.querySelector('#p-modelo-campo').classList.toggle('hidden', pr);
        b.querySelector('#p-cor-campo').classList.toggle('hidden', pr);
        b.querySelector('#p-custo-campo').classList.toggle('hidden', pr || !isAdmin());
        b.querySelector('#p-preco-campo').classList.toggle('hidden', pr);
        b.querySelector('#p-margem').classList.toggle('hidden', pr || !isAdmin());
      };
      modoProtese();
      b.querySelector('#p-tipo').addEventListener('change', modoProtese);
      b.querySelector('#p-tipo').addEventListener('change', () => {
        const d = dicaTipo(b.querySelector('#p-tipo').value);
        b.querySelector('#p-modelo').placeholder = d.modelo;
        const box = b.querySelector('#p-dica'); box.textContent = d.dica; box.classList.toggle('hidden', !d.dica);
        const u0 = b.querySelector('input[name=tam][value="Único"]');
        if (!d.unico && u0 && u0.dataset.auto) { u0.checked = false; delete u0.dataset.auto; } // desfaz o "Único" marcado sozinho
        if (d.unico) {
          const u = b.querySelector('input[name=tam][value="Único"]');
          if (u && ![...b.querySelectorAll('input[name=tam]:checked')].length) { u.checked = true; u.dataset.auto = '1'; }
          const sel = b.querySelector('#p-tam'); if (sel && [...sel.options].some((o) => o.value === 'Único') && !p.id) sel.value = 'Único';
        }
        mg();
      });
      b.querySelector('#p-custo').oninput = mg; b.querySelector('#p-preco').oninput = mg; mg();
      const cbs = {}; // código de barras por tamanho (cadastro novo)
      if (!novo) {
        b.querySelector('#p-cb').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        b.querySelector('[data-cbcam]').onclick = async () => { const c = await lerCodigoCamera('Ler código de barras'); if (c) b.querySelector('#p-cb').value = c; };
      } else {
        // um campo de código para cada tamanho (ou volume) marcado
        const box = b.querySelector('#p-cbs');
        let pendente = limpaCodigo(p.codigo_barras || ''); // código lido antes de abrir o cadastro
        const chaves = () => (ehProtese(b.querySelector('#p-tipo').value)
          ? volumesDe(b.querySelector('#pp-vol').value).map((v) => v + ' ml')
          : [...b.querySelectorAll('input[name=tam]:checked')].map((x) => x.value));
        const proximo = (atual) => {
          const ins = [...box.querySelectorAll('input[data-cbt]')];
          const n = ins.slice(ins.indexOf(atual) + 1).find((i) => !i.value.trim());
          if (n) n.focus(); else if (atual) atual.blur();
        };
        const desenharCbs = () => {
          const ks = chaves();
          if (pendente && ks.length) { if (!cbs[ks[0]]) cbs[ks[0]] = pendente; pendente = ''; }
          box.innerHTML = ks.length ? ks.map((k) => `<div class="cb-linha"><span class="cb-tam">${esc(k)}</span>
              <input data-cbt="${esc(k)}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" value="${esc(cbs[k] || '')}" placeholder="Ler código do ${esc(k)}" aria-label="Código de barras do tamanho ${esc(k)}">
              ${botaoCamera(`data-cbtcam="${esc(k)}"`)}</div>`).join('')
            : `<p class="muted small">${pendente ? `Código lido: <b>${esc(pendente)}</b> — marque o tamanho dele acima.` : 'Marque o(s) tamanho(s) acima e aparece um campo de código para cada um.'}</p>`;
          box.querySelectorAll('input[data-cbt]').forEach((i) => {
            i.oninput = () => { cbs[i.dataset.cbt] = i.value; };
            i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); cbs[i.dataset.cbt] = i.value; if (i.value.trim()) proximo(i); } };
          });
          box.querySelectorAll('[data-cbtcam]').forEach((btn) => {
            btn.onclick = async () => {
              const k = btn.dataset.cbtcam; const c = await lerCodigoCamera(`Código de barras — ${k}`);
              if (!c) return; const i = box.querySelector(`input[data-cbt="${CSS.escape(k)}"]`);
              cbs[k] = c; if (i) { i.value = c; proximo(i); }
            };
          });
        };
        b.querySelectorAll('input[name=tam]').forEach((x) => x.addEventListener('change', desenharCbs));
        b.querySelector('#pp-vol').addEventListener('input', desenharCbs);
        b.querySelector('#p-tipo').addEventListener('change', desenharCbs);
        desenharCbs();
      }
      const apg = b.querySelector('#p-apagar');
      if (apg) apg.onclick = () => { close(); apagarProduto(S.produtos.find((x) => x.id === p.id) || p, depois); };
      const h = b.querySelector('#p-hist');
      if (h) h.onclick = async () => {
        const hist = await tentar(() => rpc('historico_precos', { p_produto: p.id })); if (!hist) return;
        modal('Histórico de preços', hist.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th class="num">Custo</th><th class="num">Venda</th><th>Por</th></tr></thead><tbody>
          ${hist.map((x) => `<tr><td>${dt(x.data)}</td><td class="num">${x.custo_ant !== null ? brl(x.custo_ant) + ' → ' : ''}${brl(x.custo_novo)}</td><td class="num">${x.preco_ant !== null ? brl(x.preco_ant) + ' → ' : ''}${brl(x.preco_novo)}</td><td>${esc(x.usuario)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Sem alterações registradas.</p>');
      };
      b.querySelector('#f-prod').onsubmit = async (e) => {
        e.preventDefault();
        const val = (id) => b.querySelector(id).value.trim();
        const custo = parseNum(val('#p-custo')), preco = parseNum(val('#p-preco'));
        const prot = ehProtese(val('#p-tipo'));
        let volumes = [];
        if (prot) {
          b.querySelector('#p-modelo').value = [val('#pp-linha'), val('#pp-formato'), val('#pp-perfil'), val('#pp-sup')].filter(Boolean).join(' · ');
          volumes = volumesDe(val('#pp-vol'));
          if (!volumes.length) return toast('Informe o volume da prótese em ml (ex.: 300).', 'err');
          if (!novo && volumes.length > 1) return toast('Ao editar, informe um volume só.', 'err');
          if (!val('#pp-perfil')) return toast('Escolha o perfil da prótese.', 'err');
          b.querySelector('#p-cor').value = '';
        }
        if (!val('#p-tipo') || !val('#p-modelo')) return toast('Preencha tipo e modelo.', 'err');
        if (Number.isNaN(custo) || Number.isNaN(preco)) return toast('Confira custo e preço.', 'err');
        const base = { tipo: val('#p-tipo'), modelo: val('#p-modelo'), cor: val('#p-cor'), marca: val('#p-marca'), fornecedor: val('#p-forn'),
          custo: custo || 0, preco: preco || 0, estoque_minimo: parseInt(val('#p-min'), 10) || 0, ativo: b.querySelector('#p-ativo').checked, observacoes: val('#p-obs'),
          codigo_barras: novo ? null : (limpaCodigo(val('#p-cb')) || null) };
        // cadastro novo: confere os códigos de cada tamanho antes de gravar qualquer um
        const codDe = (k) => limpaCodigo(cbs[k] || '') || null;
        if (novo) {
          const ks = prot ? volumes.map((v) => v + ' ml') : [...b.querySelectorAll('input[name=tam]:checked')].map((x) => x.value);
          const vistos = {};
          for (const k of ks) {
            const c = codDe(k); if (!c) continue;
            if (vistos[c]) return toast(`O mesmo código foi lido no ${vistos[c]} e no ${k}. Cada tamanho tem um código diferente — confira.`, 'err');
            vistos[c] = k;
            const outro = produtoPorCodigo(c);
            if (outro) return toast(`O código do ${k} (${c}) já está gravado em: ${outro.nome}.`, 'err');
          }
        }
        const ok = await tentar(async () => {
          if (prot) {
            if (novo) { for (const v of volumes) await rpc('salvar_produto', { p: { ...base, tamanho: v + ' ml', codigo_barras: codDe(v + ' ml') } }); return volumes.length; }
            await rpc('salvar_produto', { p: { ...base, id: p.id, sku: val('#p-sku'), tamanho: volumes[0] + ' ml' } });
            return 1;
          }
          if (novo) {
            const tams = [...b.querySelectorAll('input[name=tam]:checked')].map((x) => x.value);
            if (!tams.length) throw new Error('Marque pelo menos um tamanho.');
            for (const t of tams) await rpc('salvar_produto', { p: { ...base, tamanho: t, codigo_barras: codDe(t) } });
            return tams.length;
          }
          await rpc('salvar_produto', { p: { ...base, id: p.id, sku: val('#p-sku'), tamanho: val('#p-tam') } });
          return 1;
        }, e.submitter);
        if (!ok) return;
        toast(novo ? `${ok} item(ns) cadastrado(s).` : 'Produto atualizado.', 'ok');
        close(); await recarregarProdutos(); S.listas = (await rpc('listas')) || S.listas; depois && depois();
      };
    },
  });
}

/* =========================================================
   ETIQUETAS COM QR CODE (admin)
   ========================================================= */
ROTAS.etiquetas = async (el) => {
  await recarregarProdutos();
  el.innerHTML = `<div class="page-head"><h1>Etiquetas</h1></div>
    <div class="card no-print">
      <p>Imprima etiquetas com <b>QR code</b> para colar nos modeladores que não têm código de barras. Depois é só ler a etiqueta com a câmera ou o leitor de mão na Saída e na Entrada.</p>
      <div class="toolbar"><div class="field grow"><label for="et-q">Buscar</label><input id="et-q" type="search" placeholder="Nome, tamanho, código…"></div>
        <label class="check"><input type="checkbox" id="et-preco"> Mostrar preço</label>
        <label class="check"><input type="checkbox" id="et-saldo"> Quantidade = estoque atual</label></div>
      <div class="btn-row" style="margin-bottom:12px"><button class="btn sm" id="et-todos">Marcar todos</button><button class="btn sm" id="et-nenhum">Desmarcar</button></div>
      <div class="table-wrap" style="max-height:420px"><table><thead><tr><th></th><th>Produto</th><th class="num">Estoque</th><th class="num">Etiquetas</th></tr></thead><tbody id="et-body"></tbody></table></div>
      <div class="btn-row" style="margin-top:14px"><button class="btn primary big" id="et-imprimir">Imprimir etiquetas</button><span class="muted" id="et-total" style="align-self:center"></span></div>
      <p class="muted small" style="margin-top:10px">Folha A4 com 3 colunas × 7 linhas (etiquetas de 63,5 × 38,1 mm, tipo Pimaco A4360/A4260). Também dá para imprimir em papel comum e recortar.</p>
    </div>
    <div id="etiquetas-saida"></div>`;
  const $ = (x) => el.querySelector(x);
  const qtd = {}; // id -> quantidade
  const ativos = () => S.produtos.filter((p) => p.ativo);
  const desenharLista = () => {
    const termos = norm($('#et-q').value).split(/\s+/).filter(Boolean);
    const lista = ativos().filter((p) => { const a = norm([p.nome, p.sku, p.codigo_barras].join(' ')); return termos.every((t) => a.includes(t)); });
    $('#et-body').innerHTML = lista.length ? lista.map((p) => `<tr>
      <td><label class="check" style="min-height:0"><input type="checkbox" data-sel="${p.id}" ${qtd[p.id] ? 'checked' : ''} aria-label="Selecionar ${esc(p.nome)}"></label></td>
      <td>${esc(p.nome)}<div class="small muted">${esc(p.sku)}</div></td><td class="num">${nf(p.saldo)}</td>
      <td class="num"><input type="number" inputmode="numeric" min="0" max="200" data-q="${p.id}" value="${qtd[p.id] || 0}" style="width:90px;min-height:44px;text-align:center"></td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">Nenhum produto.</td></tr>';
    totais();
  };
  const totais = () => {
    const n = Object.values(qtd).reduce((a, b) => a + (b || 0), 0);
    $('#et-total').textContent = n ? `${nf(n)} etiqueta(s) · ${nf(Math.ceil(n / 21))} folha(s)` : 'Nenhuma etiqueta selecionada';
  };
  const padrao = (p) => ($('#et-saldo').checked ? Math.max(p.saldo, 1) : 1);
  $('#et-q').oninput = desenharLista;
  $('#et-body').addEventListener('input', (e) => {
    const s = e.target.closest('[data-sel]'), q = e.target.closest('[data-q]');
    if (s) { const p = S.produtos.find((x) => x.id === Number(s.dataset.sel)); qtd[p.id] = s.checked ? padrao(p) : 0; desenharLista(); }
    if (q) { const v = Math.min(200, Math.max(0, parseInt(q.value, 10) || 0)); qtd[Number(q.dataset.q)] = v; const cb = el.querySelector(`[data-sel="${q.dataset.q}"]`); if (cb) cb.checked = v > 0; totais(); }
  });
  $('#et-saldo').onchange = () => { Object.keys(qtd).forEach((id) => { if (qtd[id]) qtd[id] = padrao(S.produtos.find((p) => p.id === Number(id))); }); desenharLista(); };
  $('#et-todos').onclick = () => { ativos().forEach((p) => { qtd[p.id] = qtd[p.id] || padrao(p); }); desenharLista(); };
  $('#et-nenhum').onclick = () => { Object.keys(qtd).forEach((k) => delete qtd[k]); desenharLista(); };
  $('#et-imprimir').onclick = (e) => tentar(async () => {
    const itens = S.produtos.filter((p) => qtd[p.id] > 0);
    if (!itens.length) throw new Error('Marque pelo menos um produto.');
    await carregarScript(LIBS.qr);
    const preco = $('#et-preco').checked;
    const svg = (txt) => { const q = window.qrcode(0, 'M'); q.addData(txt); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
    const blocos = [];
    itens.forEach((p) => {
      const qr = svg(p.sku);
      const html = `<div class="etiqueta"><div class="qr">${qr}</div><div class="et-txt">
        <div class="et-nome">${esc(p.tipo)} ${esc(p.modelo)}</div>
        <div class="et-tam">${esc(p.tamanho)}${p.cor ? ' · ' + esc(p.cor) : ''}</div>
        <div class="et-sku">${esc(p.sku)}${preco ? ' · ' + brl(p.preco) : ''}</div></div></div>`;
      for (let i = 0; i < qtd[p.id]; i++) blocos.push(html);
    });
    $('#etiquetas-saida').innerHTML = `<h2 class="no-print" style="margin-top:8px">Prévia</h2><div class="folha-etiquetas">${blocos.join('')}</div>`;
    await new Promise((r) => setTimeout(r, 150));
    document.body.classList.add('imprimir-etiquetas'); window.print();
    setTimeout(() => document.body.classList.remove('imprimir-etiquetas'), 500);
  }, e.currentTarget);
  desenharLista();
};

/* =========================================================
   ESTORNOS (admin)
   ========================================================= */
ROTAS.estornos = async (el) => {
  el.innerHTML = `<div class="page-head"><h1>Estornos</h1></div>
    <div class="tabs"><button data-st="pendente" class="on">Pendentes</button><button data-st="">Todos</button></div><div class="list" id="et-lista"></div>`;
  let st = 'pendente'; let itens = [];
  const carregar = async () => {
    itens = (await rpc('estornos', { p_status: st || null })) || [];
    if (st === 'pendente') S.pendentes = itens.length;
    el.querySelector('#et-lista').innerHTML = itens.length ? itens.map((e) => {
      const m = e.mov;
      return `<div class="card" style="margin:0"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        ${rotuloTipo(m)} <b>${esc(m.produto)}</b> <span class="badge">${m.qtd > 0 ? '+' : ''}${nf(m.qtd)} un.</span>
        ${e.status === 'pendente' ? '<span class="badge warn">pendente</span>' : e.status === 'aprovado' ? '<span class="badge in">aprovado</span>' : '<span class="badge out">recusado</span>'}</div>
        <div class="muted small">Lançamento #${m.id} de ${dt(m.data)} por ${esc(m.usuario)} · ${esc(m.motivo)}${m.paciente_nome ? ' · ' + esc(m.paciente_nome) : ''} · ${brl(m.valor_total)}</div>
        <p style="margin:10px 0"><b>Pedido por ${esc(e.solicitante)}</b> em ${dt(e.criado_em)}: “${esc(e.motivo)}”</p>
        ${e.status === 'pendente' ? `<div class="btn-row"><button class="btn in sm" data-ap="${e.id}">Aprovar estorno</button><button class="btn danger sm" data-rc="${e.id}">Recusar</button></div>`
          : `<p class="muted small" style="margin:0">Decidido por ${esc(e.decidido_por || '')} em ${dt(e.decidido_em)}${e.obs_decisao ? ' — ' + esc(e.obs_decisao) : ''}</p>`}
      </div>`;
    }).join('') : `<div class="empty">${st ? 'Nenhum pedido pendente.' : 'Nenhum pedido de estorno.'}</div>`;
  };
  el.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st = b.dataset.st; el.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); tentar(carregar); };
  el.querySelector('#et-lista').onclick = async (e) => {
    const ap = e.target.closest('[data-ap]'), rc = e.target.closest('[data-rc]');
    if (ap && await confirmar('Aprovar estorno', 'O lançamento será desfeito e o estoque corrigido.', { ok: 'Aprovar', kind: 'in' })) {
      if (await tentar(async () => { await rpc('decidir_estorno', { p_id: Number(ap.dataset.ap), p_aprovar: true, p_obs: null }); return true; })) { toast('Estorno aprovado.', 'ok'); carregar(); }
    }
    if (rc) {
      const obs = await confirmar('Recusar estorno', 'Explique ao operador por que o pedido foi recusado.', { ok: 'Recusar', kind: 'out', campo: 'Motivo da recusa' });
      if (obs && await tentar(async () => { await rpc('decidir_estorno', { p_id: Number(rc.dataset.rc), p_aprovar: false, p_obs: obs }); return true; })) { toast('Pedido recusado.', 'ok'); carregar(); }
    }
  };
  await carregar();
};

/* =========================================================
   RELATÓRIOS (admin)
   ========================================================= */
const RELATORIOS = [
  ['estoque', 'Posição de estoque'], ['movimentacoes', 'Movimentações (extrato)'], ['vendas', 'Vendas e margem'],
  ['cirurgias', 'Saídas por cirurgia'], ['reposicao', 'Reposição / abaixo do mínimo'], ['perdas', 'Perdas, avarias e cortesias'],
  ['operador', 'Lançamentos por operador'], ['abc', 'Curva ABC'],
];
const SEM_PERIODO = ['estoque', 'reposicao'];
const RELATORIOS_FINANCEIROS = ['vendas', 'abc']; // só o administrador

ROTAS.relatorios = async (el) => {
  await recarregarProdutos();
  const hoje = hojeISO();
  const tipos = [...new Set(S.produtos.map((p) => p.tipo))].sort();
  const tams = [...new Set(S.produtos.map((p) => p.tamanho))];
  el.innerHTML = `<div class="page-head"><h1>Relatórios</h1></div>
  <div class="card no-print">
    <div class="field"><label for="rl-tipo">Relatório</label><select id="rl-tipo">${RELATORIOS.filter(([k]) => isAdmin() || !RELATORIOS_FINANCEIROS.includes(k)).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
    <div id="rl-periodo"><div class="field"><span class="label">Período</span><div class="pills" id="rl-presets">
      ${[['hoje', 'Hoje'], ['mes', 'Este mês'], ['mesant', 'Mês passado'], ['90', 'Últimos 90 dias'], ['ano', 'Este ano']].map(([k, t]) => `<label class="pill"><input type="radio" name="pr" value="${k}" ${k === 'mes' ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
      <div class="grid2 keep"><div class="field"><label for="rl-de">De</label><input id="rl-de" type="date" value="${inicioMes(hoje)}"></div><div class="field"><label for="rl-ate">Até</label><input id="rl-ate" type="date" value="${hoje}"></div></div></div>
    <details><summary style="cursor:pointer;font-weight:600;padding:8px 0">Filtros</summary><div class="grid2" style="margin-top:10px">
      <div class="field"><label for="rl-ftipo">Tipo de produto</label><select id="rl-ftipo">${optionsHtml(tipos, '', 'Todos')}</select></div>
      <div class="field"><label for="rl-ftam">Tamanho</label><select id="rl-ftam">${optionsHtml(tams, '', 'Todos')}</select></div>
      <div class="field"><label for="rl-fprod">Produto contém</label><input id="rl-fprod" type="search" placeholder="Ex.: cinta 3 fechos"></div>
      <div class="field"><label for="rl-fmot">Motivo</label><select id="rl-fmot">${optionsHtml([...MOTIVOS_SAIDA, ...MOTIVOS_ENTRADA, 'Ajuste de inventário'], '', 'Todos')}</select></div>
      <div class="field"><label for="rl-fop">Operador</label><select id="rl-fop"><option value="">Todos</option></select></div>
    </div></details>
    <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="rl-gerar">Gerar relatório</button>
      <button class="btn" id="rl-csv" disabled>Exportar Excel</button><button class="btn" id="rl-pdf" disabled>PDF / Imprimir</button></div>
  </div>
  <div id="relatorio-saida"></div>`;
  const $ = (s) => el.querySelector(s);
  let cache = { de: null, ate: null, movs: [] }; let atual = null;
  const presets = { hoje: [hoje, hoje], mes: [inicioMes(hoje), hoje], mesant: [inicioMes(isoShift(inicioMes(hoje), { m: -1 })), fimMes(isoShift(inicioMes(hoje), { m: -1 }))], 90: [isoShift(hoje, { d: -89 }), hoje], ano: [hoje.slice(0, 4) + '-01-01', hoje] };
  $('#rl-presets').onchange = (e) => { const [a, b] = presets[e.target.value]; $('#rl-de').value = a; $('#rl-ate').value = b; };
  ['#rl-de', '#rl-ate'].forEach((s) => $(s).addEventListener('input', () => el.querySelectorAll('input[name=pr]').forEach((x) => { x.checked = false; })));
  const ajustaPeriodo = () => $('#rl-periodo').classList.toggle('hidden', SEM_PERIODO.includes($('#rl-tipo').value));
  $('#rl-tipo').onchange = ajustaPeriodo; ajustaPeriodo();

  const gerar = async () => {
    const tipo = $('#rl-tipo').value, de = $('#rl-de').value, ate = $('#rl-ate').value;
    if (!SEM_PERIODO.includes(tipo)) {
      if (!de || !ate || de > ate) throw new Error('Confira o período (data inicial antes da final).');
      if (cache.de !== de || cache.ate !== ate) cache = { de, ate, movs: (await rpc('movimentacoes', { p_de: de, p_ate: ate })) || [] };
      const ops = [...new Set(cache.movs.map((m) => m.usuario))].sort();
      const sel = $('#rl-fop').value; $('#rl-fop').innerHTML = optionsHtml(ops, sel, 'Todos');
    }
    const F = { tipo: $('#rl-ftipo').value, tam: $('#rl-ftam').value, prod: norm($('#rl-fprod').value), mot: $('#rl-fmot').value, op: $('#rl-fop').value };
    const okProd = (p) => (!F.tipo || p.tipo === F.tipo) && (!F.tam || p.tamanho === F.tam) && (!F.prod || F.prod.split(/\s+/).every((t) => norm(p.nome + ' ' + p.sku).includes(t)));
    const movs = cache.movs.filter((m) => okProd({ tipo: m.tipo_produto, tamanho: m.tamanho, nome: m.produto, sku: m.sku }) && (!F.mot || m.motivo === F.mot) && (!F.op || m.usuario === F.op));
    const prods = S.produtos.filter(okProd);
    atual = montarRelatorio(tipo, { movs, prods, de, ate });
    if (!isAdmin()) semValores(atual);
    atual.filtros = [F.tipo && 'Tipo: ' + F.tipo, F.tam && 'Tamanho: ' + F.tam, F.prod && 'Produto: ' + $('#rl-fprod').value, F.mot && 'Motivo: ' + F.mot, F.op && 'Operador: ' + F.op].filter(Boolean).join(' · ');
    atual.periodo = SEM_PERIODO.includes(tipo) ? 'Posição em ' + dOnly(hoje) : `${dOnly(de)} a ${dOnly(ate)}`;
    await garantirChart();
    desenharRelatorio($('#relatorio-saida'), atual);
    $('#rl-csv').disabled = false; $('#rl-pdf').disabled = false;
  };
  $('#rl-gerar').onclick = (e) => tentar(gerar, e.currentTarget);
  $('#rl-csv').onclick = () => atual && exportarCSV(atual);
  $('#rl-pdf').onclick = () => { document.body.classList.add('imprimir-relatorio'); window.print(); setTimeout(() => document.body.classList.remove('imprimir-relatorio'), 500); };
  await tentar(gerar);
};

const C = (label, key, fmt = 'txt') => ({ label, key, fmt });
const fmtCel = (v, fmt) => (fmt === 'brl' ? brl(v) : fmt === 'int' ? nf(v) : fmt === 'pct' ? pct(v) : fmt === 'dt' ? dt(v) : fmt === 'd' ? dOnly(v) : (v ?? ''));
const ehNum = (f) => ['brl', 'int', 'pct'].includes(f);

function montarRelatorio(tipo, { movs, prods }) {
  const titulo = (RELATORIOS.find((r) => r[0] === tipo) || [])[1];
  const vivos = movs.filter((m) => !m.estornado && m.tipo !== 'estorno');
  const vendas = vivos.filter(ehVenda);
  const R = { titulo, kpis: [], secoes: [], grafico: null, nota: '' };

  if (tipo === 'estoque') {
    const rows = prods.filter((p) => p.ativo || p.saldo !== 0).map((p) => ({ sku: p.sku, nome: p.nome, saldo: p.saldo, minimo: p.estoque_minimo, custo: p.custo, vcusto: Math.max(p.saldo, 0) * p.custo, preco: p.preco, vvenda: Math.max(p.saldo, 0) * p.preco }));
    R.kpis = [['Itens', nf(rows.length)], ['Unidades', nf(sum(rows, (r) => Math.max(r.saldo, 0)))], ['Valor a custo', brl(sum(rows, (r) => r.vcusto))], ['Valor a preço de venda', brl(sum(rows, (r) => r.vvenda))]];
    R.secoes.push({ cols: [C('Código', 'sku'), C('Produto', 'nome'), C('Saldo', 'saldo', 'int'), C('Mínimo', 'minimo', 'int'), C('Custo un.', 'custo', 'brl'), C('Valor custo', 'vcusto', 'brl'), C('Preço', 'preco', 'brl'), C('Valor venda', 'vvenda', 'brl')], rows, totais: ['saldo', 'vcusto', 'vvenda'] });
    const porTipo = Object.entries(groupBy(rows, (r) => prods.find((p) => p.sku === r.sku).tipo)).map(([k, v]) => [k, sum(v, (r) => r.vcusto)]);
    R.grafico = { type: 'doughnut', labels: porTipo.map((x) => x[0]), data: porTipo.map((x) => x[1]), label: 'Valor a custo', moeda: true };
  }

  if (tipo === 'movimentacoes') {
    const rows = movs.map((m) => ({ data: m.data, tipo: { saida: 'Saída', entrada: 'Entrada', ajuste: 'Ajuste', estorno: 'Estorno' }[m.tipo], motivo: m.motivo, produto: m.produto, qtd: m.qtd, total: m.valor_total, pag: m.forma_pagamento || '', paciente: m.paciente_nome || m.fornecedor || '', nf: m.nota_fiscal || '', usuario: m.usuario, sit: m.estornado ? 'Estornado' : '', _risca: m.estornado }));
    R.kpis = [['Lançamentos', nf(rows.length)], ['Entradas (un.)', nf(sum(vivos.filter((m) => m.tipo === 'entrada'), (m) => m.qtd))], ['Saídas (un.)', nf(sum(vivos.filter((m) => m.tipo === 'saida'), (m) => -m.qtd))], ['Ajustes (un.)', nf(sum(vivos.filter((m) => m.tipo === 'ajuste'), (m) => m.qtd))]];
    R.secoes.push({ cols: [C('Data', 'data', 'dt'), C('Tipo', 'tipo'), C('Motivo', 'motivo'), C('Produto', 'produto'), C('Qtd', 'qtd', 'int'), C('Valor', 'total', 'brl'), C('Pagamento', 'pag'), C('Paciente / fornecedor', 'paciente'), C('NF', 'nf'), C('Usuário', 'usuario'), C('Situação', 'sit')], rows });
  }

  if (tipo === 'vendas' || tipo === 'abc') {
    const agrupa = (fk) => Object.entries(groupBy(vendas, fk)).map(([k, v]) => {
      const fat = sum(v, (m) => m.valor_total), cus = sum(v, custoMov);
      return { chave: k, qtd: sum(v, (m) => -m.qtd), fat, desc: sum(v, (m) => m.desconto), cus, luc: fat - cus, mg: fat ? (fat - cus) / fat : NaN };
    }).sort((a, b) => b.fat - a.fat);
    const fat = sum(vendas, (m) => m.valor_total), cus = sum(vendas, custoMov);
    if (tipo === 'vendas') {
      R.kpis = [['Peças vendidas', nf(sum(vendas, (m) => -m.qtd))], ['Faturamento', brl(fat)], ['Descontos', brl(sum(vendas, (m) => m.desconto))], ['Custo', brl(cus)], ['Lucro bruto', brl(fat - cus)], ['Margem', pct(fat ? (fat - cus) / fat : NaN)]];
      const cols = (n) => [C(n, 'chave'), C('Peças', 'qtd', 'int'), C('Faturamento', 'fat', 'brl'), C('Descontos', 'desc', 'brl'), C('Custo', 'cus', 'brl'), C('Lucro', 'luc', 'brl'), C('Margem', 'mg', 'pct')];
      const tot = ['qtd', 'fat', 'desc', 'cus', 'luc'];
      const porProd = agrupa((m) => m.produto);
      R.secoes.push({ titulo: 'Por produto', cols: cols('Produto'), rows: porProd, totais: tot });
      R.secoes.push({ titulo: 'Por tamanho', cols: cols('Tamanho'), rows: agrupa((m) => m.tamanho), totais: tot });
      R.secoes.push({ titulo: 'Por forma de pagamento', cols: cols('Pagamento'), rows: agrupa((m) => m.forma_pagamento || 'Não informado'), totais: tot });
      R.secoes.push({ titulo: 'Por tipo de saída', cols: cols('Motivo'), rows: agrupa((m) => m.motivo), totais: tot });
      R.grafico = { type: 'bar', horizontal: true, labels: porProd.slice(0, 10).map((r) => r.chave), data: porProd.slice(0, 10).map((r) => r.fat), label: 'Faturamento', moeda: true };
      R.nota = 'Considera saídas com motivo “Venda à paciente” e “Incluído no pacote cirúrgico”, sem os estornados.';
    } else {
      let acum = 0;
      const rows = agrupa((m) => m.produto).map((r) => { acum += r.fat; const ac = fat ? acum / fat : 0; return { ...r, part: fat ? r.fat / fat : 0, acum: ac, classe: ac <= 0.8 || r === undefined ? 'A' : ac <= 0.95 ? 'B' : 'C' }; });
      rows.forEach((r, i) => { if (i === 0) r.classe = 'A'; });
      const cnt = (c) => rows.filter((r) => r.classe === c).length;
      R.kpis = [['Classe A (até 80%)', nf(cnt('A')) + ' produtos'], ['Classe B (80–95%)', nf(cnt('B')) + ' produtos'], ['Classe C (resto)', nf(cnt('C')) + ' produtos'], ['Faturamento', brl(fat)]];
      R.secoes.push({ cols: [C('Classe', 'classe'), C('Produto', 'chave'), C('Peças', 'qtd', 'int'), C('Faturamento', 'fat', 'brl'), C('% do total', 'part', 'pct'), C('% acumulado', 'acum', 'pct'), C('Margem', 'mg', 'pct')], rows, totais: ['qtd', 'fat'] });
      R.grafico = { type: 'bar', labels: rows.slice(0, 15).map((r) => r.chave), data: rows.slice(0, 15).map((r) => r.fat), label: 'Faturamento', moeda: true, horizontal: true };
      R.nota = 'Curva ABC pelo faturamento: A = produtos que somam os primeiros 80% do faturamento; B = até 95%; C = o restante.';
    }
  }

  if (tipo === 'cirurgias') {
    const sai = vivos.filter((m) => m.tipo === 'saida' && !['Perda / avaria', 'Uso interno'].includes(m.motivo));
    const porCir = Object.entries(groupBy(sai, (m) => m.cirurgia || 'Não informada')).map(([k, v]) => ({ cirurgia: k, pacientes: new Set(v.map((m) => norm(m.paciente_nome)).filter(Boolean)).size, pecas: sum(v, (m) => -m.qtd), valor: sum(v, (m) => m.valor_total) })).sort((a, b) => b.pecas - a.pecas);
    const det = Object.entries(groupBy(sai, (m) => (m.cirurgia || 'Não informada') + '|' + m.produto)).map(([k, v]) => ({ cirurgia: k.split('|')[0], produto: k.split('|')[1], pecas: sum(v, (m) => -m.qtd), valor: sum(v, (m) => m.valor_total) })).sort((a, b) => a.cirurgia.localeCompare(b.cirurgia) || b.pecas - a.pecas);
    R.kpis = [['Cirurgias diferentes', nf(porCir.length)], ['Pacientes', nf(new Set(sai.map((m) => norm(m.paciente_nome)).filter(Boolean)).size)], ['Peças', nf(sum(sai, (m) => -m.qtd))], ['Valor', brl(sum(sai, (m) => m.valor_total))]];
    R.secoes.push({ titulo: 'Resumo por cirurgia', cols: [C('Cirurgia', 'cirurgia'), C('Pacientes', 'pacientes', 'int'), C('Peças', 'pecas', 'int'), C('Valor', 'valor', 'brl')], rows: porCir, totais: ['pecas', 'valor'] });
    R.secoes.push({ titulo: 'Modeladores usados em cada cirurgia', cols: [C('Cirurgia', 'cirurgia'), C('Produto', 'produto'), C('Peças', 'pecas', 'int'), C('Valor', 'valor', 'brl')], rows: det });
    R.grafico = { type: 'bar', labels: porCir.map((r) => r.cirurgia), data: porCir.map((r) => r.pecas), label: 'Peças' };
    R.nota = 'Inclui vendas, pacote, cortesias e trocas (não inclui perdas e uso interno).';
  }

  if (tipo === 'reposicao') {
    const rows = prods.filter((p) => p.ativo && p.estoque_minimo > 0 && p.saldo <= p.estoque_minimo).map((p) => {
      const sug = Math.max(p.estoque_minimo * 2 - p.saldo, 0);
      return { sku: p.sku, nome: p.nome, forn: p.fornecedor || '', saldo: p.saldo, minimo: p.estoque_minimo, sug, custo: p.custo, total: sug * p.custo };
    }).sort((a, b) => a.saldo - b.saldo);
    R.kpis = [['Itens para repor', nf(rows.length)], ['Peças sugeridas', nf(sum(rows, (r) => r.sug))], ['Custo estimado da compra', brl(sum(rows, (r) => r.total))]];
    R.secoes.push({ cols: [C('Código', 'sku'), C('Produto', 'nome'), C('Fornecedor', 'forn'), C('Saldo', 'saldo', 'int'), C('Mínimo', 'minimo', 'int'), C('Comprar', 'sug', 'int'), C('Custo un.', 'custo', 'brl'), C('Custo total', 'total', 'brl')], rows, totais: ['sug', 'total'] });
    R.nota = 'Sugestão de compra = o suficiente para chegar ao dobro do estoque mínimo.';
  }

  if (tipo === 'perdas') {
    const ps = vivos.filter((m) => m.tipo === 'saida' && MOTIVOS_PERDA.includes(m.motivo));
    const aj = vivos.filter((m) => m.tipo === 'ajuste' && m.qtd < 0);
    const rows = [...ps, ...aj].sort((a, b) => (a.data < b.data ? 1 : -1)).map((m) => ({ data: m.data, motivo: m.motivo, produto: m.produto, qtd: -m.qtd, custo: custoMov(m), paciente: m.paciente_nome || '', obs: m.observacao || '', usuario: m.usuario }));
    const resumo = Object.entries(groupBy(rows, (r) => r.motivo)).map(([k, v]) => ({ motivo: k, qtd: sum(v, (r) => r.qtd), custo: sum(v, (r) => r.custo) }));
    R.kpis = [['Peças', nf(sum(rows, (r) => r.qtd))], ['Custo total', brl(sum(rows, (r) => r.custo))]];
    R.secoes.push({ titulo: 'Resumo por motivo', cols: [C('Motivo', 'motivo'), C('Peças', 'qtd', 'int'), C('Custo', 'custo', 'brl')], rows: resumo, totais: ['qtd', 'custo'] });
    R.secoes.push({ titulo: 'Detalhe', cols: [C('Data', 'data', 'dt'), C('Motivo', 'motivo'), C('Produto', 'produto'), C('Peças', 'qtd', 'int'), C('Custo', 'custo', 'brl'), C('Paciente', 'paciente'), C('Observação', 'obs'), C('Usuário', 'usuario')], rows, totais: ['qtd', 'custo'] });
    R.grafico = { type: 'doughnut', labels: resumo.map((r) => r.motivo), data: resumo.map((r) => r.custo), label: 'Custo', moeda: true };
    R.nota = 'Inclui cortesias, trocas, perdas/avarias, uso interno e ajustes de inventário que reduziram o estoque. Valores a preço de custo.';
  }

  if (tipo === 'operador') {
    const est = movs.filter((m) => m.tipo === 'estorno');
    const rows = Object.entries(groupBy(movs.filter((m) => m.tipo !== 'estorno'), (m) => m.usuario)).map(([k, v]) => {
      const vv = v.filter((m) => !m.estornado);
      return { usuario: k, lanc: v.length, ent: sum(vv.filter((m) => m.tipo === 'entrada'), (m) => m.qtd), sai: sum(vv.filter((m) => m.tipo === 'saida'), (m) => -m.qtd), fat: sum(vv.filter(ehVenda), (m) => m.valor_total), estornados: v.filter((m) => m.estornado).length };
    }).sort((a, b) => b.lanc - a.lanc);
    R.kpis = [['Operadores', nf(rows.length)], ['Lançamentos', nf(sum(rows, (r) => r.lanc))], ['Estornos feitos', nf(est.length)]];
    R.secoes.push({ cols: [C('Usuário', 'usuario'), C('Lançamentos', 'lanc', 'int'), C('Entradas (un.)', 'ent', 'int'), C('Saídas (un.)', 'sai', 'int'), C('Faturamento', 'fat', 'brl'), C('Estornados', 'estornados', 'int')], rows, totais: ['lanc', 'ent', 'sai', 'fat', 'estornados'] });
    R.grafico = { type: 'bar', labels: rows.map((r) => r.usuario), data: rows.map((r) => r.lanc), label: 'Lançamentos' };
  }
  return R;
}

// Gerente de estoque: tira dos relatórios tudo o que é dinheiro (custos, faturamento, lucro, margem)
function semValores(R) {
  R.kpis = R.kpis.filter(([k, v]) => !/R\$|margem|faturamento|custo|lucro/i.test(k + ' ' + v));
  R.secoes.forEach((sec) => {
    sec.cols = sec.cols.filter((c) => !['brl', 'pct'].includes(c.fmt));
    if (sec.totais) sec.totais = sec.totais.filter((k) => sec.cols.some((c) => c.key === k));
  });
  if (R.grafico && R.grafico.moeda) R.grafico = null;
  if (R.nota) R.nota = R.nota.replace(/ Valores a preço de custo\./, '');
  return R;
}

function desenharRelatorio(out, R) {
  limparGraficos();
  out.innerHTML = `<div class="print-only"><b>${esc(CFG.CLINICA || '')}</b> — Estoque de Modeladores</div>
    <h2 style="margin-top:8px">${esc(R.titulo)}</h2>
    <p class="muted">${esc(R.periodo)}${R.filtros ? ' · ' + esc(R.filtros) : ''} · gerado em ${dt(new Date().toISOString())} por ${esc(S.user.nome)}</p>
    ${R.kpis.length ? `<div class="kpis">${R.kpis.map(([k, v]) => `<div class="kpi"><div class="k-label">${esc(k)}</div><div class="k-val" style="font-size:1.25rem">${v}</div></div>`).join('')}</div>` : ''}
    ${R.grafico && R.grafico.data.length ? '<div class="card"><div class="chart-box"><canvas id="rl-graf"></canvas></div></div>' : ''}
    ${R.secoes.map((s) => `${s.titulo ? `<h3 style="margin-top:18px">${esc(s.titulo)}</h3>` : ''}
      ${s.rows.length ? `<div class="table-wrap"><table><thead><tr>${s.cols.map((c) => `<th class="${ehNum(c.fmt) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map((r) => `<tr class="${r._risca ? 'estornado' : ''}">${s.cols.map((c) => `<td class="${ehNum(c.fmt) ? 'num' : ''}">${esc(fmtCel(r[c.key], c.fmt))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${s.totais ? `<tfoot><tr>${s.cols.map((c, i) => `<td class="${ehNum(c.fmt) ? 'num' : ''}">${i === 0 ? 'Total' : s.totais.includes(c.key) ? esc(fmtCel(sum(s.rows, (r) => r[c.key]), c.fmt)) : ''}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div>` : '<div class="empty">Sem dados para este período e filtros.</div>'}`).join('')}
    ${R.nota ? `<p class="muted small" style="margin-top:12px">${esc(R.nota)}</p>` : ''}`;
  const g = R.grafico;
  if (g && g.data.length) {
    const paleta = ['--accent', '--out', '--in', '--warn', '--ink-3'].map(corVar).concat(['#7a5cc4', '#c25e9b', '#3a87c9', '#8a7a3a']);
    const fmt = (v) => (g.moeda ? brl(v) : nf(v));
    grafico(out.querySelector('#rl-graf'), g.type === 'doughnut'
      ? { type: 'doughnut', data: { labels: g.labels, datasets: [{ data: g.data, backgroundColor: paleta, borderWidth: 2, borderColor: corVar('--surface') }] }, options: { plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => c.label + ': ' + fmt(c.raw) } } } } }
      : { type: 'bar', data: { labels: g.labels.map((l) => (l.length > 36 ? l.slice(0, 35) + '…' : l)), datasets: [{ label: g.label, data: g.data, backgroundColor: corVar('--accent'), borderRadius: 4, maxBarThickness: 48 }] },
        options: { indexAxis: g.horizontal ? 'y' : 'x', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt(c.raw) } } }, scales: { [g.horizontal ? 'x' : 'y']: { ticks: { precision: 0, callback: (v) => (g.moeda ? brl(v).replace(',00', '') : nf(v)) } } } } });
  }
}

/* ---------------- exportação ---------------- */
function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCel = (v) => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvNum = (v, fmt) => {
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
  if (fmt === 'pct') return (Number(v) * 100).toFixed(1).replace('.', ',');
  if (fmt === 'brl') return Number(v).toFixed(2).replace('.', ',');
  if (fmt === 'dt') return dt(v);
  if (fmt === 'd') return dOnly(v);
  return v;
};
function exportarCSV(R) {
  const linhas = [[R.titulo], [R.periodo + (R.filtros ? ' · ' + R.filtros : '')], []];
  R.secoes.forEach((s) => {
    if (s.titulo) linhas.push([s.titulo]);
    linhas.push(s.cols.map((c) => c.label + (c.fmt === 'brl' ? ' (R$)' : c.fmt === 'pct' ? ' (%)' : '')));
    s.rows.forEach((r) => linhas.push(s.cols.map((c) => csvNum(r[c.key], c.fmt))));
    if (s.totais) linhas.push(s.cols.map((c, i) => (i === 0 ? 'Total' : s.totais.includes(c.key) ? csvNum(sum(s.rows, (r) => r[c.key]), c.fmt) : '')));
    linhas.push([]);
  });
  const csv = '﻿' + linhas.map((l) => l.map(csvCel).join(';')).join('\r\n');
  baixarArquivo(`${norm(R.titulo).replace(/[^a-z0-9]+/g, '-')}-${hojeISO()}.csv`, csv, 'text/csv;charset=utf-8');
}

/* =========================================================
   USUÁRIOS (admin)
   ========================================================= */
ROTAS.usuarios = async (el) => {
  const us = (await rpc('usuarios')) || [];
  el.innerHTML = `<div class="page-head"><h1>Usuários</h1><button class="btn primary" id="us-novo">+ Novo usuário</button></div>
    <div class="list">${us.map((u) => `<div class="row-item ${u.ativo ? '' : 'dim'}"><div class="main">
      <div class="title">${esc(u.nome)} <span class="badge ${u.perfil === 'admin' ? 'acc' : u.perfil === 'gerente' ? 'in' : ''}">${esc(nomePerfil(u.perfil))}</span>
        ${u.ativo ? '' : '<span class="badge">desativado</span>'} ${u.bloqueado ? '<span class="badge out">bloqueado</span>' : ''} ${u.trocar_senha ? '<span class="badge warn">troca de senha pendente</span>' : ''}</div>
      <div class="meta">Usuário: <b>${esc(u.login)}</b> · desde ${dOnly(u.criado_em)}</div>

      <div class="row-actions"><button class="btn sm" data-ed="${u.id}">Editar</button><button class="btn sm" data-pw="${u.id}">Redefinir senha</button>
</div>
    </div></div>`).join('')}</div>`;
  el.querySelector('#us-novo').onclick = () => formUsuario(null, () => render());
  el.querySelector('.list').onclick = (e) => {
    const ed = e.target.closest('[data-ed]'), pw = e.target.closest('[data-pw]');
    const lib = e.target.closest('[data-lib]'), fim = e.target.closest('[data-fim]');
    if (ed) formUsuario(us.find((u) => u.id === Number(ed.dataset.ed)), () => render());
    if (lib) liberarCadastro(us.find((u) => u.id === Number(lib.dataset.lib)));
    if (fim) {
      const u = us.find((x) => x.id === Number(fim.dataset.fim));
      confirmar('Encerrar liberação', `${esc(u.nome)} vai deixar de poder cadastrar produtos agora.`, { ok: 'Encerrar', kind: 'out' }).then(async (ok) => {
        if (ok && await tentar(async () => { await rpc('liberar_cadastro', { p_usuario: u.id, p_ate: null }); return true; })) { toast('Liberação encerrada.', 'ok'); render(); }
      });
    }
    if (pw) {
      const u = us.find((x) => x.id === Number(pw.dataset.pw));
      modal('Redefinir senha', `<form id="f-pw"><p>Nova senha provisória para <b>${esc(u.nome)}</b>. No próximo acesso a pessoa será obrigada a criar a própria senha.</p>
        <div class="field"><label for="pw-n">Senha provisória</label><input id="pw-n" type="text" minlength="6" required autocomplete="off"></div>
        <div class="btn-row end"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Redefinir</button></div></form>`, {
        onMount(b, close) {
          b.querySelector('#f-pw').onsubmit = async (ev) => {
            ev.preventDefault();
            if (await tentar(async () => { await rpc('redefinir_senha', { p_usuario: u.id, p_senha: b.querySelector('#pw-n').value }); return true; }, ev.submitter)) { toast('Senha redefinida e usuário desbloqueado.', 'ok'); close(); render(); }
          };
        },
      });
    }
  };
};

function liberarCadastro(u) {
  const agora = new Date();
  const fimDoDia = new Date(agora); fimDoDia.setHours(23, 59, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const opcoes = [
    ['hoje', 'Até o fim de hoje', fimDoDia],
    ['24h', 'Por 24 horas', new Date(agora.getTime() + 24 * 3600e3)],
    ['7d', 'Por 7 dias', new Date(agora.getTime() + 7 * 24 * 3600e3)],
    ['outro', 'Escolher data e hora', null],
  ];
  modal('Liberar cadastro de produtos', `<form id="f-lib">
    <p><b>${esc(u.nome)}</b> poderá <b>cadastrar produtos novos</b> (e gravar o código de barras de produtos que ainda não têm), além das entradas e saídas de sempre.</p>
    <p class="muted">Não poderá alterar produtos existentes, preços, nem ver custos, relatórios, painel ou usuários. A liberação termina sozinha no prazo escolhido.</p>
    <div class="field"><span class="label">Por quanto tempo?</span><div class="pills">${opcoes.map(([k, t], i) => `<label class="pill"><input type="radio" name="prazo" value="${k}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
    <div class="field hidden" id="lib-outro"><label for="lib-ate">Liberado até</label><input id="lib-ate" type="datetime-local" min="${local(agora)}" value="${local(new Date(agora.getTime() + 3 * 24 * 3600e3))}"></div>
    <p class="muted" id="lib-resumo"></p>
    <div class="btn-row end"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Liberar</button></div></form>`, {
    onMount(b, close) {
      const f = b.querySelector('#f-lib');
      const escolhido = () => {
        const k = f.querySelector('input[name=prazo]:checked').value;
        if (k === 'outro') { const v = f.querySelector('#lib-ate').value; return v ? new Date(v) : null; }
        return opcoes.find((o) => o[0] === k)[2];
      };
      const atualizar = () => {
        f.querySelector('#lib-outro').classList.toggle('hidden', f.querySelector('input[name=prazo]:checked').value !== 'outro');
        const d = escolhido(); f.querySelector('#lib-resumo').innerHTML = d && !isNaN(d) ? `Termina em <b>${esc(dt(d.toISOString()))}</b>.` : '';
      };
      f.addEventListener('input', atualizar); atualizar();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const d = escolhido();
        if (!d || isNaN(d)) return toast('Escolha a data e hora.', 'err');
        if (await tentar(async () => { await rpc('liberar_cadastro', { p_usuario: u.id, p_ate: d.toISOString() }); return true; }, e.submitter)) {
          toast(`Cadastro liberado para ${u.nome}.`, 'ok'); close(); render();
        }
      };
    },
  });
}

function formUsuario(u, depois) {
  const novo = !u; u = u || { perfil: 'operador', ativo: true };
  modal(novo ? 'Novo usuário' : 'Editar usuário', `<form id="f-us" novalidate>
    <div class="field"><label for="u-nome">Nome</label><input id="u-nome" type="text" value="${esc(u.nome)}" required></div>
    <div class="field"><label for="u-login">Usuário (para entrar)</label><input id="u-login" type="text" value="${esc(u.login)}" autocapitalize="none" spellcheck="false" required><span class="hint">Sem espaços nem acentos. Ex.: joana, recepcao2</span></div>
    ${novo ? '<div class="field"><label for="u-senha">Senha provisória</label><input id="u-senha" type="text" minlength="6" autocomplete="off" required><span class="hint">A pessoa cria a própria senha no primeiro acesso.</span></div>' : ''}
    <div class="field"><span class="label">Perfil</span><div class="pills">
      <label class="pill"><input type="radio" name="perfil" value="operador" ${u.perfil === 'operador' ? 'checked' : ''}><span>Operador</span></label>
      <label class="pill"><input type="radio" name="perfil" value="gerente" ${u.perfil === 'gerente' ? 'checked' : ''}><span>Gerente de estoque</span></label>
      <label class="pill"><input type="radio" name="perfil" value="admin" ${u.perfil === 'admin' ? 'checked' : ''}><span>Administrador</span></label></div>
      <div class="perfis-ajuda">
        <p><b>Operador</b>: registra entradas e saídas, consulta o estoque e cadastra/edita produtos. Sem custos.</p>
        <p><b>Gerente de estoque</b>: tudo do estoque — cadastra e edita produtos, ajusta contagem, aprova estornos, etiquetas, próteses e relatórios de estoque. <b>Não vê custos, lucro, margem nem faturamento</b>, e não mexe em usuários.</p>
        <p><b>Administrador</b>: acesso total.</p></div></div>
    ${novo ? '' : `<label class="check"><input type="checkbox" id="u-ativo" ${u.ativo ? 'checked' : ''}> Ativo (pode entrar no sistema)</label>`}
    <div class="btn-row end" style="margin-top:16px"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, {
    onMount(b, close) {
      b.querySelector('#f-us').onsubmit = async (e) => {
        e.preventDefault();
        const p = { id: novo ? null : u.id, nome: b.querySelector('#u-nome').value, login: b.querySelector('#u-login').value.trim(), perfil: b.querySelector('input[name=perfil]:checked').value,
          ativo: novo ? true : b.querySelector('#u-ativo').checked, senha: novo ? b.querySelector('#u-senha').value : undefined };
        if (await tentar(async () => { await rpc('salvar_usuario', { p }); return true; }, e.submitter)) { toast('Usuário salvo.', 'ok'); close(); depois && depois(); }
      };
    },
  });
}

/* =========================================================
   AUDITORIA (admin)
   ========================================================= */
const ACOES = {
  login: 'Entrou no sistema', login_falhou: 'Senha incorreta', usuario_bloqueado: 'Usuário bloqueado', troca_senha: 'Trocou a senha',
  entrada: 'Registrou entrada', saida: 'Registrou saída', estorno_solicitado: 'Pediu estorno', estorno_aprovado: 'Aprovou estorno',
  estorno_recusado: 'Recusou estorno', estorno_direto: 'Estornou lançamento', produto_criado: 'Cadastrou produto', produto_alterado: 'Alterou produto',
  ajuste_inventario: 'Ajuste de inventário', usuario_criado: 'Criou usuário', usuario_alterado: 'Alterou usuário', senha_redefinida: 'Redefiniu senha',
  cadastro_liberado: 'Liberou cadastro de produtos', cadastro_encerrado: 'Encerrou liberação de cadastro', codigo_vinculado: 'Gravou código de barras',
  lista_alterada: 'Alterou lista', backup_exportado: 'Exportou backup',
};
function resumoDetalhe(a) {
  const d = a.detalhes; if (!d) return '';
  if (d.antes && d.depois) {
    const mud = Object.keys(d.depois).filter((k) => !['criado_em'].includes(k) && JSON.stringify(d.antes[k] ?? null) !== JSON.stringify(d.depois[k] ?? null) && k in d.antes);
    return (d.depois.sku || d.depois.login || '') + (mud.length ? ': ' + mud.map((k) => `${k} ${d.antes[k] ?? '—'} → ${d.depois[k] ?? '—'}`).join('; ') : '');
  }
  return Object.entries(d).filter(([k]) => !['id', 'criado_em'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}
ROTAS.auditoria = async (el) => {
  const hoje = hojeISO();
  el.innerHTML = `<div class="page-head"><h1>Auditoria</h1><button class="btn" id="au-csv">Exportar Excel</button></div>
    <p class="muted">Registro permanente de tudo o que foi feito no sistema. Não pode ser apagado nem alterado.</p>
    <div class="toolbar"><div class="field"><label for="au-de">De</label><input id="au-de" type="date" value="${isoShift(hoje, { d: -6 })}"></div>
      <div class="field"><label for="au-ate">Até</label><input id="au-ate" type="date" value="${hoje}"></div>
      <div class="field grow"><label for="au-q">Buscar</label><input id="au-q" type="search" placeholder="Usuário, ação, produto…"></div></div>
    <div class="table-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody id="au-body"></tbody></table></div>`;
  let itens = [];
  const filtrados = () => { const t = norm(el.querySelector('#au-q').value); return itens.filter((a) => !t || norm([a.usuario, ACOES[a.acao] || a.acao, resumoDetalhe(a)].join(' ')).includes(t)); };
  const desenhar = () => { const l = filtrados(); el.querySelector('#au-body').innerHTML = l.length ? l.map((a) => `<tr><td class="nowrap">${dt(a.data)}</td><td>${esc(a.usuario || '—')}</td><td>${esc(ACOES[a.acao] || a.acao)}</td><td class="small" style="max-width:520px;word-break:break-word">${esc(resumoDetalhe(a))}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Nada no período.</td></tr>'; };
  const carregar = async () => { itens = (await rpc('auditoria', { p_de: el.querySelector('#au-de').value, p_ate: el.querySelector('#au-ate').value })) || []; desenhar(); };
  el.querySelector('#au-de').onchange = el.querySelector('#au-ate').onchange = () => tentar(carregar);
  el.querySelector('#au-q').oninput = desenhar;
  el.querySelector('#au-csv').onclick = () => exportarCSV({ titulo: 'Auditoria', periodo: `${dOnly(el.querySelector('#au-de').value)} a ${dOnly(el.querySelector('#au-ate').value)}`, secoes: [{ cols: [C('Data', 'data', 'dt'), C('Usuário', 'usuario'), C('Ação', 'acao'), C('Detalhes', 'det')], rows: filtrados().map((a) => ({ ...a, acao: ACOES[a.acao] || a.acao, det: resumoDetalhe(a) })) }] });
  await carregar();
};

/* =========================================================
   CONFIGURAÇÕES (admin)
   ========================================================= */
ROTAS.config = async (el) => {
  S.listas = (await rpc('listas')) || S.listas;
  const nomes = { tipo: 'Tipos de produto', tamanho: 'Tamanhos (na ordem)', forma_pagamento: 'Formas de pagamento', cirurgia: 'Cirurgias (sugestões)' };
  el.innerHTML = `<div class="page-head"><h1>Configurações</h1></div>
    <div class="card"><h2>Cópia de segurança</h2>
      <p>Baixa um arquivo com todos os dados (produtos, movimentações, estornos, usuários sem senhas e auditoria). Guarde em local seguro — contém nomes de pacientes.</p>
      <div class="btn-row"><button class="btn primary" id="cf-bkp">Baixar backup completo</button></div>
      <p class="muted small" style="margin-top:10px">Recomendado: fazer uma vez por semana e guardar no Dropbox/Drive da clínica.</p></div>
    <div class="cols2">${Object.entries(nomes).map(([k, t]) => `<div class="card"><h2>${t}</h2>
      <div class="field"><label for="ls-${k}" class="sr">${t}</label><textarea id="ls-${k}" rows="8">${esc((S.listas[k] || []).join('\n'))}</textarea><span class="hint">Um por linha.</span></div>
      <button class="btn" data-ls="${k}">Salvar</button></div>`).join('')}</div>
    <div class="card"><h2>Aparência</h2><div class="pills" id="cf-tema">${[['', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, t]) => `<label class="pill"><input type="radio" name="tema" value="${v}" ${(storage.get('estoque_tema') || '') === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>`;
  el.querySelector('#cf-bkp').onclick = (e) => tentar(async () => {
    const d = await rpc('backup');
    baixarArquivo(`backup-estoque-${hojeISO()}.json`, JSON.stringify(d, null, 1), 'application/json');
    toast('Backup baixado.', 'ok');
  }, e.currentTarget);
  el.querySelectorAll('[data-ls]').forEach((b) => b.onclick = () => tentar(async () => {
    const k = b.dataset.ls;
    const vals = el.querySelector('#ls-' + k).value.split('\n').map((s) => s.trim()).filter(Boolean);
    await rpc('salvar_lista', { p_categoria: k, p_valores: vals });
    S.listas[k] = [...new Set(vals)]; toast('Lista salva.', 'ok');
  }, b));
  el.querySelector('#cf-tema').onchange = (e) => { aplicarTema(e.target.value); storage.set('estoque_tema', e.target.value); };
};

/* ---------------- início ---------------- */
function aplicarTema(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

async function boot() {
  aplicarTema(storage.get('estoque_tema') || '');
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) return telaConfig();
  const t = storage.get('estoque_token');
  const c = t ? lerCache() : null;
  if (t && c) {
    S.token = t; S.user = c.user; S.produtos = c.produtos; S.listas = c.listas || {}; S.pendentes = c.pendentes || 0; S.carregado = Date.now();
    marcarAtividade();
    render();
    carregarBase().then(() => { if (!S.user) return; if (S.user.trocar_senha) render(); else { desenharNav(); avisarTela(); } })
      .catch((e) => { if (S.user) toast(e.message, 'err'); });
    return;
  }
  if (t) {
    S.token = t;
    try {
      S.user = {};
      await carregarBase(); // valida a sessão e traz tudo numa consulta só
      if (!S.user) return;
      marcarAtividade();
      return render();
    } catch { if (S.token) { S.token = null; S.user = null; storage.del('estoque_token'); } else return; }
  }
  telaLogin();
}
boot();
})();
