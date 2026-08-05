# Birthday Live Alert v4 — painel persistente

Sistema de aniversários para Twitch/StreamElements com:

- painel em `/admin`;
- adicionar, editar, excluir, ativar e desativar aniversários;
- busca e filtro por canal;
- teste individual no widget;
- backup e restauração em JSON;
- persistência em PostgreSQL externo;
- comando `!niver DD/MM HH:MM`;
- múltiplos canais no mesmo backend.

## Por que os dados não somem ao trocar de Render

O painel usa a variável `DATABASE_URL`. Ela aponta para um banco PostgreSQL separado do Render. Você pode trocar o serviço, apagar o deploy ou mudar a URL do backend: basta usar a mesma `DATABASE_URL` no novo serviço.

Sem `DATABASE_URL`, o sistema entra em modo local apenas para teste e mostra um aviso amarelo no painel. O modo local não garante permanência em hospedagem gratuita.

## Deploy no Render

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`

Variáveis obrigatórias:

```text
APP_BASE_URL=https://SEU-SERVICO.onrender.com
ADMIN_KEY=SUA-SENHA-DO-PAINEL
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
DATABASE_SSL=true
DEFAULT_TIMEZONE=America/Sao_Paulo
```

Para usar Supabase, Neon, Railway PostgreSQL ou outro PostgreSQL externo, copie a connection string completa para `DATABASE_URL`.

Variáveis opcionais para buscar avatar real da Twitch:

```text
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
```

## Abrir o painel

```text
https://SEU-SERVICO.onrender.com/admin
```

Digite a senha definida em `ADMIN_KEY`.

## StreamElements

No Custom Widget, mantenha `apiBaseUrl` apontando para a URL atual do backend. Ao trocar de Render, você só precisa trocar essa URL no Fields do widget. Os aniversários permanecem no PostgreSQL.

Comando personalizado:

```text
$(customapi https://SEU-SERVICO.onrender.com/api/register?channel=$(channel)&user=$(user)&date=$(1)&time=$(2))
```

Exemplo:

```text
!niver 12/08 09:30
```

## Backup extra

No painel, use **Baixar backup** para guardar uma cópia JSON. **Restaurar** permite juntar com a lista atual ou substituí-la.
