import { describe, it, expect } from 'vitest';
import { resolveBuildingProfile, resolveConditionRows } from '../../../server/lib/building-profile';

describe('resolveBuildingProfile', () => {
  it('returns [] when propertyType is null', () => {
    expect(resolveBuildingProfile({ propertyType: null })).toEqual([]);
  });

  it('returns [] for a propertyType with no matching preset', () => {
    expect(resolveBuildingProfile({ propertyType: 'townhouse', propertyFacts: { yearBuilt: 1975 } })).toEqual([]);
  });

  // Phase T root-cause fix — inspections store the underscore wizard slug
  // (single_family/multi_unit), but METADATA_PRESETS is hyphen-keyed. Before
  // normalizePropertyType was wired into getMetadataPreset, this returned []
  // for EVERY residential/multi-unit inspection (Building Profile dormant).
  it('resolves single-family rows for the underscore wizard slug single_family (was [])', () => {
    const rows = resolveBuildingProfile({ propertyType: 'single_family', yearBuilt: 1975, sqft: 2100 });
    expect(rows).not.toEqual([]);
    expect(rows.find((r) => r.id === 'yearBuilt')?.value).toBe(1975);
    expect(rows.find((r) => r.id === 'sqft')?.value).toBe(2100);
  });

  it('resolves multi-unit rows for the underscore wizard slug multi_unit (was [])', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'multi_unit',
      propertyFacts: { yearBuilt: 1988, totalUnits: 12 },
    });
    expect(rows).not.toEqual([]);
    expect(rows.find((r) => r.id === 'totalUnits')?.value).toBe(12);
  });

  it('resolves commercial office rows from propertyFacts, ordered by preset, null values dropped', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'commercial',
      commercialSubtype: 'office',
      propertyFacts: { yearBuilt: 1998, nra: 120000, floorCount: 6 }, // occupancyClass/sprinklered/lastRenovation absent
    });
    expect(rows).toEqual([
      { id: 'yearBuilt', group: 'identity', label: 'Year built', value: 1998, unit: null },
      { id: 'nra', group: 'physical', label: 'Net rentable area', value: 120000, unit: 'sqft' },
      { id: 'floorCount', group: 'physical', label: 'Number of floors', value: 6, unit: null },
    ]);
  });

  it('treats empty string as absent', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'commercial', commercialSubtype: 'office',
      propertyFacts: { yearBuilt: 1998, occupancyClass: '' },
    });
    expect(rows.some((r) => r.id === 'occupancyClass')).toBe(false);
    expect(rows.map((r) => r.id)).toEqual(['yearBuilt']);
  });

  it('falls back to the dedicated residential columns for a matching residential preset key', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'single-family', // METADATA_PRESETS key (hyphen)
      propertyFacts: null,
      yearBuilt: 1975, sqft: 2100,
    });
    expect(rows.find((r) => r.id === 'yearBuilt')?.value).toBe(1975);
    expect(rows.find((r) => r.id === 'sqft')?.value).toBe(2100);
  });

  it('resolves the foundation row from the dedicated foundation_type column (single-family)', () => {
    // Regression: the single-family preset field id must match the dedicated
    // map key `foundationType` (which carries the inspections.foundation_type
    // column value), or the Foundation row silently drops from the Building
    // Profile even when foundation_type is set. See #234 follow-up.
    const rows = resolveBuildingProfile({
      propertyType: 'single-family',
      propertyFacts: null,
      yearBuilt: 1975,
      foundationType: 'Basement',
    });
    expect(rows.find((r) => r.id === 'foundationType')?.value).toBe('Basement');
  });

  describe('resolveConditionRows', () => {
    it('both present -> two rows with ids temperatureF/weather, group \'conditions\', unit \'°F\' and weather capitalized (\'rain\' -> \'Rain\')', () => {
      const rows = resolveConditionRows({ temperatureF: 72, weather: 'rain' });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 'temperatureF', group: 'conditions', label: 'Temperature', value: 72, unit: '°F' });
      expect(rows[1]).toEqual({ id: 'weather', group: 'conditions', label: 'Weather', value: 'Rain', unit: null });
    });

    it('only temperature 0 -> one row (zero is a value)', () => {
      const rows = resolveConditionRows({ temperatureF: 0 });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('temperatureF');
      expect(rows[0].value).toBe(0);
    });

    it('nothing recorded -> []', () => {
      expect(resolveConditionRows({})).toEqual([]);
    });

    it('works with no propertyType (it never needs one)', () => {
      const rows = resolveConditionRows({ temperatureF: 65, weather: 'clear' });
      expect(rows).toHaveLength(2);
    });
  });
});
