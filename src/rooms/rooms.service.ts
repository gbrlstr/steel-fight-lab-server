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
import type { MatchRuntime, Person, Room, RoomSummary, RoomView } from './rooms.types'

const INPUT_KEYS = ['left', 'right', 'up', 'down', 'attack', 'special'] as const

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
    }
  }

  send(ws: WebSocket, data: unknown) {
    if (ws.readyState === 1 && ws.bufferedAmount < 1024 * 1024) {
      ws.send(JSON.stringify(data))
    }
  }

  broadcast(room: Room, data: unknown) {
    for (const person of room.people.values()) this.send(person.ws, data)
  }

  update(room: Room) {
    this.broadcast(room, this.view(room))
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
    }
    this.broadcast(room, {
      type: 'start',
      pair: room.pair,
      state: room.match.state,
    })
    this.update(room)
  }

  handleMessage(ws: WebSocket, raw: RawData, ctx: { room: Room | null; person: Person | null }) {
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
      if (ctx.room) throw new Error('Já conectado a uma sala')
      let room: Room | undefined
      if (message.type === 'create') {
        if (this.rooms.size >= 100) throw new Error('Servidor cheio')
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
      if (!room) throw new Error('Sala não encontrada')
      if (room.people.size >= 64) throw new Error('Sala cheia')
      const person: Person = {
        id: randomUUID(),
        nick: String(message.nick ?? 'Viewer').trim().slice(0, 24) || 'Viewer',
        hero: 'tusk',
        ready: false,
        online: true,
        ws,
      }
      room.people.set(person.id, person)
      if (!room.host) room.host = person.id
      this.send(ws, { type: 'welcome', id: person.id, code: room.code })
      this.send(ws, this.view(room))
      if (room.match) {
        this.send(ws, {
          type: 'start',
          pair: room.pair,
          state: room.match.state,
        })
      }
      this.update(room)
      return { room, person }
    }

    const { room, person } = ctx
    if (!room || !person) throw new Error('Entre em uma sala')

    if (message.type === 'hero') {
      if (room.pair.includes(person.id)) {
        throw new Error('Seleção bloqueada durante convocação')
      }
      if (Object.hasOwn(roster, String(message.hero))) {
        person.hero = String(message.hero)
      }
    }

    if (message.type === 'queue') {
      if (room.bracket.length) throw new Error('Inscrições encerradas')
      if (!room.queue.includes(person.id) && !room.pair.includes(person.id)) {
        room.queue.push(person.id)
      }
    }

    if (message.type === 'call') {
      if (person.id !== room.host) throw new Error('Somente organizador')
      if (room.match || room.pair.length) throw new Error('Já há uma convocação ativa')
      if (room.bracket.length) {
        if (!room.bracket.some((match) => !match.done)) {
          throw new Error('Torneio encerrado')
        }
      } else if (room.queue.length < 2) {
        throw new Error('Precisa de pelo menos 2 lutadores na fila')
      }
      this.schedule(room)
      return ctx
    }

    if (message.type === 'tournament') {
      if (person.id !== room.host) throw new Error('Somente organizador')
      if (room.match || room.pair.length || room.bracket.length) {
        throw new Error('Evento já iniciado')
      }
      const n = room.queue.length
      if (n < 2 || n > 32 || (n & (n - 1))) {
        throw new Error('Inscreva 2, 4, 8, 16 ou 32 participantes')
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
        'abandono',
      )
      return ctx
    }

    if (message.type === 'input') {
      this.applyInput(room, person, message)
      return ctx
    }

    this.update(room)
    return ctx
  }

  private applyInput(room: Room, person: Person, message: Record<string, unknown>) {
    const match = room.match
    const slot = room.pair.indexOf(person.id)
    if (!match || slot < 0) return

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

  handleDisconnect(room: Room | null, person: Person | null) {
    if (!room || !person) return
    person.online = false
    room.queue = room.queue.filter((id) => id !== person.id)
    if (room.pair.includes(person.id)) {
      this.finish(
        room,
        room.pair.find((id) => id !== person.id),
        'desconexão',
      )
    }
    if (person.id === room.host) {
      room.host = [...room.people.values()].find((entry) => entry.online)?.id ?? null
    }
    this.update(room)
    if (![...room.people.values()].some((entry) => entry.online)) {
      this.rooms.delete(room.code)
      this.logger.log(`Sala ${room.code} removida`)
    }
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
              ? 'ausência'
              : 'dupla ausência: avanço administrativo do primeiro inscrito',
          )
        }
        continue
      }

      const match = room.match
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
            this.finish(room, room.pair[match.state.winner], 'combate validado')
            break
          }
        } else match.terminal = 0
      }

      if (room.match) {
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
