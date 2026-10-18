import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultApp } from "@/test-utils/app";

const trackAppOpen = vi.fn();
const captureReferral = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackAppOpen: (...a: unknown[]) => trackAppOpen(...a) }));
vi.mock("@/lib/referral", () => ({ captureReferral: (...a: unknown[]) => captureReferral(...a) }));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
vi.mock("./AuthDialog", () => ({ AuthDialog: () => <div data-testid="auth-dialog" /> }));

import { useApp } from "@/lib/app-context";
import { useToast } from "@/lib/toast";
import { Providers } from "./Providers";

function Probe() {
  const { lang } = useApp();
  const toast = useToast();
  return <button onClick={() => toast("hello")}>{`lang:${lang}`}</button>;
}

describe("Providers", () => {
  it("provides app context + toasts, mounts the auth dialog and records the app open and referral", () => {
    window.history.replaceState({}, "", "/?ref=ABCD1234");
    render(
      <Providers value={{ ...defaultApp, lang: "hi" }}>
        <Probe />
      </Providers>,
    );
    expect(screen.getByText("lang:hi")).toBeTruthy();
    expect(screen.getByTestId("auth-dialog")).toBeTruthy();
    expect(trackAppOpen).toHaveBeenCalledWith("hi");
    expect(captureReferral).toHaveBeenCalledWith("?ref=ABCD1234");
    window.history.replaceState({}, "", "/");
  });
});
