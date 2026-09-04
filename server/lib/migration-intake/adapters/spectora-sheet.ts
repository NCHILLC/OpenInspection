/**
 * The Spectora export as a SHEET: which column holds what, and how to read one
 * cell of a row. Everything about the file's own shape lives here; turning its
 * rows into a template is `spectora.ts`.
 *
 * Split out when reading three more columns pushed the adapter past the
 * file-size gate. The seam is the honest one — one half knows the format, the
 * other knows our template — and it is the half a format change touches.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: this file carries the FORMAT DISCRIMINATORS
 * (the column headings a reader must match to recognise the file at all) and
 * one REQUIRED ENUM. Each is annotated at its declaration. Nothing here
 * reproduces the product's section, item or comment vocabulary, which is theirs.
 */
import { readXlsxSheet } from '../formats/xlsx-sheet';

/**
 * The column headings that identify this file as this product's export.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. These are the strings a
 * reader must match to recognise the format at all. Minimum necessary literal
 * use — the list stops at what identifies the format and does not continue into
 * the product's own section, item or comment vocabulary, which is theirs.
 * Matched case-insensitively on the PREFIX, because several headings continue
 * into a parenthesised note.
 */
const REQUIRED_HEADERS = ['section name', 'item name', 'comment name', 'comment text'];

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. The heading of the
 * column holding the value below; a prefix, because the real heading continues
 * into a parenthesised list of its own values.
 */
const COMMENT_TYPE_HEADER = 'comment type';

/**
 * Three more headings this reader needs, matched on the same prefix rule.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. Each is the minimum
 * prefix that identifies one column; the real headings continue into a
 * parenthesised note listing that column's own values, which is theirs.
 *
 * Without these the import dropped what the file actually says about a comment:
 * a comment offering a list of answers arrived as a bare checkbox with no
 * answers, and one the file marks as on-by-default arrived off. Our own
 * `choices` and `default` fields already carry both — nothing was missing at
 * this end except the reading.
 */
const CHOICES_HEADER = 'multiple choice options';

/** ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. See CHOICES_HEADER. */
const ANSWER_TYPE_HEADER = 'answer type';

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. See CHOICES_HEADER.
 * A PREFIX, and deliberately the shorter of two: the export also carries a
 * "Default Value 2" for range answers, which sits to the right of this one, so
 * first-match resolves to the column meant here.
 */
const DEFAULT_VALUE_HEADER = 'default value';

/**
 * The answer-type value that means "this comment offers a list to pick from".
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: REQUIRED ENUM. One functional token the parser
 * must match to tell a list-bearing comment from a plain one.
 */
const CHOICE_ANSWER_TYPE = 'checkbox';

/**
 * The default-value cell's affirmative.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: REQUIRED ENUM. One functional token the parser
 * must match to tell an on-by-default comment from an off one.
 */
const AFFIRMATIVE_DEFAULT = 'true';

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. A prefix; the real
 * heading continues into a parenthesised note naming this column's own values.
 */
const SEVERITY_HEADER = 'category';

/**
 * The file's three-point severity, as a POSITION in the tenant's own ordered
 * defect categories.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: REQUIRED ENUM. Three functional tokens the
 * parser must match; the right-hand side is an index, not a name.
 *
 * A position and not a name because these categories are per-tenant and
 * renameable. The code seeds them `maintenance` / `recommendation` / `safety`,
 * and a real deployment had renamed all three to its own severity words — so an
 * adapter writing the seed names would have produced a category resolving to
 * NOTHING in that tenant. An unresolved category counts toward the report
 * Summary (a defect must never be silently dropped from it), so every imported
 * defect would have driven the Summary: the exact flood this column exists to
 * prevent.
 *
 * The two scales are also not the same axis, and aligning them is deliberate
 * rather than a discovered identity: the file grades how BAD a finding is, and
 * these categories say what KIND it is. Three ascending points onto three
 * ascending categories is the only mapping that uses the column at all.
 */
const SEVERITY_POSITION: Record<string, number> = {
    '-1': 0,
    '0': 1,
    '1': 2,
};

/**
 * The comment-type column's values.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: REQUIRED ENUM. Three short functional tokens
 * the parser must match to do anything at all. They happen to be our own three
 * tabs, so the mapping below is the identity — a coincidence of the format,
 * not a taxonomy taken from it.
 */
export const COMMENT_TYPES = ['info', 'limit', 'defect'] as const;
export type CommentType = typeof COMMENT_TYPES[number];

/**
 * Which of our tabs each of those values names. The identity, spelled out.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED on the right-hand side
 * — `information`, `limitations` and `defects` are OUR tab names. That they
 * line up one-to-one with the column's values is a coincidence of the format.
 */
export const TAB_FOR_COMMENT_TYPE: Record<CommentType, 'information' | 'limitations' | 'defects'> = {
    info: 'information',
    limit: 'limitations',
    defect: 'defects',
};

