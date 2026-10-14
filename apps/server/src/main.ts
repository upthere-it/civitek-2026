import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  loadEnv();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  // in produzione HOST=127.0.0.1: si raggiunge solo da nginx (ecosystem.config.js), mai direttamente
  const host = process.env.HOST;
  await (host ? app.listen(port, host) : app.listen(port));
  Logger.log(`Sneaker Passport in ascolto su ${host ?? ''}:${port}`, 'Bootstrap');
}

void bootstrap();
