/**
 * jsdom has no `showModal()`/`close()` on <dialog>. This adds the behaviour the components rely on: `open` is
 * toggled, `close` fires a `close` event (what React's `onClose` listens to), and `escape()` simulates the
 * Escape key by firing a cancelable `cancel` event and closing unless it was prevented.
 */
export function installDialogPolyfill() {
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
export function escape(dialog: HTMLElement) {
  const ev = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(ev);
  if (!ev.defaultPrevented) (dialog as HTMLDialogElement).close();
}
