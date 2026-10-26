/**
 * BFF resource route for the ISN card (inspection page + editor settings sheet).
 * loader: GET /api/inspections/:id/isn — null when the inspection did not come
 * from ISN, or on any failure (the card then renders nothing).
 */
import type { Route } from "./+types/isn-card";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    const inspectionId = new URL(request.url).searchParams.get("inspectionId");
    if (!token || !inspectionId) return null;
    const res = await createApi(context, { token }).inspections[":id"].isn
        .$get({ param: { id: inspectionId } }, { headers: { "x-token-relay": "1" } })
        .catch(() => null);
    if (!res?.ok) return null;
    return (await res.json()).data;
}
