// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemReasonSheet } from "./ItemReasonSheet";
import type { CustomLimitation } from "~/lib/limitations";

const baseProps = {
  entries: [] as ReadonlyArray<CustomLimitation>,
  required: true,
  label: "Chimney",
  phone: true,
  onAdd: () => {},
  onToggle: () => {},
};

describe("ItemReasonSheet", () => {
  it("phone + required + no entries shows the bar item-reason-bar and no inline panel", () => {
    render(<ItemReasonSheet {...baseProps} />);
    expect(screen.getByTestId("item-reason-bar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add a reason/i })).toBeNull();
  });

  it("tapping the bar opens the sheet (the 'Why wasn't X inspected?' title appears)", () => {
    render(<ItemReasonSheet {...baseProps} />);
    fireEvent.click(screen.getByTestId("item-reason-bar"));
    expect(screen.getByRole("dialog", { name: "Why wasn't Chimney inspected?" })).toBeTruthy();
  });

  it("phone=false renders the inline panel and no bar", () => {
    render(<ItemReasonSheet {...baseProps} phone={false} />);
    expect(screen.queryByTestId("item-reason-bar")).toBeNull();
  });

  it("phone + required + an included entry renders the inline panel and no bar", () => {
    const entries: CustomLimitation[] = [
      { id: "x", title: "Locked", comment: "", included: true },
    ];
    render(<ItemReasonSheet {...baseProps} entries={entries} />);
    expect(screen.queryByTestId("item-reason-bar")).toBeNull();
  });
});
