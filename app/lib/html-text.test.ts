// @vitest-environment node
import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "./html-text";

describe("htmlToPlainText", () => {
  it("removes the paragraph tags an inspector was reading on screen", () => {
    expect(htmlToPlainText("<p>Wire splices were found exposed.</p>"))
      .toBe("Wire splices were found exposed.");
  });

  // Without a boundary space these run together as "OneTwo".
  it("keeps a word boundary between blocks", () => {
    expect(htmlToPlainText("<p>One</p><p>Two</p>")).toBe("One Two");
    expect(htmlToPlainText("First<br>Second")).toBe("First Second");
  });

  it("drops inline formatting without eating the words", () => {
    expect(htmlToPlainText("<p>A <strong>major</strong> <em>hazard</em>.</p>"))
      .toBe("A major hazard.");
  });

  it("decodes entities a rich-text editor emits", () => {
    expect(htmlToPlainText("<p>Fascia&nbsp;&amp; soffit</p>")).toBe("Fascia & soffit");
    expect(htmlToPlainText("<p>3&#39; clearance</p>")).toBe("3' clearance");
  });

  // Entities are decoded AFTER tags are stripped, so prose that TALKS about a
  // tag survives instead of being mistaken for markup and deleted.
  it("preserves an encoded tag written as prose", () => {
    expect(htmlToPlainText("<p>Use &lt;p&gt; here</p>")).toBe("Use <p> here");
  });

  it("collapses whitespace and handles empty input", () => {
    expect(htmlToPlainText("<p>  spaced   out  </p>")).toBe("spaced out");
    expect(htmlToPlainText("")).toBe("");
  });
});
