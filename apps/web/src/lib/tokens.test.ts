import { describe, expect, it } from "vitest";
import * as tokens from "./tokens";

describe("tokens", () => {
  it("re-exports the design tokens for JS consumers", () => {
    expect(tokens.colors).toBeTruthy();
    expect(tokens.radii).toBeTruthy();
    expect(tokens.spacing).toBeTruthy();
    expect(tokens.typeTokens).toBeTruthy();
  });
});
