/**
 * The Spectora adapter reads the file the export button produces.
 *
 * It did not. Its docblock described a four-bucket comment model mapped onto
 * three tabs, over a JSON object with a `sections` array. The export button
 * produces a SPREADSHEET, one row per canned comment, and marks each comment
 * info / limit / defect — which ARE our three tabs. So the adapter was written
 * against a different representation, and the mapping it made complicated is
 * the identity.
 */
import { describe, it, expect } from 'vitest';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { zipOf } from '../helpers/zip-fixture';

/**
 * The columns this reader needs, in the order the export carries them.
 *
 * The real export is 42 columns wide. The three after the comment type are not
 * adjacent to it there — the reader finds every column by its heading, so the
 * gap between them does not matter and this fixture leaves it out.
 *
 * The rest are photo slots, ordering, severity, units, estimates and
 * timestamps, which a template import does not consume.
 */
const HEADER = [
    'Section Name', 'Item Name', 'Comment Name', 'Comment Text',
    'Comment Type (info, limit, defect)',
    'Multiple Choice Options (comma-separated)',
    'Answer Type (boolean, checkbox, date, number, range, text)',
    'Default Value',
    'Category (-1: Low, 0: Med, 1: High)',
];

function sheetXml(rows: string[][]): string {
    const cell = (v: string, col: number, row: number) =>
        `<c r="${String.fromCharCode(65 + col)}${row}" t="str"><v>${v.replace(/&/g, '&amp;')}</v></c>`;
    const body = rows.map((r, i) =>
        `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join('')}</row>`).join('');
    return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

const workbook = (rows: string[][]): Promise<Uint8Array> =>
    zipOf({ 'xl/worksheets/sheet1.xml': sheetXml(rows) });

/**
 * The file that reaches this adapter after an operator opens the export in
 * Excel and re-saves it — to reorder rows or retype a comment, both ordinary
 * things to do to a template. Excel pools the cell text into a shared-string
 * table and points at it by index, which is a different shape from the export
 * button's own file. This is not a corrupt or hostile input; it's the one an
 * operator produces the moment they touch the file in the tool everyone has.
 */
function sharedStringWorkbook(rows: string[][]): Promise<Uint8Array> {
    const strings: string[] = [];
    const indexOf = (v: string): number => {
        const found = strings.indexOf(v);
        if (found >= 0) return found;
        strings.push(v);
        return strings.length - 1;
    };
    const cell = (v: string, col: number, row: number) =>
        `<c r="${String.fromCharCode(65 + col)}${row}" t="s"><v>${indexOf(v)}</v></c>`;
    const body = rows.map((r, i) =>
        `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join('')}</row>`).join('');
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
    const sst = `<?xml version="1.0"?><sst count="${strings.length}" uniqueCount="${strings.length}">`
        + strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('') + '</sst>';
    return zipOf({ 'xl/worksheets/sheet1.xml': sheet, 'xl/sharedStrings.xml': sst });
}

const THREE_ROWS = [
    HEADER,
    ['Roof', 'Covering', 'Worn', 'The covering is worn.', 'defect'],
    ['Roof', 'Flashing', 'OK', 'Flashing appears serviceable.', 'info'],
    ['Exterior', 'Siding', 'Limited', 'Access was limited.', 'limit'],
];

describe('spectoraAdapter.inspect — the real export', () => {
    it('reports sections, items and the identity vocabulary', async () => {
        const got = await spectoraAdapter.inspect?.(await workbook(THREE_ROWS));
        expect(got?.kind).toBe('template');
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(2);
        expect(got.items).toBe(3);
        expect(got.ratings).toEqual(['info', 'limit', 'defect']);
    });

    it('reports no template name, because this export carries none', async () => {
        // Null rather than a filename or a placeholder: the caller already has
        // the filename, and a placeholder is indistinguishable from a template
        // genuinely called that.
        const got = await spectoraAdapter.inspect?.(await workbook(THREE_ROWS));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.name).toBeNull();
        expect(got.ratingsShown).toBeNull();
    });

    it('counts an item once however many comments it carries', async () => {
        const got = await spectoraAdapter.inspect?.(await workbook([
            HEADER,
            ['Roof', 'Covering', 'A', 'text', 'info'],
            ['Roof', 'Covering', 'B', 'text', 'defect'],
        ]));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(1);
        expect(got.items).toBe(1);
    });

    it('returns null for a workbook without the expected header', async () => {
        expect(await spectoraAdapter.inspect?.(await workbook([
            ['Name', 'Email'], ['Alice', 'a@b.test'],
        ]))).toBeNull();
    });

    it('returns null for bytes that are not a workbook at all', async () => {
        expect(await spectoraAdapter.inspect?.(
            new TextEncoder().encode('Full Name,Email\nAlice,a@b.test'),
        )).toBeNull();
    });
});

