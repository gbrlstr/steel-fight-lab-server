import { Controller, Get } from '@nestjs/common'
import { RoomsService } from './rooms/rooms.service'

@Controller()
export class HealthController {
  constructor(private readonly rooms: RoomsService) {}

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'sleet-fighter-server',
      rooms: this.rooms.listSize(),
    }
  }
}
