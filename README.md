# Sleet Fighter Server

Authoritative multiplayer backend for **Steel Fight Lab**: rooms, queue, tournament, and real-time fights.

Paired with the **dota-model-viewer** client (Steel Fight Lab). The server is the **sole authority** over combat state and match outcome.

| | |
| --- | --- |
| **Stack** | NestJS 11 · TypeScript · `ws` · Node.js |
| **Simulation** | 60 Hz · snapshots ~20 Hz · rollback up to 120 frames |
| **License** | [MIT](./LICENSE.md) |

---

## Overview

- Create / join rooms by code; public list over HTTP
- Hero select, queue, bracket, and host call-up
- Authoritative match using the same `combat.ts` rules as the client
- Clean leave (`exit`) with no ghost seats in the room
- Drop mid-fight: **30s** pause + resume via `resumeId` / `resumeToken` (e.g. F5)
- Presence timeout and forfeit on leave / disconnect

```
create/join → hero → queue → tournament/call → ready → start
                                              ↘ input ↔ snapshot
                                              ↘ paused → resumed | forfeit
```

---

## Requirements

- **Node.js 22+** (same major as the client is recommended in development)
- Steel Fight Lab client pointed at this server

---

## Get started

```bash
npm install
npm run start:dev
```

| Service | Default URL |
| --- | --- |
| Health | `GET http://127.0.0.1:3010/health` |
| Rooms | `GET http://127.0.0.1:3010/rooms` |
| WebSocket | `ws://127.0.0.1:3001` |

Ports via [`.env.example`](./.env.example):

```env
PORT=3001
HTTP_PORT=3010
HOST=0.0.0.0
```

Production:

```bash
npm run build
npm run start:prod
```

---

## Connect the client

In Nuxt (`dota-model-viewer`):

```ts
runtimeConfig: {
  public: {
    wsUrl: 'ws://127.0.0.1:3001',
    apiUrl: 'http://127.0.0.1:3010',
  },
}
```

Or:

```bash
NUXT_PUBLIC_WS_URL=ws://127.0.0.1:3001
NUXT_PUBLIC_API_URL=http://127.0.0.1:3010
```

The message contract mirrors `dota-model-viewer/app/types/network.ts` (JSON with a `type` field).

---

## WebSocket protocol (summary)

### Joining a room

1. Client sends `create` or `join` (optionally `resumeId` + `resumeToken`)
2. Server replies with `welcome` (`id`, `code`, `token`, …) and `room`
3. Lobby flow: `hero` → `queue` → `tournament` / `call` → `ready`

### Fight

| Direction | Main types |
| --- | --- |
| Server → client | `start`, `snapshot`, `paused`, `resumed`, `result`, `room` |
| Client → server | `input` (`seq`, `frame`, boolean mask), `exit` |

- Simulation at **60 Hz**; snapshots ~**20 Hz**
- Client does **not** send HP, position, damage, or winner
- Late inputs: rollback window; invalid sequences are dropped
- FNV-1a checksum on snapshots (integrity / tests — not authentication)

### Leave & reconnect

| Situation | Behavior |
| --- | --- |
| `exit` or disconnect outside a fight | Seat removed; room updated for everyone else |
| Disconnect **during** a fight | `paused` for **30s** |
| `join` with resume token in time | `resumed` on the same seat; input sequence reset via acks |
| Timeout | Opponent wins; missing player removed |

Authority and rollback details on the client: `docs/network.md` in the **dota-model-viewer** repo.

---

## Structure

```
src/
  rooms/          # rooms, queue, bracket, match, pause/resume
  net/            # WebSocket server (ws) on the same HTTP process
  game/           # combat.ts + roster.json (mirrors client rules)
  health.controller.ts
  app.module.ts
  main.ts
```

**Important:** change fight rules in sync with `dota-model-viewer/app/game/shared/combat.ts`. Divergence causes the client to reject snapshots (`divergences`).

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run start:dev` | Watch mode (development) |
| `npm run start:prod` | Run `dist/main` |
| `npm run build` | Compile Nest |
| `npm run lint` | ESLint |
| `npm test` | Jest (unit) |
| `npm run test:e2e` | End-to-end tests |

---

## Contributing

1. Fork + branch (`fix/…`, `feat/…`, `docs/…`)
2. Keep the protocol compatible with the client, or update **both** repos in the same PR / linked issue
3. Run `npm run build` and relevant tests
4. Document message (`type`) changes, timeouts, or room semantics
5. Do not commit secrets, real `.env` files, or proprietary assets

Strong PR targets: packet-loss stability, orphan room cleanup, metrics/observability, reconnect tests, automated sync of `combat.ts` / `roster.json`.

---

## Security & current limits

- Room state is **in-memory** (lost on restart)
- No account auth; identity = connection (+ short-lived resume token)
- Snapshot checksum is not cryptographic anti-cheat
- Fine for prototype / LAN / demos; harden before large-scale public production

---

## License

[MIT](./LICENSE.md) — Copyright © 2026 Steel Fight Lab Contributors.

Note: data derived from *Dota 2* / Valve is not covered by MIT. See the appendix in `LICENSE.md`.
