/**
 * A defect's stored category is an id OR a name, and both have to resolve.
 *
 * Seed template JSON stores names ("safety"); a template authored after Plan-4
 * stores a `defect_categories.id`; and `DefectFieldsRow` — the control an
 * inspector actually uses to set a severity — stores the id. So every consumer
 * has to accept either, and the two lookups below are keyed both ways.
 *
 * The NAME map exists because the report chip printed the stored value
 * verbatim: the colour lookup already resolved id-or-name, the label did not,
 * and so every hand-set severity rendered its raw uuid to the client beside a
 * correctly coloured chip.
 */
export interface DefectCategoryRow { id: string; name: string; color: string }

export function categoryKeyMaps(categories: DefectCategoryRow[]): {
    color: Map<string, string>;
    name: Map<string, string>;
} {
    const color = new Map<string, string>();
    const name = new Map<string, string>();
    for (const cat of categories) {
        color.set(cat.name, cat.color);
        color.set(cat.id, cat.color);
        name.set(cat.name, cat.name);
        name.set(cat.id, cat.name);
    }
    return { color, name };
}
