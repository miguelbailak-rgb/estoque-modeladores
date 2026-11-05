-- =====================================================================
--  ESTOQUE DE MODELADORES — Miguel Bailak Cirurgia Plástica
--  Banco de dados (Supabase / PostgreSQL)
--
--  Como usar: no painel do Supabase abra "SQL Editor" > "New query",
--  cole TODO este arquivo e clique em "Run". Pode rodar de novo sem
--  perder dados (as funções são recriadas; as tabelas são mantidas).
--
--  Segurança:
--   * As tabelas ficam no esquema privado "estoque", que NÃO é exposto
--     pela API. O site só consegue chamar as funções do esquema public,
--     e cada função confere a sessão e o perfil (operador/admin).
--   * Senhas guardadas com bcrypt; sessão expira após 30 min sem uso;
--     bloqueio de 15 min após 5 senhas erradas.
--   * Auditoria e movimentações não podem ser apagadas nem alteradas.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists estoque;
revoke all on schema estoque from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema estoque from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------
create table if not exists estoque.usuarios (
  id            serial primary key,
  nome          text not null,
  login         text not null,
  senha_hash    text not null,
  perfil        text not null check (perfil in ('admin','operador')),
  ativo         boolean not null default true,
  trocar_senha  boolean not null default true,
  tentativas    int not null default 0,
  bloqueado_ate timestamptz,
  criado_em     timestamptz not null default now()
);
create unique index if not exists usuarios_login_uk on estoque.usuarios (lower(login));
-- perfis: admin (tudo), gerente (estoque completo, sem custos/lucro), operador
alter table estoque.usuarios drop constraint if exists usuarios_perfil_check;
alter table estoque.usuarios add constraint usuarios_perfil_check check (perfil in ('admin','gerente','operador'));
-- liberação temporária para operador cadastrar produtos novos (null = sem liberação)
alter table estoque.usuarios add column if not exists cadastro_ate timestamptz;

create table if not exists estoque.sessoes (
  token_hash  text primary key,
  usuario_id  int not null references estoque.usuarios(id),
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null
);

create table if not exists estoque.listas (
  categoria text not null,
  valor     text not null,
  ordem     int  not null default 0,
  primary key (categoria, valor)
);

create table if not exists estoque.produtos (
  id             serial primary key,
  sku            text not null unique,
  tipo           text not null,
  modelo         text not null,
  marca          text,
  fornecedor     text,
  tamanho        text not null,
  cor            text,
  custo          numeric(12,2) not null default 0 check (custo >= 0),
  preco          numeric(12,2) not null default 0 check (preco >= 0),
  estoque_minimo int not null default 0 check (estoque_minimo >= 0),
  ativo          boolean not null default true,
  observacoes    text,
  criado_em      timestamptz not null default now()
);
-- código de barras do fabricante (EAN etc.), lido pela câmera
alter table estoque.produtos add column if not exists codigo_barras text;
create unique index if not exists produtos_codbarras_uk on estoque.produtos (codigo_barras) where codigo_barras is not null;
-- produto apagado pelo administrador que já tinha histórico: some das listas, o histórico fica
alter table estoque.produtos add column if not exists excluido boolean not null default false;
alter table estoque.produtos add column if not exists excluido_em timestamptz;

create table if not exists estoque.movimentacoes (
  id              bigserial primary key,
  data            timestamptz not null default now(),
  tipo            text not null check (tipo in ('entrada','saida','ajuste','estorno')),
  motivo          text not null,
  produto_id      int not null references estoque.produtos(id),
  qtd             int not null,              -- positivo entra, negativo sai
  custo_unitario  numeric(12,2) not null default 0,
  valor_unitario  numeric(12,2) not null default 0,
  desconto        numeric(12,2) not null default 0,
  valor_total     numeric(12,2) not null default 0,
  forma_pagamento text,
  fornecedor      text,
  nota_fiscal     text,
  paciente_nome   text,
  cirurgia        text,
  data_cirurgia   date,
  observacao      text,
  usuario_id      int not null references estoque.usuarios(id),
  estornado       boolean not null default false,
  estorno_de      bigint references estoque.movimentacoes(id)
);
create index if not exists mov_data_idx    on estoque.movimentacoes (data);
create index if not exists mov_produto_idx on estoque.movimentacoes (produto_id);

create table if not exists estoque.estornos (
  id               serial primary key,
  movimentacao_id  bigint not null references estoque.movimentacoes(id),
  solicitado_por   int not null references estoque.usuarios(id),
  motivo           text not null,
  status           text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  decidido_por     int references estoque.usuarios(id),
  decidido_em      timestamptz,
  obs_decisao      text,
  criado_em        timestamptz not null default now()
);

-- PRÓTESES: cada unidade física com nº de série, lote e validade (rastreabilidade)
alter table estoque.produtos add column if not exists controla_serie boolean not null default false;
create table if not exists estoque.unidades (
  id           bigserial primary key,
  produto_id   int not null references estoque.produtos(id),
  numero_serie text not null,
  lote         text,
  validade     date,
  status       text not null default 'estoque' check (status in ('estoque','saiu','cancelada')),
  entrada_mov  bigint not null references estoque.movimentacoes(id),
  saida_mov    bigint references estoque.movimentacoes(id),
  lado         text check (lado in ('Direita','Esquerda')),
  criado_em    timestamptz not null default now()
);
create unique index if not exists unidades_serie_uk on estoque.unidades (upper(numero_serie)) where status <> 'cancelada';
create index if not exists unidades_produto_idx on estoque.unidades (produto_id, status);
create index if not exists unidades_entrada_idx on estoque.unidades (entrada_mov);
create index if not exists unidades_saida_idx on estoque.unidades (saida_mov);

create table if not exists estoque.historico_precos (
  id          serial primary key,
  produto_id  int not null references estoque.produtos(id),
  custo_ant   numeric(12,2), custo_novo numeric(12,2),
  preco_ant   numeric(12,2), preco_novo numeric(12,2),
  usuario_id  int not null references estoque.usuarios(id),
  data        timestamptz not null default now()
);

create table if not exists estoque.auditoria (
  id         bigserial primary key,
  data       timestamptz not null default now(),
  usuario_id int references estoque.usuarios(id),
  acao       text not null,
  detalhes   jsonb
);

-- Movimentações e auditoria são permanentes (só a coluna "estornado" muda)
create or replace function estoque.tg_bloqueia_alteracao() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registros de % não podem ser apagados.', tg_table_name;
  end if;
  if tg_table_name = 'movimentacoes'
     and (to_jsonb(new) - 'estornado') = (to_jsonb(old) - 'estornado') then
    return new;
  end if;
  raise exception 'Registros de % não podem ser alterados.', tg_table_name;
end $$;

drop trigger if exists tg_auditoria_imutavel on estoque.auditoria;
create trigger tg_auditoria_imutavel before update or delete on estoque.auditoria
  for each row execute function estoque.tg_bloqueia_alteracao();
drop trigger if exists tg_mov_imutavel on estoque.movimentacoes;
create trigger tg_mov_imutavel before update or delete on estoque.movimentacoes
  for each row execute function estoque.tg_bloqueia_alteracao();

-- Proteção extra: RLS ligado e sem políticas = ninguém lê direto
alter table estoque.usuarios         enable row level security;
alter table estoque.sessoes          enable row level security;
alter table estoque.listas           enable row level security;
alter table estoque.produtos         enable row level security;
alter table estoque.movimentacoes    enable row level security;
alter table estoque.estornos         enable row level security;
alter table estoque.historico_precos enable row level security;
alter table estoque.auditoria        enable row level security;
alter table estoque.unidades         enable row level security;

