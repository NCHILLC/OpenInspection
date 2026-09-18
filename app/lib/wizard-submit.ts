import type { AddressSelection } from "~/routes/resources/places";
import { m } from "~/paraglide/messages";

/**
 * Re-exported here because the property-type vocabulary is part of THIS
 * contract: `propertyType` below is one of the fields the create endpoint
 * validates, and the wizard needs the list to pick its default. Defined once in
 * `server/lib/inspection-property-type.ts` — a literal retyped in the component
 * is how the selection came to be posted in a shape no endpoint accepted.
 */
export { INSPECTION_PROPERTY_TYPES } from "../../server/lib/inspection-property-type";

/**
 * The form body the New Inspection wizard posts.
 *
 * Pulled out of the component so the contract can be asserted directly rather
 * than through a rendered wizard: the fields here are exactly what
 * `/inspections`'s `create` intent reads, and a field silently dropped on this
 * side is a value the inspector typed and never saw again. Every value is a
 * string because this is submitted as form data.
 */
export interface WizardCreateState {
    propertyType: string;
    address: string;
    addressSel: AddressSelection | null;
    templateId: string;
    serviceIds: string[];
    /** serviceId → cents, for the lines whose price the inspector edited. */
    priceOverrides: Map<string, number>;
    date: string;
    time: string;
    timeZone: string;
    soloMode: boolean;
    inspectorId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    selectedAgentId: string | null;
    newAgentName: string;
    newAgentEmail: string;
}

export function buildWizardCreatePayload(s: WizardCreateState): Record<string, string> {
    // P-4: serviceSelections carries the per-row price overrides and is the
    // server's authoritative source; serviceIds stays for the plain case.
    const serviceSelectionsJson = JSON.stringify(
        s.serviceIds.map((id) => {
            const override = s.priceOverrides.get(id);
            return override !== undefined ? { serviceId: id, priceOverrideCents: override } : { serviceId: id };
        }),
    );

    return {
        intent: "create",
        propertyType: s.propertyType,
        address: s.address,
        // #198 — structured geocoded address. Empty strings when the inspector
        // typed a free-form address the API could not match; the server stamps
        // addressGeocodedAt itself.
        addressPlaceId: s.addressSel?.placeId ?? "",
        addressStreet: s.addressSel?.street ?? "",
        addressCity: s.addressSel?.city ?? "",
        addressState: s.addressSel?.state ?? "",
        addressZip: s.addressSel?.zip ?? "",
        addressCounty: s.addressSel?.county ?? "",
        addressLat: s.addressSel?.lat != null ? String(s.addressSel.lat) : "",
        addressLng: s.addressSel?.lng != null ? String(s.addressSel.lng) : "",
        templateId: s.templateId,
        serviceIds: s.serviceIds.join(","),
        serviceSelectionsJson,
        date: s.date,
        time: s.time,
        timeZone: s.timeZone,
        soloMode: String(s.soloMode),
        inspectorId: s.inspectorId,
        // IA-1 People step fields
        clientName: s.clientName,
        clientEmail: s.clientEmail,
        clientPhone: s.clientPhone,
        // An existing agent and a newly typed one are mutually exclusive: sending
        // both would have the server create a duplicate contact beside the link.
        agentContactId: s.selectedAgentId ?? "",
        newAgentName: s.selectedAgentId ? "" : s.newAgentName,
        newAgentEmail: s.selectedAgentId ? "" : s.newAgentEmail,
    };
}

/** What the `/inspections` action returns when it does NOT redirect. */
export interface WizardCreateResult {
    intent?: string;
    ok?: boolean;
    error?: { code?: string; message?: string; details?: { billingPortalUrl?: string | null } };
}

/**
 * The line to show the inspector when a create was refused, or null when it was
 * not refused at all.
 *
 * The counterpart to buildWizardCreatePayload above, and here for the same
 * reason it is: a refusal the wizard fails to read is a wizard that throws away
 * everything the inspector typed. It used to, for every code except
 * QUOTA_EXHAUSTED — the submit effect closed the wizard, which navigates to
 * /inspections, so one mistyped client email silently cost the address,
 * template, client, services and schedule.
 *
 * QUOTA_EXHAUSTED is excluded because it has its own panel with an upgrade CTA;
 * a banner would say less and duplicate it.
 */
export function wizardRefusalMessage(data: WizardCreateResult | undefined): string | null {
    if (data?.ok !== false || data.error?.code === "QUOTA_EXHAUSTED") return null;
    // The API names the field and the reason ("client.email: Invalid email
    // address") — the only thing that tells the inspector what to go and fix.
    return data.error?.message || m.new_inspection_create_failed();
}
