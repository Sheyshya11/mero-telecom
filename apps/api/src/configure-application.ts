import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createValidationPipe } from './common/pipes/create-validation-pipe';
import type { AppConfig } from './config/configuration';
import { createCorsOptions } from './config/cors';

export function configureApplication(
  app: INestApplication,
  options: { swagger?: boolean; logger?: boolean } = {},
): AppConfig['app'] {
  const configService = app.get(ConfigService<AppConfig, true>);
  const appConfig = configService.getOrThrow('app');

  app.useLogger(options.logger === false ? false : ['error', 'warn', 'log']);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors(createCorsOptions(appConfig.frontendUrl));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  if (options.swagger !== false) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Mero Telecom API')
      .setDescription('REST API for the Mero Telecom ISP Management Platform.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
  }

  return appConfig;
}

export function logApplicationStarted(port: number): void {
  Logger.log(`API listening on port ${port}`, 'Bootstrap');
}