-- ---------------------------------------------------------------------
-- DADOS INICIAIS
-- ---------------------------------------------------------------------
insert into estoque.usuarios (nome, login, senha_hash, perfil, trocar_senha)
select 'Administrador', 'admin', extensions.crypt('admin123', extensions.gen_salt('bf', 10)), 'admin', true
where not exists (select 1 from estoque.usuarios);

insert into estoque.listas (categoria, valor, ordem) values
  ('tipo','Cinta',1), ('tipo','Body / macacão',2), ('tipo','Sutiã pós-cirúrgico',3),
  ('tipo','Faixa abdominal',4), ('tipo','Faixa de mento / face',5), ('tipo','Meia compressiva',6),
  ('tipo','Placa abdominal',7), ('tipo','Placa lateral (flancos)',8), ('tipo','Placa lombar',9),
  ('tipo','Espuma',10), ('tipo','Prótese mamária',11), ('tipo','Outros',12),
  ('tamanho','PP',1), ('tamanho','P',2), ('tamanho','M',3), ('tamanho','G',4),
  ('tamanho','GG',5), ('tamanho','XG',6), ('tamanho','EXG',7), ('tamanho','Único',8),
  ('forma_pagamento','Pix',1), ('forma_pagamento','Dinheiro',2), ('forma_pagamento','Débito',3),
  ('forma_pagamento','Crédito à vista',4), ('forma_pagamento','Crédito parcelado',5),
  ('forma_pagamento','Incluso no pacote',6), ('forma_pagamento','Sem cobrança',7),
  ('cirurgia','Abdominoplastia',1), ('cirurgia','Lipoaspiração',2), ('cirurgia','Lipoabdominoplastia',3),
  ('cirurgia','Mamoplastia redutora',4), ('cirurgia','Mamoplastia de aumento',5), ('cirurgia','Mastopexia',6),
  ('cirurgia','Mini abdominoplastia',7), ('cirurgia','Ritidoplastia',8), ('cirurgia','Lipo de papada',9),
  ('cirurgia','Braquioplastia',10), ('cirurgia','Cruroplastia',11), ('cirurgia','Ginecomastia',12),
  ('cirurgia','Pós-bariátrica',13), ('cirurgia','Outra',14), ('cirurgia','Mamoplastia de aumento com mastopexia',15),
  ('cirurgia','Troca de prótese mamária',16)
on conflict do nothing;

update estoque.listas set ordem = 12 where categoria = 'tipo' and valor = 'Outros' and ordem < 12;

-- ---------------------------------------------------------------------
-- FUNÇÕES INTERNAS (não ficam expostas na API)
-- ---------------------------------------------------------------------
create or replace function estoque._hash(p text) returns text
language sql immutable set search_path = extensions, public as $$
  select encode(digest(p, 'sha256'), 'hex')
$$;

create or replace function estoque._sessao(p_token text, p_permite_troca boolean default false)
returns estoque.usuarios
language plpgsql set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  select usr.* into u
    from estoque.sessoes s join estoque.usuarios usr on usr.id = s.usuario_id
   where s.token_hash = estoque._hash(coalesce(p_token,'')) and s.expira_em > now() and usr.ativo;
  if not found then
    raise exception 'SESSAO_EXPIRADA' using hint = 'Sua sessão expirou. Entre novamente.';
  end if;
  if u.trocar_senha and not p_permite_troca then
    raise exception 'TROCAR_SENHA' using hint = 'Troque sua senha para continuar.';
  end if;
  -- renova a sessão (30 min) no máximo 1x por minuto: evita gravação e espera entre consultas simultâneas
  update estoque.sessoes set expira_em = now() + interval '30 minutes'
   where token_hash = estoque._hash(p_token) and expira_em < now() + interval '29 minutes';
  return u;
end $$;

-- cadastro e edição de produtos: todos os perfis (custo só o administrador)
create or replace function estoque._pode_cadastrar(u estoque.usuarios) returns boolean
language sql stable as $$
  select u.perfil in ('admin','gerente','operador')
$$;

-- administrador ou gerente de estoque
create or replace function estoque._gestor(p_token text) returns estoque.usuarios
language plpgsql set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._sessao(p_token);
  if u.perfil not in ('admin','gerente') then
    raise exception 'Acesso permitido somente ao administrador ou ao gerente de estoque.';
  end if;
  return u;
end $$;

create or replace function estoque._admin(p_token text) returns estoque.usuarios
language plpgsql set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._sessao(p_token);
  if u.perfil <> 'admin' then
    raise exception 'Acesso permitido somente ao administrador.';
  end if;
  return u;
end $$;

create or replace function estoque._audit(p_usuario int, p_acao text, p_det jsonb default null)
returns void language sql set search_path = estoque, public as $$
  insert into estoque.auditoria (usuario_id, acao, detalhes) values (p_usuario, p_acao, p_det);
$$;

create or replace function estoque._saldo(p_produto int) returns int
language sql stable set search_path = estoque, public as $$
  select coalesce(sum(qtd), 0)::int from estoque.movimentacoes where produto_id = p_produto;
$$;

create or replace function estoque._eh_protese(t text) returns boolean
language sql immutable as $$ select coalesce(t, '') ~* '^pr[óo]tese' $$;

create or replace function estoque._txt(p jsonb, k text) returns text
language sql immutable as $$ select nullif(trim(p ->> k), '') $$;

create or replace function estoque._num(p jsonb, k text) returns numeric
language sql immutable as $$
  select case when nullif(trim(p ->> k), '') is null then null
              else replace(trim(p ->> k), ',', '.')::numeric end
$$;

create or replace function estoque._prod_nome(pr estoque.produtos) returns text
language sql immutable as $$
  select concat_ws(' · ', pr.tipo || ' ' || pr.modelo, pr.tamanho, nullif(pr.cor, ''))
$$;

-- linha de movimentação em JSON (com ou sem valores de custo)
create or replace function estoque._mov_json(m estoque.movimentacoes, p_admin boolean)
returns jsonb language sql stable set search_path = estoque, public as $$
  select jsonb_build_object(
    'id', m.id, 'data', m.data, 'tipo', m.tipo, 'motivo', m.motivo,
    'produto_id', m.produto_id, 'sku', p.sku, 'produto', estoque._prod_nome(p),
    'tipo_produto', p.tipo, 'tamanho', p.tamanho,
    'qtd', m.qtd, 'valor_unitario', m.valor_unitario, 'desconto', m.desconto,
    'valor_total', m.valor_total, 'forma_pagamento', m.forma_pagamento,
    'fornecedor', m.fornecedor, 'nota_fiscal', m.nota_fiscal,
    'paciente_nome', m.paciente_nome, 'cirurgia', m.cirurgia, 'data_cirurgia', m.data_cirurgia,
    'observacao', m.observacao, 'usuario', u.nome, 'usuario_id', m.usuario_id,
    'estornado', m.estornado, 'estorno_de', m.estorno_de,
    'estorno_pendente', exists (select 1 from estoque.estornos e where e.movimentacao_id = m.id and e.status = 'pendente'),
    'saldo_atual', estoque._saldo(m.produto_id),
    'unidades', (select jsonb_agg(jsonb_build_object('id', x.id, 'numero_serie', x.numero_serie, 'lote', x.lote,
                   'validade', x.validade, 'lado', x.lado) order by x.lado nulls last, x.id)
                 from estoque.unidades x where x.entrada_mov = m.id or x.saida_mov = m.id)
  ) || case when p_admin then jsonb_build_object('custo_unitario', m.custo_unitario) else '{}'::jsonb end
  from estoque.produtos p, estoque.usuarios u
  where p.id = m.produto_id and u.id = m.usuario_id
