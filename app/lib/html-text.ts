/**
 * Canned comment bodies are authored in a RICH TEXT editor, so they are stored
 * as HTML. The editor's comment rows render them as text, which means React
 * escapes the markup and the inspector reads a literal `<p>` around every
 * paragraph.
 *
 * These rows are a compact PREVIEW of the comment, so the answer is readable
 * text rather than rendered markup: injecting stored HTML into the editor would
 * trade an ugly row for an injection surface, and formatting buys nothing in a
 * two-line preview. The published report renders the real markup elsewhere.
 */

/** The named entities a rich-text editor actually emits. Numeric forms are
 *  handled generically below. */
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/**
 * Readable plain text from stored comment HTML.
 *
 * Block boundaries become spaces rather than vanishing — without that,
 * `<p>One</p><p>Two</p>` reads as "OneTwo". Entities are decoded AFTER tags are
 * stripped, so an encoded `&lt;p&gt;` in the author's prose survives as visible
 * text instead of being mistaken for markup and removed.
 */
export function htmlToPlainText(input: string): string {
    if (!input) return '';
    return input
        .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}
