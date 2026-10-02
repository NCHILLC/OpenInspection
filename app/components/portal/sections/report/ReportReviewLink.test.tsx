// @vitest-environment happy-dom
/**
 * The Summary's link into the Cost Clarity Review (fork-only; docs/develop/fork-log.md). It must
 * be absent on every deployment that has not configured DDD, which reaches the component as a
 * null link, and it must be a real link, because the summary PDF prints it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportReviewLink } from './ReportReviewLink';

describe('<ReportReviewLink>', () => {
    it('renders nothing without a link', () => {
        expect(render(<ReportReviewLink href={null} />).container.innerHTML).toBe('');
        expect(render(<ReportReviewLink href={undefined} />).container.innerHTML).toBe('');
    });

    it('is a plain link to the review, so it stays clickable in the printed PDF', () => {
        const { getByRole } = render(<ReportReviewLink href="https://ddd.test/c/abc.sig" />);
        const link = getByRole('link');
        expect(link.getAttribute('href')).toBe('https://ddd.test/c/abc.sig');
        expect(link.textContent).toBe('See your Cost Clarity Review');
        expect(link.closest('aside')?.className).not.toContain('print:hidden');
    });
});
