// @vitest-environment happy-dom
import { useState } from "react";
import { render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";

// PropertyInfoForm now uses useFetcher (the #200 "Fetch property details"
// button), so it must render inside a data-router context. `renderPF` wraps any
// element in a minimal stub router; an optional `action` powers the autofill
// fetcher for the tests that click the button. The field/commit tests below
// never click it, so their fetcher stays idle and no action is needed.
// `onSave` fires optimistically on every change with the RAW value typed;
// `onCommit` fires the durable save with a FULL coerced snapshot of every field
// — on blur for text/number/date, on change for select/boolean.
function renderPF(ui: React.ReactElement, action?: () => unknown) {
  const Stub = createRoutesStub([{ path: "/", Component: () => ui, action }]);
  return render(<Stub />);
}

function labelInput(container: HTMLElement, labelText: string): HTMLInputElement | null {
  const spans = Array.from(container.querySelectorAll("label span span")) as HTMLElement[];
  const match = spans.find((s) => s.textContent === labelText);
  const label = match?.closest("label");
  return (label?.querySelector("input") as HTMLInputElement | null) ?? null;
}

// PropertyInfoForm is fully controlled by the `inspection` prop, so a blur can
// only read an edited value if `onSave` updated that prop first. This harness
// mirrors the production wiring in inspection-edit.tsx: onSave → optimistic
// setInspection (stores the RAW value); onCommit → the durable save (spied on
// here), receiving the full facts object.
function Harness({ initial, onCommit, phone }: { initial: Record<string, unknown>; onCommit: (facts: Record<string, unknown>) => void; phone?: boolean }) {
  const [inspection, setInspection] = useState(initial);
  return (
    <PropertyInfoForm
      inspection={inspection}
      phone={phone}
      onSave={(id, v) => setInspection((prev) => ({ ...prev, [id]: v }))}
      onCommit={onCommit}
    />
  );
}

describe("PropertyInfoForm field sets", () => {
  it("renders bedrooms/bathrooms plus unit + county for a residential inspection", () => {
    const { getByText } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(getByText("Bedrooms")).toBeTruthy();
    expect(getByText("Bathrooms")).toBeTruthy();
    expect(getByText("Year Built")).toBeTruthy();
    expect(getByText("Sq Ft")).toBeTruthy();
    expect(getByText("Unit / Suite")).toBeTruthy();
    expect(getByText("County")).toBeTruthy();
  });

  it("omits bedrooms/bathrooms + unit but shows Building Area and County for a commercial inspection", () => {
    const { queryByText, getByText } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} />,
    );
    expect(queryByText("Bedrooms")).toBeNull();
    expect(queryByText("Bathrooms")).toBeNull();
    // Commercial properties have a county but no unit/suite.
    expect(queryByText("Unit / Suite")).toBeNull();
    expect(getByText("County")).toBeTruthy();
    expect(getByText("Building Area (Sq Ft)")).toBeTruthy();
    // The plain "Sq Ft" label is relabeled for commercial.
    expect(queryByText("Sq Ft")).toBeNull();
  });

  it("renders lotSize (Lot Size)", () => {
    const { getByText } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} />,
    );
    expect(getByText("Lot Size")).toBeTruthy();
  });
});

describe("PropertyInfoForm raw-string typing (Finding 4)", () => {
  it("keeps a fractional Bathrooms value ('2.5') verbatim — onChange is the raw string, not coerced to 2", () => {
    const onSave = vi.fn();
    const { container } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onSave={onSave} />,
    );
    const input = labelInput(container, "Bathrooms")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "2.5" } });
    // onSave gets the RAW string, never Number("2.5") === 2.5-typed / null.
    expect(onSave).toHaveBeenCalledWith("bathrooms", "2.5");
  });

  it("does not clear the input on the transient mid-decimal '2.' keystroke", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Bathrooms")!;
    fireEvent.change(input, { target: { value: "2." } });
    // Controlled value retains "2." — a coerce here would snap it to "2" or "".
    expect(input.value).toBe("2.");
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(input.value).toBe("2.5");
  });
});

