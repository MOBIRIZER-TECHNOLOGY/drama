/**
 * jsdom lacks `HTMLDialogElement.showModal/close` and `ResizeObserver`. Importing this file installs minimal
 * stand-ins (side effect) so `<Modal>` content becomes visible/accessible and recharts can measure a container.
 */
if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class FakeResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const rect = { width: 800, height: 300, top: 0, left: 0, right: 800, bottom: 300, x: 0, y: 0 } as DOMRectReadOnly;
      this.cb([{ target, contentRect: rect, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
}

export {};
