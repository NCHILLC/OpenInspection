// @vitest-environment happy-dom
/**
 * Canvas X4: the phone's template chooser for an inspection with no sections.
 * The "Matches the order" tag may only appear where the template's name says it
 * fits the ordered property type, and Start inspection applies the picked one.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { EmptyTemplate, orderSummary, templateMatchesOrder } from "./PhoneTemplateChooser";

const TEMPLATES = [
    { id: "t-condo", name: "Condo/Townhome" },
    { id: "t-sfh", name: "Single-family home" },
    { id: "t-new", name: "New construction" },
];

function renderChooser(inspection: Record<string, unknown>) {
    const saved: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/edit",
            Component: () => <EmptyTemplate phone inspection={inspection} onChoose={() => {}} />,
            action: async ({ request }) => {
                saved.push(Object.fromEntries(await request.formData()) as Record<string, string>);
                // Not ok: a real success reloads the page, which a test must not do.
                return { ok: false, intent: "save-settings" };
            },
        },
        { path: "/resources/template-search", loader: () => ({ templates: TEMPLATES, hasMore: false, page: 1, totalPages: 1 }) },
    ]);
    render(<Stub initialEntries={["/edit"]} />);
    return saved;
}

describe("templateMatchesOrder", () => {
    it("matches on the words the template's name uses for the property type", () => {
        expect(templateMatchesOrder("Condo/Townhome", "multi_unit")).toBe(true);
        expect(templateMatchesOrder("Single-family home", "single_family")).toBe(true);
        expect(templateMatchesOrder("Single-family home", "multi_unit")).toBe(false);
        expect(templateMatchesOrder("Commercial ASTM", "commercial")).toBe(true);
    });
    it("matches nothing when the property type is unknown", () => {
        expect(templateMatchesOrder("Condo/Townhome", null)).toBe(false);
        expect(templateMatchesOrder("Condo/Townhome", "")).toBe(false);
    });
});

describe("orderSummary", () => {
    it("builds the line from the fields the inspection has and leaves out the rest", () => {
        expect(orderSummary({ propertyType: "multi_unit", sqft: 1240, yearBuilt: 2006 })).toEqual(["Ordered: Multi-unit", "1,240 sq ft", "Built 2006"]);
        expect(orderSummary({ sqft: null, yearBuilt: null })).toEqual([]);
        expect(orderSummary({ propertyType: "commercial" })).toEqual(["Ordered: Commercial"]);
    });
});

describe("PhoneTemplateChooser", () => {
    it("tags only the template that fits the order", async () => {
        renderChooser({ propertyType: "multi_unit", sqft: 1240 });
        await screen.findByRole("radio", { name: /Condo\/Townhome/ });
        expect(screen.getAllByText("Matches the order")).toHaveLength(1);
        expect(screen.getByRole("radio", { name: /Condo\/Townhome/ }).textContent).toContain("Matches the order");
        expect(screen.getByRole("radio", { name: /Single-family/ }).textContent).not.toContain("Matches the order");
        expect(screen.getByText("No checklist yet")).toBeTruthy();
        expect(screen.getByText("1,240 sq ft")).toBeTruthy();
        expect(screen.getByText("You can change the template later from the inspection's More menu.")).toBeTruthy();
    });

    it("shows no tag at all when the inspection says nothing about what was ordered", async () => {
        renderChooser({});
        await screen.findByRole("radio", { name: /Condo\/Townhome/ });
        expect(screen.queryByText("Matches the order")).toBeNull();
    });

    it("Start inspection waits for a pick, then applies that template", async () => {
        const saved = renderChooser({ propertyType: "multi_unit" });
        const start = await screen.findByRole("button", { name: /Start inspection/ });
        expect((start as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(await screen.findByRole("radio", { name: /New construction/ }));
        expect((start as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(start);
        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0].intent).toBe("save-settings");
        expect(JSON.parse(saved[0].payload)).toEqual({ templateId: "t-new" });
    });
});

describe("EmptyTemplate on the desktop", () => {
    it("keeps the single Choose a template button", () => {
        const Stub = createRoutesStub([{ path: "/", Component: () => <EmptyTemplate phone={false} inspection={{}} onChoose={() => {}} /> }]);
        render(<Stub />);
        expect(screen.getByRole("button", { name: "Choose a template" })).toBeTruthy();
    });
});
