// @vitest-environment happy-dom
/**
 * F74 — first-run setup has to name the step that leaves the agent portal dead.
 * ONB-02 — and has to do it without putting deployment notes on the first view.
 *
 * Publishing agent terms is a manual, deployment-level step in BOTH modes: the
 * gate does not branch on `APP_MODE`, no workspace administrator can supply the
 * document, and until it exists `POST /api/agent-signup` refuses and agents are
 * told "Agent sign-up is not available yet" with no way forward. It is covered
 * thoroughly in `docs/operate/deploy.md`, and nowhere an operator who only runs
 * the wizard would ever see it.
 *
 * The claims under test: the setup SURFACE still names the step and its
 * consequence, but inside a disclosure that is closed on first paint, together
 * with the Cloudflare secret steps for the setup code; the setup-code field
 * itself keeps a short hint that points at it; and none of it is a gate: the
 * terms are published from the command line, so nothing here may block
 * finishing setup.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(async () => null),
    createSessionWithToken: vi.fn(),
}));

vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({})),
}));

import SetupPage from "~/routes/setup";

function renderSetup() {
    const Stub = createRoutesStub([
        {
            path: "/setup",
            Component: SetupPage,
            loader: () => ({ ready: true }),
            action: async () => ({}),
        },
    ]);
    return render(<Stub initialEntries={["/setup"]} />);
}

describe("first-run setup — the operator notes", () => {
    it("holds the agent-terms step and the Cloudflare secret steps in a closed disclosure", async () => {
        const { container } = renderSetup();
        // Positive control: the surface this assertion is aimed at really did
        // render. A bad selector reports "absent" indistinguishably otherwise.
        expect(await screen.findByText(/Create Account/i)).toBeTruthy();

        const details = container.querySelector("details");
        expect(details).not.toBeNull();
        expect(details!.hasAttribute("open")).toBe(false);
        expect(details!.querySelector("summary")?.textContent).toMatch(/whoever deployed this/i);

        const inside = details!.textContent;
        expect(inside).toMatch(/agent sign-up/i);
        expect(inside).toMatch(/agent terms/i);
        expect(inside).toMatch(/operates this deployment/i);
        expect(inside).toMatch(/agent-terms:publish/);
        expect(inside).toMatch(/SETUP_CODE/);
        expect(inside).toMatch(/Variables and Secrets/);
    });

    it("keeps the setup-code hint on the field and points at the note", async () => {
        const { container } = renderSetup();
        await screen.findByText(/Create Account/i);
        const details = container.querySelector("details");
        const hint = screen.getByText(/at least 6 characters/i).parentElement;
        expect(hint).not.toBeNull();
        expect(details!.contains(hint)).toBe(false);
        expect(hint!.textContent).toMatch(/note below the form/i);
    });

    it("does not block finishing setup", async () => {
        renderSetup();
        const submit = await screen.findByRole("button", { name: /Create Account/i });
        expect(submit).not.toBeDisabled();
    });
});
