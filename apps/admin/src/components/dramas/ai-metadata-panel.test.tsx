import "@/test/dramas-dom-matchers";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { AiMetadataPanel } from "./ai-metadata-panel";

const draft = (over: Record<string, unknown> = {}) => ({
  title: "Tea Stall",
  slug: "tea-stall",
  synopsis: "A widow finds secrets.",
  genres: ["Drama"],
  tags: ["family"],
  seo_title: "Tea Stall SEO",
  meta_description: "Meta desc",
  keywords: ["tea"],
  content_rating: "U/A",
  confidence: 0.8,
  moderation_flags: [],
  ...over,
});

function setup(props: Partial<React.ComponentProps<typeof AiMetadataPanel>> = {}) {
  const onApply = vi.fn();
  const utils = renderPage(
    <AiMetadataPanel
      languageOptions={["English", "Hindi"]}
      currentLanguage="English"
      existingTitle=""
      existingSynopsis=""
      isCreate
      onApply={onApply}
      {...props}
    />,
  );
  return { onApply, ...utils };
}

async function open() {
  await userEvent.click(screen.getByRole("button", { name: "Show" }));
}

describe("AiMetadataPanel", () => {
  it("toggles open and closed", async () => {
    setup();
    expect(screen.queryByLabelText(/Seed/)).toBeNull();
    await open();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByLabelText(/Seed/)).toBeNull();
  });

  it("rejects a seed that is too short without calling the API", async () => {
    setup();
    await open();
    await userEvent.type(screen.getByLabelText(/Seed/), "ab");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 3 characters");
    expect(mockApi.callsTo("POST", "/v1/admin/ai/series-metadata")).toHaveLength(0);
    // typing clears the error
    await userEvent.type(screen.getByLabelText(/Seed/), "c");
    expect(screen.queryByText(/at least 3 characters/)).toBeNull();
  });

  it("generates a draft, shows it, and applies it", async () => {
    mockApi.post("/v1/admin/ai/series-metadata", draft({ moderation_flags: ["violence"], genres: [] }));
    const { onApply } = setup();
    await open();
    await userEvent.type(screen.getByLabelText(/Seed/), "  a tea stall  ");
    await userEvent.selectOptions(screen.getByLabelText("Output language"), "Hindi");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));

    const section = await screen.findByRole("region", { name: "AI draft" });
    expect(section).toHaveTextContent("Tea Stall");
    expect(section).toHaveTextContent("tea-stall");
    expect(section).toHaveTextContent("violence");
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "80");
    expect(mockApi.callsTo("POST", "/v1/admin/ai/series-metadata")[0].body).toEqual({
      seed: "a tea stall",
      language: "Hindi",
      title: null,
      synopsis: null,
    });
    expect(screen.getByRole("button", { name: /Regenerate/ })).toBeInTheDocument();
    expect(section).toHaveTextContent(", sets the slug");

    await userEvent.click(screen.getByRole("button", { name: /Apply to form/ }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ title: "Tea Stall" }));
    expect(await screen.findByText(/Draft applied to the form/)).toBeInTheDocument();
  });

  it("sends existing title/synopsis when the toggle is on, and disables it when there is none", async () => {
    mockApi.post("/v1/admin/ai/series-metadata", draft({ confidence: 0.5, content_rating: "" }));
    setup({ existingTitle: " Old ", existingSynopsis: "  ", isCreate: false });
    await open();
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.type(screen.getByLabelText(/Seed/), "notes");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
    await screen.findByRole("region", { name: "AI draft" });
    expect(mockApi.callsTo("POST", "/v1/admin/ai/series-metadata")[0].body).toMatchObject({ title: "Old", synopsis: null });
    expect(screen.getByText("(kept as is when editing)")).toBeInTheDocument();
    expect(screen.queryByText(/, sets the slug/)).toBeNull();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("disables the toggle with nothing existing", async () => {
    setup();
    await open();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText("Nothing on this tab yet.")).toBeInTheDocument();
  });

  it("clamps out-of-range confidence and picks the low tone", async () => {
    mockApi.post("/v1/admin/ai/series-metadata", draft({ confidence: -3 }));
    setup();
    await open();
    await userEvent.type(screen.getByLabelText(/Seed/), "notes");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
    expect(await screen.findByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("maps AI failures to readable messages", async () => {
    mockApi.post("/v1/admin/ai/series-metadata", fail(503, "down"));
    setup();
    await open();
    await userEvent.type(screen.getByLabelText(/Seed/), "notes");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
    expect(await screen.findAllByText(/AI is unavailable right now/)).not.toHaveLength(0);
    expect(screen.queryByRole("region", { name: "AI draft" })).toBeNull();
  });

  it("prefills the seed from the transcript", async () => {
    mockApi.get("/v1/admin/ai/series/s1/transcript", { text: "  hello transcript  ", episodes: 2 });
    setup({ seriesId: "s1" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Seed from transcript/ }));
    await waitFor(() => expect(screen.getByLabelText(/Seed/)).toHaveValue("hello transcript"));
    expect(mockApi.callsTo("GET", "/v1/admin/ai/series/s1/transcript")[0].query).toEqual({ episodes: "3" });
    expect(await screen.findByText("Seeded from 2 episode transcript(s).")).toBeInTheDocument();
    expect(screen.getByLabelText(/Seed/)).toHaveFocus();
  });

  it("explains when there is no transcript yet", async () => {
    mockApi.get("/v1/admin/ai/series/s1/transcript", { text: "   ", episodes: 0 });
    setup({ seriesId: "s1" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Seed from transcript/ }));
    expect(await screen.findByText(/No transcript yet/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Seed/)).toHaveValue("");
  });

  it("reports transcript load failures", async () => {
    mockApi.get("/v1/admin/ai/series/s1/transcript", fail(502, "bad"));
    setup({ seriesId: "s1" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Seed from transcript/ }));
    expect(await screen.findAllByText(/The AI provider returned an error/)).not.toHaveLength(0);
  });

  it("hides the transcript button without a series id", async () => {
    setup();
    await open();
    expect(screen.queryByRole("button", { name: /Seed from transcript/ })).toBeNull();
  });
});