$$;

create or replace function estoque._executar_estorno(p_mov bigint, p_usuario int, p_motivo text)
returns bigint language plpgsql set search_path = estoque, public as $$
declare m estoque.movimentacoes; novo bigint; s int;
begin
  select * into m from estoque.movimentacoes where id = p_mov for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if m.estornado then raise exception 'Este lançamento já foi estornado.'; end if;
  if m.tipo not in ('entrada','saida') then raise exception 'Somente entradas e saídas podem ser estornadas.'; end if;
  perform 1 from estoque.produtos where id = m.produto_id for update;
  if exists (select 1 from estoque.produtos where id = m.produto_id and excluido) then
    raise exception 'Este produto foi apagado; o lançamento não pode ser estornado.';
  end if;
  s := estoque._saldo(m.produto_id);
  if s - m.qtd < 0 then
    raise exception 'Não é possível estornar: o saldo ficaria negativo (saldo atual %).', s;
  end if;
  insert into estoque.movimentacoes (tipo, motivo, produto_id, qtd, custo_unitario, valor_unitario,
         desconto, valor_total, observacao, usuario_id, estorno_de)
  values ('estorno', 'Estorno de ' || m.tipo, m.produto_id, -m.qtd, m.custo_unitario, m.valor_unitario,
          m.desconto, m.valor_total, p_motivo, p_usuario, m.id)
  returning id into novo;
  -- próteses: entrada estornada cancela as unidades; saída estornada devolve as unidades ao estoque
  if m.tipo = 'entrada' then
    if exists (select 1 from estoque.unidades where entrada_mov = m.id and status = 'saiu') then
      raise exception 'Alguma prótese desta entrada já saiu do estoque. Estorne a saída dela primeiro.';
    end if;
    update estoque.unidades set status = 'cancelada' where entrada_mov = m.id;
  else
    update estoque.unidades set status = 'estoque', saida_mov = null, lado = null where saida_mov = m.id;
  end if;
  update estoque.movimentacoes set estornado = true where id = m.id;
  return novo;
end $$;

-- ---------------------------------------------------------------------
-- FUNÇÕES PÚBLICAS (chamadas pelo site)
-- ---------------------------------------------------------------------

