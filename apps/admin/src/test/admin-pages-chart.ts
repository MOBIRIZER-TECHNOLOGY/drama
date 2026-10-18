import { fireEvent, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Hover a recharts chart in jsdom. Recharts converts pointer coordinates using the wrapper's layout box, which
 * jsdom reports as zero, so give the wrapper a real size first. Returns the tooltip text (empty if none).
 */
export function hoverChart(wrapper: Element, x = 400, y = 100, size = { width: 800, height: 300 }): string {
  Object.defineProperty(wrapper, "offsetWidth", { value: size.width, configurable: true });
  Object.defineProperty(wrapper, "offsetHeight", { value: size.height, configurable: true });
  (wrapper as HTMLElement).getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, ...size, right: size.width, bottom: size.height, toJSON() {} }) as DOMRect;
  fireEvent.mouseMove(wrapper, { clientX: x, clientY: y });
  return wrapper.querySelector(".recharts-tooltip-wrapper")?.textContent ?? "";
}

/** Recharts mounts one render after its container is measured; wait for `count` chart wrappers. */
export async function findCharts(container: HTMLElement, count = 1): Promise<Element[]> {
  await waitFor(() => expect(container.querySelectorAll(".recharts-wrapper").length).toBe(count));
  return [...container.querySelectorAll(".recharts-wrapper")];
}
