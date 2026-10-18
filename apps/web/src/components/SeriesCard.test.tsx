import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCategory, makeSeries } from "@/test-utils/fixtures";
import { SeriesCard, SeriesCardSkeleton } from "./SeriesCard";

describe("SeriesCard", () => {
  it("links to the series with a locale href and labels by title", () => {
    render(<SeriesCard series={makeSeries()} lang="hi" />);
    const a = screen.getByRole("link", { name: "My Show" });
    expect(a.getAttribute("href")).toBe("/hi/series/my-show");
    expect(screen.getByText("10 eps")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("numbers ranked cards", () => {
    render(<SeriesCard series={makeSeries()} lang="en" rank={3} />);
    expect(screen.getByRole("link", { name: "3. My Show" })).toBeTruthy();
    expect(screen.getByText("3").getAttribute("aria-hidden")).toBe("true");
  });

  it("shows free-episode count or VIP for premium series", () => {
    const a = render(<SeriesCard series={makeSeries({ is_premium: true, free_episodes: 3 })} lang="en" freeLabel="Free" />);
    expect(screen.getByText("3 free")).toBeTruthy();
    a.unmount();
    render(<SeriesCard series={makeSeries({ is_premium: true, free_episodes: 0 })} lang="en" />);
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("shows rating (adult styled), completion status and categories", () => {
    const a = render(
      <SeriesCard
        series={makeSeries({ content_rating: "A", is_adult: true, completion_status: "Ongoing", categories: [makeCategory(), makeCategory({ id: "c2", name: "Drama" })] })}
        lang="en"
        episodesLabel="episodes"
        className="extra"
      />,
    );
    expect(screen.getByText("A").getAttribute("title")).toBe("Mature content");
    expect(screen.getByText("A").className).toContain("text-danger");
    expect(screen.getByText("Ongoing")).toBeTruthy();
    expect(screen.getByText("Romance · Drama")).toBeTruthy();
    expect(screen.getByText("10 episodes")).toBeTruthy();
    expect(a.container.querySelector("a")!.className).toContain("extra");
    a.unmount();
    render(<SeriesCard series={makeSeries({ content_rating: "U" })} lang="en" />);
    expect(screen.getByText("U").getAttribute("title")).toBe("Content rating");
  });
});

describe("SeriesCardSkeleton", () => {
  it("renders with the default and a custom class", () => {
    const a = render(<SeriesCardSkeleton />);
    expect(a.container.firstElementChild!.className).toContain("w-[9.5rem]");
    const b = render(<SeriesCardSkeleton className="w-10" />);
    expect(b.container.firstElementChild!.className).toBe("w-10");
  });
});
