# Sleet Fighter Server

Backend NestJS autoritativo para salas, fila, torneio e luta multiplayer do Sleet Fighter.

## Contrato WebSocket

Mesmo protocolo do cliente em `dota-model-viewer` (`app/types/network.ts`):

- Cliente: `ws://127.0.0.1:3001`
- Mensagens JSON com campo `type`
- Simulação a 60 Hz, snapshots ~20 Hz, rollback de até 120 frames

### Fluxo

1. `create` / `join` → `welcome` + `room`
2. `hero`, `queue`, `tournament` / `call`, `ready`
3. `start` → luta; `input` → `snapshot`
4. `result` ao terminar (KO validado, abandono ou desconexão)

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
  },
}
```

Ou `NUXT_PUBLIC_WS_URL=ws://127.0.0.1:3001`.

## Estrutura

- `src/rooms` — salas, fila, bracket e match autoritativo
- `src/net` — servidor WebSocket nativo (`ws`) no mesmo HTTP
- `src/game` — cópia da regra `combat.ts` + `roster.json` usada na autoridade