describe("PropertyInfoForm full-snapshot commit (Finding 1)", () => {
  it("commits the WHOLE facts object on blur with the changed field coerced and empty fields → null", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "1990" } });
    // onChange must NOT commit (no keystroke persistence).
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      yearBuilt: 1990,
      sqft: null,
      foundationType: null,
      lotSize: null,
      bedrooms: null,
      bathrooms: null,
      unit: null,
      county: null,
      temperatureF: null,
      weather: null,
    });
  });

  it("commits a fractional bathrooms value coerced to a Number within the full object", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Bathrooms")!;
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.bathrooms).toBe(2.5);
  });

  it("preserves already-entered sibling fields when a second field commits (superset PATCH)", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const year = labelInput(container, "Year Built")!;
    fireEvent.change(year, { target: { value: "1990" } });
    fireEvent.blur(year);
    const county = labelInput(container, "County")!;
    fireEvent.change(county, { target: { value: "Travis County" } });
    fireEvent.blur(county);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    // The county commit still carries the earlier yearBuilt value.
    expect(facts.yearBuilt).toBe(1990);
    expect(facts.county).toBe("Travis County");
  });

  it("commits null when a number field is cleared to empty on blur", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential", yearBuilt: 1990 }} onCommit={onCommit} />);
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.yearBuilt).toBeNull();
  });

  it("commits null when a text field (lotSize) is blurred empty", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential", lotSize: "old" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.lotSize).toBeNull();
  });

  it("commits a text field (lotSize) value on blur", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Lot Size")!;
    fireEvent.change(input, { target: { value: "0.25 acres" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.lotSize).toBe("0.25 acres");
  });

  it("still fires onSave optimistically on change with the raw string", () => {
    const onSave = vi.fn();
    const { container } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onSave={onSave} />,
    );
    const input = labelInput(container, "Year Built")!;
    fireEvent.change(input, { target: { value: "1985" } });
    expect(onSave).toHaveBeenCalledWith("yearBuilt", "1985");
  });
});

// Commercial subtype-preset persist (design 2026-07-13). When the parent
// threads a subtype preset via `templateFields`, the extra non-dedicated fields
// (nra, sprinklered, ...) render AND commit into a `metadata` envelope, while
// the dedicated columns stay at the top level. A residential/all-dedicated
// preset still emits a flat object (covered by the Finding-1 suite above).
describe("PropertyInfoForm commercial preset metadata split", () => {
  const officePreset = [
    { id: "yearBuilt", label: "Year built", type: "number" as const, group: "Identity" },
    { id: "nra", label: "Net rentable area", type: "number" as const, group: "Physical" },
    { id: "sprinklered", label: "Sprinklered", type: "select" as const, group: "Compliance", options: ["None", "Partial", "Full"] },
  ];

  it("renders subtype-preset fields passed via templateFields", () => {
    const { getByText } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} templateFields={officePreset} />,
    );
    expect(getByText("Net rentable area")).toBeTruthy();
    expect(getByText("Sprinklered")).toBeTruthy();
  });

  it("splits non-dedicated preset fields into a metadata envelope on commit", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(
      <PropertyInfoForm
        inspection={{ propertyType: "commercial", yearBuilt: 1998, nra: 42000 }}
        templateFields={officePreset}
        onCommit={onCommit}
      />,
    );
    fireEvent.blur(labelInput(container, "Net rentable area")!);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.yearBuilt).toBe(1998);
    expect(facts.metadata).toEqual({ nra: 42000, sprinklered: null });
  });

  it("emits a flat object (no metadata key) when every preset field is dedicated", () => {
    const onCommit = vi.fn();
    const dedicatedOnly = [
      { id: "yearBuilt", label: "Year built", type: "number" as const, group: "Identity" },
      { id: "sqft", label: "Building area", type: "number" as const, group: "Physical" },
    ];
    const { container } = renderPF(
      <PropertyInfoForm
        inspection={{ propertyType: "commercial", yearBuilt: 2001 }}
        templateFields={dedicatedOnly}
        onCommit={onCommit}
      />,
    );
    fireEvent.blur(labelInput(container, "Year built")!);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts).not.toHaveProperty("metadata");
    expect(facts.yearBuilt).toBe(2001);
  });
});

