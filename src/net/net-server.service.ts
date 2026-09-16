import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpAdapterHost } from '@nestjs/core'
import type { Server as HttpServer } from 'http'
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
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit() {
    const host = this.config.get<string>('HOST') ?? '0.0.0.0'
    const onCloud = !!(
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME
    )
    // Cloud hosts expose a single PORT. Locally we can still split HTTP_PORT
    // (Nest) and PORT (raw ws) when both are set and differ.
    const wsPort = Number(this.config.get('PORT') ?? 3001)
    const httpPort = Number(
      this.config.get('HTTP_PORT') ?? this.config.get('PORT') ?? 3010,
    )
    const shareHttp =
      onCloud || !this.config.get('HTTP_PORT') || httpPort === wsPort

    if (shareHttp) {
      const server = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer
      this.wss = new WebSocketServer({ server, maxPayload: 4096 })
      this.logger.log(
        `WebSocket multiplayer attached to HTTP server (same origin as /rooms)`,
      )
    } else {
      this.wss = new WebSocketServer({ port: wsPort, host, maxPayload: 4096 })
      this.wss.on('listening', () => {
        this.logger.log(`WebSocket multiplayer em ws://127.0.0.1:${wsPort}`)
      })
    }

    this.wss.on('connection', (socket) => this.bind(socket))
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
      this.rooms.handleDisconnect(ctx.room, ctx.person, ws)
    })
  }
}
