import { HttpException, HttpStatus } from "@nestjs/common";

export type ApiErrorDetails = Record<string, string | number | boolean | null>;

export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorDetails,
  ) {
    super(message, status);
  }
}
