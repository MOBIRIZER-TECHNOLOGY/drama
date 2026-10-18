import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowArtwork } from "./ShowArtwork";

const img = (c: HTMLElement) => c.querySelector("img")!;
const path = (el: HTMLElement) => el.getAttribute("src")!.replace("http://localhost:3000", "");

describe("ShowArtwork", () => {
  it("renders the given source", () => {
    const { container } = render(<ShowArtwork alt="" src="https://cdn.example.com/a.jpg" kind="poster" width={10} height={10} unoptimized />);
    expect(img(container).getAttribute("src")).toBe("https://cdn.example.com/a.jpg");
    expect(img(container).getAttribute("alt")).toBe("");
  });
  it("uses the kind-specific fallback when there is no source", () => {
    const poster = render(<ShowArtwork alt="" src={null} kind="poster" width={10} height={10} unoptimized />);
    expect(path(img(poster.container))).toBe("/images/show-fallback-poster.jpg");
    const banner = render(<ShowArtwork alt="" kind="banner" width={10} height={10} unoptimized />);
    expect(path(img(banner.container))).toBe("/images/show-fallback-banner.jpg");
  });
  it("falls back after the image fails to load, but retries a new src", () => {
    const { container, rerender } = render(<ShowArtwork alt="" src="https://cdn.example.com/bad.jpg" kind="poster" width={10} height={10} unoptimized />);
    fireEvent.error(img(container));
    expect(path(img(container))).toBe("/images/show-fallback-poster.jpg");
    rerender(<ShowArtwork alt="" src="https://cdn.example.com/good.jpg" kind="poster" width={10} height={10} unoptimized />);
    expect(img(container).getAttribute("src")).toBe("https://cdn.example.com/good.jpg");
  });
  it("an error on the fallback itself changes nothing", () => {
    const { container } = render(<ShowArtwork alt="" kind="poster" width={10} height={10} unoptimized />);
    fireEvent.error(img(container));
    expect(path(img(container))).toBe("/images/show-fallback-poster.jpg");
  });
});
