/**
 * Pure reading of ISN's `GET /order/{id}` body into the facts OI keeps on an
 * inspection. No I/O: the people and inspectors it names are ISN ids, resolved
 * by `order-apply.ts`. Field names were taken off a live NCHI order (146,
 * 2026-10-24); ISN sends numbers as strings and blanks as "".
 */

type Order = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(str(v)?.replace(/,/g, ''));
    return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(str(v) ?? NaN);
    return Number.isFinite(n) ? n : null;
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
    clientId: string | null;
    buyersAgentId: string | null;
    sellersAgentId: string | null;
}

export function orderFacts(o: Order): IsnOrderFacts {
    const street = [str(o.address1), str(o.address2)].filter(Boolean).join(' ') || null;
    const city = str(o.city);
    const state = str(o.stateabbreviation);
    const zip = str(o.zip);
    const line2 = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const datetime = str(o.datetime);
    return {
        date: datetime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(datetime) ? datetime.replace(' ', 'T') : null,
        canceled: str(o.canceled) === 'yes',
        referenceNumber: o.oid !== undefined && o.oid !== null && o.oid !== '' ? String(o.oid) : null,
        propertyAddress: street ? [street, line2].filter(Boolean).join(', ') : null,
        address: {
            addressStreet: street, addressCity: city, addressState: state, addressZip: zip,
            addressCounty: str(o.county), addressLat: num(o.latitude), addressLng: num(o.longitude),
        },
        yearBuilt: int(o.yearbuilt),
        sqft: int(o.squarefeet),
        foundationType: foundationFromIsn(o.foundationtype),
        inspectorIds: Array.from({ length: 10 }, (_, i) => str(o[`inspector${i + 1}`])).filter((v): v is string => !!v),
        serviceNames: Array.isArray(o.services)
            ? o.services.map((s) => str((s as Order)?.name)).filter((v): v is string => !!v)
            : [],
        clientId: str(o.client),
        buyersAgentId: str(o.buyersagent),
        sellersAgentId: str(o.sellersagent),
    };
}

/** Name, email, phone of an ISN client or agent record (the two use different keys). */
export function personFromIsn(p: Order | undefined): { name: string; email?: string; phone?: string } | null {
    if (!p) return null;
    const name = str(p.display) ?? str(p.displayname)
        ?? ([str(p.first) ?? str(p.firstname), str(p.last) ?? str(p.lastname)].filter(Boolean).join(' ') || null);
    if (!name) return null;
    const email = str(p.email);
    const phone = str(p.mobilephone) ?? str(p.workphone) ?? str(p.homephone);
    return { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}
