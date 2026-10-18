import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, aUser, setAuth } from "@/test-utils/auth-context";
import { PageTitle, RequireAuth } from "./RequireAuth";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
beforeEach(() => setAuth());
const w = { wrapper: appWrapper() };

describe("RequireAuth", () => {
  it("shows skeletons while loading, or a custom fallback", () => {
    setAuth({ status: "loading" });
    const a = render(<RequireAuth><p>secret</p></RequireAuth>, w);
    expect(a.container.querySelectorAll("[aria-hidden]").length).toBe(3);
    expect(screen.queryByText("secret")).toBeNull();
    a.unmount();
    render(<RequireAuth fallback={<p>wait</p>}><p>secret</p></RequireAuth>, w);
    expect(screen.getByText("wait")).toBeTruthy();
  });

  it("prompts anonymous viewers to sign in", () => {
    render(<RequireAuth><p>secret</p></RequireAuth>, w);
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByText("Sign in to continue")).toBeTruthy();
    fireEvent.click(screen.getByText("Sign in"));
    expect(auth.openAuth).toHaveBeenCalled();
  });

  it("accepts custom copy", () => {
    render(<RequireAuth title="Wallet" message="Sign in for coins"><p>x</p></RequireAuth>, w);
    expect(screen.getByText("Wallet")).toBeTruthy();
    expect(screen.getByText("Sign in for coins")).toBeTruthy();
  });

  it("warns and disables sign-in when Firebase isn't configured", () => {
    setAuth({ firebaseConfigured: false });
    render(<RequireAuth><p>x</p></RequireAuth>, w);
    expect(screen.getAllByText("Sign-in is not available right now.").length).toBeGreaterThan(0);
    expect((screen.getByText("Sign in").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders children when authenticated", () => {
    setAuth({ status: "authenticated", user: aUser });
    render(<RequireAuth><p>secret</p></RequireAuth>, w);
    expect(screen.getByText("secret")).toBeTruthy();
  });
});

describe("PageTitle", () => {
  it("renders heading, sub and aside", () => {
    render(<PageTitle sub="sub" aside={<span>aside</span>}>Title</PageTitle>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Title");
    expect(screen.getByText("sub")).toBeTruthy();
    expect(screen.getByText("aside")).toBeTruthy();
  });
  it("omits sub when absent", () => {
    const { container } = render(<PageTitle>Title</PageTitle>);
    expect(container.querySelector("p")).toBeNull();
  });
});
