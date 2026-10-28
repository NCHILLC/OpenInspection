import { getMetadataPreset } from './commercial-subtypes';

export interface ProfileRow {
  id: string;
  group: string;
  label: string;
  value: string | number | null;
  unit: string | null;
}

export interface BuildingProfileInput {
  propertyType?: string | null;
  commercialSubtype?: string | null;
  propertyFacts?: Record<string, unknown> | null;
  yearBuilt?: number | null;
  sqft?: number | null;
  foundationType?: string | null;
  lotSize?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
}

/**
 * Commercial PCA Phase F — resolve the Building Profile display rows for the
 * report. Server-only so the `commercial-subtypes` presets never reach the
 * client bundle. Value precedence: the `property_facts` JSON envelope, then the
 * dedicated residential columns. Only preset-listed field ids surface (so a
 * propertyType with no preset returns []). Empty / undefined values are dropped
 * so the report renders only populated facts; the report layer decides
 * visibility. `group` defaults to 'identity' when a preset field omits it.
 */
export function resolveBuildingProfile(input: BuildingProfileInput): ProfileRow[] {
  if (!input.propertyType) return [];
  const preset = getMetadataPreset(input.propertyType, input.commercialSubtype ?? undefined);
  const facts = (input.propertyFacts ?? {}) as Record<string, unknown>;
  const dedicated: Record<string, unknown> = {
    yearBuilt: input.yearBuilt,
    sqft: input.sqft,
    foundationType: input.foundationType,
    lotSize: input.lotSize,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
  };
  return preset
    .map((f): ProfileRow => {
      const raw = facts[f.id] ?? dedicated[f.id] ?? null;
      const value = raw === '' || raw === undefined ? null : (raw as string | number | null);
      return { id: f.id, group: f.group ?? 'identity', label: f.label, value, unit: f.unit ?? null };
    })
    .filter((r) => r.value !== null);
}

/**
 * Resolve the on-site condition rows (temperature, weather) for the report.
 * These apply to every property type, so unlike `resolveBuildingProfile` they
 * depend on neither a preset nor `propertyType`. Only present values surface,
 * so a report with no recorded conditions adds no rows.
 */
export function resolveConditionRows(input: {
  temperatureF?: number | null;
  weather?: string | null;
}): ProfileRow[] {
  const rows: ProfileRow[] = [];
  if (input.temperatureF !== null && input.temperatureF !== undefined) {
    rows.push({ id: 'temperatureF', group: 'conditions', label: 'Temperature', value: input.temperatureF, unit: '°F' });
  }
  if (typeof input.weather === 'string' && input.weather !== '') {
    const weather = input.weather.charAt(0).toUpperCase() + input.weather.slice(1);
    rows.push({ id: 'weather', group: 'conditions', label: 'Weather', value: weather, unit: null });
  }
  return rows;
}
