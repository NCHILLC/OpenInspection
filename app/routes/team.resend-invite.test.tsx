// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const resend = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn().mockResolvedValue("token"),
}));
vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    team: { invites: { ":token": { resend: { $post: resend } } } },
  })),
}));

import TeamPage, { action } from "~/routes/team";

const pending = {
  id: "invite-1",
  name: null,
  email: "invitee@seed.test",
  role: "inspector",
  status: "pending",
  lastActiveAt: null,
  token: "invite-1",
  inviteLink: "https://inspections.example.test/join?token=invite-1",
  expiresAt: new Date(Date.now() + 864e5).toISOString(),
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderTeam() {
  const Stub = createRoutesStub([{
    path: "/team",
    Component: TeamPage,
    loader: () => ({ members: [pending], canManage: true, isOwner: true, loadFailed: false }),
    action,
  }]);
  return render(<Stub initialEntries={["/team"]} />);
}

async function submitResend() {
  renderTeam();
  fireEvent.click(await screen.findByRole("button", { name: /Pending Invites/i }));
  fireEvent.click(screen.getByRole("button", { name: /^Resend$/i }));
}

describe("/team — resend invitation feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("announces a successful resend", async () => {
    resend.mockResolvedValue(response({ success: true, data: { resent: true } }));
    await submitResend();

    expect(await screen.findByRole("status")).toHaveTextContent("Invitation email sent.");
  });

  it.each([
    [{ error: "Email delivery failed" }, "Email delivery failed"],
    [{ error: { message: "Invite not found" } }, "Invite not found"],
  ])("announces a failed resend from either API error shape", async (body, message) => {
    resend.mockResolvedValue(response(body, 502));
    await submitResend();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("announces a generic failure when the API request itself fails", async () => {
    resend.mockRejectedValue(new Error("network details must not reach the page"));
    await submitResend();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to resend invitation");
    expect(screen.queryByText(/network details/i)).toBeNull();
  });
});
