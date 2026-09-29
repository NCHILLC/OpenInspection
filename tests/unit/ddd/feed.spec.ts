import { describe, it, expect } from 'vitest';
import { sectionsForFilter } from '../../../app/lib/report-helpers';
import { dddReviewLink } from '../../../server/ddd/link';
import { severityOf, summaryFindings } from '../../../server/ddd/summary';

/**
 * Data Driven Direction's findings feed and review link (fork-only; docs/develop/fork-log.md).
 * The feed must return exactly what the report's own Summary shows, and the link must verify
 * on DDD's side, so both are pinned against the other half here.
 */

const defect = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `Defect ${id}`, included: true, drivesSummary: true, effectiveComment: `Comment ${id}.`,
    effectiveCategory: 'Moderate', effectiveLocation: null, effectiveTrade: null, defectPhotos: [], ...over,
});

const sections = [
    {
        id: 's1', title: 'Exterior', items: [
            {
                id: 'i1', label: 'Deck', resolvedTabs: {
                    defects: [
                        defect('d1', {
                            effectiveLocation: 'Rear', effectiveTrade: 'deck contractor',
                            defectPhotos: [{ key: 't/inspections/x/a.jpg', url: 't/inspections/x/a.jpg' }, { key: 't/inspections/x/clip.mp4', url: '' }],
                        }),
                        defect('d2', { included: false }),
                        defect('d3', { drivesSummary: false, effectiveCategory: 'Maintenance' }),
                    ],
                },
            },
            { id: 'i2', label: 'Siding', resolvedTabs: { defects: [defect('d4', { drivesSummary: undefined, effectiveCategory: 'Safety/Major' })] } },
        ],
    },
    { id: 's2', title: 'Roof', items: [{ id: 'i3', label: 'Covering', resolvedTabs: { defects: [defect('d5', { included: false })] } }] },
];

describe('DDD findings feed', () => {
    it('returns the findings the report Summary shows, in its order', () => {
        const summary = sectionsForFilter(sections, 'summary').flatMap((s) =>
            s.items.flatMap((item) => (item.resolvedTabs?.defects ?? []).map((d) => `${s.id}:${item.id}:${d.id}`)));
        expect(summaryFindings(sections).map((f) => f.findingKey)).toEqual(summary);
        expect(summary).toEqual(['s1:i1:d1', 's1:i2:d4']);
    });

    it('carries the text, location, trade and a Section::Item::Comment key, and only real photos', () => {
        const [deck] = summaryFindings(sections);
        expect(deck).toEqual({
            findingKey: 's1:i1:d1', defectKey: 'Exterior::Deck::Defect d1', section: 'Exterior', item: 'Deck',
            title: 'Defect d1', text: 'Comment d1.', severity: 'moderate', location: 'Rear', trade: 'deck contractor',
            photoKeys: ['t/inspections/x/a.jpg'],
        });
    });

    it('reads a category name as one of three severities, defaulting to minor', () => {
        expect(['Safety/Major', 'safety', 'Moderate', 'recommendation', 'Minor', 'maintenance', undefined].map(severityOf))
            .toEqual(['safety', 'safety', 'moderate', 'moderate', 'minor', 'minor', 'minor']);
    });
});

describe('DDD review link', () => {
    it('is absent unless both the site URL and the secret are set', async () => {
        expect(await dddReviewLink({}, 'x')).toBeNull();
        expect(await dddReviewLink({ DDD_SITE_URL: 'https://ddd.test' }, 'x')).toBeNull();
        expect(await dddReviewLink({ DDD_LINK_SECRET: 's' }, 'x')).toBeNull();
    });

    it('matches the test vector Data Driven Direction verifies (tests/client.test.ts there)', async () => {
        expect(await dddReviewLink({ DDD_SITE_URL: 'https://ddd.test/', DDD_LINK_SECRET: 'test-link-secret' }, '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'))
            .toBe('https://ddd.test/c/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90.4R8G_b983jMC8TilK5UWA0cxrodUaJGWEFk8FMaF8KQ');
    });
});
