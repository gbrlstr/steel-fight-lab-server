import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: true })
  // Local: HTTP_PORT=3010 + PORT=3001 (dual). Cloud: only PORT → HTTP and WS share it.
  const httpPort = Number(process.env.HTTP_PORT ?? process.env.PORT ?? 3010)
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen(httpPort, host)
  Logger.log(`HTTP + health em http://127.0.0.1:${httpPort}/health`, 'Bootstrap')
}
void bootstrap()
