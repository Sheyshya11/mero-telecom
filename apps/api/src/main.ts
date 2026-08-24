import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApplication, logApplicationStarted } from './configure-application';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const { port } = configureApplication(app);
  await app.listen(port, '0.0.0.0');
  logApplicationStarted(port);
}

void bootstrap();
