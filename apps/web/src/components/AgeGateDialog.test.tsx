import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { AgeGateDialog } from "./AgeGateDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

const setup = (over: Partial<Parameters<typeof AgeGateDialog>[0]> = {}) => {
  const props = { open: true, busy: false, error: null, onConfirm: vi.fn(), onClose: vi.fn(), ...over };
  render(<AgeGateDialog {...props} />, { wrapper: appWrapper() });
  return props;
};

describe("AgeGateDialog", () => {
  it("confirms and dismisses", () => {
    const p = setup();
    fireEvent.click(screen.getByText("I am 18 or older"));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Not now"));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();
  });

  it("shows an error and locks both buttons while busy", () => {
    setup({ busy: true, error: "Failed to confirm" });
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe("Failed to confirm");
    expect((screen.getByText("Not now") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText(/I am 18/).closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
