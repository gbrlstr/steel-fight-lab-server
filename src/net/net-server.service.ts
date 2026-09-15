import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WebSocketServer, type WebSocket } from 'ws'
import { RoomsService } from '../rooms/rooms.service'
import type { Person, Room } from '../rooms/rooms.types'

type SocketContext = {
  room: Room | null
  person: Person | null
  count: number
  bucket: number
}

@Injectable()
export class NetServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NetServerService.name)
  private wss?: WebSocketServer
  private tick?: NodeJS.Timeout

  constructor(
    private readonly rooms: RoomsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const port = Number(this.config.get('PORT') ?? 3001)
    const host = this.config.get<string>('HOST') ?? '0.0.0.0'
    this.wss = new WebSocketServer({ port, host, maxPayload: 4096 })
    this.wss.on('connection', (socket) => this.bind(socket))
    this.wss.on('listening', () => {
      this.logger.log(`WebSocket multiplayer em ws://127.0.0.1:${port}`)
    })
    this.tick = setInterval(() => this.rooms.tick(), 1000 / 20)
  }

  onModuleDestroy() {
    if (this.tick) clearInterval(this.tick)
    this.wss?.close()
  }

  private bind(ws: WebSocket) {
    const ctx: SocketContext = {
      room: null,
      person: null,
      count: 0,
      bucket: Date.now(),
    }

    ws.on('message', (raw) => {
      try {
        if (Date.now() - ctx.bucket > 1000) {
          ctx.bucket = Date.now()
          ctx.count = 0
        }
        if (++ctx.count > 180) {
          ws.close(1008, 'rate')
          return
        }
        const next = this.rooms.handleMessage(ws, raw, ctx)
        ctx.room = next.room
        ctx.person = next.person
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro'
        this.rooms.send(ws, { type: 'error', message })
      }
    })

    ws.on('close', () => {
      this.rooms.handleDisconnect(ctx.room, ctx.person)
    })
  }
}
