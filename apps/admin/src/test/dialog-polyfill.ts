/**
 * jsdom has `<dialog>` but not `showModal()`/`close()`. Importing this file installs minimal versions that
 * toggle the `open` attribute (so the UA stylesheet shows/hides content) and fire `close` like a browser.
 */
const proto = (globalThis as { HTMLDialogElement?: { prototype: HTMLDialogElement } }).HTMLDialogElement?.prototype;
if (proto) {
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
export {};
