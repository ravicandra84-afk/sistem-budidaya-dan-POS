import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadApiEnvironment } from "./config/env";
import { ApiExceptionFilter } from "./common/http/api-exception.filter";
import { configureApiSecurity } from "./common/http/security";

async function bootstrap(): Promise<void> {
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

  await app.listen(environment.PORT);
}

void bootstrap().catch(() => {
  console.error(
    "API startup failed. Check the validated environment configuration.",
  );
  process.exitCode = 1;
});