-- LOGIN: não gera erro (para gravar tentativas); devolve {ok, ...}
create or replace function public.login(p_login text, p_senha text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; t text;
begin
  delete from estoque.sessoes where expira_em < now() - interval '1 day';
  select * into u from estoque.usuarios where lower(login) = lower(trim(coalesce(p_login,'')));
  if not found or not u.ativo then
    perform pg_sleep(0.4);
    return jsonb_build_object('ok', false, 'erro', 'Usuário ou senha inválidos.');
  end if;
  if u.bloqueado_ate is not null and u.bloqueado_ate > now() then
    return jsonb_build_object('ok', false, 'erro',
      'Usuário bloqueado por excesso de tentativas. Tente novamente após '
      || to_char(u.bloqueado_ate at time zone 'America/Sao_Paulo', 'HH24:MI') || '.');
  end if;
  if u.senha_hash <> crypt(coalesce(p_senha,''), u.senha_hash) then
    update estoque.usuarios
       set tentativas = tentativas + 1,
           bloqueado_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = u.id;
    perform estoque._audit(u.id, 'login_falhou', null);
    if u.tentativas + 1 >= 5 then
      perform estoque._audit(u.id, 'usuario_bloqueado', null);
      return jsonb_build_object('ok', false, 'erro', 'Senha incorreta 5 vezes. Usuário bloqueado por 15 minutos.');
    end if;
    return jsonb_build_object('ok', false, 'erro', 'Usuário ou senha inválidos.');
  end if;
  update estoque.usuarios set tentativas = 0, bloqueado_ate = null where id = u.id;
  t := encode(gen_random_bytes(32), 'hex');
  insert into estoque.sessoes (token_hash, usuario_id, expira_em)
  values (estoque._hash(t), u.id, now() + interval '30 minutes');
  perform estoque._audit(u.id, 'login', null);
  return jsonb_build_object('ok', true, 'token', t, 'id', u.id, 'nome', u.nome,
                            'login', u.login, 'perfil', u.perfil, 'trocar_senha', u.trocar_senha,
                            'cadastro_ate', case when u.cadastro_ate > now() then u.cadastro_ate end);
end $$;

create or replace function public.logout(p_token text) returns void
language sql security definer set search_path = estoque, extensions, public as $$
  delete from estoque.sessoes where token_hash = estoque._hash(coalesce(p_token,''));
$$;

create or replace function public.sessao(p_token text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._sessao(p_token, true);
  return jsonb_build_object('id', u.id, 'nome', u.nome, 'login', u.login,
                            'perfil', u.perfil, 'trocar_senha', u.trocar_senha,
                            'cadastro_ate', case when u.cadastro_ate > now() then u.cadastro_ate end);
end $$;

-- Tudo o que o aplicativo precisa ao abrir, numa consulta só
create or replace function public.inicio(p_token text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; usr jsonb;
begin
  u := estoque._sessao(p_token, true);
  usr := jsonb_build_object('id', u.id, 'nome', u.nome, 'login', u.login, 'perfil', u.perfil, 'trocar_senha', u.trocar_senha,
                            'cadastro_ate', case when u.cadastro_ate > now() then u.cadastro_ate end);
  if u.trocar_senha then return jsonb_build_object('usuario', usr); end if;
  return jsonb_build_object('usuario', usr,
    'produtos', public.produtos(p_token),
    'listas', public.listas(p_token),
    'pendentes', case when u.perfil in ('admin','gerente') then (select count(*) from estoque.estornos where status = 'pendente') else 0 end);
end $$;

create or replace function public.trocar_senha(p_token text, p_senha_atual text, p_senha_nova text)
returns void language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._sessao(p_token, true);
  if u.senha_hash <> crypt(coalesce(p_senha_atual,''), u.senha_hash) then
    raise exception 'A senha atual está incorreta.';
  end if;
  if length(coalesce(p_senha_nova,'')) < 6 then
    raise exception 'A nova senha precisa ter pelo menos 6 caracteres.';
  end if;
  if p_senha_nova = p_senha_atual then
    raise exception 'A nova senha precisa ser diferente da atual.';
  end if;
  update estoque.usuarios set senha_hash = crypt(p_senha_nova, gen_salt('bf', 10)), trocar_senha = false
   where id = u.id;
  perform estoque._audit(u.id, 'troca_senha', null);
end $$;

-- Listas (tipos, tamanhos, formas de pagamento, cirurgias) + fornecedores usados
create or replace function public.listas(p_token text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
begin
  perform estoque._sessao(p_token);
  return (
    select jsonb_object_agg(categoria, valores) from (
      select categoria, jsonb_agg(valor order by ordem, valor) valores from estoque.listas group by categoria
      union all
      select 'fornecedor', coalesce(jsonb_agg(distinct f), '[]'::jsonb) from (
        select fornecedor f from estoque.produtos where coalesce(fornecedor,'') <> ''
        union select fornecedor from estoque.movimentacoes where coalesce(fornecedor,'') <> '') x
    ) t
  );
end $$;

-- Produtos com saldo (custo só para admin)
create or replace function public.produtos(p_token text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; adm boolean;
begin
  u := estoque._sessao(p_token);
  adm := u.perfil = 'admin';
  return coalesce((
    select jsonb_agg(
      jsonb_build_object('id', p.id, 'sku', p.sku, 'codigo_barras', p.codigo_barras, 'tipo', p.tipo, 'modelo', p.modelo, 'marca', p.marca,
        'fornecedor', p.fornecedor, 'tamanho', p.tamanho, 'cor', p.cor, 'preco', p.preco,
        'estoque_minimo', p.estoque_minimo, 'ativo', p.ativo, 'observacoes', p.observacoes,
        'nome', estoque._prod_nome(p), 'saldo', coalesce(s.saldo, 0),
        'controla_serie', p.controla_serie, 'validade_proxima', un.vmin, 'vencidas', coalesce(un.venc, 0),
        'vence_90', coalesce(un.v90, 0))
      || case when adm then jsonb_build_object('custo', p.custo) else '{}'::jsonb end
      order by p.tipo, p.modelo, tl.ordem nulls last, p.tamanho, p.cor)
    from estoque.produtos p
    left join (select produto_id, sum(qtd)::int saldo from estoque.movimentacoes group by produto_id) s
           on s.produto_id = p.id
    left join estoque.listas tl on tl.categoria = 'tamanho' and tl.valor = p.tamanho
    left join (select produto_id, min(validade) vmin, count(*) filter (where validade < current_date) venc,
                      count(*) filter (where validade >= current_date and validade < current_date + 90) v90
                 from estoque.unidades where status = 'estoque' group by produto_id) un on un.produto_id = p.id
    where not p.excluido and (u.perfil in ('admin','gerente') or p.ativo)), '[]'::jsonb);
end $$;

-- ENTRADA
create or replace function public.registrar_entrada(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; pr estoque.produtos; q int; c numeric; m estoque.movimentacoes; mot text;
        un jsonb; ns text; dup text;
begin
  u := estoque._sessao(p_token);
  q := (p ->> 'quantidade')::int;
  mot := estoque._txt(p, 'motivo');
  if mot is null or mot not in ('Compra de fornecedor','Consignação recebida','Devolução de paciente','Troca recebida','Outro') then
    raise exception 'Escolha o motivo da entrada.';
  end if;
  select * into pr from estoque.produtos where id = (p ->> 'produto_id')::int for update;
  if not found or not pr.ativo then raise exception 'Produto não encontrado ou inativo.'; end if;
  -- próteses: uma linha por unidade (nº de série obrigatório; lote e validade)
  if pr.controla_serie then
    if jsonb_typeof(p -> 'unidades') <> 'array' or jsonb_array_length(p -> 'unidades') = 0 then
      raise exception 'Informe o número de série de cada prótese.';
    end if;
    q := jsonb_array_length(p -> 'unidades');
    select string_agg(x, ', ') into dup from (
      select upper(trim(e ->> 'numero_serie')) x from jsonb_array_elements(p -> 'unidades') e group by 1 having count(*) > 1) d;
    if dup is not null then raise exception 'Número de série repetido nesta entrada: %.', dup; end if;
    for un in select * from jsonb_array_elements(p -> 'unidades') loop
      ns := trim(coalesce(un ->> 'numero_serie', ''));
      if ns = '' then raise exception 'Falta o número de série de uma das próteses.'; end if;
      if exists (select 1 from estoque.unidades where upper(numero_serie) = upper(ns) and status <> 'cancelada') then
        raise exception 'A prótese nº de série % já está cadastrada.', ns;
      end if;
    end loop;
  end if;
  if q is null or q <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  c := coalesce(estoque._num(p, 'custo_unitario'), pr.custo);
  if u.perfil <> 'admin' then c := pr.custo; end if; -- só o administrador informa custo
  if pr.controla_serie then c := 0; end if;
  if c < 0 then raise exception 'Custo inválido.'; end if;
  insert into estoque.movimentacoes (tipo, motivo, produto_id, qtd, custo_unitario, valor_unitario, valor_total,
         fornecedor, nota_fiscal, observacao, usuario_id)
  values ('entrada', mot, pr.id, q, c, c, round(c * q, 2),
          coalesce(estoque._txt(p,'fornecedor'), pr.fornecedor), estoque._txt(p,'nota_fiscal'),
          estoque._txt(p,'observacao'), u.id)
  returning * into m;
  if pr.controla_serie then
    insert into estoque.unidades (produto_id, numero_serie, lote, validade, entrada_mov)
    select pr.id, trim(e ->> 'numero_serie'), nullif(trim(coalesce(e ->> 'lote', '')), ''),
           nullif(e ->> 'validade', '')::date, m.id
    from jsonb_array_elements(p -> 'unidades') e;
  end if;
  perform estoque._audit(u.id, 'entrada', jsonb_build_object('movimentacao', m.id, 'produto', pr.sku, 'qtd', q, 'motivo', mot,
                         'series', (select jsonb_agg(e ->> 'numero_serie') from jsonb_array_elements(coalesce(p -> 'unidades', '[]')) e)));
  return estoque._mov_json(m, u.perfil = 'admin');
end $$;

-- SAÍDA
create or replace function public.registrar_saida(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; pr estoque.produtos; q int; vu numeric; d numeric; s int;
        m estoque.movimentacoes; mot text; pac text; un jsonb; x estoque.unidades; ids bigint[] := '{}';
begin
  u := estoque._sessao(p_token);
  q := (p ->> 'quantidade')::int;
  mot := estoque._txt(p, 'motivo');
  pac := estoque._txt(p, 'paciente_nome');
  if mot is null or mot not in ('Venda à paciente','Incluído no pacote cirúrgico','Cortesia','Troca',
                                'Perda / avaria','Uso interno','Devolução ao fornecedor','Implantada na paciente') then
    raise exception 'Escolha o motivo da saída.';
  end if;
  if mot in ('Venda à paciente','Incluído no pacote cirúrgico','Cortesia','Troca','Implantada na paciente') and pac is null then
    raise exception 'Informe o nome da paciente.';
  end if;
  select * into pr from estoque.produtos where id = (p ->> 'produto_id')::int for update;
  if not found or not pr.ativo then raise exception 'Produto não encontrado ou inativo.'; end if;
  -- próteses: escolhe as unidades exatas (e o lado, quando vai para a paciente)
  if pr.controla_serie then
    if jsonb_typeof(p -> 'unidades') <> 'array' or jsonb_array_length(p -> 'unidades') = 0 then
      raise exception 'Escolha qual(is) prótese(s) — pelo número de série.';
    end if;
    q := jsonb_array_length(p -> 'unidades');
    for un in select * from jsonb_array_elements(p -> 'unidades') loop
      select * into x from estoque.unidades where id = (un ->> 'id')::bigint for update;
      if not found or x.produto_id <> pr.id or x.status <> 'estoque' then
        raise exception 'A prótese escolhida não está disponível no estoque (nº %).', coalesce(x.numero_serie, un ->> 'id');
      end if;
      if (x.id = any(ids)) then raise exception 'A prótese nº % foi escolhida duas vezes.', x.numero_serie; end if;
      ids := ids || x.id;
      if mot in ('Venda à paciente','Incluído no pacote cirúrgico','Cortesia','Troca','Implantada na paciente') then
        if x.validade is not null and x.validade < current_date then
          raise exception 'A prótese nº % está VENCIDA (validade %). Não pode ser usada em paciente.', x.numero_serie, to_char(x.validade, 'DD/MM/YYYY');
        end if;
        if coalesce(un ->> 'lado', '') not in ('Direita','Esquerda') then
          raise exception 'Informe o lado (direita ou esquerda) da prótese nº %.', x.numero_serie;
        end if;
      end if;
    end loop;
  end if;
  if q is null or q <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  s := estoque._saldo(pr.id);
  if q > s then
    raise exception 'Estoque insuficiente: há apenas % unidade(s) de %.', s, estoque._prod_nome(pr);
  end if;
  vu := coalesce(estoque._num(p, 'valor_unitario'), case when mot in ('Venda à paciente','Incluído no pacote cirúrgico') then pr.preco else 0 end);
  d  := coalesce(estoque._num(p, 'desconto'), 0);
  if pr.controla_serie then vu := 0; d := 0; end if; -- próteses: pagas pela paciente, sem valores no estoque
  if vu < 0 or d < 0 then raise exception 'Valores não podem ser negativos.'; end if;
  if d > vu * q then raise exception 'O desconto não pode ser maior que o valor total.'; end if;
  insert into estoque.movimentacoes (tipo, motivo, produto_id, qtd, custo_unitario, valor_unitario, desconto,
         valor_total, forma_pagamento, paciente_nome, cirurgia, data_cirurgia, observacao, usuario_id)
  values ('saida', mot, pr.id, -q, case when pr.controla_serie then 0 else pr.custo end, vu, d, round(vu * q - d, 2),
          case when pr.controla_serie then null else estoque._txt(p,'forma_pagamento') end,
          pac, estoque._txt(p,'cirurgia'), nullif(p ->> 'data_cirurgia','')::date, estoque._txt(p,'observacao'), u.id)
  returning * into m;
  if pr.controla_serie then
    update estoque.unidades x2 set status = 'saiu', saida_mov = m.id,
           lado = case when (e ->> 'lado') in ('Direita','Esquerda') then e ->> 'lado' end
      from jsonb_array_elements(p -> 'unidades') e where x2.id = (e ->> 'id')::bigint;
  end if;
  perform estoque._audit(u.id, 'saida', jsonb_build_object('movimentacao', m.id, 'produto', pr.sku, 'qtd', q,
                         'motivo', mot, 'valor_total', m.valor_total,
                         'series', (select jsonb_agg(numero_serie) from estoque.unidades where saida_mov = m.id)));
  return estoque._mov_json(m, u.perfil = 'admin');
end $$;

-- Lançamentos do dia (operador vê os próprios; admin vê todos)
create or replace function public.lancamentos_dia(p_token text, p_dia date default null) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; dia date;
begin
  u := estoque._sessao(p_token);
  dia := coalesce(p_dia, (now() at time zone 'America/Sao_Paulo')::date);
  return coalesce((
    select jsonb_agg(estoque._mov_json(m, u.perfil = 'admin') order by m.data desc)
    from estoque.movimentacoes m
    where m.data >= (dia::timestamp at time zone 'America/Sao_Paulo')
      and m.data <  ((dia + 1)::timestamp at time zone 'America/Sao_Paulo')
      and (u.perfil in ('admin','gerente') or m.usuario_id = u.id)), '[]'::jsonb);
end $$;

create or replace function public.solicitar_estorno(p_token text, p_mov bigint, p_motivo text) returns void
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; m estoque.movimentacoes;
begin
  u := estoque._sessao(p_token);
  select * into m from estoque.movimentacoes where id = p_mov;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if u.perfil <> 'admin' and m.usuario_id <> u.id then raise exception 'Você só pode pedir estorno dos seus lançamentos.'; end if;
  if m.estornado then raise exception 'Este lançamento já foi estornado.'; end if;
  if m.tipo not in ('entrada','saida') then raise exception 'Somente entradas e saídas podem ser estornadas.'; end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Explique o motivo do estorno.'; end if;
  if exists (select 1 from estoque.estornos where movimentacao_id = p_mov and status = 'pendente') then
    raise exception 'Já existe um pedido de estorno aguardando o administrador.';
  end if;
  insert into estoque.estornos (movimentacao_id, solicitado_por, motivo) values (p_mov, u.id, trim(p_motivo));
  perform estoque._audit(u.id, 'estorno_solicitado', jsonb_build_object('movimentacao', p_mov, 'motivo', p_motivo));
end $$;

-- ===================== ADMINISTRADOR =====================

create or replace function public.salvar_produto(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; ant estoque.produtos; novo estoque.produtos; pid int; cb text; restr text; adm boolean;
begin
  u := estoque._sessao(p_token);
  adm := u.perfil in ('admin','gerente');
  if not estoque._pode_cadastrar(u) then
    raise exception 'Cadastro de produtos não liberado para você. Peça ao administrador.';
  end if;
  if not adm then -- operador: não troca o código interno nem inativa
    p := p - 'sku';
    if nullif(p ->> 'id','') is null then p := p || jsonb_build_object('ativo', true);
    else p := p || jsonb_build_object('ativo', (select ativo from estoque.produtos where id = (p ->> 'id')::int)); end if;
  end if;
  cb := regexp_replace(coalesce(p ->> 'codigo_barras',''), '\s', '', 'g');
  if cb = '' then cb := null; end if;
  if cb is not null and exists (select 1 from estoque.produtos where upper(sku) = upper(cb) and id is distinct from nullif(p ->> 'id','')::int) then
    raise exception 'Este código de barras é igual ao código interno de outro produto.';
  end if;
  if estoque._txt(p,'tipo') is null or estoque._txt(p,'modelo') is null or estoque._txt(p,'tamanho') is null then
    raise exception 'Preencha tipo, modelo e tamanho.';
  end if;
  pid := nullif(p ->> 'id','')::int;
  if pid is null then
    insert into estoque.produtos (sku, tipo, modelo, marca, fornecedor, tamanho, cor, custo, preco,
           estoque_minimo, ativo, observacoes, codigo_barras, controla_serie)
    values (coalesce(upper(estoque._txt(p,'sku')), 'TMP-' || gen_random_uuid()), estoque._txt(p,'tipo'),
            estoque._txt(p,'modelo'), estoque._txt(p,'marca'), estoque._txt(p,'fornecedor'), estoque._txt(p,'tamanho'),
            estoque._txt(p,'cor'),
            case when estoque._eh_protese(estoque._txt(p,'tipo')) or u.perfil <> 'admin' then 0 else coalesce(estoque._num(p,'custo'),0) end,
            case when estoque._eh_protese(estoque._txt(p,'tipo')) then 0 else coalesce(estoque._num(p,'preco'),0) end,
            coalesce((p ->> 'estoque_minimo')::int, 0), coalesce((p ->> 'ativo')::boolean, true),
            estoque._txt(p,'observacoes'), cb, estoque._eh_protese(estoque._txt(p,'tipo')))
    returning * into novo;
    if novo.sku like 'TMP-%' then
      update estoque.produtos set sku = 'MOD-' || lpad(novo.id::text, 4, '0') where id = novo.id returning * into novo;
    end if;
    insert into estoque.historico_precos (produto_id, custo_novo, preco_novo, usuario_id)
    values (novo.id, novo.custo, novo.preco, u.id);
    perform estoque._audit(u.id, 'produto_criado', to_jsonb(novo) || jsonb_build_object('por_liberacao', not adm));
  else
    select * into ant from estoque.produtos where id = pid for update;
    if not found or ant.excluido then raise exception 'Produto não encontrado.'; end if;
    update estoque.produtos set
      sku = coalesce(upper(estoque._txt(p,'sku')), sku), tipo = estoque._txt(p,'tipo'), modelo = estoque._txt(p,'modelo'),
      marca = estoque._txt(p,'marca'), fornecedor = estoque._txt(p,'fornecedor'), tamanho = estoque._txt(p,'tamanho'),
      cor = estoque._txt(p,'cor'),
      custo = case when estoque._eh_protese(estoque._txt(p,'tipo')) then 0 when u.perfil <> 'admin' then ant.custo else coalesce(estoque._num(p,'custo'),0) end,
      preco = case when estoque._eh_protese(estoque._txt(p,'tipo')) then 0 else coalesce(estoque._num(p,'preco'),0) end,
      estoque_minimo = coalesce((p ->> 'estoque_minimo')::int, 0), ativo = coalesce((p ->> 'ativo')::boolean, true),
      observacoes = estoque._txt(p,'observacoes'), codigo_barras = cb,
      controla_serie = estoque._eh_protese(estoque._txt(p,'tipo'))
    where id = pid returning * into novo;
    if ant.controla_serie and not novo.controla_serie and estoque._saldo(pid) <> 0 then
      raise exception 'Este produto tem próteses em estoque controladas por nº de série; não dá para mudar o tipo.';
    end if;
    if novo.controla_serie and not ant.controla_serie and estoque._saldo(pid) <> 0 then
      raise exception 'Para virar prótese, o produto precisa estar com estoque zero (as unidades entram com nº de série).';
    end if;
    if novo.custo <> ant.custo or novo.preco <> ant.preco then
      insert into estoque.historico_precos (produto_id, custo_ant, custo_novo, preco_ant, preco_novo, usuario_id)
      values (pid, ant.custo, novo.custo, ant.preco, novo.preco, u.id);
    end if;
    perform estoque._audit(u.id, 'produto_alterado', jsonb_build_object('antes', to_jsonb(ant), 'depois', to_jsonb(novo)));
  end if;
  return to_jsonb(novo);
exception when unique_violation then
  get stacked diagnostics restr = constraint_name;
  if restr = 'produtos_codbarras_uk' then
    raise exception 'Este código de barras já está cadastrado em outro produto.';
  end if;
  raise exception 'Já existe um produto com este código (SKU).';
end $$;

create or replace function public.historico_precos(p_token text, p_produto int) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
begin
  perform estoque._admin(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('data', h.data, 'custo_ant', h.custo_ant, 'custo_novo', h.custo_novo,
           'preco_ant', h.preco_ant, 'preco_novo', h.preco_novo, 'usuario', u.nome) order by h.data desc)
    from estoque.historico_precos h join estoque.usuarios u on u.id = h.usuario_id
    where h.produto_id = p_produto), '[]'::jsonb);
end $$;

create or replace function public.ajustar_inventario(p_token text, p_produto int, p_contada int, p_justificativa text)
returns jsonb language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; pr estoque.produtos; s int; m estoque.movimentacoes;
begin
  u := estoque._gestor(p_token);
  if p_contada is null or p_contada < 0 then raise exception 'Informe a quantidade contada (zero ou mais).'; end if;
  if coalesce(trim(p_justificativa),'') = '' then raise exception 'A justificativa é obrigatória.'; end if;
  select * into pr from estoque.produtos where id = p_produto for update;
  if not found or pr.excluido then raise exception 'Produto não encontrado.'; end if;
  if pr.controla_serie then
    raise exception 'Próteses são controladas por número de série: use Entrada ou Saída escolhendo a unidade.';
  end if;
  s := estoque._saldo(pr.id);
  if s = p_contada then raise exception 'A contagem é igual ao saldo do sistema (%). Nada a ajustar.', s; end if;
  insert into estoque.movimentacoes (tipo, motivo, produto_id, qtd, custo_unitario, valor_unitario, valor_total, observacao, usuario_id)
  values ('ajuste', 'Ajuste de inventário', pr.id, p_contada - s, pr.custo, pr.custo,
          round(pr.custo * (p_contada - s), 2), trim(p_justificativa), u.id)
  returning * into m;
  perform estoque._audit(u.id, 'ajuste_inventario', jsonb_build_object('produto', pr.sku, 'saldo_sistema', s,
                         'contado', p_contada, 'justificativa', p_justificativa));
  return estoque._mov_json(m, u.perfil = 'admin');
end $$;

create or replace function public.estornos(p_token text, p_status text default 'pendente') returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._gestor(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'status', e.status, 'motivo', e.motivo, 'criado_em', e.criado_em,
             'solicitante', us.nome, 'decidido_em', e.decidido_em, 'decidido_por', ud.nome, 'obs_decisao', e.obs_decisao,
             'mov', estoque._mov_json(m, u.perfil = 'admin')) order by e.criado_em desc)
    from estoque.estornos e
    join estoque.movimentacoes m on m.id = e.movimentacao_id
    join estoque.usuarios us on us.id = e.solicitado_por
    left join estoque.usuarios ud on ud.id = e.decidido_por
    where p_status is null or e.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.decidir_estorno(p_token text, p_id int, p_aprovar boolean, p_obs text default null)
returns void language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; e estoque.estornos;
begin
  u := estoque._gestor(p_token);
  select * into e from estoque.estornos where id = p_id for update;
  if not found or e.status <> 'pendente' then raise exception 'Pedido não encontrado ou já decidido.'; end if;
  if p_aprovar then
    perform estoque._executar_estorno(e.movimentacao_id, u.id, e.motivo);
  end if;
  update estoque.estornos set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         decidido_por = u.id, decidido_em = now(), obs_decisao = nullif(trim(p_obs),'')
   where id = p_id;
  perform estoque._audit(u.id, case when p_aprovar then 'estorno_aprovado' else 'estorno_recusado' end,
                         jsonb_build_object('pedido', p_id, 'movimentacao', e.movimentacao_id));
end $$;

-- Admin estorna diretamente (sem pedido)
create or replace function public.estornar(p_token text, p_mov bigint, p_motivo text) returns void
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._gestor(p_token);
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Explique o motivo do estorno.'; end if;
  perform estoque._executar_estorno(p_mov, u.id, trim(p_motivo));
  update estoque.estornos set status = 'aprovado', decidido_por = u.id, decidido_em = now(),
         obs_decisao = 'Estornado diretamente pelo administrador'
   where movimentacao_id = p_mov and status = 'pendente';
  perform estoque._audit(u.id, 'estorno_direto', jsonb_build_object('movimentacao', p_mov, 'motivo', p_motivo));
end $$;

-- Movimentações de um período (base de todos os relatórios)
create or replace function public.movimentacoes(p_token text, p_de date, p_ate date) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare quem estoque.usuarios;
begin
  quem := estoque._gestor(p_token);
  if p_ate - p_de > 1100 then raise exception 'Escolha um período de até 3 anos.'; end if;
  -- consulta única (sem subconsultas por linha): rápida mesmo com muitos lançamentos
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'data', m.data, 'tipo', m.tipo, 'motivo', m.motivo,
      'produto_id', m.produto_id, 'sku', p.sku, 'produto', estoque._prod_nome(p),
      'tipo_produto', p.tipo, 'tamanho', p.tamanho,
      'qtd', m.qtd, 'valor_unitario', m.valor_unitario, 'desconto', m.desconto,
      'valor_total', m.valor_total, 'forma_pagamento', m.forma_pagamento,
      'fornecedor', m.fornecedor, 'nota_fiscal', m.nota_fiscal,
      'paciente_nome', m.paciente_nome, 'cirurgia', m.cirurgia, 'data_cirurgia', m.data_cirurgia,
      'observacao', m.observacao, 'usuario', u.nome, 'usuario_id', m.usuario_id,
      'estornado', m.estornado, 'estorno_de', m.estorno_de,
      'estorno_pendente', ep.movimentacao_id is not null,
      'custo_unitario', case when quem.perfil = 'admin' then m.custo_unitario end) order by m.data desc)
    from estoque.movimentacoes m
    join estoque.produtos p on p.id = m.produto_id
    join estoque.usuarios u on u.id = m.usuario_id
    left join (select distinct movimentacao_id from estoque.estornos where status = 'pendente') ep on ep.movimentacao_id = m.id
    where m.data >= (p_de::timestamp at time zone 'America/Sao_Paulo')
      and m.data <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')), '[]'::jsonb);
end $$;

create or replace function public.usuarios(p_token text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
begin
  perform estoque._admin(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'login', login, 'perfil', perfil,
            'ativo', ativo, 'trocar_senha', trocar_senha, 'bloqueado', coalesce(bloqueado_ate > now(), false),
            'cadastro_ate', case when cadastro_ate > now() then cadastro_ate end,
            'criado_em', criado_em) order by ativo desc, nome) from estoque.usuarios), '[]'::jsonb);
end $$;

create or replace function public.salvar_usuario(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; uid int; ant estoque.usuarios; senha text;
begin
  u := estoque._admin(p_token);
  uid := nullif(p ->> 'id','')::int;
  if estoque._txt(p,'nome') is null or estoque._txt(p,'login') is null then raise exception 'Preencha nome e usuário.'; end if;
  if coalesce(p ->> 'perfil','') not in ('admin','gerente','operador') then raise exception 'Perfil inválido.'; end if;
  if estoque._txt(p,'login') !~ '^[A-Za-z0-9._-]{3,30}$' then
    raise exception 'O usuário deve ter de 3 a 30 letras/números, sem espaços nem acentos.';
  end if;
  senha := p ->> 'senha';
  if uid is null then
    if length(coalesce(senha,'')) < 6 then raise exception 'A senha inicial precisa ter pelo menos 6 caracteres.'; end if;
    insert into estoque.usuarios (nome, login, senha_hash, perfil, trocar_senha)
    values (estoque._txt(p,'nome'), estoque._txt(p,'login'), crypt(senha, gen_salt('bf', 10)), p ->> 'perfil', true);
    perform estoque._audit(u.id, 'usuario_criado', jsonb_build_object('login', p ->> 'login', 'perfil', p ->> 'perfil'));
  else
    select * into ant from estoque.usuarios where id = uid for update;
    if not found then raise exception 'Usuário não encontrado.'; end if;
    if uid = u.id and (coalesce((p ->> 'ativo')::boolean, true) = false or p ->> 'perfil' <> 'admin') then
      raise exception 'Você não pode desativar nem rebaixar o seu próprio usuário.';
    end if;
    update estoque.usuarios set nome = estoque._txt(p,'nome'), login = estoque._txt(p,'login'), perfil = p ->> 'perfil',
           ativo = coalesce((p ->> 'ativo')::boolean, true)
     where id = uid;
    if not exists (select 1 from estoque.usuarios where perfil = 'admin' and ativo) then
      raise exception 'É preciso manter pelo menos um administrador ativo.';
    end if;
    if not coalesce((p ->> 'ativo')::boolean, true) then delete from estoque.sessoes where usuario_id = uid; end if;
    perform estoque._audit(u.id, 'usuario_alterado', jsonb_build_object(
      'antes', jsonb_build_object('nome', ant.nome, 'login', ant.login, 'perfil', ant.perfil, 'ativo', ant.ativo),
      'depois', p - 'senha'));
  end if;
exception when unique_violation then
  raise exception 'Já existe um usuário com este nome de acesso.';
end $$;

-- Próteses: unidades em estoque / que saíram, com busca por nº de série, lote ou paciente
create or replace function public.unidades(p_token text, p_produto int default null, p_status text default null, p_busca text default null)
returns jsonb language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; b text;
begin
  u := estoque._sessao(p_token);
  b := nullif(trim(coalesce(p_busca, '')), '');
  return coalesce((select jsonb_agg(j order by ordem1, ordem2) from (
    select jsonb_build_object(
      'id', x.id, 'produto_id', x.produto_id, 'produto', estoque._prod_nome(pr), 'marca', pr.marca, 'tamanho', pr.tamanho,
      'sku', pr.sku, 'numero_serie', x.numero_serie, 'lote', x.lote, 'validade', x.validade, 'status', x.status, 'lado', x.lado,
      'entrada_data', me.data, 'entrada_motivo', me.motivo, 'fornecedor', me.fornecedor, 'nota_fiscal', me.nota_fiscal,
      'saida_id', ms.id, 'saida_data', ms.data, 'saida_motivo', ms.motivo, 'paciente_nome', ms.paciente_nome,
      'cirurgia', ms.cirurgia, 'data_cirurgia', ms.data_cirurgia, 'usuario_saida', us.nome) j,
      case when x.status = 'estoque' then 0 else 1 end ordem1,
      case when x.status = 'estoque' then extract(epoch from coalesce(x.validade, '2999-01-01'::date)) else -extract(epoch from ms.data) end ordem2
    from estoque.unidades x
    join estoque.produtos pr on pr.id = x.produto_id
    join estoque.movimentacoes me on me.id = x.entrada_mov
    left join estoque.movimentacoes ms on ms.id = x.saida_mov
    left join estoque.usuarios us on us.id = ms.usuario_id
    where x.status <> 'cancelada'
      and (p_produto is null or x.produto_id = p_produto)
      and (p_status is null or x.status = p_status)
      and (b is null or x.numero_serie ilike '%' || b || '%' or x.lote ilike '%' || b || '%'
           or ms.paciente_nome ilike '%' || b || '%' or pr.sku ilike b)
    order by 2, 3 limit 1000) t), '[]'::jsonb);
end $$;

-- Grava o código de barras lido num produto (admin; ou operador liberado, só em produto sem código)
create or replace function public.vincular_codigo(p_token text, p_produto int, p_codigo text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; pr estoque.produtos; cb text;
begin
  u := estoque._sessao(p_token);
  if not estoque._pode_cadastrar(u) then
    raise exception 'Cadastro de códigos não liberado para você. Peça ao administrador.';
  end if;
  cb := regexp_replace(coalesce(p_codigo,''), '\s', '', 'g');
  if cb = '' then raise exception 'Código vazio.'; end if;
  select * into pr from estoque.produtos where id = p_produto for update;
  if not found or pr.excluido then raise exception 'Produto não encontrado.'; end if;
  if false and pr.codigo_barras is not null and pr.codigo_barras <> cb then
    raise exception 'Este produto já tem outro código de barras. Somente o administrador pode trocar.';
  end if;
  if exists (select 1 from estoque.produtos where (codigo_barras = cb or upper(sku) = upper(cb)) and id <> pr.id) then
    raise exception 'Este código já pertence a outro produto.';
  end if;
  update estoque.produtos set codigo_barras = cb where id = pr.id;
  perform estoque._audit(u.id, 'codigo_vinculado', jsonb_build_object('produto', pr.sku, 'codigo', cb, 'anterior', pr.codigo_barras));
  return jsonb_build_object('id', pr.id, 'sku', pr.sku, 'codigo_barras', cb);
end $$;

-- APAGAR PRODUTO (somente o administrador)
-- Sem nenhuma entrada/saída: apaga de vez. Com histórico: baixa o que houver em estoque,
-- libera o código de barras e tira o produto de todas as listas — relatórios e auditoria continuam.
create or replace function public.apagar_produto(p_token text, p_produto int, p_motivo text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; pr estoque.produtos; s int; m estoque.movimentacoes; nun int := 0;
begin
  u := estoque._admin(p_token);
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Informe o motivo.'; end if;
  select * into pr from estoque.produtos where id = p_produto for update;
  if not found or pr.excluido then raise exception 'Produto não encontrado.'; end if;
  if not exists (select 1 from estoque.movimentacoes where produto_id = pr.id)
     and not exists (select 1 from estoque.unidades where produto_id = pr.id) then
    delete from estoque.historico_precos where produto_id = pr.id;
    delete from estoque.produtos where id = pr.id;
    perform estoque._audit(u.id, 'produto_apagado', to_jsonb(pr) || jsonb_build_object('motivo', trim(p_motivo), 'modo', 'apagado'));
    return jsonb_build_object('modo', 'apagado', 'baixadas', 0);
  end if;
  s := estoque._saldo(pr.id);
  if s <> 0 then
    insert into estoque.movimentacoes (tipo, motivo, produto_id, qtd, custo_unitario, valor_unitario, valor_total, observacao, usuario_id)
    values ('ajuste', 'Produto apagado', pr.id, -s, pr.custo, pr.custo, round(pr.custo * -s, 2), trim(p_motivo), u.id)
    returning * into m;
    update estoque.unidades set status = 'cancelada', saida_mov = m.id where produto_id = pr.id and status = 'estoque';
    get diagnostics nun = row_count;
  end if;
  update estoque.produtos set excluido = true, excluido_em = now(), ativo = false, codigo_barras = null where id = pr.id;
  perform estoque._audit(u.id, 'produto_apagado', jsonb_build_object('produto', pr.sku, 'nome', estoque._prod_nome(pr),
          'motivo', trim(p_motivo), 'modo', 'arquivado', 'saldo_baixado', s, 'unidades_canceladas', nun, 'codigo_barras', pr.codigo_barras));
  return jsonb_build_object('modo', 'arquivado', 'baixadas', s);
end $$;

-- Libera (ou encerra, com p_ate nulo) o cadastro temporário de produtos para um operador
create or replace function public.liberar_cadastro(p_token text, p_usuario int, p_ate timestamptz) returns void
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios; alvo estoque.usuarios;
begin
  u := estoque._admin(p_token);
  select * into alvo from estoque.usuarios where id = p_usuario for update;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  if alvo.perfil <> 'operador' then raise exception 'Administrador e gerente de estoque já podem cadastrar produtos.'; end if;
  if p_ate is not null and p_ate <= now() then raise exception 'Escolha uma data e hora no futuro.'; end if;
  if p_ate is not null and p_ate > now() + interval '90 days' then raise exception 'A liberação pode ser de no máximo 90 dias.'; end if;
  update estoque.usuarios set cadastro_ate = p_ate where id = p_usuario;
  perform estoque._audit(u.id, case when p_ate is null then 'cadastro_encerrado' else 'cadastro_liberado' end,
                         jsonb_build_object('usuario', alvo.login, 'ate', p_ate));
end $$;

create or replace function public.redefinir_senha(p_token text, p_usuario int, p_senha text) returns void
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._admin(p_token);
  if length(coalesce(p_senha,'')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  update estoque.usuarios set senha_hash = crypt(p_senha, gen_salt('bf', 10)), trocar_senha = true,
         tentativas = 0, bloqueado_ate = null where id = p_usuario;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  delete from estoque.sessoes where usuario_id = p_usuario;
  perform estoque._audit(u.id, 'senha_redefinida', jsonb_build_object('usuario', p_usuario));
end $$;

create or replace function public.auditoria(p_token text, p_de date, p_ate date) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
begin
  perform estoque._admin(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'data', a.data, 'usuario', u.nome,
            'acao', a.acao, 'detalhes', a.detalhes) order by a.data desc)
    from (select * from estoque.auditoria
           where data >= (p_de::timestamp at time zone 'America/Sao_Paulo')
             and data <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
           order by data desc limit 2000) a
    left join estoque.usuarios u on u.id = a.usuario_id), '[]'::jsonb);
end $$;

create or replace function public.salvar_lista(p_token text, p_categoria text, p_valores jsonb) returns void
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._admin(p_token);
  if p_categoria not in ('tipo','tamanho','forma_pagamento','cirurgia') then raise exception 'Lista inválida.'; end if;
  if jsonb_array_length(coalesce(p_valores,'[]')) = 0 then raise exception 'A lista não pode ficar vazia.'; end if;
  delete from estoque.listas where categoria = p_categoria;
  insert into estoque.listas (categoria, valor, ordem)
  select p_categoria, trim(v), min(ord) from jsonb_array_elements_text(p_valores) with ordinality t(v, ord)
  where trim(v) <> '' group by trim(v);
  perform estoque._audit(u.id, 'lista_alterada', jsonb_build_object('lista', p_categoria, 'valores', p_valores));
end $$;

-- Cópia de segurança completa (sem senhas)
create or replace function public.backup(p_token text) returns jsonb
language plpgsql security definer set search_path = estoque, extensions, public as $$
declare u estoque.usuarios;
begin
  u := estoque._admin(p_token);
  perform estoque._audit(u.id, 'backup_exportado', null);
  return jsonb_build_object(
    'gerado_em', now(),
    'usuarios', (select coalesce(jsonb_agg(to_jsonb(x) - 'senha_hash'), '[]') from estoque.usuarios x),
    'listas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from estoque.listas x),
    'produtos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from estoque.produtos x),
    'movimentacoes', (select coalesce(jsonb_agg(to_jsonb(x) order by id), '[]') from estoque.movimentacoes x),
    'estornos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from estoque.estornos x),
    'historico_precos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from estoque.historico_precos x),
    'unidades', (select coalesce(jsonb_agg(to_jsonb(x) order by id), '[]') from estoque.unidades x),
    'auditoria', (select coalesce(jsonb_agg(to_jsonb(x) order by id), '[]') from estoque.auditoria x));
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES: o site (papel "anon") só executa estas funções
-- ---------------------------------------------------------------------
revoke all on all functions in schema estoque from public;
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema estoque from anon, authenticated';
    execute 'revoke all on all functions in schema estoque from anon, authenticated';
    foreach f in array array[
      'login(text,text)','logout(text)','sessao(text)','inicio(text)','trocar_senha(text,text,text)','listas(text)',
      'produtos(text)','registrar_entrada(text,jsonb)','registrar_saida(text,jsonb)','lancamentos_dia(text,date)',
      'solicitar_estorno(text,bigint,text)','salvar_produto(text,jsonb)','historico_precos(text,int)',
      'ajustar_inventario(text,int,int,text)','estornos(text,text)','decidir_estorno(text,int,boolean,text)',
      'estornar(text,bigint,text)','movimentacoes(text,date,date)','usuarios(text)','salvar_usuario(text,jsonb)',
      'redefinir_senha(text,int,text)','vincular_codigo(text,int,text)','apagar_produto(text,int,text)','unidades(text,int,text,text)','liberar_cadastro(text,int,timestamptz)','auditoria(text,date,date)','salvar_lista(text,text,jsonb)','backup(text)']
    loop
      execute format('revoke all on function public.%s from public', f);
      execute format('grant execute on function public.%s to anon, authenticated', f);
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
