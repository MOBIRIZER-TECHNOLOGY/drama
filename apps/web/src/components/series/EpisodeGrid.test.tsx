import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test-utils/app";
import { ep } from "@/test-utils/series-fixtures";
import { EpisodeGrid } from "./EpisodeGrid";

const small = [ep(1, { is_free: true, title: "Pilot" }), ep(2, { accessible: true }), ep(3, { price: 25 }), ep(4)];

describe("EpisodeGrid", () => {
  it("labels each episode by lock state and shows the price on the next one", () => {
    renderWithApp(<EpisodeGrid episodes={small} currentId={null} continueNumber={null} onSelect={() => {}} />);
    expect(screen.getByLabelText("Episode 1 – Pilot. Free")).toBeInTheDocument();
    expect(screen.getByLabelText("Episode 2. Unlocked")).toBeInTheDocument();
    expect(screen.getByLabelText("Episode 3. Unlock for 25 coins")).toBeInTheDocument();
    expect(screen.getByLabelText("Episode 4. Unlock previous episodes first")).toBeInTheDocument();
    expect(screen.getByTitle("1. Pilot — Free")).toBeInTheDocument();
    expect(screen.getByTitle("Unlocked")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("selects the clicked episode", () => {
    const onSelect = vi.fn();
    renderWithApp(<EpisodeGrid episodes={small} currentId={null} continueNumber={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText(/^Episode 3/));
    expect(onSelect).toHaveBeenCalledWith(small[2]);
  });

  it("marks the current episode and a Resume badge on the continue episode only", () => {
    renderWithApp(<EpisodeGrid episodes={small} currentId="ep-1" continueNumber={2} onSelect={() => {}} />);
    expect(screen.getByLabelText(/^Episode 1/).getAttribute("aria-current")).toBe("true");
    expect(screen.getByLabelText(/^Episode 2/).textContent).toContain("Resume");
    expect(screen.getAllByText("Resume")).toHaveLength(1);
  });

  it("does not badge the continue episode when it is also current", () => {
    renderWithApp(<EpisodeGrid episodes={small} currentId="ep-2" continueNumber={2} onSelect={() => {}} />);
    expect(screen.queryByText("Resume")).toBeNull();
  });

  describe("with many episodes", () => {
    const many = Array.from({ length: 120 }, (_, i) => ep(i + 1, { is_free: i < 5 }));

    it("splits into 50-episode range tabs and switches between them", () => {
      renderWithApp(<EpisodeGrid episodes={many} currentId={null} continueNumber={null} onSelect={() => {}} />);
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["1–50", "51–100", "101–120"]);
      expect(tabs[0].getAttribute("aria-selected")).toBe("true");
      expect(screen.getAllByRole("listitem")).toHaveLength(50);
      fireEvent.click(tabs[2]);
      expect(screen.getAllByRole("listitem")).toHaveLength(20);
      expect(screen.getByLabelText(/^Episode 101/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Episode 1\./)).toBeNull();
    });

    it("opens on the range that holds the current episode", () => {
      renderWithApp(<EpisodeGrid episodes={many} currentId="ep-75" continueNumber={null} onSelect={() => {}} />);
      expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
      expect(screen.getByLabelText(/^Episode 75/)).toBeInTheDocument();
    });

    it("falls back to the first range for an unknown current episode", () => {
      renderWithApp(<EpisodeGrid episodes={many} currentId="nope" continueNumber={null} onSelect={() => {}} />);
      expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    });
  });
});
