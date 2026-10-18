import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => ({ get }) }));

import { JsonLd } from "./JsonLd";

describe("JsonLd", () => {
  it("renders an ld+json script with `<` escaped and the request nonce", async () => {
    get.mockReturnValue("abc123");
    const el = await JsonLd({ data: { name: "</script><b>" } });
    const { container } = render(el);
    const script = container.querySelector("script")!;
    expect(script.getAttribute("type")).toBe("application/ld+json");
    expect(script.innerHTML).not.toContain("<");
    expect(JSON.parse(script.innerHTML)).toEqual({ name: "</script><b>" });
    expect(get).toHaveBeenCalledWith("x-nonce");
    expect(el.props.nonce).toBe("abc123");
  });
  it("omits the nonce when the proxy did not set one and accepts arrays", async () => {
    get.mockReturnValue(null);
    const el = await JsonLd({ data: [{ a: 1 }] });
    expect(el.props.nonce).toBeUndefined();
    expect(el.props.dangerouslySetInnerHTML.__html).toBe('[{"a":1}]');
  });
});
