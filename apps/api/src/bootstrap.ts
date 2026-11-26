import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ApiExceptionFilter } from "./common/http/api-exception.filter";
import { configureApiSecurity } from "./common/http/security";
import { loadApiEnvironment } from "./config/env";
import { AppModule } from "./app.module";

export async function createApiApplication() {
  const environment = loadApiEnvironment();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(environment.API_PREFIX.replace(/^\//, ""));
  app.useGlobalFilters(new ApiExceptionFilter());
  configureApiSecurity(app, environment);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  return { app, environment };
}
