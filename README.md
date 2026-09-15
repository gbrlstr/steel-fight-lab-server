# Sleet Fighter Server

Backend autoritativo multiplayer para o **Steel Fight Lab**: salas, fila, torneio e luta em tempo real.

Pareado com o cliente **dota-model-viewer** (Steel Fight Lab). O servidor é a **única autoridade** sobre estado de combate e resultado da partida.

| | |
| --- | --- |
| **Stack** | NestJS 11 · TypeScript · `ws` · Node.js |
| **Simulação** | 60 Hz · snapshots ~20 Hz · rollback até 120 frames |
| **Licença** | [MIT](./LICENSE.md) |

---

## Visão geral

- Criar / entrar em salas por código; lista pública via HTTP
- Seleção de herói, fila, bracket e convocação pelo organizador
- Match autoritativo com a mesma regra de `combat.ts` do cliente
- Saída limpa (`exit`) sem “fantasmas” na sala
- Queda durante a luta: pausa de **30s** + retomada com `resumeId` / `resumeToken` (ex.: F5)
- Timeout de presença e forfeit por abandono / desconexão

```
create/join → hero → queue → tournament/call → ready → start
                                              ↘ input ↔ snapshot
                                              ↘ paused → resumed | forfeit
```

---

## Requisitos

- **Node.js 22+** (recomendado a mesma major do cliente em desenvolvimento)
- Cliente Steel Fight Lab apontando para este servidor

---

## Começar

```bash
npm install
npm run start:dev
```

| Serviço | URL padrão |
| --- | --- |
| Health | `GET http://127.0.0.1:3010/health` |
| Salas | `GET http://127.0.0.1:3010/rooms` |
| WebSocket | `ws://127.0.0.1:3001` |

Portas via [`.env.example`](./.env.example):

```env
PORT=3001
HTTP_PORT=3010
HOST=0.0.0.0
```

Produção:

```bash
npm run build
npm run start:prod
```

---

## Ligar ao cliente

No Nuxt (`dota-model-viewer`):

```ts
runtimeConfig: {
  public: {
    wsUrl: 'ws://127.0.0.1:3001',
    apiUrl: 'http://127.0.0.1:3010',
  },
}
```

Ou:

```bash
NUXT_PUBLIC_WS_URL=ws://127.0.0.1:3001
NUXT_PUBLIC_API_URL=http://127.0.0.1:3010
```

O contrato de mensagens espelha `dota-model-viewer/app/types/network.ts` (JSON com campo `type`).

---

## Protocolo WebSocket (resumo)

### Entrada na sala

1. Cliente envia `create` ou `join` (opcionalmente `resumeId` + `resumeToken`)
2. Servidor responde `welcome` (`id`, `code`, `token`, …) e `room`
3. Fluxo de lobby: `hero` → `queue` → `tournament` / `call` → `ready`

### Luta

| Direção | Tipos principais |
| --- | --- |
| Servidor → cliente | `start`, `snapshot`, `paused`, `resumed`, `result`, `room` |
| Cliente → servidor | `input` (`seq`, `frame`, máscara booleana), `exit` |

- Simulação a **60 Hz**; snapshots ~**20 Hz**
- Cliente **não** envia vida, posição, dano ou vencedor
- Inputs atrasados: janela de rollback; sequências inválidas são descartadas
- Checksum FNV-1a nos snapshots (integridade / testes — não é autenticação)

### Saída e reconexão

| Situação | Comportamento |
| --- | --- |
| `exit` ou disconnect fora da luta | Assento removido; sala atualizada para os demais |
| Disconnect **durante** a luta | `paused` por **30s** |
| `join` com token de resume a tempo | `resumed` no mesmo assento; sequência de input reiniciada via acks |
| Timeout | Vitória do oponente; ausente removido |

Detalhes de autoridade e rollback no cliente: documentação `docs/network.md` no repositório **dota-model-viewer**.

---

## Estrutura

```
src/
  rooms/          # salas, fila, bracket, match, pause/resume
  net/            # servidor WebSocket (ws) no mesmo processo HTTP
  game/           # combat.ts + roster.json (espelho da regra do cliente)
  health.controller.ts
  app.module.ts
  main.ts
```

**Importante:** altere a regra de luta em sincronia com `dota-model-viewer/app/game/shared/combat.ts`. Divergência causa rejeição de snapshots no cliente (`divergences`).

---

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run start:dev` | Watch mode (desenvolvimento) |
| `npm run start:prod` | Executa `dist/main` |
| `npm run build` | Compila Nest |
| `npm run lint` | ESLint |
| `npm test` | Jest (unit) |
| `npm run test:e2e` | Testes e2e |

---

## Como contribuir

1. Fork + branch (`fix/…`, `feat/…`, `docs/…`)
2. Mantenha o protocolo compatível com o cliente ou atualize **ambos** os repositórios no mesmo PR / issue vinculada
3. Rode `npm run build` e testes relevantes
4. Documente mudanças de mensagem (`type`), timeouts ou semântica de sala
5. Não envie segredos, `.env` real nem assets proprietários

Prioridades boas para PRs: estabilidade sob perda de pacotes, limpeza de salas órfãs, métricas/observabilidade, testes de reconexão, sincronização automática de `combat.ts` / `roster.json`.

---

## Segurança e limites atuais

- Estado de salas **em memória** (não persiste após restart)
- Sem autenticação de conta; identidade = conexão (+ token de resume de curta duração)
- Checksum de snapshot não substitui anti-cheat criptográfico
- Adequado a protótipo / LAN / demos; endurecer antes de produção pública em larga escala

---

## Licença

[MIT](./LICENSE.md) — Copyright © 2026 Steel Fight Lab Contributors.

Aviso: dados derivados de *Dota 2* / Valve não estão cobertos pela MIT. Veja o apêndice em `LICENSE.md`.
