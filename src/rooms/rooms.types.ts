import type { WebSocket } from 'ws'
import type { Input, State } from '../game/combat'

export type Person = {
  id: string
  token: string
  nick: string
  hero: string
  ready: boolean
  online: boolean
  ws: WebSocket | null
  disconnectedAt: number | null
}

export type BracketMatch = {
  round: number
  players: string[]
  done: boolean
  winner?: string
}

export type MatchRuntime = {
  state: State
  history: Map<number, State>
  inputs: Map<number, Array<Input | null>>
  sequence: number[]
  clock: number
  terminal: number
  paused: boolean
  pauseUntil: number
  missing: string[]
}

export type Room = {
  code: string
  host: string | null
  people: Map<string, Person>
  queue: string[]
  pair: string[]
  bracket: BracketMatch[]
  champion: string | null
  match: MatchRuntime | null
  deadline: number
}

export type RoomView = {
  type: 'room'
  code: string
  host: string | null
  people: Array<Pick<Person, 'id' | 'nick' | 'hero' | 'ready' | 'online'>>
  queue: string[]
  pair: string[]
  deadline: number
  bracket: BracketMatch[]
  champion: string | null
  active: boolean
  paused: boolean
  pauseUntil: number
  missing: string[]
}

export type RoomSummary = {
  code: string
  host: string
  players: number
  queue: number
  active: boolean
}

export const RECONNECT_MS = 30_000
