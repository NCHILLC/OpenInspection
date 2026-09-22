type ResendResponse = { ok: boolean; status: number; json(): Promise<unknown> };

export async function resendTeamInvite(
  send: () => Promise<ResendResponse>,
): Promise<{ ok: boolean; resent: boolean; error?: string }> {
  try {
    const res = await send();
    if (res.ok) return { ok: true, resent: true };

    const body = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    return { ok: false, resent: false, error: message ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, resent: false, error: "Failed to resend invitation" };
  }
}
