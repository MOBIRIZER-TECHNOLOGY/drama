import { describe, expect, it } from "vitest";
import { enhanceCmsHtml } from "./cms-html";

describe("enhanceCmsHtml", () => {
  it("adds slug ids to h2/h3 headings and builds a toc when there are three or more", () => {
    const { html, toc } = enhanceCmsHtml("<h2>Refunds &amp; Returns</h2><p>x</p><h3><b>Sub</b> Section</h3><h2>Refunds &amp; Returns</h2>");
    expect(toc).toEqual([
      { id: "refunds-returns", text: "Refunds & Returns", level: 2 },
      { id: "sub-section", text: "Sub Section", level: 3 },
      { id: "refunds-returns-2", text: "Refunds & Returns", level: 2 },
    ]);
    expect(html).toContain('<h2 id="refunds-returns">Refunds &amp; Returns</h2>');
    expect(html).toContain('<h2 id="refunds-returns-2">');
  });

  it("keeps an author-set id and reserves it against later slugs", () => {
    const { html, toc } = enhanceCmsHtml(`<h2 id='intro'>Hello</h2><h2>Intro</h2><h2>Three</h2>`);
    expect(html).toContain(`<h2 id='intro'>Hello</h2>`);
    expect(toc.map((t) => t.id)).toEqual(["intro", "intro-2", "three"]);
  });

  it("leaves empty headings alone and returns no toc below three entries", () => {
    const { html, toc } = enhanceCmsHtml("<h2> <br> </h2><h2>One</h2>");
    expect(html).toContain("<h2> <br> </h2>");
    expect(toc).toEqual([]);
  });

  it("falls back to 'section' for headings with no letters or digits and keeps non-latin text", () => {
    const { toc } = enhanceCmsHtml("<h2>!!!</h2><h2>रिफंड नीति</h2><h2>&nbsp;x&quot;&#39;&lt;&gt;</h2>");
    expect(toc[0].id).toBe("section");
    expect(toc[1].id).toBe("रिफंड-नीति");
    expect(toc[2].text).toBe("x\"'<>");
  });

  it("wraps tables in a scroll container", () => {
    const { html } = enhanceCmsHtml("<table><tr><td>1</td></tr></table>");
    expect(html).toBe('<div class="cms-scroll"><table><tr><td>1</td></tr></table></div>');
  });
});
