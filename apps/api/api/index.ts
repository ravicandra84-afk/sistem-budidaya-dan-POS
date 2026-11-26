import type { Request, RequestHandler, Response } from "express";
import { createApiApplication } from "../src/bootstrap";

let expressHandler: Promise<RequestHandler> | undefined;

function getExpressHandler(): Promise<RequestHandler> {
  expressHandler ??= createApiApplication().then(async ({ app }) => {
    await app.init();
    return app.getHttpAdapter().getInstance() as RequestHandler;
  });

  return expressHandler;
}

export default async function vercelHandler(
  request: Request,
  response: Response,
): Promise<void> {
  const handler = await getExpressHandler();
  handler(request, response, () => undefined);
}
