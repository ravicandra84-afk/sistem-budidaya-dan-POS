import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";
import { ZodType } from "zod";
import { ApiException } from "../http/api-exception";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    void metadata;
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ApiException(400, "INVALID_PAYLOAD", "Payload tidak valid.");
    }

    return result.data;
  }
}
