// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { ReportView, reportViewProps } from '~/components/portal/sections/ReportView';
import { EMPTY_BRAND } from '~/lib/brand';
import { m } from '~/paraglide/messages';
import type { ReportOutlineEntry, PcaReportData, ReportLoaderResult } from '~/components/portal/sections/report/types';

// Every entry the tier-gated PCA registry projects into the TOC (Commercial
// PCA Phase O — mirrors server/lib/pca-section-registry.ts's `full` tier,
// minus the self-referential `cover`/`toc` ids buildReportOutline drops).
const FULL_OUTLINE: ReportOutlineEntry[] = [
  { id: 'transmittal-letter', level: 0, title: 'Transmittal Letter' },
  { id: 'systems-summary', level: 0, title: 'Systems Summary' },
  { id: 'pca-summary', level: 0, title: 'PCA Summary' },
  { id: 'summary', level: 1, title: 'Summary' },
  { id: 'summary.general-description', level: 2, title: 'General Description' },
  { id: 'summary.physical-condition', level: 2, title: 'General Physical Condition' },
  { id: 'summary.opinion-of-cost', level: 2, title: 'Opinion of Cost' },
  { id: 'summary.deviations', level: 2, title: 'Deviations from the Guide' },
  { id: 'summary.recommendations', level: 2, title: 'Recommendations' },
  { id: 'introduction', level: 1, title: 'Introduction' },
  { id: 'introduction.purpose', level: 2, title: 'Purpose' },
  { id: 'introduction.scope-of-work', level: 2, title: 'Scope of Work' },
  { id: 'introduction.limitations-exceptions', level: 2, title: 'Limitations & Exceptions' },
  { id: 'introduction.reconnaissance', level: 2, title: 'General Property Reconnaissance' },
  { id: 'introduction.user-reliance', level: 2, title: 'User Reliance' },
  { id: 'property-description', level: 1, title: 'General Property Description' },
  { id: 'document-review', level: 1, title: 'Document Review & Interviews' },
  { id: 'site', level: 1, title: 'Site' },
  { id: 'structural-envelope', level: 1, title: 'Structural Frame & Building Envelope' },
  { id: 'mep', level: 1, title: 'Mechanical, Electrical & Plumbing' },
  { id: 'interior', level: 1, title: 'Interior Elements' },
  { id: 'life-safety', level: 1, title: 'Life Safety / Fire Protection' },
  { id: 'additional-considerations', level: 1, title: 'Additional Considerations' },
];

const pcaReport: PcaReportData = {
  narrative: {
    transmittalLetter: 'TL copy',
    summaryGeneralDescription: 'GD',
    summaryPhysicalCondition: 'PC',
    summaryRecommendations: 'REC',
    purpose: 'PURP',
    scopeOfWork: 'SCOPE',
    limitationsExceptions: 'LIMITS',
    reconnaissance: 'RECON',
    additionalConsiderations: 'ADDL',
  },
  systemsSummary: [
    { systemId: 'site', systemTitle: 'Site', worstSeverity: 'good', counts: { safety: 0, recommendation: 0, maintenance: 0 } },
  ],
  deviations: [],
};

function baseProps(overrides: Partial<ReportLoaderResult> = {}) {
  return reportViewProps({
    inspectionId: 'insp-1',
    address: '1 Main St',
    date: '2026-07-11',
    inspectorName: 'Jane Doe',
    brand: EMPTY_BRAND,
    stats: { total: 2, satisfactory: 1, monitor: 0, defect: 1 },
    sections: [
      { id: 'roofing', title: 'Roofing', items: [], defectCount: 0 },
      { id: 'electrical', title: 'Electrical', items: [], defectCount: 0 },
    ],
    pcaReport,
    reportTier: 'full_pca',
    outline: FULL_OUTLINE,
    tenant: 'acme',
    ...overrides,
  } as ReportLoaderResult & { tenant?: string });
}

