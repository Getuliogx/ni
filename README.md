# Birthday Live Alert v2

Projeto para Twitch com:
- comando `!niver DD/MM HH:MM`
- multi-canal no mesmo backend
- mensagem personalizada com `{nick}`
- avatar no alerta
- widget para StreamElements
- painel admin

## Estrutura

- `backend/` -> vai para Render/Railway
- `streamelements-widget/` -> colar no Custom Widget do StreamElements

## Repositório

Suba **as duas pastas no mesmo repositório**.

## Importante sobre GitHub

Não suba `node_modules`.

Se estiver usando upload pelo navegador do GitHub e aparecer que são arquivos demais, use:
- GitHub Desktop, ou
- arraste só esta estrutura limpa do projeto

## Deploy no Render

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`

### Variáveis de ambiente

Crie no Render:

- `APP_BASE_URL` = URL final do app no Render
- `ADMIN_KEY` = sua senha do painel
- `DEFAULT_TIMEZONE` = `America/Sao_Paulo`
- `DEFAULT_MESSAGE_TEMPLATE` = `🎉 Feliz aniversário, {nick}!`
- `TWITCH_CLIENT_ID` = seu Client ID da Twitch
- `TWITCH_CLIENT_SECRET` = seu Client Secret da Twitch

Os dois últimos são os que permitem buscar automaticamente a foto de perfil do usuário pela API da Twitch. A Twitch usa o endpoint Get Users para retornar dados do usuário, incluindo `profile_image_url`. citeturn925765search0turn925765search3

## StreamElements

O Custom Widget aceita HTML, CSS, JS e pode buscar dados por HTTP API. O chatbot também aceita `$(customapi)` para chamar API externa. citeturn925765search1turn925765search2

### Comando `!niver`

Crie um comando custom no StreamElements com a resposta:

```text
$(customapi https://SEU-BACKEND.com/api/register?channel=$(channel)&user=$(user)&date=$(1)&time=$(2))
```

Exemplo no chat:

```text
!niver 12/08 09:30
```

### Widget

No StreamElements, crie um **Custom Widget** e cole:
- `widget.html` em HTML
- `widget.css` em CSS
- `widget.js` em JS
- `widget.json` em Fields

Depois configure:
- `apiBaseUrl` = sua URL do Render
- `channel` = nome do canal Twitch onde o widget vai rodar
- `timezone` = `America/Sao_Paulo`

## Mensagem personalizada

No painel admin ou via variável de ambiente, use placeholders:
- `{nick}`
- `{channel}`
- `{date}`
- `{time}`

Exemplo:

```text
🎂 Hoje é o dia do {nick}! Feliz aniversário!
```

## Painel admin

Abra:

```text
https://SEU-BACKEND.com/admin?key=SUA_CHAVE
```

Você pode filtrar por canal:

```text
https://SEU-BACKEND.com/admin?key=SUA_CHAVE&channel=nomedocanal
```

## Overlay direto pelo backend

Também existe uma rota pronta:

```text
https://SEU-BACKEND.com/overlay?channel=nomedocanal&timezone=America/Sao_Paulo
```

Mas para Twitch o ideal é usar o Custom Widget do StreamElements.
