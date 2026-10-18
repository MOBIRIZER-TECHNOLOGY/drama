import { describe, expect, it } from "vitest";
import { ep } from "@/test-utils/series-fixtures";
import { highestAccessibleNumber, lockState } from "./lock-state";

describe("lock-state", () => {
  it("highestAccessibleNumber counts free or accessible episodes only", () => {
    expect(highestAccessibleNumber([])).toBe(0);
    expect(highestAccessibleNumber([ep(1, { is_free: true }), ep(2, { accessible: true }), ep(3), ep(7)])).toBe(2);
    expect(highestAccessibleNumber([ep(5, { accessible: true }), ep(2, { is_free: true })])).toBe(5);
  });

  it("classifies episodes", () => {
    expect(lockState(ep(1, { is_free: true }), 0)).toBe("free");
    expect(lockState(ep(2, { accessible: true }), 2)).toBe("accessible");
    expect(lockState(ep(3), 2)).toBe("next");
    expect(lockState(ep(4), 2)).toBe("later");
  });
});