describe('spectoraAdapter.convert — the real export', () => {
    it('puts each comment on the tab its type names', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        const [template] = result.bundle.templates;
        const roof = template!.schema.sections.find((s) => s.title === 'Roof');
        const covering = roof?.items.find((i) => i.label === 'Covering');
        const flashing = roof?.items.find((i) => i.label === 'Flashing');
        expect(covering?.tabs?.defects.map((d) => d.title)).toEqual(['Worn']);
        expect(flashing?.tabs?.information.map((c) => c.title)).toEqual(['OK']);
        const siding = template!.schema.sections
            .find((s) => s.title === 'Exterior')?.items[0];
        expect(siding?.tabs?.limitations.map((c) => c.title)).toEqual(['Limited']);
    });

    it('keeps the file\'s own order for sections and items', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        const schema = result.bundle.templates[0]!.schema;
        expect(schema.sections.map((s) => s.title)).toEqual(['Roof', 'Exterior']);
        expect(schema.sections[0]!.items.map((i) => i.label)).toEqual(['Covering', 'Flashing']);
    });

    it('an EMPTY comment type is NAMED, not dropped', async () => {
        // Sixty-five of the real file's 1872 comments have no type. Dropping
        // them is how a count says 1872 and a template holds 1807, with nothing
        // saying which went.
        const result = await spectoraAdapter.convert(await workbook([
            HEADER,
            ['Roof', 'Covering', 'Worn', 'Text.', 'defect'],
            ['Roof', 'Covering', 'Untyped', 'Text.', ''],
        ]), { name: 'T' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(JSON.stringify(result.bundle)).toMatch(/Untyped/);
        expect(result.bundle.manifest.warnings.map((w) => w.message).join(' ')).toMatch(/Untyped/);
    });

    it('an UNRECOGNISED comment type is named too, and says what it said', async () => {
        const result = await spectoraAdapter.convert(await workbook([
            HEADER,
            ['Roof', 'Covering', 'Odd', 'Text.', 'maybe'],
        ]), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        const warnings = result.bundle.manifest.warnings.map((w) => w.message).join(' ');
        expect(warnings).toMatch(/Odd/);
        expect(warnings).toMatch(/maybe/);
    });

    it('POSITIVE CONTROL — a fully typed file raises no warning', async () => {
        // Without this, the two assertions above pass identically for an
        // adapter that warns about every row.
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        expect(result.bundle.manifest.warnings).toEqual([]);
    });

    it('the accounting balances — nothing can be silently skipped', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'T' });
        if (!result.ok) throw new Error('unreachable');
        const counts = result.bundle.manifest.counts.template;
        expect(counts.readFromSource).toBe(counts.emitted + counts.dropped.length);
    });

    it('takes the template name from the caller, never from the file', async () => {
        const result = await spectoraAdapter.convert(await workbook(THREE_ROWS), { name: 'Chosen' });
        if (!result.ok) throw new Error('unreachable');
        expect(result.bundle.templates[0]!.name).toBe('Chosen');
    });

    it('refuses a workbook whose header is not this export\'s', async () => {
        const result = await spectoraAdapter.convert(await workbook([
            ['Name', 'Email'], ['Alice', 'a@b.test'],
        ]), { name: 'T' });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses an export with a header and no comment rows', async () => {
        // Distinct from the above and it has its own sentence: the operator
        // exported the right thing from the wrong place.
        const result = await spectoraAdapter.convert(await workbook([HEADER]), { name: 'T' });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('NO_SECTIONS');
    });

    it('reads a file an operator opened and RE-SAVED in Excel', async () => {
        // Re-saving pools every value into a shared-string table instead of
        // writing it inline — this is what broke before the reader resolved
        // `t="s"` cells: the header stopped matching anything and this file
        // was refused as NOT_AN_EXPORT even though it holds the real export's
        // own rows, untouched except for the tool that wrote the bytes.
        const result = await spectoraAdapter.convert(await sharedStringWorkbook(THREE_ROWS), { name: 'T' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        const schema = result.bundle.templates[0]!.schema;
        expect(schema.sections.map((s) => s.title)).toEqual(['Roof', 'Exterior']);
        const roof = schema.sections.find((s) => s.title === 'Roof');
        expect(roof?.items.find((i) => i.label === 'Covering')?.tabs?.defects.map((d) => d.title))
            .toEqual(['Worn']);
    });
});

/**
 * What the file says about a comment, beyond its text.
 *
 * These three columns were read by nothing, and the loss was invisible at the
 * import and obvious in the field: a comment offering a list of answers arrived
 * as a bare checkbox with no answers to check, and the comments the file marks
 * as on-by-default arrived off, so an inspector opened every report to the same
 * three boxes unticked. Both destinations already existed — `choices` and
 * `default` are template-schema fields the editor has always rendered.
 */
