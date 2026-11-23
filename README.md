# Diário de funcionamento psicológico

Ferramenta pessoal de automonitoramento diário (humor, energia, cognição, ansiedade,
impulsividade, sono, comportamento e contexto). **Não é instrumento diagnóstico.**

Stack: React + TypeScript + Vite (PWA instalável), Supabase (Postgres, Auth, RLS).
Hospedagem gratuita: Vercel (front) e Supabase free (dados).

## Arquitetura em uma frase

O navegador conversa diretamente com o Supabase. A proteção dos dados não depende
do front: está no **Row Level Security** do Postgres e nas **regras de conclusão
dentro do banco** (`complete_entry`). Mesmo que o front seja alterado, o banco
recusa dados que violam as regras.

## Estrutura

```
supabase/migrations/001_init.sql   esquema inicial, RLS e funções base
supabase/migrations/002_data_integrity.sql   gravação transacional e auditoria protegida
supabase/migrations/003_atomic_backup_restore.sql   restauração transacional de backup
src/domain/indicators.ts           catálogo dos 45 indicadores (espelha o banco)
src/domain/schemas.ts              validação (rascunho, conclusão, backup)
src/domain/analysis.ts             análise descritiva + correlação com gate
src/domain/export.ts               CSV (com proteção contra injeção) e backup JSON
src/domain/domain.test.ts          testes da lógica de domínio
src/data/repository.ts             acesso ao Supabase com controle de concorrência
src/ui/                            formulário, calendário, análise, dados
```

## Configuração

### 1. Supabase

1. Crie um projeto em supabase.com (plano free).
2. No **SQL Editor**, execute os arquivos SQL em ordem: `001_init.sql`, `002_data_integrity.sql` e `003_atomic_backup_restore.sql`. Não pule a ordem.
3. Em **Authentication → Providers**, mantenha **Email** habilitado (login por link).
4. Em **Authentication → URL Configuration**, defina a *Site URL* com o endereço
   da aplicação (ex.: `https://seu-diario.vercel.app`) e adicione a mesma URL em
   *Redirect URLs*. Para teste local, adicione também `http://localhost:5173`.
5. Desative cadastro aberto se for usar só você: em *Authentication → Providers →
   Email*, desmarque *Allow new users to sign up* após criar sua conta. Isso impede
   que outras pessoas criem contas no seu projeto.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

A chave *anon* é pública por desenho. Nunca coloque a *service_role* no front.

### 3. Ícones do PWA

Coloque `public/icon-192.png` e `public/icon-512.png` (necessários para instalar na tela
inicial). Sem eles, a aplicação funciona, mas o celular pode não oferecer a instalação.

### 4. Executar

```bash
npm install
npm run dev        # desenvolvimento
npm test           # testes de domínio
npm run build      # checagem de tipos + build de produção
```

### 5. Deploy gratuito (Vercel)

Importe o repositório na Vercel, defina as duas variáveis `VITE_*` e faça o deploy.
Nenhum servidor precisa ficar ligado no seu computador.

## Integridade: o que o sistema garante

| Garantia | Onde é aplicada |
|---|---|
| Um registro por dia; nenhum dia é sobrescrito por outro | `UNIQUE (user_id, entry_date)` |
| Usuário só acessa os próprios dados | RLS em todas as tabelas |
| Registros não podem ser apagados pela API comum | Sem política de DELETE |
| Concluir exige os 45 indicadores, horas de sono e os dois campos narrativos | Função `complete_entry` no banco |
| Edição concorrente não sobrescreve silenciosamente | `updated_at` como controle otimista no `saveDraft` |
| Alterações em registros concluídos ficam registradas | Triggers em `daily_entry` e `indicator_score` → `entry_revision` |
| Histórico de revisões não pode ser alterado | Sem políticas de update/delete em `entry_revision` |
| Valores fora de 0–10 e indicadores desconhecidos são recusados | `CHECK` no banco + `zod` no front |
| Dia sem registro não vira zero nas análises | `null` e `n` explícito em toda estatística |
| Restauração não sobrescreve dias existentes | `restore_entries` no banco pula e informa; o lote é transacional |

## Análise

- **Descritiva (ativa):** média, desvio padrão, mínimo/máximo, comparação dos últimos
  7 dias com os 7 anteriores, tendência por mínimos quadrados (somente com ≥ 7 dias),
  média móvel de 7 dias, gráficos e calendário. Todo resultado mostra `n`.
- **Correlação (implementada, desativada):** Spearman com tratamento de empates. Só é
  exibida se `CORRELATIONS_ENABLED = true` **e** houver pelo menos `MIN_PAIRS = 30` pares
  completos. Esse limiar fica em `src/domain/analysis.ts`; ajuste quando quiser.

Ao ativar correlações, mantenha a leitura como associação, nunca causa.

## Exportação e backup

- **CSV:** uma linha por dia, com BOM para o Excel reconhecer acentos. Células começando com
  `= + - @` recebem apóstrofo (proteção contra injeção de fórmula).
- **JSON (backup):** `schema_version` e todos os registros. É o formato de restauração.
- **PDF:** a aplicação usa a impressão do navegador (“Salvar como PDF”), com CSS de impressão.
  Não há geração de PDF no servidor.

## Limitações conhecidas

Honestidade sobre o que **não** está pronto:

1. **Offline (parcial):** após carregar um registro com conexão, alterações também são
   guardadas no IndexedDB e sincronizadas quando a conexão voltar. Esse armazenamento é
   local ao perfil do navegador, não é criptografado pelo aplicativo e pode ser apagado
   pelo navegador. Se a versão do servidor mudar em outra sessão, a cópia local é preservada
   e exige decisão manual; não há resolução automática de conflitos. Ainda é necessário
   estar online para carregar/criar o registro inicial.
2. **Testes de RLS:** as políticas e permissões foram reforçadas, mas ainda precisam ser
   verificadas contra um Supabase local ou projeto de teste com dois usuários distintos.
   Não declare a segurança multiusuário validada até esse teste passar.
3. **Testes da conclusão e restauração no banco:** as funções SQL validam as regras e a
   restauração é transacional, mas ainda falta executar testes de integração contra um
   Supabase local (`supabase start`).
4. **Lista de indicadores duplicada:** o catálogo existe no SQL e no TypeScript. Qualquer
   mudança exige alterar os dois. Um teste de integração deveria comparar ambos.
5. **Plano gratuito do Supabase:** projetos inativos por um período podem ser pausados, e
   o plano gratuito tem backups limitados. Confira a política atual no painel. Por isso,
   faça **backup JSON periódico** pela aba Dados e guarde-o fora da nuvem.
6. **Localização dos dados:** o Supabase oferece regiões; escolha a mais próxima do Brasil
   na criação do projeto. Mesmo assim, o provedor é externo; avalie isso à luz da LGPD
   (dado de saúde, art. 11), com consentimento explícito e a ciência de que o uso é pessoal.
7. **Análise não é diagnóstico.** Textos gerados pela aplicação descrevem valores; não
   estabelecem condições clínicas.

## Próximos passos sugeridos

- Buffer offline com IndexedDB e sincronização ao reconectar.
- Teste de integração do banco (RLS, unicidade, conclusão, revisões) com `supabase start`.
- Autenticação com segundo fator (TOTP) no Supabase, já que os dados são sensíveis.
- Exportação de relatório mensal como arquivo, não só impressão.
