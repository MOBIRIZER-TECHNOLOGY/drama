import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { nav, resetNav } from "@/test-utils/next-navigation";
import { LanguageSwitcher } from "./LanguageSwitcher";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));

beforeEach(() => resetNav());

describe("LanguageSwitcher", () => {
  it("renders nothing with a single language", () => {
    const { container } = render(<LanguageSwitcher />, {
      wrapper: appWrapper({ languages: [{ code: "en", name: "English", native_name: "English", rtl: false }] }),
    });
    expect(container.innerHTML).toBe("");
  });

  it("lists native names, selects the current language and navigates keeping path and query", () => {
    resetNav("/hi/series/x", "ep=2");
    render(<LanguageSwitcher />, { wrapper: appWrapper({ lang: "hi" }) });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("hi");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["English", "हिन्दी"]);
    fireEvent.change(select, { target: { value: "en" } });
    expect(nav.router.push).toHaveBeenCalledWith("/series/x?ep=2");
  });

  it("navigates to the prefixed path without a query string", () => {
    resetNav("/series/x");
    render(<LanguageSwitcher />, { wrapper: appWrapper() });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hi" } });
    expect(nav.router.push).toHaveBeenCalledWith("/hi/series/x");
  });

  it("compact mode shows upper-case codes; falls back to the english name when no native name", () => {
    const { rerender } = render(<LanguageSwitcher compact />, { wrapper: appWrapper() });
    expect(Array.from((screen.getByRole("combobox") as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["EN", "HI"]);
    rerender(<LanguageSwitcher />);
    const W = appWrapper({ languages: [{ code: "en", name: "English", native_name: "", rtl: false }, { code: "fr", name: "French", native_name: "", rtl: false }] });
    const r2 = render(<LanguageSwitcher />, { wrapper: W });
    expect(Array.from((r2.container.querySelector("select") as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["English", "French"]);
  });
});