describe("PropertyInfoForm select commit", () => {
  it("commits foundationType on change (discrete select) with the full facts object", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential" }} onCommit={onCommit} />,
    );
    const select = Array.from(container.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "slab"),
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "slab" } });
    expect(onCommit).toHaveBeenCalledWith({
      yearBuilt: null,
      sqft: null,
      foundationType: "slab",
      lotSize: null,
      bedrooms: null,
      bathrooms: null,
      unit: null,
      county: null,
      temperatureF: null,
      weather: null,
    });
  });

  it("phone: a select is a radiogroup; picking commits it, tapping it again clears it", () => {
    const onCommit = vi.fn();
    const phone = renderPF(<PropertyInfoForm inspection={{ propertyType: "residential", foundationType: "slab" }} phone onCommit={onCommit} />);
    expect(phone.container.querySelector("select")).toBeNull();
    const slab = phone.getAllByRole("radio").find((b) => b.textContent === "slab")!;
    expect(slab.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(slab);
    expect((onCommit.mock.calls.at(-1)![0] as Record<string, unknown>).foundationType).toBeNull();
    fireEvent.click(phone.getAllByRole("radio").find((b) => b.textContent === "crawlspace")!);
    expect((onCommit.mock.calls.at(-1)![0] as Record<string, unknown>).foundationType).toBe("crawlspace");
  });
});

