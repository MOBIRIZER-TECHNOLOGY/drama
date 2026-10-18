import { describe, expect, it } from "vitest";
import Index from "./page";

describe("index page", () => {
  it("redirects to the dashboard", () => {
    expect(() => Index()).toThrow("NEXT_REDIRECT:/dashboard");
  });
});
