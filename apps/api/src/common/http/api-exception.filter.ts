import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Request, Response } from "express";
import { ApiException } from "./api-exception";

type RequestWithId = Request & { requestId?: string };
type DatabaseFailure = { code?: unknown; meta?: { code?: unknown } };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const databaseError = this.getDatabaseError(exception);
    const status =
      exception instanceof ApiException
        ? exception.getStatus()
        : exception instanceof HttpException
          ? exception.getStatus()
          : (databaseError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const code =
      exception instanceof ApiException
        ? exception.code
        : (databaseError?.code ?? this.getCode(status));
    const message =
      exception instanceof ApiException
        ? exception.message
        : (databaseError?.message ?? this.getMessage(status));
    const requestId = request.requestId ?? randomUUID();

    response.status(status).json({
      status: "error",
      message,
      error: {
        code,
        ...(exception instanceof ApiException && exception.details
          ? { details: exception.details }
          : {}),
      },
      meta: { request_id: requestId },
    });
  }

  private getCode(status: number): string {
    if (status === HttpStatus.UNAUTHORIZED) return "UNAUTHORIZED";
    if (status === HttpStatus.FORBIDDEN) return "FORBIDDEN";
    if (status === HttpStatus.NOT_FOUND) return "NOT_FOUND";
    if (status === HttpStatus.TOO_MANY_REQUESTS) return "RATE_LIMIT_EXCEEDED";
    if (status >= 400 && status < 500) return "INVALID_REQUEST";
    return "INTERNAL_SERVER_ERROR";
  }

  private getMessage(status: number): string {
    if (status === HttpStatus.UNAUTHORIZED) return "Autentikasi diperlukan.";
    if (status === HttpStatus.FORBIDDEN) return "Akses ditolak.";
    if (status === HttpStatus.NOT_FOUND) return "Data tidak ditemukan.";
    if (status === HttpStatus.TOO_MANY_REQUESTS)
      return "Terlalu banyak permintaan.";
    if (status >= 400 && status < 500)
      return "Permintaan tidak dapat diproses.";
    return "Terjadi kesalahan internal.";
  }

  private getDatabaseError(
    exception: unknown,
  ): { status: number; code: string; message: string } | undefined {
    if (typeof exception !== "object" || exception === null) return undefined;

    const error = exception as DatabaseFailure;
    const code = typeof error.code === "string" ? error.code : "";
    const databaseCode =
      typeof error.meta?.code === "string" ? error.meta.code : "";

    if (["P1001", "P1002", "P1008", "P1017"].includes(code)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: "DATABASE_UNAVAILABLE",
        message: "Layanan database sementara tidak tersedia.",
      };
    }
    if (
      ["P2034", "55P03", "57014"].includes(code) ||
      ["55P03", "57014"].includes(databaseCode)
    ) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: "DATABASE_LOCK_TIMEOUT",
        message: "Database sedang sibuk. Silakan coba kembali.",
      };
    }

    return undefined;
  }
}