// #200 — "Fetch property details" autofill button. Relays the address to the
// editor BFF action; fills ONLY empty fields (never clobbers manual entry) and
// commits the merged snapshot; degrades with a clear message when unconfigured.
describe("PropertyInfoForm — Fetch property details (#200)", () => {
  function mountAutofill(
    actionResult: unknown,
    handlers: { onSave?: (id: string, v: unknown) => void; onCommit?: (f: Record<string, unknown>) => void },
  ) {
    const inspection: Record<string, unknown> = {
      propertyType: "single_family",
      propertyAddress: "123 Main St, Austin, TX 78701",
      bedrooms: "4", // already set — must NOT be overwritten
      // yearBuilt / sqft / etc. absent = empty = fillable
    };
    return renderPF(
      <PropertyInfoForm inspection={inspection} onSave={handlers.onSave} onCommit={handlers.onCommit} />,
      () => actionResult,
    );
  }

  it("fills only empty fields and never clobbers a value the inspector already set", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    mountAutofill(
      { intent: "autofill-property-facts", facts: { yearBuilt: 1990, bedrooms: 3 }, reason: null },
      { onSave, onCommit },
    );

    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("yearBuilt", 1990));
    expect(onSave).not.toHaveBeenCalledWith("bedrooms", 3);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ yearBuilt: 1990, bedrooms: 4 }));
    await waitFor(() => expect(screen.getByText(/filled 1 field/i)).toBeTruthy());
  });

  it("shows an 'unconfigured' message and commits nothing when the provider key is unset", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    mountAutofill({ intent: "autofill-property-facts", facts: null, reason: "NO_API_KEY" }, { onSave, onCommit });

    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));

    await waitFor(() => expect(screen.getByText(/is not set up for your company/i)).toBeTruthy());
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("PropertyInfoForm temperature/weather (condition fields)", () => {
  const commercialPresetWithoutTempWeather = [
    { id: "yearBuilt", label: "Year built", type: "number" as const, group: "Identity" },
    { id: "sqft", label: "Building area", type: "number" as const, group: "Physical" },
    { id: "county", label: "County", type: "text" as const, group: "Identity" },
  ];

  it("renders Temperature and Weather for residential and when templateFields lacks them", () => {
    const residential = renderPF(<PropertyInfoForm inspection={{ propertyType: "residential" }} />);
    expect(residential.getByText("Temp °F")).toBeTruthy();
    expect(residential.getByText("Weather")).toBeTruthy();
    residential.unmount();

    const commercial = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "commercial" }} templateFields={commercialPresetWithoutTempWeather} />,
    );
    expect(commercial.getByText("Temp °F")).toBeTruthy();
    expect(commercial.getByText("Weather")).toBeTruthy();
  });

  it("shows needed badge when empty, hides when filled, and hides when published even if empty", () => {
    const { container } = renderPF(<PropertyInfoForm inspection={{ propertyType: "residential" }} />);
    expect(container.querySelector('[data-testid="needed-temperatureF"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="needed-weather"]')).toBeTruthy();

    const { container: c2 } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential", temperatureF: 64, weather: "clear" }} />,
    );
    expect(c2.querySelector('[data-testid="needed-temperatureF"]')).toBeNull();
    expect(c2.querySelector('[data-testid="needed-weather"]')).toBeNull();

    const { container: c3 } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential", temperatureF: 0 }} />,
    );
    expect(c3.querySelector('[data-testid="needed-temperatureF"]')).toBeNull();

    const { container: c4 } = renderPF(
      <PropertyInfoForm inspection={{ propertyType: "residential", reportStatus: "published" }} />,
    );
    expect(c4.querySelector('[data-testid="needed-temperatureF"]')).toBeNull();
    expect(c4.querySelector('[data-testid="needed-weather"]')).toBeNull();
  });

  it("rounds temperature to integer on blur and commits with temperatureF alongside other fields", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} onCommit={onCommit} />);
    const input = labelInput(container, "Temp °F")!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "64.6" } });
    fireEvent.blur(input);
    const facts = onCommit.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(facts.temperatureF).toBe(65);
    expect(facts.yearBuilt).toBeNull();
    expect(facts.sqft).toBeNull();
    expect(facts.foundationType).toBeNull();
    expect(facts.lotSize).toBeNull();
    expect(facts.bedrooms).toBeNull();
    expect(facts.bathrooms).toBeNull();
    expect(facts.unit).toBeNull();
    expect(facts.county).toBeNull();
  });

  it("phone weather renders as radiogroup with four radios, clicking Rain calls onSave and onCommit, clicking selected clears it", () => {
    const onCommit = vi.fn();
    const { container } = renderPF(<Harness initial={{ propertyType: "residential" }} phone onCommit={onCommit} />);
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).toBeTruthy();
    expect(group?.getAttribute("aria-label")).toBe("Weather");
    const radios = within(group as HTMLElement).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    const rain = radios.find((b) => b.textContent?.toLowerCase().includes("rain"))!;
    expect(rain).toBeTruthy();
    fireEvent.click(rain);
    expect(rain.getAttribute("aria-checked")).toBe("true");
    expect((onCommit.mock.calls.at(-1)![0] as Record<string, unknown>).weather).toBe("rain");

    fireEvent.click(rain);
    expect(rain.getAttribute("aria-checked")).toBe("false");
    expect((onCommit.mock.calls.at(-1)![0] as Record<string, unknown>).weather).toBeNull();
  });

  it("desktop weather select has localized labels and raw id values", () => {
    const { container } = renderPF(<PropertyInfoForm inspection={{ propertyType: "residential" }} />);
    const selects = Array.from(container.querySelectorAll("select"));
    const weatherSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === "clear")) as HTMLSelectElement | undefined;
    expect(weatherSelect).toBeTruthy();
    const options = Array.from(weatherSelect!.options).filter((o) => o.value !== "");
    const values = options.map((o) => o.value).sort();
    expect(values).toEqual(["clear", "cloudy", "rain", "snow"]);
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain("Clear");
    expect(labels).toContain("Cloudy");
    expect(labels).toContain("Rain");
    expect(labels).toContain("Snow");
  });
});
