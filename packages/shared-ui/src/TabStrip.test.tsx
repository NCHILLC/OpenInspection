// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { TabStrip } from "./TabStrip";

afterEach(cleanup);

const TABS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];

describe("TabStrip", () => {
  it("horizontal (default) keeps bottom-border underline tabs", () => {
    const { container } = render(
      <TabStrip tabs={TABS} activeId="a" onChange={() => {}} />,
    );
    expect((container.firstChild as HTMLElement).className).toContain("border-b");
  });

  it("vertical orientation stacks with left-border accent", () => {
    const { container } = render(
      <TabStrip tabs={TABS} activeId="a" onChange={() => {}} orientation="vertical" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain("flex-col");
    const active = screen.getByRole("button", { name: "Alpha" });
    expect(active.className).toContain("border-l-2");
  });
});

describe("TabStrip segmented variant", () => {
  const COUNTED = [{ id: "defects", label: "Defects", count: 2 }, { id: "information", label: "Info" }];

  it("renders a tablist whose selected tab is filled, 44px tall, and keeps its count", () => {
    render(<TabStrip variant="segmented" tabs={COUNTED} activeId="defects" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeTruthy();
    const selected = screen.getByRole("tab", { name: /Defects/ });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.className).toContain("bg-ih-primary");
    expect(selected.className).toContain("min-h-11");
    expect(selected.textContent).toContain("2");
    const other = screen.getByRole("tab", { name: "Info" });
    expect(other.getAttribute("aria-selected")).toBe("false");
    expect(other.className).toContain("border-ih-border-strong");
  });

  it("calls onChange with the tapped tab", () => {
    const onChange = vi.fn();
    render(<TabStrip variant="segmented" tabs={COUNTED} activeId="defects" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Info" }));
    expect(onChange).toHaveBeenCalledWith("information");
  });

  it("leaves the default strip as plain buttons with no tab roles", () => {
    render(<TabStrip tabs={TABS} activeId="a" onChange={() => {}} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
  });
});
