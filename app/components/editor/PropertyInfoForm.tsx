import { useMemo, useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { isDedicatedFactKey } from "~/lib/property-facts-keys";
import { m } from "~/paraglide/messages";
import { INSPECTION_WEATHER } from "../../../server/lib/inspection-weather";

interface MetadataField {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  group?: string;
  options?: string[];
  unit?: string;
  required?: boolean;
  integer?: boolean;
  optionLabels?: Record<string, string>;
}

// Field ids here MUST be persistable keys of PropertyFactsSchema
// (server/lib/validations/inspection/read.ts): yearBuilt, sqft, temperatureF,
// weather, foundationType, lotSize, bedrooms, bathrooms, unit, county.
// `reportTier`/`commercialSubtype` are owned by CommercialReportControls, not this form.
// `unit`/`county` are real text columns on `inspections` (autofilled at intake) and are
// now in PropertyFactsSchema, so edits here persist through the property-facts write.
function residentialFields(): MetadataField[] {
  return [
    { id: "yearBuilt", label: m.editor_property_field_year_built(), type: "number", group: m.editor_property_group_facts() },
    { id: "sqft", label: m.editor_property_field_sqft(), type: "number", group: m.editor_property_group_facts() },
    { id: "foundationType", label: m.editor_property_field_foundation(), type: "select", group: m.editor_property_group_facts(), options: ["basement", "slab", "crawlspace", "other"] },
    { id: "lotSize", label: m.editor_property_field_lot_size(), type: "text", group: m.editor_property_group_facts() },
    { id: "bedrooms", label: m.editor_property_field_bedrooms(), type: "number", group: m.editor_property_group_facts() },
    { id: "bathrooms", label: m.editor_property_field_bathrooms(), type: "number", group: m.editor_property_group_facts() },
    { id: "unit", label: m.editor_property_field_unit(), type: "text", group: m.editor_property_group_facts() },
    { id: "county", label: m.editor_property_field_county(), type: "text", group: m.editor_property_group_facts() },
  ];
}

// Commercial PCA inspections have no bedroom/bathroom counts; `sqft` reads as
// gross building area rather than a home's living area. A commercial property has
// a county but not a unit/suite, so `county` is present and `unit` is not.
function commercialFields(): MetadataField[] {
  return [
    { id: "yearBuilt", label: m.editor_property_field_year_built(), type: "number", group: m.editor_property_group_facts() },
    { id: "sqft", label: m.editor_property_field_building_area(), type: "number", group: m.editor_property_group_facts() },
    { id: "foundationType", label: m.editor_property_field_foundation(), type: "select", group: m.editor_property_group_facts(), options: ["basement", "slab", "crawlspace", "other"] },
    { id: "lotSize", label: m.editor_property_field_lot_size(), type: "text", group: m.editor_property_group_facts() },
    { id: "county", label: m.editor_property_field_county(), type: "text", group: m.editor_property_group_facts() },
  ];
}

function conditionFields(): MetadataField[] {
  return [
    { id: "temperatureF", label: m.editor_property_field_temperature(), type: "number", group: m.editor_property_group_facts(), unit: "°F", required: true, integer: true },
    { id: "weather", label: m.editor_property_field_weather(), type: "select", group: m.editor_property_group_facts(), options: [...INSPECTION_WEATHER], optionLabels: { clear: m.editor_property_weather_clear(), cloudy: m.editor_property_weather_cloudy(), rain: m.editor_property_weather_rain(), snow: m.editor_property_weather_snow() }, required: true },
  ];
}

function withConditionFields(fields: MetadataField[]): MetadataField[] {
  const result = [...fields];
  const existing = new Set(result.map((f) => f.id));
  const toAdd = conditionFields().filter((f) => !existing.has(f.id));
  if (toAdd.length === 0) return result;
  const sqftIndex = result.findIndex((f) => f.id === "sqft");
  if (sqftIndex >= 0) {
    result.splice(sqftIndex + 1, 0, ...toAdd);
  } else {
    result.push(...toAdd);
  }
  return result;
}

interface PropertyInfoFormProps {
  inspection: Record<string, unknown>;
  templateFields?: MetadataField[];
  propertyAddress?: string;
  // The phone's Inspection details screen (canvas S03): three fields to a row,
  // 48px controls, and select fields as a radiogroup a thumb can hit. The
  // address is already in the app bar there, so the form drops its own.
  phone?: boolean;
  // Optimistic, per-keystroke update for the parent's local state. Stores the
  // RAW value typed (a string for text/number/date, a boolean for checkboxes),
  // so the controlled input keeps exactly what the inspector typed — including a
  // transient "2." mid-decimal. Does NOT persist on its own.
  onSave?: (fieldId: string, value: unknown) => void;
  // Durable save. Fires on blur for text/number/date, on change for
  // select/boolean (discrete). Receives a FULL coerced snapshot of every field
  // (not a single field), so the parent can persist it through ONE shared
  // fetcher without field-to-field abort: each PATCH is a superset of any
  // in-flight one (mirrors PsqPanel.commitResponses; see
  // feedback_rr_shared_fetcher_abort). The parent wires this to the
  // `save-property-facts` route intent.
  onCommit?: (facts: Record<string, unknown>) => void;
}

export function PropertyInfoForm({ inspection, templateFields, propertyAddress, phone, onSave, onCommit }: PropertyInfoFormProps) {
  const defaultFields = inspection.propertyType === "commercial" ? commercialFields() : residentialFields();
  const baseFields = templateFields?.length ? templateFields : defaultFields;
  const metaFields = withConditionFields(baseFields);

  const filled = useMemo(() => metaFields.filter((f) => inspection[f.id]).length, [metaFields, inspection]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const f of metaFields) {
      const g = f.group || m.editor_property_group_general();
      if (!seen.has(g)) { seen.add(g); result.push(g); }
    }
    return result;
  }, [metaFields]);

  const fieldsByGroup = useCallback(
    (group: string) => metaFields.filter((f) => (f.group || m.editor_property_group_general()) === group),
    [metaFields],
  );

  // Coerce a field's CURRENT value into the shape PropertyFactsSchema expects.
  // Only ever runs on the commit path (never per-keystroke), so a transient
  // "2." never gets coerced back into the controlled input mid-typing.
  //   number  → empty/null/undefined → null, else Number() (decimals allowed)
  //   text/date/select → empty/null/undefined → null, else String()
  //   boolean → Boolean()
  // The value passed in is the raw string the input holds (or a boolean for
  // checkboxes); the server Zod validates ranges after this.
  function coerce(field: MetadataField, value: unknown): unknown {
    if (field.type === "boolean") return Boolean(value);
    if (value === "" || value === null || value === undefined) return null;
    if (field.type === "number") {
      if (field.integer) return Math.round(Number(value));
      return Number(value);
    }
    return String(value);
  }

  // Durable commit. Builds a FULL coerced snapshot of every field in metaFields:
  // the changed field takes its just-entered value; every other field is read
  // from the `inspection` prop (which the optimistic onSave has already
  // updated). Committing the whole object each time is what makes a single
  // shared fetcher abort-safe — a later PATCH is a superset of any in-flight
  // one, so a cancelled earlier submit loses no data.
  // Dedicated-column keys (yearBuilt, sqft, ...) go at the top level where the
  // service writes them to real columns; every other field is a commercial
  // subtype-preset extra (nra, floorCount, sprinklered, ...) that rides the
  // `metadata` envelope into the property_facts JSON column. The split is keyed
  // off the single shared DEDICATED_FACT_KEYS list. When the active preset has
  // no non-dedicated fields (every residential preset), `metadata` stays empty
  // and we emit a flat object — byte-for-byte the pre-envelope shape, so the
  // strip's superset-PATCH abort-safety and existing callers are unchanged.
  function commitAll(changedField: MetadataField, changedValue: unknown) {
    const dedicated: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    for (const f of metaFields) {
      const raw = f.id === changedField.id ? changedValue : inspection[f.id];
      const value = coerce(f, raw);
      if (isDedicatedFactKey(f.id)) dedicated[f.id] = value;
      else metadata[f.id] = value;
    }
    onCommit?.(Object.keys(metadata).length ? { ...dedicated, metadata } : dedicated);
  }

  // #200 — "Fetch property details": pull public-records facts for the address
  // and fill ONLY the fields the inspector hasn't already entered, so a lookup
  // never clobbers manual work. Rides the editor BFF action (autofill-property-
  // facts intent) via its own fetcher, then commits the merged snapshot through
  // the same save-property-facts path as manual edits.
  const autofillFetcher = useFetcher<{
    intent?: string;
    facts?: Record<string, unknown> | null;
    reason?: string | null;
  }>();
  const [autofillMsg, setAutofillMsg] = useState<string | null>(null);
  const addressString = (propertyAddress || (inspection.propertyAddress as string) || "").trim();
  const autofilling = autofillFetcher.state !== "idle";

  useEffect(() => {
    if (autofillFetcher.state !== "idle" || !autofillFetcher.data) return;
    const data = autofillFetcher.data;
    if (data.intent !== "autofill-property-facts") return;

    const facts = data.facts;
    if (!facts) {
      setAutofillMsg(
        data.reason === "NO_API_KEY"
          ? m.editor_property_autofill_unconfigured()
          : data.reason === "NOT_FOUND"
            ? m.editor_property_autofill_not_found()
            : m.editor_property_autofill_failed(),
      );
      return;
    }

    const dedicated: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    const filledLabels: string[] = [];
    for (const f of metaFields) {
      const current = inspection[f.id];
      const isEmpty = current === "" || current === null || current === undefined;
      const factVal = facts[f.id];
      let raw = current;
      if (isEmpty && factVal != null && factVal !== "") {
        raw = factVal;
        filledLabels.push(f.label);
        onSave?.(f.id, factVal); // optimistic — keep the controlled input in sync
      }
      const value = coerce(f, raw);
      if (isDedicatedFactKey(f.id)) dedicated[f.id] = value;
      else metadata[f.id] = value;
    }

    if (filledLabels.length) {
      onCommit?.(Object.keys(metadata).length ? { ...dedicated, metadata } : dedicated);
      setAutofillMsg(
        m.editor_property_autofill_filled({ count: filledLabels.length, fields: filledLabels.join(", ") }),
      );
    } else {
      setAutofillMsg(m.editor_property_autofill_none());
    }
    // Fires once per settled autofill response; metaFields/inspection/callbacks
    // are intentionally read fresh at fire time (RR fetcher-effect convention).
  }, [autofillFetcher.state, autofillFetcher.data]);

  function runAutofill() {
    setAutofillMsg(null);
    autofillFetcher.submit({ intent: "autofill-property-facts", addressString }, { method: "post" });
  }

  return (
    <div className={phone ? "" : "px-6 py-6 max-w-5xl"} data-testid="property-info-form">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
            {m.editor_property_progress({ filled, total: metaFields.length })}
          </p>
          {filled === metaFields.length && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[13px] font-bold bg-ih-ok-bg text-ih-ok-fg ring-1 ring-inset ring-ih-ok/30">
              {m.editor_property_complete()}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={phone ? "sr-only" : "text-2xl font-bold tracking-tight text-ih-fg-1"}>
            {(propertyAddress || inspection.propertyAddress as string) || m.editor_property_fallback()}
          </h2>
          <button
            type="button"
            onClick={runAutofill}
            disabled={addressString.length < 5 || autofilling}
            className="h-8 px-3 rounded-md border border-ih-border text-[15px] font-bold text-ih-primary-text hover:bg-ih-primary-tint disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {autofilling ? m.editor_property_autofill_loading() : m.editor_property_autofill_button()}
          </button>
        </div>
        {autofillMsg && <p className="mt-2 text-[15px] text-ih-fg-3">{autofillMsg}</p>}
      </header>

      {groups.map((g) => (
        <fieldset key={g} className="mb-6">
          <legend className="text-[14px] font-bold uppercase tracking-[0.15em] text-ih-fg-3 mb-2">{g}</legend>
          <div className={phone ? "grid grid-cols-3 gap-2.5" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"}>
            {fieldsByGroup(g).map((f) => {
              // A <label> would forward a tap on its text to the first radio.
              const Wrap = phone && f.type === "select" ? "div" : "label";
              return (
              <Wrap key={f.id} className={Wrap === "div" ? "block col-span-3" : "block"}>
                <span className="flex items-center gap-1 text-[13px] font-bold uppercase tracking-[0.18em] text-ih-fg-3">
                  <span>{f.label}</span>
                  {Boolean(inspection[`_prefilled_${f.id}`]) && (
                    <span className="text-[12px] font-semibold text-ih-primary-text normal-case tracking-normal">{m.editor_property_prefilled()}</span>
                  )}
                  {f.required && (inspection[f.id] === "" || inspection[f.id] === null || inspection[f.id] === undefined) && (inspection.reportStatus as string) !== "published" && (
                    <span data-testid={`needed-${f.id}`} className="normal-case tracking-normal text-[12px] font-bold px-2 py-0.5 rounded-full bg-ih-watch-bg text-ih-watch-fg ring-1 ring-inset ring-ih-watch/40">{m.editor_property_needed_to_publish()}</span>
                  )}
                </span>
                {(f.type === "text" || f.type === "number" || f.type === "date") && (
                  <input
                    type={f.type}
                    value={(inspection[f.id] as string | number) ?? ""}
                    onChange={(e) => onSave?.(f.id, e.target.value)}
                    onBlur={(e) => commitAll(f, e.target.value)}
                    placeholder={f.unit ?? "—"}
                    className={`ih-input mt-1 w-full${phone ? " h-12 text-[17px]" : ""}`}
                  />
                )}
                {f.type === "select" && phone && (
                  <div role="radiogroup" aria-label={f.label} className="mt-1 grid grid-cols-4 gap-1.5">
                    {(f.options ?? []).map((opt) => {
                      const on = inspection[f.id] === opt;
                      const label = f.optionLabels?.[opt] ?? opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          // Tapping the chosen one clears it, as the select's "—" does.
                          onClick={() => { const v = on ? "" : opt; onSave?.(f.id, v); commitAll(f, v); }}
                          className={`h-12 rounded-md border text-[15px] capitalize ${on ? "border-ih-primary bg-ih-primary-tint text-ih-primary-text font-bold" : "border-ih-border-strong text-ih-fg-2 font-semibold"}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {f.type === "select" && !phone && (
                  <select
                    value={(inspection[f.id] as string) ?? ""}
                    onChange={(e) => { onSave?.(f.id, e.target.value); commitAll(f, e.target.value); }}
                    className="ih-input mt-1 w-full"
                  >
                    <option value="">&mdash;</option>
                    {(f.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>{f.optionLabels?.[opt] ?? opt}</option>
                    ))}
                  </select>
                )}
                {f.type === "boolean" && (
                  <div className="mt-1 flex items-center h-10">
                    <input
                      type="checkbox"
                      checked={!!inspection[f.id]}
                      onChange={(e) => { onSave?.(f.id, e.target.checked); commitAll(f, e.target.checked); }}
                      className="h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                    />
                  </div>
                )}
              </Wrap>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
