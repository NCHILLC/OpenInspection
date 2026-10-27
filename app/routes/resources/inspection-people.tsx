/**
 * BFF resource route for the phone's Inspection details screen (S03).
 * loader: GET /api/inspections/:id/people, cut to what a call/text row needs.
 * Empty list on any failure (the screen then says nobody is recorded).
 */
import type { Route } from "./+types/inspection-people";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    const inspectionId = new URL(request.url).searchParams.get("inspectionId");
    if (!token || !inspectionId) return [];
    const res = await createApi(context, { token }).inspections[":id"].people
        .$get({ param: { id: inspectionId } }, { headers: { "x-token-relay": "1" } })
        .catch(() => null);
    if (!res?.ok) return [];
    return (await res.json()).data
        .filter((p) => p.kind !== "other")
        .map(({ id, roleLabel, name, phone, agency, kind }) => ({ id, roleLabel, name, phone, agency, kind }));
}