describe('spectoraAdapter.convert — what the file says about a comment', () => {
    const row = (
        name: string, type: string, choices: string, answerType: string, def: string,
        severity = '',
    ) => ['Roof', 'General', name, 'Body.', type, choices, answerType, def, severity];

    const itemFrom = async (rows: string[][]) => {
        const result = await spectoraAdapter.convert(await workbook([HEADER, ...rows]), { name: 'T' });
        if (!result.ok) throw new Error('conversion refused');
        return result.bundle.templates[0]!.schema.sections[0]!.items[0]!;
    };

    /** Every comment, whichever tab it landed on. */
    const built = async (rows: string[][]) => {
        const item = await itemFrom(rows);
        return [...item.tabs!.information, ...item.tabs!.limitations, ...item.tabs!.defects];
    };

    /** The defects only — a category is a defect's field, not a comment's. */
    const builtDefects = async (rows: string[][]) => (await itemFrom(rows)).tabs!.defects;

    it('gives a list-bearing comment the answers the file lists', async () => {
        const [comment] = await built([
            row('Utilities', 'info', 'All On, Water Off, Electric Off', 'checkbox', ''),
        ]);
        expect(comment!.choices).toEqual(['All On', 'Water Off', 'Electric Off']);
    });

    it('gives a defect its answers too — a list is not information-only', async () => {
        const [defect] = await builtDefects([
            row('Material', 'defect', 'Asphalt, Slate', 'checkbox', ''),
        ]);
        expect(defect!.choices).toEqual(['Asphalt', 'Slate']);
    });

    it('drops blank and duplicate options rather than rendering empty boxes', async () => {
        const [comment] = await built([
            row('Occupancy', 'info', 'Vacant, , Occupied,Vacant ,  ', 'checkbox', ''),
        ]);
        expect(comment!.choices).toEqual(['Vacant', 'Occupied']);
    });

    /**
     * A row can carry leftover text in the options column while being a plain
     * yes/no comment. Reading it anyway would put answers on a comment the
     * inspector never chose them for, so the ANSWER TYPE decides, not the text.
     */
    it('ignores options on a comment the file does not type as list-bearing', async () => {
        const [comment] = await built([
            row('Notes', 'info', 'left, over, text', 'boolean', ''),
        ]);
        expect(comment!.choices).toBeUndefined();
    });

    it('imports a comment the file marks on-by-default as included', async () => {
        const [on, off, blank] = await built([
            row('Scope', 'info', '', 'boolean', 'true'),
            row('Re-Inspection', 'info', '', 'boolean', 'false'),
            row('Addendum', 'info', '', 'boolean', ''),
        ]);
        expect(on!.default).toBe(true);
        // Off is the safe direction: a comment wrongly ON puts words in the
        // report that the inspector did not write.
        expect(off!.default).toBe(false);
        expect(blank!.default).toBe(false);
    });

    /**
     * The file grades how BAD a finding is; our categories say what KIND it is.
     * Three points onto three seeds is the only mapping that uses the column,
     * and the top grade lands on the one seed that drives the report Summary.
     */
    it('files a defect by the severity the file grades it', async () => {
        const [low, med, high] = await builtDefects([
            row('Worn trim', 'defect', '', 'boolean', '', '-1'),
            row('Cracked pane', 'defect', '', 'boolean', '', '0'),
            row('Dead tree on the service drop', 'defect', '', 'boolean', '', '1'),
        ]);
        expect(low!.category).toBe('maintenance');
        expect(med!.category).toBe('recommendation');
        expect(high!.category).toBe('safety');
    });

    it('leaves an ungraded or oddly-graded defect on the default', async () => {
        // Not a guess in either direction: filing it as the mildest hides it,
        // filing it as the worst floods the Summary.
        const [blank, odd] = await builtDefects([
            row('No grade', 'defect', '', 'boolean', '', ''),
            row('Odd grade', 'defect', '', 'boolean', '', '7'),
        ]);
        expect(blank!.category).toBe('recommendation');
        expect(odd!.category).toBe('recommendation');
    });

    it('still imports when the export omits the three columns entirely', async () => {
        // An older export, or a hand-built sheet. Every comment reads plain and
        // off, which is what it did before these columns were read at all.
        const short = ['Section Name', 'Item Name', 'Comment Name', 'Comment Text',
            'Comment Type (info, limit, defect)'];
        const result = await spectoraAdapter.convert(
            await workbook([short, ['Roof', 'General', 'Worn', 'Body.', 'defect']]), { name: 'T' },
        );
        if (!result.ok) throw new Error('conversion refused');
        const defect = result.bundle.templates[0]!.schema.sections[0]!.items[0]!.tabs!.defects[0]!;
        expect(defect.choices).toBeUndefined();
        expect(defect.default).toBe(false);
    });
});
