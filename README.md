# Sleet Fighter Server

Backend NestJS autoritativo para salas, fila, torneio e luta multiplayer do Sleet Fighter.

## Contrato WebSocket

Mesmo protocolo do cliente em `dota-model-viewer` (`app/types/network.ts`):

- Cliente: `ws://127.0.0.1:3001`
- Mensagens JSON com campo `type`
- Simulação a 60 Hz, snapshots ~20 Hz, rollback de até 120 frames

### Fluxo

1. `create` / `join` → `welcome` (+ `token`) + `room`
2. `hero`, `queue`, `tournament` / `call`, `ready`
3. `start` → luta; `input` → `snapshot`
4. `result` ao terminar (KO validado, abandono ou desconexão)

### Saída e reconexão

- `exit` remove o jogador da sala (não fica fantasma para os outros)
- Queda de conexão **fora** da luta também remove o assento
- Queda **durante** a luta pausa a partida (`paused`) por **30s**
- `join` com `resumeId` + `resumeToken` retoma o mesmo assento (ex.: F5)
- Se voltar a tempo → `resumed`; se não → vitória do oponente e remoção do ausente
- Lista pública: `GET http://127.0.0.1:3010/rooms`

## Scripts

```bash
npm install
npm run start:dev
```

Health: `GET http://127.0.0.1:3010/health`  
WebSocket: `ws://127.0.0.1:3001`

## Cliente Nuxt

Em `dota-model-viewer/nuxt.config.ts`:

```ts
runtimeConfig: {
  public: {
    wsUrl: 'ws://127.0.0.1:3001',
    apiUrl: 'http://127.0.0.1:3010',
  },
}
```

Ou `NUXT_PUBLIC_WS_URL` / `NUXT_PUBLIC_API_URL`.

## Estrutura

- `src/rooms` — salas, fila, bracket e match autoritativo
- `src/net` — servidor WebSocket nativo (`ws`) no mesmo HTTP
- `src/game` — cópia da regra `combat.ts` + `roster.json` usada na autoridade
