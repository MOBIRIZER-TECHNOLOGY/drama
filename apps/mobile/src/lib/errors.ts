/** Errors from katha-api arrive as `{ detail: { code, message } }`. Normalise anything into that shape. */
export type ApiError = { code: string; message: string; status?: number };

type Detail = { code?: unknown; message?: unknown };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function toApiError(error: unknown, status?: number): ApiError {
  if (isObject(error)) {
    const detail = error.detail;
    if (isObject(detail)) {
      const d = detail as Detail;
      return {
        code: typeof d.code === "string" ? d.code : "error",
        message: typeof d.message === "string" ? d.message : "Something went wrong",
        status,
      };
    }
    if (typeof detail === "string") return { code: "error", message: detail, status };
    if (Array.isArray(detail)) return { code: "validation_error", message: "Please check your input", status };
    if (typeof error.message === "string") return { code: "error", message: error.message, status };
  }
  if (error instanceof Error) return { code: "network_error", message: error.message || "Network error", status };
  if (typeof error === "string") return { code: "error", message: error, status };
  return { code: "error", message: "Something went wrong", status };
}

export class RequestError extends Error implements ApiError {
  code: string;
  status?: number;
  constructor(err: ApiError) {
    super(err.message);
    this.name = "RequestError";
    this.code = err.code;
    this.status = err.status;
  }
}

/** Unwrap an openapi-fetch result: return data or throw a RequestError carrying code/status. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    throw new RequestError(toApiError(result.error, result.response?.status));
  }
  return result.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  return toApiError(error).message;
}

export function errorCode(error: unknown): string {
  if (error instanceof RequestError) return error.code;
  return toApiError(error).code;
}
