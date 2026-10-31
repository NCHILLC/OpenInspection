/**
 * Pure reading of ISN's `GET /order/{id}` body into the facts OI keeps on an
 * inspection. No I/O: the people and inspectors it names are ISN ids, resolved
 * by `order-apply.ts`. Field names were taken off a live NCHI order (146,
 * 2026-10-24); ISN sends numbers as strings and blanks as "".
 */

type Order = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/**
 * ISN HTML-encodes display text (`Builder&#39;s`). One pass over the string, so
 * `&amp;#39;` decodes to the literal text `&#39;`, not to an apostrophe.
 */
export function decodeIsnText(s: string): string {
    return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (m, dec, hex, name) => {
        if (name) return NAMED[name.toLowerCase()] ?? m;
        const cp = dec ? Number(dec) : parseInt(hex, 16);
        return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    });
}
/** `str` for text OI stores or shows (names, address, notes), entity-decoded. */
const text = (v: unknown): string | null => {
    const s = str(v);
    return s === null ? null : decodeIsnText(s).trim() || null;
};
const int = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(str(v)?.replace(/,/g, ''));
    return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(str(v) ?? NaN);
    return Number.isFinite(n) ? n : null;
};
const cents = (v: unknown): number | null => {
    const n = num(typeof v === 'string' ? v.replace(/,/g, '') : v);
    return n === null ? null : Math.round(n * 100);
};

/** OI's foundation vocabulary (see getPropertyFacts) from ISN's free-text `foundationtype`. */
export function foundationFromIsn(v: unknown): 'basement' | 'slab' | 'crawlspace' | 'other' | null {
    const s = str(v)?.toLowerCase();
    if (!s) return null;
    if (s.includes('crawl')) return 'crawlspace';
    if (s.includes('basement')) return 'basement';
    if (s.includes('slab')) return 'slab';
    return 'other';
}

export interface IsnOrderFacts {
    /** Local wall-clock `YYYY-MM-DDTHH:MM:SS`, the format the wizard writes to `inspections.date`. */
    date: string | null;
    canceled: boolean;
    /** ISN's order number (`oid`), what NCHI's staff call the order by. */
    referenceNumber: string | null;
    propertyAddress: string | null;
    address: {
        addressStreet: string | null; addressCity: string | null; addressState: string | null;
        addressZip: string | null; addressCounty: string | null; addressLat: number | null; addressLng: number | null;
    };
    yearBuilt: number | null;
    sqft: number | null;
    foundationType: ReturnType<typeof foundationFromIsn>;
    /** ISN user ids, `inspector1` first (the lead). */
    inspectorIds: string[];
    serviceNames: string[];
    /** What ISN bills for the order (`totalfee`), and the fees it is made of. */
    totalCents: number | null;
    fees: { name: string; cents: number }[];
    clientId: string | null;
    buyersAgentId: string | null;
    sellersAgentId: string | null;
}

export function orderFacts(o: Order): IsnOrderFacts {
    const street = [text(o.address1), text(o.address2)].filter(Boolean).join(' ') || null;
    const city = text(o.city);
    const state = str(o.stateabbreviation);
    const zip = str(o.zip);
    const line2 = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const datetime = str(o.datetime);
    return {
        date: datetime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(datetime) ? datetime.replace(' ', 'T') : null,
        // A deleted order keeps canceled 'no' in ISN; only deleteddatetime (and show 'no') says it is gone.
        canceled: str(o.canceled) === 'yes' || str(o.deleteddatetime) !== null,
        referenceNumber: o.oid !== undefined && o.oid !== null && o.oid !== '' ? String(o.oid) : null,
        propertyAddress: street ? [street, line2].filter(Boolean).join(', ') : null,
        address: {
            addressStreet: street, addressCity: city, addressState: state, addressZip: zip,
            addressCounty: text(o.county), addressLat: num(o.latitude), addressLng: num(o.longitude),
        },
        yearBuilt: int(o.yearbuilt),
        sqft: int(o.squarefeet),
        foundationType: foundationFromIsn(o.foundationtype),
        inspectorIds: Array.from({ length: 10 }, (_, i) => str(o[`inspector${i + 1}`])).filter((v): v is string => !!v),
        serviceNames: Array.isArray(o.services)
            ? o.services.map((s) => text((s as Order)?.name)).filter((v): v is string => !!v)
            : [],
        totalCents: cents(o.totalfee),
        fees: Array.isArray(o.fees)
            ? o.fees.flatMap((x) => {
                const name = text((x as Order)?.name);
                const c = cents((x as Order)?.amount);
                return name && c ? [{ name, cents: c }] : [];
            })
            : [],
        clientId: str(o.client),
        buyersAgentId: str(o.buyersagent),
        sellersAgentId: str(o.sellersagent),
    };
}

/** Name, email, phone of an ISN client or agent record (the two use different keys). */
export function personFromIsn(p: Order | undefined): { name: string; email?: string; phone?: string } | null {
    if (!p) return null;
    const name = text(p.display) ?? text(p.displayname)
        ?? ([text(p.first) ?? text(p.firstname), text(p.last) ?? text(p.lastname)].filter(Boolean).join(' ') || null);
    if (!name) return null;
    const email = str(p.email);
    const phone = str(p.mobilephone) ?? str(p.workphone) ?? str(p.homephone);
    return { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}

/**
 * The inspections list's ready check for an inspection that came from ISN: the
 * order's services that are not on the inspection (OI has no service of that
 * name, so it was left off at create), and how many ISN inspectors have no OI
 * user. A warning only; it gates nothing (Aaron, 2026-10-23).
 */
export function isnReadyCheck(payload: Order, lineNames: string[], unmatchedInspectors: number | null) {
    const onInspection = new Set(lineNames.map((n) => n.trim().toLowerCase()));
    const f = orderFacts(payload);
    return {
        unmatchedServices: f.serviceNames.filter((n) => !onInspection.has(n.toLowerCase())),
        unmatchedInspectors: unmatchedInspectors ?? 0,
        // S3 conflict: a cancel OI did not follow because the report has writing
        // (order-apply.ts cancelIfUntouched). The list shows it when the row is not cancelled.
        canceledInIsn: f.canceled,
    };
}

const yesNo = (v: unknown): boolean | null => {
    const s = str(v)?.toLowerCase();
    return s === 'yes' ? true : s === 'no' ? false : null;
};

/**
 * What the inspection page's ISN card shows: the order facts OI keeps nowhere
 * else. Read-only; ISN owns them. ISN's id-valued fields (escrow officer,
 * insurance agent, refer reason, cost center, order type) are left out: showing
 * them needs a lookup per id.
 */
export function isnCardFields(o: Order) {
    const f = orderFacts(o);
    const mapUrl = str(o.mapurl);
    const where = f.address.addressLat !== null && f.address.addressLng !== null
        ? `${f.address.addressLat},${f.address.addressLng}` : f.propertyAddress;
    return {
        orderNumber: f.referenceNumber,
        reportNumber: str(o.reportnumber),
        canceled: f.canceled,
        accessCode: text(o.gatecode),
        occupied: yesNo(o.propertyoccupied),
        utilitiesOn: yesNo(o.utilitieson),
        crossStreets: text(o.majorcrossstreets),
        policyHolder: text(o.policyholder),
        policyNumber: text(o.policynumber),
        paid: yesNo(o.paid),
        signed: yesNo(o.signature),
        // ISN's own map link when it is https, else a maps search on the address.
        directionsUrl: mapUrl?.startsWith('https://') ? mapUrl
            : where ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(where)}` : null,
    };
}