/**
 * <ReportView> now needs a data-router context: the Art. 13 view-tracking
 * disclosure it renders (OI #271) carries the recipient's Art. 21 control,
 * which posts through a fetcher rather than a browser fetch. Wrapping is the
 * honest fix — the component is only ever mounted from a route.
 */
function renderReport(props: ReturnType<typeof baseProps>) {
  const Stub = createRoutesStub([{ path: '/', Component: () => <ReportView {...props} /> }]);
  return render(<Stub initialEntries={['/']} />);
}

describe('ReportView TOC anchors (Commercial PCA Phase O5)', () => {
  it('renders no dangling anchors — every #report-toc href resolves to a real target id', () => {
    const { container } = renderReport(baseProps());
    const hrefs = [...container.querySelectorAll('#report-toc a[href^="#"]')]
      .map((a) => a.getAttribute('href')!.slice(1))
      .filter((id) => id.length > 0);
    expect(hrefs.length).toBe(FULL_OUTLINE.length);
    for (const id of hrefs) {
      expect(container.querySelector(`#${CSS.escape(id)}`), `missing target for #${id}`).toBeTruthy();
    }
  });

  it('stamps every rendered inspection-template section with its own anchor id', () => {
    const { container } = renderReport(baseProps());
    expect(container.querySelector('#roofing')).toBeTruthy();
    expect(container.querySelector('#electrical')).toBeTruthy();
  });

  it('omits the TOC when outline is empty', () => {
    const { container } = renderReport(baseProps({ outline: [] }));
    expect(container.querySelector('#report-toc')).toBeNull();
  });

  // The Summary is a residential deliverable (ReportView.tsx: `summaryAvailable
  // = !data.reportTier`). A commercial report never enters Summary mode — even
  // a `?summary=1` link renders the full report, cost tables and photo
  // appendix included, and has neither the Summary chip nor the summary-PDF
  // button. A residential report gets both.
  const costTables: NonNullable<ReportLoaderResult['costTables']> = {
    table1: {
      immediate: [{ item: {
        id: 'cost-1', system: 'roof', component: 'Unique roof membrane', location: '',
        action: 'replace', costMethod: 'lump_sum', quantity: null, uom: null,
        unitCostCents: null, lumpSumCents: 500000, eul: null, effAge: null,
        rul: null, suggestedRemedy: 'Replace', bucket: 'immediate',
        sectionRef: null, photoRef: null, sortOrder: 0,
      }, total: 500000 }],
      shortTerm: [], immediateTotalCents: 500000, shortTermTotalCents: 0,
    },
    reserveSchedule: null,
    rollup: { immediateCents: 500000, shortTermCents: 0, reserveCents: 0 },
    droppedCount: 0,
  };
  const photoAppendix: NonNullable<ReportLoaderResult['photoAppendix']> = [{
    photoNo: 1, key: 'photo-1', url: '/p/1', caption: 'Unique roof photo',
    sectionId: 'roofing', sectionTitle: 'Roofing', itemId: 'item-1', itemLabel: 'Roof',
  }];

  it('commercial: ?summary=1 renders the full report, with no Summary chip and no summary-PDF button', () => {
    const { getByText, queryByRole } = renderReport(baseProps({
      costTables, photoAppendix, photoMode: 'appendix', showEstimates: true,
      initialFilter: 'summary',
    }));
    expect(getByText('Unique roof membrane')).toBeTruthy();
    expect(getByText('Unique roof photo')).toBeTruthy();
    expect(queryByRole('button', { name: m.report_view_filter_summary() })).toBeNull();
    expect(queryByRole('button', { name: m.report_view_download_summary_pdf() })).toBeNull();
  });

  it('residential: the Summary chip and the summary-PDF button are present', () => {
    const { getByRole } = renderReport(baseProps({
      reportTier: null, costTables: null, photoMode: 'inline',
    }));
    expect(getByRole('button', { name: m.report_view_filter_summary() })).toBeTruthy();
    expect(getByRole('button', { name: m.report_view_download_summary_pdf() })).toBeTruthy();
  });
});
