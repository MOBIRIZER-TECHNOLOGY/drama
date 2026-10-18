/**
 * jsdom lacks HTMLDialogElement.showModal/close; the app's Modal depends on them. Call `installDialog()`
 * (e.g. in a `beforeAll`) to give them the observable behaviour: toggle `open` and fire `close` on close().
 */
export function installDialog() {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.show = proto.showModal;
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

/** recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks. */
export function installResizeObserver() {
  if (typeof globalThis.ResizeObserver !== "undefined") return;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
