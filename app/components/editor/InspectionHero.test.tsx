// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectionHero, heroEyebrow } from "./InspectionHero";

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(),
  };
});

import { useFetcher } from "react-router";
const mockedUseFetcher = vi.mocked(useFetcher);

describe("heroEyebrow", () => {
  it("names today and the time of day", () => {
    const result = heroEyebrow("2026-10-27T09:00:00Z", new Date(2026, 9, 27, 12, 0), "en-US");
    expect(result).toBe(`Today · 9:00 AM`);
  });

  it("writes another day as a short date, with the time after it", () => {
    const result = heroEyebrow("2026-10-28T14:30:00Z", new Date(2026, 9, 27, 12, 0), "en-US");
    expect(result).toContain("Oct");
    expect(result.endsWith("2:30 PM")).toBe(true);
  });

  it("drops the time when the date has none", () => {
    const result = heroEyebrow("2026-10-27", new Date(2026, 9, 27, 12, 0), "en-US");
    expect(result).toBe("Today");
  });
});

describe("InspectionHero", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the address as the h1 with client, city and year built under it", () => {
    mockedUseFetcher.mockReturnValue({
      data: [
        { id: "1", roleLabel: "Client", name: "Jordan Sample", phone: "123", agency: null, kind: "client" },
      ],
      load: vi.fn(),
    } as never);

    render(<InspectionHero inspectionId="123" address="123 Main St" date="2026-10-27T09:00:00Z" city="Huntersville" yearBuilt={1998} />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("123 Main St");
    expect(screen.getByText("Jordan Sample · Huntersville · Built 1998")).toBeTruthy();
  });

  it("omits the subline when nothing is known", () => {
    mockedUseFetcher.mockReturnValue({
      data: [],
      load: vi.fn(),
    } as never);

    render(<InspectionHero inspectionId="123" address="123 Main St" date="2026-10-27T09:00:00Z" />);

    expect(screen.queryByText(/Jordan|Huntersville|Built/)).toBeNull();
  });

  it("never uses an agent as the client name", () => {
    mockedUseFetcher.mockReturnValue({
      data: [
        { id: "1", roleLabel: "Agent", name: "Agent Smith", phone: "123", agency: "Realty Co", kind: "agent" },
      ],
      load: vi.fn(),
    } as never);

    render(<InspectionHero inspectionId="123" address="123 Main St" date="2026-10-27T09:00:00Z" city="Huntersville" yearBuilt={1998} />);

    expect(screen.queryByText("Agent Smith")).toBeNull();
    expect(screen.getByText("Huntersville · Built 1998")).toBeTruthy();
  });
});
