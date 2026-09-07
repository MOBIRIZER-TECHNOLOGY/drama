export type ApiError = { status: number; code: string; message: string };

type Detail = { code?: unknown; message?: unknown } | { msg?: unknown; loc?: unknown }[] | string | undefined;

/**
 * Normalise an openapi-fetch result (`{ error, response }`) or a thrown value into `{ status, code, message }`.
 * API errors are `{ detail: { code, message } }`; validation errors are `{ detail: [{ msg }] }`.
 */
export function toApiError(error: unknown, response?: Response): ApiError {
  const status = response?.status ?? 0;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: Detail }).detail;
    if (Array.isArray(detail)) {
      const first = detail[0];
      const msg = first && typeof first === "object" && "msg" in first ? String(first.msg) : "Invalid input";
      return { status, code: "validation_error", message: msg };
    }
    if (detail && typeof detail === "object") {
      return {
        status,
        code: typeof detail.code === "string" ? detail.code : "error",
        message: typeof detail.message === "string" ? detail.message : "Something went wrong",
      };
    }
    if (typeof detail === "string") return { status, code: "error", message: detail };
  }
  if (error instanceof Error) {
    const offline = error.name === "TypeError" || error.name === "AbortError" || error.name === "TimeoutError";
    return {
      status,
      code: offline ? "network_error" : "error",
      message: offline ? "Could not reach the server. Check your connection and try again." : error.message,
    };
  }
  if (status === 401) return { status, code: "unauthorized", message: "Please sign in to continue." };
  if (status === 403) return { status, code: "forbidden", message: "Not allowed." };
  if (status === 404) return { status, code: "not_found", message: "Not found." };
  return { status, code: "error", message: status ? `Request failed (${status})` : "Something went wrong" };
}

export function isApiError(value: unknown): value is ApiError {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    "message" in value &&
    typeof (value as ApiError).code === "string"
  );
}

/** Wrap a client call so network failures surface as ApiError rather than throwing. */
export async function call<T>(
  fn: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<{ data: T; error: null } | { data: null; error: ApiError }> {
  try {
    const result = await fn();
    if (result.error !== undefined || !result.response.ok) {
      return { data: null, error: toApiError(result.error, result.response) };
    }
    return { data: result.data as T, error: null };
  } catch (e) {
    return { data: null, error: toApiError(e) };
  }
}
