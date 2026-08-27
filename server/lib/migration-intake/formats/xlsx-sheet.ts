import { logger } from '../../logger';
import { readZipEntry } from './zip';

/**
 * The parts of the workbook format this reader names.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: PUBLIC STANDARD VALUE. The archive path of the
 * first worksheet and the element that holds its rows are both named by the
 * published spreadsheet specification, not by any product.
 */
const OOXML = {
    firstWorksheet: 'xl/worksheets/sheet1.xml',
    sharedStrings: 'xl/sharedStrings.xml',
    sheetData: '<sheetData',
} as const;

/**
 * The workbook's shared-string table, resolved to plain text by position.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The real export writes every value inline (`t="str"`) and this file has no
 * `sharedStrings.xml` at all — `readZipEntry` answers null and this is `[]`.
 * A workbook a person re-saved in Excel is a DIFFERENT writer: Excel pools
 * repeated text into this table and points at it with `t="s"` cells whose
 * `<v>` is an INDEX, not a value. A reader that only reads `<v>` literally
 * sees `0`, `1`, `2`... where the header names were, which is indistinguishable
 * from a workbook this reader has never seen the shape of.
 *
 * Each `<si>` entry can hold one plain `<t>`, or several `<r><t>` runs when the
 * cell mixes formatting within one string — both are joined before decoding,
 * because the runs are the ONE string split by formatting, not several.
 */
async function readSharedStrings(bytes: Uint8Array): Promise<string[]> {
    const xml = await readZipEntry(bytes, OOXML.sharedStrings);
    if (xml === null) return [];
    const text = new TextDecoder().decode(xml);
    const strings: string[] = [];
    for (const siXml of text.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        let joined = '';
        for (const tXml of siXml[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) joined += tXml[1]!;
        strings.push(decodeCellText(joined));
    }
    return strings;
}

/**
 * The first worksheet of an XLSX, as rows of strings.
 *
 * ── Why this exists rather than a library ───────────────────────────────────
 * The Worker bundle ceiling is 3 MiB gzipped and a self-hosted deploy fails
 * above it. The spreadsheet library already in this repository is a
 * Node-oriented browser build used client-side. What a vendor export needs is
 * one sheet, no styles, no formulas — which is this file.
 *
 * ── What a real export taught this reader ───────────────────────────────────
 * Two things a generated workbook would not have shown:
 *
 *  1. `sharedStrings.xml` can be EMPTY, every value inline as `t="str"` with a
 *     `<v>`. A reader built against shared strings sees a blank sheet, reports
 *     zero sections, and is not obviously broken.
 *  2. Text can be escaped TWICE — the XML holds `&amp;amp;`. The exporting
 *     product escapes its own stored content and the XML writer escapes that,
 *     so a single decode leaves an entity where a section name should be.
 *
 * Both are the exporting product's, not the format's, and neither is guessable.
 *
 * ── What an EDITED export taught this reader ────────────────────────────────
 * A workbook opened and re-saved in Excel is not the same writer: Excel uses
 * the shared-string table the real export leaves empty, and marks those cells
 * `t="s"` with an index in place of a value. Resolving it is the one case this
 * reader must handle even though the export itself never produces it — an
 * operator editing the file in the one tool everyone has is not a hostile
 * input, it is the expected way this file gets a template's comments retyped.
 */
export async function readXlsxSheet(bytes: Uint8Array): Promise<string[][] | null> {
    const xml = await readZipEntry(bytes, OOXML.firstWorksheet);
    if (xml === null) return null;
    const text = new TextDecoder().decode(xml);
    if (!text.includes(OOXML.sheetData)) return null;
    const sharedStrings = await readSharedStrings(bytes);

    const rows: string[][] = [];
    let width = 0;
    for (const rowXml of text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cellXml of rowXml[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
            const attrs = cellXml[1]!;
            const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
            if (!ref) continue;
            const index = columnIndex(ref);
            const type = attrs.match(/\bt="([a-zA-Z]+)"/)?.[1] ?? '';
            const raw = cellXml[2]!.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
            while (cells.length < index) cells.push('');
            cells[index] = type === 's' ? (sharedStrings[Number(raw)] ?? '') : decodeCellText(raw);
        }
        width = Math.max(width, cells.length);
        rows.push(cells);
    }
    // Pad short rows so a column index means the same thing on every row. A
    // ragged result makes "column 5 is the comment type" true only sometimes,
    // and the row it is false on is the one nobody checks.
    for (const row of rows) while (row.length < width) row.push('');
    if (rows.length === 0) {
        logger.warn('[intake] worksheet parsed with no rows');
        return null;
    }
    return rows;
}

/** `A` → 0, `Z` → 25, `AA` → 26. Column letters are base-26 with no zero digit. */
function columnIndex(letters: string): number {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/**
 * One pass of XML entity decoding.
 *
 * ⚠️ `&amp;` is replaced LAST. Replacing it first turns `&amp;lt;` into `&lt;`
 * and then into `<` within the same pass — two passes' worth of decoding done
 * in one, which would make the bound below meaningless.
 */
function decodeOnce(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Whether a string still carries one of the five entities decoding handles. */
const ENTITY = /&(lt|gt|quot|apos|amp);/;

/**
 * A cell's text, decoded AT MOST TWICE.
 *
 * Twice, not once and not to a fixed point, and the number is the observed
 * escaping depth rather than a convenience. Once is too few: the real export
 * holds `&amp;amp;`, and stopping there prints `&amp;` in the middle of a
 * section name. A fixed point is too many and has no floor — it would take a
 * cell whose genuine content is the TEXT `&amp;` all the way down to `&`, and
 * nothing would stop it.
 *
 * So the cost of this rule is exactly one case: a cell whose true content is a
 * single-escaped entity. That has never been observed, while the double
 * escaping is in every export measured, and a bounded rule can be re-measured
 * where an unbounded one cannot.
 */
function decodeCellText(s: string): string {
    const once = decodeOnce(s);
    return ENTITY.test(once) ? decodeOnce(once) : once;
}
