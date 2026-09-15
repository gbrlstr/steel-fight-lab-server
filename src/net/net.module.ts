import { Module } from '@nestjs/common'
import { RoomsModule } from '../rooms/rooms.module'
import { NetServerService } from './net-server.service'

@Module({
  imports: [RoomsModule],
  providers: [NetServerService],
})
export class NetModule {}
