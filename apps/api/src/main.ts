import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EsignConfigService } from './esign-config/esign-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const esign = app.get(EsignConfigService);
  Logger.log(`esign.production.enabled=${esign.productionEnabled}`, 'Bootstrap');

  const port = Number(process.env.API_PORT || 3000);
  await app.listen(port);
  Logger.log(`api listening on ${port}`, 'Bootstrap');
}

void bootstrap();
