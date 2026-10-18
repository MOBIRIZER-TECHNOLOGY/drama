import "@/test/components-dom-matchers";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { MAX_IMAGE_BYTES } from "@/lib/uploads";
import { ImageUpload } from "./image-upload";

/** Boundary fake for the browser's XHR: the PUT to object storage. Tests drive its lifecycle by hand. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  status = 200;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  method = "";
  url = "";
  body: unknown;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(m: string, u: string) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader() {}
  send(b: unknown) {
    this.body = b;
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://store/put", key: "library/x/cover.png", public_url: "https://cdn/library/x/cover.png" });
});
afterEach(() => vi.unstubAllGlobals());

const file = (name = "c.png", type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });
const picker = (label = "Cover") => screen.getByLabelText(`${label} file`) as HTMLInputElement;
const xhr = () => FakeXHR.instances[0];
async function waitForXhr() {
  await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
}

describe("ImageUpload", () => {
  it("empty state: Upload button, no Remove, default size hint, no preview image", () => {
    const { container } = renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Upload/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText(`Up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("custom hint and aspect frames", () => {
    const { container, rerender } = renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} hint="Exactly 9:16" />);
    expect(screen.getByText("Exactly 9:16")).toBeTruthy();
    expect(container.querySelector(".aspect-\\[9\\/16\\]")).toBeTruthy();
    rerender(<ImageUpload label="Cover" value={null} onChange={() => {}} aspect="wide" />);
    expect(container.querySelector(".aspect-\\[16\\/9\\]")).toBeTruthy();
    rerender(<ImageUpload label="Cover" value={null} onChange={() => {}} aspect="square" />);
    expect(container.querySelector(".aspect-square")).toBeTruthy();
  });

  it("a pasted URL previews, edits report onChange, clearing the text reports null", () => {
    const onChange = vi.fn();
    const { container } = renderPage(<ImageUpload label="Cover" value="https://img/a.png" onChange={onChange} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://img/a.png");
    expect(screen.getByRole("button", { name: /Replace/ })).toBeTruthy();
    const url = screen.getByLabelText("Cover URL");
    fireEvent.change(url, { target: { value: "https://img/b.png" } });
    expect(onChange).toHaveBeenLastCalledWith("https://img/b.png");
    fireEvent.change(url, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("a stored key without a media base has no previewable image", () => {
    const { container } = renderPage(<ImageUpload label="Cover" value="library/x/cover.png" onChange={() => {}} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("Remove clears the value", async () => {
    const onChange = vi.fn();
    renderPage(<ImageUpload label="Cover" value="https://img/a.png" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("the Upload button opens the file picker", async () => {
    renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} />);
    const click = vi.spyOn(picker(), "click");
    await userEvent.click(screen.getByRole("button", { name: /Upload/ }));
    expect(click).toHaveBeenCalled();
  });

  it("uploads: presigns, PUTs the file, stores the key, previews the URL, toasts, and resets the input", async () => {
    const onChange = vi.fn();
    const { container } = renderPage(<ImageUpload label="Cover" value={null} onChange={onChange} />);
    const f = file("cover.png");
    fireEvent.change(picker(), { target: { files: [f] } });
    await waitForXhr();
    expect(mockApi.callsTo("POST", "/v1/admin/uploads/presign")[0].body).toEqual({
      kind: "image",
      filename: "cover.png",
      content_type: "image/png",
    });
    expect(xhr().method).toBe("PUT");
    expect(xhr().url).toBe("https://store/put");
    expect(xhr().body).toBe(f);
    // in flight: progress bar, busy, Cancel offered, Remove hidden
    act(() => xhr().upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 }));
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    expect((container.querySelector(".bg-accent.transition-all") as HTMLElement).style.width).toBe("25%");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    act(() => xhr().onload!());
    await screen.findByText("Cover uploaded");
    expect(onChange).toHaveBeenCalledWith("library/x/cover.png");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/library/x/cover.png");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(picker().value).toBe("");
  });

  it("ignores a change event with no file", () => {
    renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} />);
    fireEvent.change(picker(), { target: { files: [] } });
    expect(mockApi.calls).toHaveLength(0);
  });

  it("rejects non-images and oversize files before any request, with a toast", async () => {
    const onChange = vi.fn();
    renderPage(<ImageUpload label="Cover" value={null} onChange={onChange} />);
    fireEvent.change(picker(), { target: { files: [file("a.txt", "text/plain")] } });
    expect(await screen.findByText("Please choose an image file.")).toBeTruthy();
    fireEvent.change(picker(), { target: { files: [file("big.png", "image/png", MAX_IMAGE_BYTES + 1)] } });
    expect(await screen.findByText(/Image is 10\.0 MB|Image is .* the limit is 10\.0 MB/)).toBeTruthy();
    expect(mockApi.calls).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("surfaces presign failures and storage failures", async () => {
    const onChange = vi.fn();
    renderPage(<ImageUpload label="Cover" value={null} onChange={onChange} />);
    mockApi.post("/v1/admin/uploads/presign", fail(500, "presign down"));
    fireEvent.change(picker(), { target: { files: [file()] } });
    expect(await screen.findByText("presign down")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upload/ })).toBeEnabled();

    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://store/put", key: "k", public_url: "https://cdn/k" });
    fireEvent.change(picker(), { target: { files: [file()] } });
    await waitForXhr();
    xhr().status = 403;
    act(() => xhr().onload!());
    expect(await screen.findByText("Upload to storage failed (403)")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("normalises non-Error rejections to the generic message", async () => {
    mockApi.post("/v1/admin/uploads/presign", () => {
      throw "nope";  
    });
    renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} />);
    fireEvent.change(picker(), { target: { files: [file()] } });
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
  });

  it("Cancel aborts quietly (no error toast) and leaves the value alone", async () => {
    const onChange = vi.fn();
    renderPage(<ImageUpload label="Cover" value={null} onChange={onChange} />);
    fireEvent.change(picker(), { target: { files: [file()] } });
    await waitForXhr();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picking a new file aborts the one in flight", async () => {
    renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} />);
    fireEvent.change(picker(), { target: { files: [file("one.png")] } });
    await waitForXhr();
    const abort = vi.spyOn(xhr(), "abort");
    fireEvent.change(picker(), { target: { files: [file("two.png")] } });
    expect(abort).toHaveBeenCalled();
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    expect(screen.queryByRole("alert")).toBeNull(); // the aborted one stays silent
  });

  it("unmounting aborts an in-flight upload", async () => {
    const { unmount } = renderPage(<ImageUpload label="Cover" value={null} onChange={() => {}} />);
    fireEvent.change(picker(), { target: { files: [file()] } });
    await waitForXhr();
    const abort = vi.spyOn(xhr(), "abort");
    unmount();
    expect(abort).toHaveBeenCalled();
  });
});
