// @vitest-environment happy-dom
/**
 * `useIsMobile` on a phone used to break hydration. The server cannot see a
 * viewport, so it renders the desktop tree; the hook then seeded its state from
 * `matchMedia` on the client's FIRST render, so at 375px the hydrating tree
 * disagreed with the server's and React threw #418 and rebuilt the editor from
 * scratch — every phone, every load, logged as a recoverable error. The hook
 * now hydrates with a fixed server snapshot and re-renders once with the truth.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

import { useIsMobile } from "~/hooks/useBreakpoint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  return <span>{useIsMobile() ? "mobile" : "desktop"}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useIsMobile — hydration on a phone", () => {
  it("hydrates the server's desktop tree without a mismatch, then reports mobile", async () => {
    // What the server produced: it has no viewport.
    const html = renderToString(<Probe />);
    expect(html).toContain("desktop");

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);

    // The phone.
    const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", vi.fn(() => mq));

    const recovered: unknown[] = [];
    await act(() => {
      hydrateRoot(host, <Probe />, { onRecoverableError: (e) => recovered.push(e) });
    });

    expect(recovered, "hydration must not throw and recover").toEqual([]);
    expect(host.textContent).toBe("mobile");
  });
});
