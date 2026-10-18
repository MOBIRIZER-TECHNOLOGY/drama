import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonClass } from "./Button";

describe("Button", () => {
  it("defaults to a primary md type=button", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b).toHaveAttribute("type", "button");
    expect(b.className).toContain("bg-accent");
    expect(b.className).toContain("h-10");
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and busy while loading, and doesn't fire clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: /Save/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("respects disabled, type and custom class", () => {
    render(
      <Button disabled type="submit" variant="danger" size="lg" className="extra">
        X
      </Button>,
    );
    const b = screen.getByRole("button");
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("type", "submit");
    expect(b).not.toHaveAttribute("aria-busy");
    expect(b.className).toMatch(/text-danger.*h-12.*extra/);
  });

  it("buttonClass composes variants and sizes", () => {
    expect(buttonClass()).toContain("bg-accent");
    expect(buttonClass("gold", "sm", "x")).toMatch(/bg-gold.*h-8.*x$/);
    expect(buttonClass("ghost")).toContain("bg-transparent");
    expect(buttonClass("secondary")).toContain("bg-surface2");
  });
});
