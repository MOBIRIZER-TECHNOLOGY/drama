import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockApi } from "@/test/api";
import { setAdmin } from "@/test/auth";
import AdminLayout from "./layout";

vi.mock("@/lib/auth", async () => (await import("@/test/auth")).authModule);

describe("AdminLayout", () => {
  it("wraps its children in the app shell for the signed-in admin", () => {
    setAdmin("owner", { email: "boss@example.com" });
    mockApi.get(/.*/, {});
    render(<AdminLayout params={Promise.resolve({})}>
        <p>page body</p>
      </AdminLayout>);
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
  });
});
