import { createKathaClient, type components } from "@katha/api-client";
import { clearToken, tokenStore } from "./token";

export const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Admin client: attaches the admin JWT as Bearer. A 401 that means the *session* is gone sends the admin back
 * to /login; a 401 that refuses a factor or a password is left for the form that asked.
 */
export const api = createKathaClient({ baseUrl, platform: "web", tokens: tokenStore });

/**
 * Messages `current_admin` in the API sends alongside code `unauthorized` when the bearer token itself is the
 * problem. The same code is also used for "Invalid credentials" on `/auth/login` and `/auth/totp/disable`, and
 * `totp_invalid` / `totp_required` for the second factor — none of which mean the session is over. Logging out
 * on those threw away the enrolment secret on a single mistyped digit.
 */
const SESSION_LOST = /invalid or expired|authentication required|unknown admin/i;

/** Why the session is over, or null when the 401 is about something other than the session. */
function sessionLostReason(body: unknown): "expired" | "revoked" | null {
  const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : null;
  if (!detail || typeof detail !== "object") return "expired"; // no structured body: the classic expiry
  const { code, message } = detail as { code?: unknown; message?: unknown };
  if (code === "session_revoked") return "revoked";
  if (code === "unauthorized" && typeof message === "string" && SESSION_LOST.test(message)) return "expired";
  return null;
}

api.use({
  async onResponse({ response }) {
    if (response.status === 401 && typeof window !== "undefined") {
      const { pathname, search } = window.location;
      if (!pathname.startsWith("/login")) {
        // "Expired" and "someone ended your session" call for different reassurance on the sign-in screen.
        // The body is read from a clone so the caller still gets an unconsumed stream.
        let reason: "expired" | "revoked" | null = "expired";
        try {
          reason = sessionLostReason(await response.clone().json());
        } catch {
          /* a 401 without a JSON body is still an expiry as far as the viewer is concerned */
        }
        if (reason) {
          clearToken();
          const url = new URL("/login", window.location.origin);
          url.searchParams.set("next", pathname + search);
          url.searchParams.set("reason", reason);
          window.location.href = url.toString();
        }
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
