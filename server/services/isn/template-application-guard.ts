import { sql } from 'drizzle-orm';
import { inspections, inspectionResults, inspectionMediaPool, reports, reportVersions, templates, isnOrders, isnOrderTypeTemplates } from '../../lib/db/schema';
import { REPORT_STATUS } from '../../lib/status/report-status';

/** Rechecked INSIDE every statement of the atomic D1 batch, against HTTP writers too. */
export function untouchedIsnTemplateGuard(tenantId: string, inspectionId: string, reportId: string, templateId: string, resultsId: string) {
    return sql`
        exists (select 1 from ${inspections} where ${inspections.tenantId} = ${tenantId}
            and ${inspections.id} = ${inspectionId} and ${inspections.reportStatus} = ${REPORT_STATUS.IN_PROGRESS})
        and (select count(*) from ${reports} where ${reports.tenantId} = ${tenantId} and ${reports.inspectionId} = ${inspectionId}) = 1
        and exists (select 1 from ${reports} where ${reports.tenantId} = ${tenantId} and ${reports.inspectionId} = ${inspectionId}
            and ${reports.id} = ${reportId} and ${reports.kind} = 'primary' and ${reports.status} = ${REPORT_STATUS.IN_PROGRESS}
            and ${reports.publishedAt} is null and trim(coalesce(${reports.inspectorNarrative}, '')) = '')
        and not exists (select 1 from ${reportVersions} where ${reportVersions.tenantId} = ${tenantId} and ${reportVersions.inspectionId} = ${inspectionId})
        and not exists (select 1 from ${inspectionMediaPool} where ${inspectionMediaPool.tenantId} = ${tenantId} and ${inspectionMediaPool.inspectionId} = ${inspectionId})
        and exists (select 1 from ${inspectionResults} where ${inspectionResults.tenantId} = ${tenantId} and ${inspectionResults.inspectionId} = ${inspectionId} and ${inspectionResults.id} = ${resultsId})
        and not exists (select 1 from ${inspectionResults} where ${inspectionResults.tenantId} = ${tenantId} and ${inspectionResults.inspectionId} = ${inspectionId}
            and (${inspectionResults.ydocState} is not null or not json_valid(${inspectionResults.data})
                or json_type(${inspectionResults.data}) <> 'object' or exists (select 1 from json_each(${inspectionResults.data}))))
        and exists (select 1 from ${templates} where ${templates.tenantId} = ${tenantId} and ${templates.id} = ${templateId} and ${templates.retiredAt} is null)
        and exists (select 1 from ${isnOrders} inner join ${isnOrderTypeTemplates}
            on ${isnOrderTypeTemplates.isnOrderTypeId} = trim(json_extract(${isnOrders.payload}, '$.ordertype'))
            and ${isnOrderTypeTemplates.tenantId} = ${tenantId} and ${isnOrderTypeTemplates.templateId} = ${templateId}
            where ${isnOrders.tenantId} = ${tenantId} and ${isnOrders.inspectionId} = ${inspectionId})
    `;
}
