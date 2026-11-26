import { createApiApplication } from "./bootstrap";

async function bootstrap(): Promise<void> {
  const { app, environment } = await createApiApplication();
  await app.listen(environment.PORT);
}

void bootstrap().catch(() => {
  console.error(
    "API startup failed. Check the validated environment configuration.",
  );
  process.exitCode = 1;
});
