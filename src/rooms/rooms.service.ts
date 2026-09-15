import { Injectable, Logger } from '@nestjs/common'
import { randomBytes, randomUUID } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import {
  RULES,
  checksum,
  initial,
  roster,
  step,
  type Input,
  type State,
} from '../game/combat'
import {
  RECONNECT_MS,
  type Person,
  type Room,
  type RoomSummary,
  type RoomView,
} from './rooms.types'

const INPUT_KEYS = ['left', 'right', 'up', 'down', 'attack', 'special'] as const

type SocketCtx = { room: Room | null; person: Person | null }

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name)
  private readonly rooms = new Map<string, Room>()

  listSize() {
    return this.rooms.size
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => {
      const online = [...room.people.values()].filter((person) => person.online)
      return {
        code: room.code,
        host: online.find((person) => person.id === room.host)?.nick ?? online[0]?.nick ?? '—',
        players: online.length,
        queue: room.queue.length,
        active: !!room.match,
      }
    })
  }

  view(room: Room): RoomView {
    return {
      type: 'room',
      code: room.code,
      host: room.host,
      people: [...room.people.values()].map(({ id, nick, hero, ready, online }) => ({
        id,
        nick,
        hero,
        ready,
        online,
      })),
      queue: room.queue,
      pair: room.pair,
      deadline: room.deadline,
      bracket: room.bracket,
      champion: room.champion,
      active: !!room.match,
      paused: !!room.match?.paused,
      pauseUntil: room.match?.pauseUntil ?? 0,
      missing: room.match?.missing ?? [],
    }
  }

  send(ws: WebSocket | null, data: unknown) {
    if (ws && ws.readyState === 1 && ws.bufferedAmount < 1024 * 1024) {
      ws.send(JSON.stringify(data))
    }
  }

  broadcast(room: Room, data: unknown) {
    for (const person of room.people.values()) this.send(person.ws, data)
  }

  update(room: Room) {
    this.broadcast(room, this.view(room))
  }

  private purgeRoom(room: Room) {
    if ([...room.people.values()].some((entry) => entry.online)) return
    this.rooms.delete(room.code)
    this.logger.log(`Room ${room.code} removed`)
  }

  private removePerson(room: Room, person: Person) {
    room.people.delete(person.id)
    room.queue = room.queue.filter((id) => id !== person.id)
    if (person.id === room.host) {
      room.host = [...room.people.values()].find((entry) => entry.online)?.id ?? null
    }
  }

  private schedule(room: Room) {
    if (room.match || room.pair.length) return
    const next = room.bracket.find((match) => !match.done)
    if (next) room.pair = [...next.players]
    else if (!room.bracket.length && room.queue.length >= 2) {
      room.pair = room.queue.splice(0, 2)
    }
    if (room.pair.length) {
      room.deadline = Date.now() + 30_000
      for (const id of room.pair) room.people.get(id)!.ready = false
      this.update(room)
    }
  }

  finish(room: Room, winner: string | undefined, reason: string) {
    const pair = [...room.pair]
    this.broadcast(room, { type: 'result', winner, reason })
    const node = room.bracket.find(
      (match) => !match.done && match.players[0] === pair[0] && match.players[1] === pair[1],
    )
    if (node && winner) {
      node.done = true
      node.winner = winner
      const round = room.bracket.filter((match) => match.round === node.round)
      if (round.every((match) => match.done)) {
        const winners = round.map((match) => match.winner!).filter(Boolean)
        if (winners.length === 1) room.champion = winners[0]
        else {
          for (let i = 0; i < winners.length; i += 2) {
            room.bracket.push({
              round: node.round + 1,
              players: [winners[i], winners[i + 1]],
              done: false,
            })
          }
        }
      }
    }
    room.match = null
    room.pair = []
    room.deadline = 0
    this.update(room)
    this.schedule(room)
  }

  private begin(room: Room) {
    const heroes = room.pair.map((id) => room.people.get(id)!.hero)
    room.match = {
      state: initial(heroes[0], heroes[1]),
      history: new Map(),
      inputs: new Map(),
      sequence: [-1, -1],
      clock: performance.now(),
      terminal: 0,
      paused: false,
      pauseUntil: 0,
      missing: [],
    }
    this.broadcast(room, {
      type: 'start',
      pair: room.pair,
      state: room.match.state,
      acks: [...room.match.sequence],
      resumed: false,
    })
    this.update(room)
  }

  private pauseMatch(room: Room, missingId: string) {
    const match = room.match
    if (!match) return
    if (!match.missing.includes(missingId)) match.missing.push(missingId)
    match.paused = true
    match.pauseUntil = Date.now() + RECONNECT_MS
    match.clock = performance.now()
    this.broadcast(room, {
      type: 'paused',
      until: match.pauseUntil,
      missing: match.missing,
      seconds: Math.ceil(RECONNECT_MS / 1000),
    })
    this.update(room)
    this.logger.log(`Match paused in room ${room.code} · waiting ${missingId.slice(0, 8)}`)
  }

  private resumeMatch(room: Room) {
    const match = room.match
    if (!match?.paused) return
    match.paused = false
    match.pauseUntil = 0
    match.missing = []
    match.clock = performance.now()
    this.broadcast(room, {
      type: 'resumed',
      pair: room.pair,
      state: match.state,
      acks: [...match.sequence],
    })
    this.update(room)
    this.logger.log(`Match resumed in room ${room.code}`)
  }

  private tryResume(room: Room) {
    const match = room.match
    if (!match?.paused) return
    match.missing = match.missing.filter((id) => !room.people.get(id)?.online)
    if (!match.missing.length) this.resumeMatch(room)
    else this.update(room)
  }

  private attachPerson(room: Room, person: Person, ws: WebSocket) {
    person.ws = ws
    person.online = true
    person.disconnectedAt = null
    person.ready = room.pair.includes(person.id) ? person.ready : false
  }

  handleMessage(ws: WebSocket, raw: RawData, ctx: SocketCtx) {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>
    if (message.type === 'ping') {
      this.send(ws, { type: 'pong', at: message.at })
      return ctx
    }

    if (message.type === 'list') {
      this.send(ws, { type: 'rooms', rooms: this.list() })
      return ctx
    }

    if (message.type === 'create' || message.type === 'join') {
      if (ctx.room) throw new Error('Already connected to a room')

      const resumeId = String(message.resumeId ?? '')
      const resumeToken = String(message.resumeToken ?? '')

      if (message.type === 'join' && resumeId && resumeToken) {
        const room = this.rooms.get(String(message.code ?? '').toUpperCase())
        const existing = room?.people.get(resumeId)
        if (room && existing && existing.token === resumeToken) {
          if (existing.online && existing.ws && existing.ws !== ws) {
            try {
              existing.ws.close(4000, 'replaced')
            } catch {
              /* ignore */
            }
          }
          this.attachPerson(room, existing, ws)
          if (message.nick) {
            existing.nick = String(message.nick).trim().slice(0, 24) || existing.nick
          }
          this.send(ws, {
            type: 'welcome',
            id: existing.id,
            code: room.code,
            token: existing.token,
            resumed: true,
          })
          this.send(ws, this.view(room))
          if (room.match) {
            const slot = room.pair.indexOf(existing.id)
            if (slot >= 0) {
              // Allow the reconnected client to start a fresh input sequence.
              room.match.sequence[slot] = -1
              for (const [frame, values] of room.match.inputs) {
                values[slot] = null
                room.match.inputs.set(frame, values)
              }
            }
            this.send(ws, {
              type: 'start',
              pair: room.pair,
              state: room.match.state,
              acks: [...room.match.sequence],
              resumed: true,
            })
            if (room.match.paused) {
              this.send(ws, {
                type: 'paused',
                until: room.match.pauseUntil,
                missing: room.match.missing,
                seconds: Math.max(0, Math.ceil((room.match.pauseUntil - Date.now()) / 1000)),
              })
            }
          }
          this.tryResume(room)
          this.update(room)
          return { room, person: existing }
        }
      }

      let room: Room | undefined
      if (message.type === 'create') {
        if (this.rooms.size >= 100) throw new Error('Server full')
        const code = randomBytes(3).toString('hex').toUpperCase()
        room = {
          code,
          host: null,
          people: new Map(),
          queue: [],
          pair: [],
          bracket: [],
          champion: null,
          match: null,
          deadline: 0,
        }
        this.rooms.set(code, room)
      } else {
        room = this.rooms.get(String(message.code ?? '').toUpperCase())
      }
      if (!room) throw new Error('Room not found')
      if (room.people.size >= 64) throw new Error('Room full')

      const person: Person = {
        id: randomUUID(),
        token: randomBytes(16).toString('hex'),
        nick: String(message.nick ?? 'Viewer').trim().slice(0, 24) || 'Viewer',
        hero: 'tusk',
        ready: false,
        online: true,
        ws,
        disconnectedAt: null,
      }
      room.people.set(person.id, person)
      if (!room.host) room.host = person.id
      this.send(ws, {
        type: 'welcome',
        id: person.id,
        code: room.code,
        token: person.token,
        resumed: false,
      })
      this.send(ws, this.view(room))
      this.update(room)
      return { room, person }
    }

    const { room, person } = ctx
    if (!room || !person) throw new Error('Join a room first')

    if (message.type === 'exit') {
      this.exitPerson(room, person, 'leave')
      return { room: null, person: null }
    }

    if (message.type === 'hero') {
      if (room.pair.includes(person.id) && room.match) {
        throw new Error('Hero select locked during fight')
      }
      if (room.pair.includes(person.id) && !room.match) {
        throw new Error('Hero select locked during call-up')
      }
      if (Object.hasOwn(roster, String(message.hero))) {
        person.hero = String(message.hero)
      }
    }

    if (message.type === 'queue') {
      if (room.bracket.length) throw new Error('Registration closed')
      if (!room.queue.includes(person.id) && !room.pair.includes(person.id)) {
        room.queue.push(person.id)
      }
    }

    if (message.type === 'call') {
      if (person.id !== room.host) throw new Error('Host only')
      if (room.match || room.pair.length) throw new Error('A call-up is already active')
      if (room.bracket.length) {
        if (!room.bracket.some((match) => !match.done)) {
          throw new Error('Tournament finished')
        }
      } else if (room.queue.length < 2) {
        throw new Error('Need at least 2 fighters in queue')
      }
      this.schedule(room)
      return ctx
    }

    if (message.type === 'tournament') {
      if (person.id !== room.host) throw new Error('Host only')
      if (room.match || room.pair.length || room.bracket.length) {
        throw new Error('Event already started')
      }
      const n = room.queue.length
      if (n < 2 || n > 32 || (n & (n - 1))) {
        throw new Error('Register 2, 4, 8, 16, or 32 players')
      }
      for (let i = 0; i < n; i += 2) {
        room.bracket.push({
          round: 1,
          players: room.queue.slice(i, i + 2),
          done: false,
        })
      }
      room.queue = []
      this.schedule(room)
      return ctx
    }

    if (message.type === 'ready' && room.pair.includes(person.id) && !room.match) {
      person.ready = true
      if (room.pair.every((id) => room.people.get(id)?.ready)) this.begin(room)
    }

    if (message.type === 'leave' && room.pair.includes(person.id)) {
      this.finish(
        room,
        room.pair.find((id) => id !== person.id),
        'forfeit',
      )
      return ctx
    }

    if (message.type === 'input') {
      if (room.match?.paused) return ctx
      this.applyInput(room, person, message)
      return ctx
    }

    this.update(room)
    return ctx
  }

  private exitPerson(room: Room, person: Person, reason: string) {
    const inMatch = !!room.match && room.pair.includes(person.id)
    if (inMatch) {
      this.finish(
        room,
        room.pair.find((id) => id !== person.id),
        reason === 'leave' ? 'forfeit' : reason,
      )
    } else if (room.pair.includes(person.id) && !room.match) {
      for (const id of room.pair) {
        const entry = room.people.get(id)
        if (entry) entry.ready = false
      }
      room.pair = []
      room.deadline = 0
    }
    person.online = false
    person.ws = null
    this.removePerson(room, person)
    this.update(room)
    this.purgeRoom(room)
  }

  private applyInput(room: Room, person: Person, message: Record<string, unknown>) {
    const match = room.match
    const slot = room.pair.indexOf(person.id)
    if (!match || slot < 0 || match.paused) return

    const seq = message.seq
    const frame = message.frame
    if (!Number.isInteger(seq) || (seq as number) <= match.sequence[slot]) return
    if (
      !Number.isInteger(frame) ||
      (frame as number) < Math.max(1, match.state.frame - RULES.rollback) ||
      (frame as number) > match.state.frame + 12
    ) {
      return
    }
    if (!message.input || typeof message.input !== 'object') return

    const input: Input = {}
    const raw = message.input as Record<string, unknown>
    for (const key of INPUT_KEYS) input[key] = raw[key] === true

    const key = frame as number
    const values = match.inputs.get(key) ?? [null, null]
    if (values[slot]) return
    values[slot] = input
    match.inputs.set(key, values)
    match.sequence[slot] = seq as number

    if (key <= match.state.frame && match.history.has(key - 1)) {
      const end = match.state.frame
      match.state = structuredClone(match.history.get(key - 1)!) as State
      for (let f = key; f <= end; f++) {
        match.state = step(match.state, (match.inputs.get(f) ?? [{}, {}]) as [Input, Input])
        match.history.set(f, match.state)
      }
    }
  }

  handleDisconnect(room: Room | null, person: Person | null, ws?: WebSocket) {
    if (!room || !person) return
    if (!room.people.has(person.id)) return
    // Stale socket after resume — the new connection already owns this seat.
    if (person.ws && ws && person.ws !== ws) return
    if (person.online && person.ws && !ws) return

    person.online = false
    person.ws = null
    person.disconnectedAt = Date.now()
    room.queue = room.queue.filter((id) => id !== person.id)

    if (room.match && room.pair.includes(person.id)) {
      this.pauseMatch(room, person.id)
      this.update(room)
      return
    }

    if (room.pair.includes(person.id) && !room.match) {
      for (const id of room.pair) {
        const entry = room.people.get(id)
        if (entry) entry.ready = false
      }
      room.pair = []
      room.deadline = 0
    }

    if (person.id === room.host) {
      room.host = [...room.people.values()].find((entry) => entry.online)?.id ?? null
    }

    this.removePerson(room, person)
    this.update(room)
    this.purgeRoom(room)
  }

  tick() {
    for (const room of this.rooms.values()) {
      if (!room.match) {
        if (room.deadline && Date.now() > room.deadline) {
          const ready = room.pair.filter((id) => room.people.get(id)?.ready)
          this.finish(
            room,
            ready[0] ?? room.pair[0],
            ready.length
              ? 'no-show'
              : 'double no-show: advancing first entrant',
          )
        }
        continue
      }

      const match = room.match

      if (match.paused) {
        if (Date.now() >= match.pauseUntil) {
          const online = room.pair.filter((id) => room.people.get(id)?.online)
          const offline = room.pair.filter((id) => !room.people.get(id)?.online)
          if (offline.length) {
            const winner =
              online.length === 1
                ? online[0]
                : room.pair.find((id) => !match.missing.includes(id)) ?? online[0]
            this.finish(room, winner, 'disconnect: reconnect time expired')
            for (const id of offline) {
              const missing = room.people.get(id)
              if (missing) this.removePerson(room, missing)
            }
            this.update(room)
            this.purgeRoom(room)
          } else {
            this.resumeMatch(room)
          }
        }
        continue
      }

      const now = performance.now()
      let budget = 8
      while (now - match.clock >= 1000 / 60 && budget--) {
        match.clock += 1000 / 60
        match.history.set(match.state.frame, match.state)
        match.state = step(
          match.state,
          (match.inputs.get(match.state.frame + 1) ?? [{}, {}]) as [Input, Input],
        )
        for (const key of match.history.keys()) {
          if (key < match.state.frame - RULES.rollback - 1) match.history.delete(key)
        }
        for (const key of match.inputs.keys()) {
          if (key < match.state.frame - RULES.rollback - 1) match.inputs.delete(key)
        }
        if (match.state.winner !== null) {
          if (!match.terminal) match.terminal = match.state.frame
          if (match.state.frame - match.terminal > RULES.rollback) {
            this.finish(room, room.pair[match.state.winner], 'combat validated')
            break
          }
        } else match.terminal = 0
      }

      if (room.match && !room.match.paused) {
        this.broadcast(room, {
          type: 'snapshot',
          state: match.state,
          hash: checksum(match.state),
          acks: match.sequence,
        })
      }
    }
  }
}
