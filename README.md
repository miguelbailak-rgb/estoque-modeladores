# Estoque de Modeladores

Controle de estoque de modeladores pós-operatórios da **Miguel Bailak Cirurgia Plástica**.
Funciona no celular, tablet e computador, pela internet.

- **Operador** (recepção/secretária): registra entradas e saídas e consulta o estoque — não vê custos nem margens.
- **Administrador**: tudo do operador + painel, produtos e preços, ajustes de inventário, aprovação de estornos, relatórios, usuários, auditoria e backup.

O site fica no **GitHub Pages** (grátis) e os dados ficam num banco **Supabase** (grátis), protegido por senha.

---

## Como colocar no ar (uma vez só, ~15 minutos)

### 1. Criar o banco de dados no Supabase

1. Acesse **https://supabase.com** → *Start your project* → entre com sua conta (pode ser a do GitHub).
2. Clique em **New project**:
   - *Name*: `estoque-modeladores`
   - *Database Password*: crie uma senha forte e guarde (não é usada no aplicativo, mas guarde)
   - *Region*: **South America (São Paulo)**
   - Clique em *Create new project* e espere uns 2 minutos.
3. No menu da esquerda, abra **SQL Editor** → **New query**.
4. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) aqui no GitHub, clique no botão de **copiar** (ícone de duas folhas, no canto do arquivo), cole no SQL Editor e clique em **Run**.
   Deve aparecer *Success. No rows returned*.

### 2. Pegar a URL e a chave pública

No Supabase, vá em **Project Settings** (engrenagem) → **API Keys** / **Data API**:

- **Project URL** — algo como `https://abcdefghijkl.supabase.co`
- **Publishable key** (começa com `sb_publishable_…`) — ou, em projetos antigos, a chave **anon public**

> ⚠️ Use **somente** a chave pública. Nunca copie a chave *secret* / *service_role*.

### 3. Colocar a URL e a chave no aplicativo

1. Aqui no GitHub, abra o arquivo [`js/config.js`](js/config.js) e clique no **lápis** (Edit).
2. Preencha entre as aspas:
   ```js
   SUPABASE_URL: "https://abcdefghijkl.supabase.co",
   SUPABASE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx",
   ```
3. Clique em **Commit changes…** → **Commit changes**.

### 4. Publicar o site (GitHub Pages)

1. No repositório: **Settings** → **Pages**.
2. Em *Build and deployment* → *Source*: **Deploy from a branch**; *Branch*: **main** e pasta **/ (root)** → **Save**.
3. Em 1–2 minutos o endereço aparece no topo da página:
   **https://miguelbailak-rgb.github.io/estoque-modeladores/**

### 5. Primeiro acesso

- Usuário: **admin**
- Senha: **admin123**

O sistema obriga a trocar a senha no primeiro acesso. Depois:

1. **Configurações** → confira as listas de tipos, tamanhos, formas de pagamento e cirurgias.
2. **Produtos** → **+ Novo produto** (dá para marcar vários tamanhos de uma vez; cada tamanho vira um item).
3. **Entrada** → lance o estoque inicial (motivo *Compra de fornecedor* ou *Outro*).
4. **Usuários** → crie os operadores (cada um cria a própria senha no primeiro acesso).

### Liberação temporária de cadastro

Em **Usuários**, no operador, toque em **Liberar cadastro** e escolha o prazo (fim do dia, 24 horas, 7 dias ou data/hora; no máximo 90 dias).
Enquanto durar, ele vê o menu **Produtos** e pode **cadastrar produtos novos** e **gravar o código de barras** de produtos que ainda não têm — além das entradas e saídas de sempre.
Não pode alterar produtos existentes, preços, nem ver custos, painel, relatórios, usuários ou auditoria.
A liberação termina sozinha no prazo; dá para encerrar antes com **Encerrar liberação**. Tudo fica na Auditoria.

### Leitor de código de barras

- **Câmera**: toque em **Ler código** e aponte para o código de barras ou QR code. Na primeira vez o celular/iPad pede permissão para usar a câmera — toque em **Permitir**.
  Se negou sem querer: iPhone/iPad → Ajustes › Safari › Câmera › Permitir; Android → cadeado ao lado do endereço › Permissões › Câmera.
