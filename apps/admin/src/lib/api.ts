import { createKathaClient, type components } from "@katha/api-client";
import { clearToken, tokenStore } from "./token";

export const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Admin client: attaches the admin JWT as Bearer; a 401 anywhere sends the admin back to /login. */
export const api = createKathaClient({ baseUrl, platform: "web", tokens: tokenStore });

api.use({
  async onResponse({ response }) {
    if (response.status === 401 && typeof window !== "undefined") {
      const { pathname, search } = window.location;
      if (!pathname.startsWith("/login")) {
        clearToken();
        const url = new URL("/login", window.location.origin);
        url.searchParams.set("next", pathname + search);
        url.searchParams.set("reason", "expired");
        window.location.href = url.toString();
      }
    }
    return response;
  },
});

export type Schemas = components["schemas"];

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ValidationItem = { loc?: (string | number)[]; msg?: string };

/** Turn an openapi-fetch error body (or a thrown Error) into something a human can read. */
export function errorMessage(err: unknown, response?: Response): string {
  if (err instanceof ApiError) return err.message;
  if (err && typeof err === "object" && "detail" in err) {
    const detail = (err as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return (detail as ValidationItem[])
        .map((v) => {
          const path = (v.loc ?? []).filter((p) => p !== "body").join(".");
          return path ? `${path}: ${v.msg ?? "invalid"}` : (v.msg ?? "invalid");
        })
        .join("; ");
    }
    if (detail && typeof detail === "object" && "message" in detail) {
      return String((detail as { message: unknown }).message);
    }
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) return "Cannot reach the API. Is it running?";
  if (err instanceof Error) return err.message;
  if (response) return `${response.status} ${response.statusText || "error"}`.trim();
  return "Something went wrong";
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "detail" in err) {
    const detail = (err as { detail: unknown }).detail;
    if (detail && typeof detail === "object" && "code" in detail) return String((detail as { code: unknown }).code);
    if (Array.isArray(detail)) return "validation_error";
  }
  return "error";
}

/**
 * Unwrap an openapi-fetch result into data-or-throw so pages can use plain async/await.
 * Network failures are normalised into ApiError with status 0.
 */
export async function call<T, E>(p: Promise<{ data?: T; error?: E; response: Response }>): Promise<NonNullable<T>> {
  let result: { data?: T; error?: E; response: Response };
  try {
    result = await p;
  } catch (e) {
    throw new ApiError(errorMessage(e), 0, "network");
  }
  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    throw new ApiError(errorMessage(error, response), response.status, errorCode(error));
  }
  return data as NonNullable<T>;
}