/** Where each thing this reader needs sits in the header row. */
export interface SheetColumns {
    section: number;
    item: number;
    commentName: number;
    commentText: number;
    /** -1 when the export omits the column entirely — every row then reads untyped. */
    commentType: number;
    /** -1 on an export without the column; the comment then offers no list. */
    choices: number;
    /** -1 on an export without the column; every row then reads as a plain comment. */
    answerType: number;
    /** -1 on an export without the column; every comment then imports off. */
    defaultValue: number;
    /** -1 on an export without the column; every defect then takes the default. */
    severity: number;
}

/**
 * The workbook as this reader understands it, or why it does not.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — our own refusal
 * codes, which the operator never sees; the sentences they map to are below.
 */
export type SpectoraSheet =
    | { ok: true; rows: string[][]; columns: SheetColumns }
    | { ok: false; code: 'NOT_AN_EXPORT' | 'NO_SECTIONS' };

/** The index of the first heading starting with `prefix`, or -1. */
function headerIndex(header: string[], prefix: string): number {
    return header.findIndex((cell) => cell.startsWith(prefix));
}

/**
 * The bytes as this export, or why they are not it.
 *
 * ONE shape test, shared by `inspect` and `convert`. `inspect` throws the
 * reason away and answers null; `convert` turns it into the sentence the
 * operator reads. A second copy of this test is how the two come to disagree
 * about what this product's file is — silently, because each has its own tests.
 */
export async function readSpectoraWorkbook(input: unknown): Promise<SpectoraSheet> {
    if (!(input instanceof Uint8Array)) return { ok: false, code: 'NOT_AN_EXPORT' };
    const rows = await readXlsxSheet(input);
    if (rows === null || rows.length === 0) return { ok: false, code: 'NOT_AN_EXPORT' };
    const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
    if (!REQUIRED_HEADERS.every((h) => header.some((cell) => cell.startsWith(h)))) {
        return { ok: false, code: 'NOT_AN_EXPORT' };
    }
    const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''));
    if (body.length === 0) return { ok: false, code: 'NO_SECTIONS' };
    return {
        ok: true,
        rows: body,
        columns: {
            section: headerIndex(header, REQUIRED_HEADERS[0]!),
            item: headerIndex(header, REQUIRED_HEADERS[1]!),
            commentName: headerIndex(header, REQUIRED_HEADERS[2]!),
            commentText: headerIndex(header, REQUIRED_HEADERS[3]!),
            commentType: headerIndex(header, COMMENT_TYPE_HEADER),
            choices: headerIndex(header, CHOICES_HEADER),
            answerType: headerIndex(header, ANSWER_TYPE_HEADER),
            defaultValue: headerIndex(header, DEFAULT_VALUE_HEADER),
            severity: headerIndex(header, SEVERITY_HEADER),
        },
    };
}

export function at(row: string[], column: number): string {
    return column < 0 ? '' : (row[column] ?? '').trim();
}

/**
 * The answers a comment offers, or undefined when it offers none.
 *
 * Only a comment the file TYPES as list-bearing gets them. The options column
 * is otherwise read as decoration: a row can carry leftover text there while
 * being a plain yes/no comment, and turning that into a pick-list would put
 * answers on a comment the inspector never chose them for.
 *
 * Comma-separated, and a comma is all the file gives — an option containing one
 * cannot be expressed in this format, so none is assumed to. Blanks and
 * duplicates are dropped rather than rendered as empty or repeated checkboxes.
 */
export function choicesFrom(row: string[], columns: SheetColumns): string[] | undefined {
    if (at(row, columns.answerType).toLowerCase() !== CHOICE_ANSWER_TYPE) return undefined;
    const seen = new Set<string>();
    for (const raw of at(row, columns.choices).split(',')) {
        const choice = raw.trim();
        if (choice) seen.add(choice);
    }
    return seen.size > 0 ? [...seen] : undefined;
}

/**
 * Whether the file says this comment starts included.
 *
 * Anything other than the affirmative reads as off, which is the safe
 * direction: a comment wrongly ON puts words in the report the inspector did
 * not write, and a comment wrongly OFF is one tap away.
 */
/**
 * The category a defect starts in, or undefined when the file does not grade it.
 *
 * `categories` is the tenant's own, in ascending grade order. Undefined comes
 * back for a row the file leaves ungraded, one graded with something this
 * reader does not know, or a tenant with fewer categories than the grade needs
 * — in every case the caller's default stands rather than a guess being filed
 * as the mildest or the worst.
 */
export function categoryFrom(
    row: string[], columns: SheetColumns, categories: readonly string[],
): string | undefined {
    const position = SEVERITY_POSITION[at(row, columns.severity)];
    return position === undefined ? undefined : categories[position];
}

export function defaultFrom(row: string[], columns: SheetColumns): boolean {
    return at(row, columns.defaultValue).toLowerCase() === AFFIRMATIVE_DEFAULT;
}
