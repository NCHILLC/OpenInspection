import { describe, it, expect } from 'vitest';
import { cloneByScope } from '../../../app/hooks/findings/shared';

describe('cloneByScope', () => {
    const src = {
        rating: 'SAT',
        notes: 'Roof in good condition.',
        photos: [{ key: 'photo1.jpg' }],
        tabs: { defects: [] },
        tags: ['follow-up'],
    };

    it('"rating" copies only rating', () => {
        expect(cloneByScope(src, 'rating')).toEqual({ rating: 'SAT' });
    });
    it('"rating_notes" copies rating + notes and leaves photos, defects and tags behind', () => {
        expect(cloneByScope(src, 'rating_notes')).toEqual({ rating: 'SAT', notes: 'Roof in good condition.' });
    });
    it('handles missing rating gracefully', () => {
        expect(cloneByScope({ notes: 'X' }, 'rating')).toEqual({});
    });
    it('handles missing notes in rating_notes scope', () => {
        expect(cloneByScope({ rating: 'MON' }, 'rating_notes')).toEqual({ rating: 'MON' });
    });
});
