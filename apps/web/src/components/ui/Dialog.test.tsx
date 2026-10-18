import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { Dialog } from "./Dialog";

// jsdom does not implement <dialog> modality.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

const wrapper = appWrapper({ messages: {} });

describe("Dialog", () => {
  it("opens modally when `open` flips true and closes when it flips false", () => {
    const { rerender, container } = render(
      <Dialog open={false} onClose={() => {}} title="T">
        body
      </Dialog>,
      { wrapper },
    );
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    rerender(
      <Dialog open onClose={() => {}} title="T">
        body
      </Dialog>,
    );
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(container.querySelector("dialog")).toHaveAttribute("open");
    rerender(
      <Dialog open={false} onClose={() => {}} title="T">
        body
      </Dialog>,
    );
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores it", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <Dialog open onClose={() => {}}>
        x
      </Dialog>,
      { wrapper },
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("labels the dialog by its title, only when there is one", () => {
    const { container, rerender } = render(
      <Dialog open onClose={() => {}} title="Hello">
        x
      </Dialog>,
      { wrapper },
    );
    const dlg = container.querySelector("dialog")!;
    expect(dlg.getAttribute("aria-labelledby")).toBe(screen.getByText("Hello").id);
    rerender(
      <Dialog open onClose={() => {}}>
        x
      </Dialog>,
    );
    expect(dlg).not.toHaveAttribute("aria-labelledby");
  });

  it("close button, native close and backdrop click call onClose; inner clicks do not", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open onClose={onClose} title="T" size="lg" closeLabel="Shut">
        <p>inside</p>
      </Dialog>,
      { wrapper },
    );
    const dlg = container.querySelector("dialog")!;
    expect(dlg.className).toContain("max-w-2xl");
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Shut"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dlg);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent(dlg, new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("ignores native close events while not open, uses default close label and sizes", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <Dialog open={false} onClose={onClose} size="sm">
        x
      </Dialog>,
      { wrapper },
    );
    fireEvent(container.querySelector("dialog")!, new Event("close"));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")!.className).toContain("max-w-sm");
    rerender(
      <Dialog open onClose={onClose}>
        x
      </Dialog>,
    );
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
    expect(container.querySelector("dialog")!.className).toContain("max-w-md");
  });
});
