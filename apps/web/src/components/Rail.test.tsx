import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { Rail } from "./Rail";

let resizeCb: (() => void) | undefined;
const disconnect = vi.fn();
afterEach(() => {
  resizeCb = undefined;
});

function geometry(el: HTMLElement, g: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(el, "scrollWidth", { value: g.scrollWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: g.clientWidth, configurable: true });
  el.scrollLeft = g.scrollLeft;
}

function setup(props: Partial<Parameters<typeof Rail>[0]> = {}) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resizeCb = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const r = render(
    <Rail title="Trending" id="rail-x" {...props}>
      <div>card</div>
    </Rail>,
    { wrapper: appWrapper() },
  );
  const scroller = r.container.querySelector(".snap-x") as HTMLDivElement;
  return { ...r, scroller };
}

describe("Rail", () => {
  it("renders title, labelled section id, action and children", () => {
    setup({ action: <span>All</span> });
    expect(screen.getByRole("region", { name: "Trending" }).id).toBe("rail-x");
    expect(screen.getByText("card")).toBeTruthy();
    expect(screen.getByText("All")).toBeTruthy();
  });

  it("does not label the section when the title isn't a string", () => {
    const { container } = setup({ title: <b>Bold</b> });
    expect(container.querySelector("section")!.getAttribute("aria-label")).toBeNull();
  });

  it("enables arrows according to scroll position (±4px tolerance)", () => {
    const { scroller } = setup();
    const back = screen.getByLabelText("Scroll back") as HTMLButtonElement;
    const fwd = screen.getByLabelText("Scroll forward") as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    geometry(scroller, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
    act(() => resizeCb!());
    expect(back.disabled).toBe(true);
    expect(fwd.disabled).toBe(false);
    geometry(scroller, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 300 });
    fireEvent.scroll(scroller);
    expect(back.disabled).toBe(false);
    expect(fwd.disabled).toBe(false);
    geometry(scroller, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 598 });
    fireEvent.scroll(scroller);
    expect(fwd.disabled).toBe(true);
  });

  it("scrolls by 80% of the width in the reading direction, reversed for rtl", () => {
    const { scroller } = setup();
    const by = vi.fn();
    scroller.scrollBy = by;
    geometry(scroller, { scrollWidth: 1000, clientWidth: 500, scrollLeft: 100 });
    act(() => resizeCb!());
    fireEvent.click(screen.getByLabelText("Scroll forward"));
    expect(by).toHaveBeenLastCalledWith({ left: 400, behavior: "smooth" });
    fireEvent.click(screen.getByLabelText("Scroll back"));
    expect(by).toHaveBeenLastCalledWith({ left: -400, behavior: "smooth" });
    scroller.style.direction = "rtl";
    fireEvent.click(screen.getByLabelText("Scroll forward"));
    expect(by).toHaveBeenLastCalledWith({ left: -400, behavior: "smooth" });
  });

  it("disconnects its observer on unmount", () => {
    const { unmount } = setup();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
