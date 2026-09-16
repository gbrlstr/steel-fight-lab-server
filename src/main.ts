import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

function isCloudPlatform() {
  return !!(
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME
  )
}

function listenPort() {
  // Railway/Render/Fly inject PORT and proxy only to that port.
  // Local dual-port keeps HTTP_PORT (Nest) separate from PORT (raw ws).
  if (isCloudPlatform()) {
    return Number(process.env.PORT ?? process.env.HTTP_PORT ?? 3010)
  }
  return Number(process.env.HTTP_PORT ?? process.env.PORT ?? 3010)
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
  const httpPort = listenPort()
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen(httpPort, host)
  Logger.log(
    `HTTP + health em http://127.0.0.1:${httpPort}/health` +
      (isCloudPlatform() ? ' (cloud: HTTP+WS share PORT)' : ''),
    'Bootstrap',
  )
}
void bootstrap()
