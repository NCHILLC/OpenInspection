import { describe, it, expect } from "vitest";
import { searchReport, countSearchResults } from "./report-search";

const SECTIONS = [
    {
        id: "s_roof",
        title: "Roof",
        items: [
            {
                id: "i_covering",
                label: "Roof Covering",
                tabs: {
                    information: [{ id: "n1", title: "Material", comment: "Architectural shingle." }],
                    limitations: [{ id: "l1", title: "Not walked", comment: "Roof was wet." }],
                    defects: [{ id: "d1", title: "Lifted shingle", comment: "Water intrusion likely." }],
                },
            },
            { id: "i_flashing", label: "Flashing", tabs: { defects: [{ id: "d2", title: "Rusted flashing", comment: "" }] } },
        ],
    },
    {
        id: "s_plumb",
        title: "Plumbing",
        items: [{ id: "i_heater", label: "Water Heater", tabs: { defects: [{ id: "d3", title: "TPR discharge", comment: "Terminates high." }] } }],
    },
];

/** rating/value/flag state, keyed "sectionId:itemId". */
function results(map: Record<string, { rating?: string; value?: unknown; flaggedIds?: string[] }>) {
    return (itemId: string, sectionId: string) => {
        const r = map[`${sectionId}:${itemId}`];
        if (!r) return undefined;
        return {
            rating: r.rating,
            value: r.value,
            tabs: { defects: (r.flaggedIds ?? []).map((id) => ({ cannedId: id, flagged: true })) },
        };
    };
}

const none = results({});

describe("searchReport — text", () => {
    it("matches a canned comment title", () => {
        const out = searchReport(SECTIONS, none, { text: "lifted" });
        expect(out).toHaveLength(1);
        expect(out[0].sectionTitle).toBe("Roof");
        expect(out[0].items[0].hits[0].title).toBe("Lifted shingle");
    });

    it("matches a canned comment body, not just its title", () => {
        const out = searchReport(SECTIONS, none, { text: "water intrusion" });
        expect(countSearchResults(out)).toBe(1);
        expect(out[0].items[0].hits[0].cannedId).toBe("d1");
    });

    it("matches an item label with no canned hit", () => {
        const out = searchReport(SECTIONS, none, { text: "water heater" });
        expect(countSearchResults(out)).toBe(1);
        expect(out[0].items[0].labelMatched).toBe(true);
    });

    it("is case- and whitespace-insensitive", () => {
        expect(countSearchResults(searchReport(SECTIONS, none, { text: "  RUSTED  " }))).toBe(1);
    });

    it("groups hits under their section and drops sections with none", () => {
        const out = searchReport(SECTIONS, none, { text: "shingle" });
        expect(out.map((s) => s.sectionId)).toEqual(["s_roof"]);
    });

    it("returns nothing for a query that matches nothing", () => {
        expect(searchReport(SECTIONS, none, { text: "asbestos" })).toEqual([]);
    });
});

describe("searchReport — kind filters partition template content", () => {
    it("limits hits to the chosen tabs", () => {
        const out = searchReport(SECTIONS, none, { text: "", kinds: ["defects"], incompleteOnly: true });
        const kinds = out.flatMap((s) => s.items.flatMap((i) => i.hits.map((h) => h.kind)));
        expect(new Set(kinds)).toEqual(new Set(["defects"]));
    });

    it("treats an empty kind list as all kinds, since a filter nobody set is not a filter", () => {
        const all = searchReport(SECTIONS, none, { text: "roof", kinds: [] });
        const dflt = searchReport(SECTIONS, none, { text: "roof" });
        expect(all).toEqual(dflt);
    });
});

describe("searchReport — state filters read the inspection, not the template", () => {
    const withState = results({
        "s_roof:i_covering": { rating: "Satisfactory", flaggedIds: ["d1"] },
        "s_plumb:i_heater": { value: "50 gal" },
    });

    it("Flagged keeps only items carrying the follow-up flag", () => {
        const out = searchReport(SECTIONS, withState, { text: "", flaggedOnly: true });
        expect(countSearchResults(out)).toBe(1);
        expect(out[0].items[0].itemId).toBe("i_covering");
    });

    // The question "what did I flag?" has no search text in it.
    it("returns items for a state filter with an empty query", () => {
        expect(countSearchResults(searchReport(SECTIONS, withState, { text: "", flaggedOnly: true }))).toBe(1);
    });

    // ...but an empty query with NO state filter is not a search at all.
    it("returns nothing for an empty query and no filters", () => {
        expect(searchReport(SECTIONS, withState, { text: "" })).toEqual([]);
    });

    // Incomplete reads isItemComplete — the same predicate as the progress ring.
    // i_covering is rated and i_heater holds a value, so only i_flashing is open.
    it("Incomplete agrees with the progress predicate, including non-rich values", () => {
        const out = searchReport(SECTIONS, withState, { text: "", incompleteOnly: true });
        const ids = out.flatMap((s) => s.items.map((i) => i.itemId));
        expect(ids).toEqual(["i_flashing"]);
    });

    it("combines text with a state filter", () => {
        const out = searchReport(SECTIONS, withState, { text: "rusted", incompleteOnly: true });
        expect(countSearchResults(out)).toBe(1);
        expect(out[0].items[0].itemId).toBe("i_flashing");
        expect(searchReport(SECTIONS, withState, { text: "lifted", incompleteOnly: true })).toEqual([]);
    });
});