- **Leitor de mão (USB ou Bluetooth)**: use um leitor no modo teclado (o padrão da maioria) que envia *Enter* no final. É só ler o código com a tela de Saída, Entrada, Estoque ou Produtos aberta. No iPad, pareie o leitor pelo Bluetooth como se fosse um teclado.
- **Cadastrar o código de um produto**: leia o código na Entrada; se ele não estiver cadastrado, o administrador escolhe o produto e o código fica gravado. Ou em Produtos › Editar › *Código de barras do fabricante*.
- Cada tamanho/cor tem o seu próprio código de barras.

### Instalar no celular como aplicativo

Abra o endereço no celular e:
- **iPhone (Safari)**: botão Compartilhar → **Adicionar à Tela de Início**.
- **Android (Chrome)**: menu ⋮ → **Adicionar à tela inicial** / **Instalar app**.

---

## Como funciona

| Tela | Quem vê | O que faz |
|---|---|---|
| Leitor de código | todos | Botão **Ler código** (câmera do celular/iPad) e **leitor de mão** USB/Bluetooth nas telas de Saída, Entrada, Estoque e Produtos. Lê código de barras do fabricante (EAN) e QR code. Código desconhecido: o admin grava o código no produto na hora. |
| Saída | todos | Venda à paciente, incluído no pacote cirúrgico, cortesia, troca, perda/avaria, uso interno. Não deixa sair mais do que há em estoque. Gera comprovante para imprimir. |
| Entrada | todos | Compra de fornecedor, devolução de paciente, troca recebida, outro. |
| Estoque | todos | Saldo de cada item, alerta de reposição. Admin vê custos e faz ajuste de inventário (contagem física, com justificativa). |
| Lançamentos | todos | Lançamentos do dia. Operador vê só os seus e pode **pedir estorno**; admin estorna direto. |
| Painel | admin | Valor do estoque (custo e venda), itens para repor, faturamento, lucro e margem do mês, gráficos. |
| Produtos | admin | Cadastro, preços (com histórico de alterações), estoque mínimo, ativar/inativar. |
| Etiquetas | admin | Imprime etiquetas com QR code (folha A4, 3×7, 63,5×38,1 mm — Pimaco A4360) para modeladores sem código de barras. |
| Estornos | admin | Aprovar ou recusar pedidos dos operadores. |
| Relatórios | admin | Posição de estoque, extrato, vendas e margem, saídas por cirurgia, reposição, perdas/cortesias, por operador, curva ABC. Exporta para **Excel** e **PDF**. |
| Usuários | admin | Criar, desativar, redefinir senha (também desbloqueia). **Liberar cadastro** temporário para um operador. |
| Auditoria | admin | Registro permanente de todas as ações. |
| Configurações | admin | Listas editáveis, **backup completo**, tema claro/escuro. |

### Segurança

- Senhas guardadas com criptografia (bcrypt); ninguém, nem o administrador, consegue ver a senha de outra pessoa.
- Bloqueio de 15 minutos após 5 senhas erradas.
- A sessão termina após 30 minutos sem uso.
- Os dados ficam numa área privada do banco: o site só acessa através de funções que conferem o usuário e o perfil a cada operação. O operador nunca recebe valores de custo.
- Movimentações e auditoria **não podem ser apagadas nem alteradas** — correções são feitas por estorno ou ajuste, que ficam registrados.
- O código no GitHub é público, mas **não contém dados nem senhas**. A chave do `config.js` é a chave pública do Supabase, feita para ficar no site.
- LGPD: o sistema só guarda o nome da paciente e a cirurgia, o mínimo para rastrear a saída do modelador.

### Backup

O plano gratuito do Supabase **não** faz backups automáticos que você possa restaurar.
Por isso, faça em **Configurações → Baixar backup completo** pelo menos **uma vez por semana** e guarde o arquivo num local seguro (ele contém nomes de pacientes).
Se quiser backup diário automático, o plano **Pro** do Supabase inclui.

> Observação: no plano gratuito, o Supabase pausa projetos que ficam **7 dias sem nenhum acesso**. Com uso diário isso não acontece; se acontecer, basta entrar no painel do Supabase e clicar em *Restore*.

---

## Atualizar o banco depois de mudanças

Se o arquivo `supabase/schema.sql` for atualizado, basta rodá-lo de novo no SQL Editor — ele recria as funções e **mantém todos os dados**.

## Estrutura dos arquivos

```
index.html              página do aplicativo
css/style.css           visual (fonte grande, pensado para celular)
js/config.js            URL e chave do Supabase  ← editar
js/app.js               telas e regras do aplicativo
supabase/schema.sql     banco de dados, segurança e funções
manifest.webmanifest    instalação como app no celular
icons/                  ícones
```
