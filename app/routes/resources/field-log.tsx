/**
 * BFF for the field log. GET reads the user's setting. POST carries either an
 * event batch from the device buffer or `{ enabled }` from the settings card.
 * The API validates both and enforces the setting.
 */
import type { Route } from "./+types/field-log";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (!token) return Response.json({ enabled: false }, { status: 401 });
  const res = await createApi(context, { token }).fieldLog.setting.$get();
  return res.ok ? Response.json(await res.json()) : Response.json({ enabled: false }, { status: res.status });
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await getToken(context, request);
  if (!token) return Response.json({ ok: false }, { status: 401 });
  const api = createApi(context, { token });
  const body = (await request.json().catch(() => null)) as object | null;
  if (!body) return Response.json({ ok: false }, { status: 400 });
  const res = "enabled" in body
    ? await api.fieldLog.setting.$put({ json: body as never })
    : await api.fieldLog.events.$post({ json: body as never });
  return new Response(null, { status: res.status });
}
