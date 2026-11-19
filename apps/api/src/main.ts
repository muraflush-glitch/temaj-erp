import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Pas load balancer-it duhet numri i saktë i proxy-ve, përndryshe IP-ja e klientit mund të falsifikohet.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.setGlobalPrefix('api');
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({ origin, credentials: false });
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`Temaj ERP API në portin ${port}`);
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
