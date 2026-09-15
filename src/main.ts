import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: true })
  const httpPort = Number(process.env.HTTP_PORT ?? 3010)
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen(httpPort, host)
  Logger.log(
    `Health em http://127.0.0.1:${httpPort}/health`,
    'Bootstrap',
  )
}
void bootstrap()
