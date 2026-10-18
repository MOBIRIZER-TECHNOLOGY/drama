import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test-utils/app";

const POST = vi.fn();
const toast = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { POST: (...a: unknown[]) => POST(...a) } }));
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));

import { ReportDialog } from "./ReportDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  POST.mockReset();
  toast.mockReset();
});

const ok = { data: {}, response: { ok: true, status: 200 } };

describe("ReportDialog", () => {
  it("submits the chosen reason and trimmed details, toasts and closes", async () => {
    POST.mockResolvedValue(ok);
    const onClose = vi.fn();
    renderWithApp(<ReportDialog open onClose={onClose} seriesId="s1" episodeId="e1" />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "copyright" } });
    fireEvent.change(screen.getByLabelText("Details (optional)"), { target: { value: "  stolen  " } });
    fireEvent.click(screen.getByText("Send report"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(POST).toHaveBeenCalledWith("/v1/reports", { body: { series_id: "s1", episode_id: "e1", reason: "copyright", details: "stolen" } });
    expect(toast).toHaveBeenCalledWith("Thanks, we will look into it.", "success");
  });

  it("defaults to playback_issue, null details and null episode", async () => {
    POST.mockResolvedValue(ok);
    renderWithApp(<ReportDialog open onClose={() => {}} seriesId="s1" episodeId={null} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Inappropriate content",
      "Copyright issue",
      "Video does not play",
      "Wrong language or subtitles",
      "Something else",
    ]);
    fireEvent.click(screen.getByText("Send report"));
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(POST.mock.calls[0][1].body).toEqual({ series_id: "s1", episode_id: null, reason: "playback_issue", details: null });
  });

  it("shows the API error, keeps the dialog open and does not toast", async () => {
    POST.mockResolvedValue({ error: { detail: { code: "x", message: "Rate limited" } }, response: { ok: false, status: 429 } });
    const onClose = vi.fn();
    renderWithApp(<ReportDialog open onClose={onClose} seriesId="s1" episodeId={null} />);
    fireEvent.click(screen.getByText("Send report"));
    expect((await screen.findByRole("alert")).textContent).toBe("Rate limited");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
