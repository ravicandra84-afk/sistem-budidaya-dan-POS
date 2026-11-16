import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadApiEnvironment } from "./config/env";

async function bootstrap(): Promise<void> {
  const environment = loadApiEnvironment();
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = environment.CORS_ALLOWED_ORIGINS.split(",").map((origin) =>
    origin.trim(),
  );

  app.setGlobalPrefix(environment.API_PREFIX.replace(/^\//, ""));
  app.enableCors({ origin: allowedOrigins });
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
  console.error("API startup failed. Check the validated environment configuration.");
  process.exitCode = 1;
});