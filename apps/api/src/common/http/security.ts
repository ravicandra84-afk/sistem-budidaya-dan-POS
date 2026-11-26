import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";
import type { ApiEnvironment } from "../../config/env";

export function configureApiSecurity(
  app: INestApplication,
  environment: ApiEnvironment,
): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
    }),
  );

  const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");
  const origins = [
    ...new Set([
      normalizeOrigin(environment.FRONTEND_URL),
      ...environment.CORS_ALLOWED_ORIGINS.split(",")
        .map(normalizeOrigin)
        .filter(Boolean),
    ]),
  ];

  app.enableCors({
    origin: origins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    exposedHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 600,
  });
}
