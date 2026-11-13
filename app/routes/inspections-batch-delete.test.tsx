// @vitest-environment happy-dom
/**
 * F55 — deleting an inspection did not clear its offline data from the device.
 *
 * The defect was NOT a missing function. `deleteResultsDb` has existed since the
 * restore-resync path was written, and had no caller outside its own module;
 * nothing on the delete path called anything. So the thing that has to be
 * asserted here is the WIRING — that pressing Delete actually reaches the purge
 * with the right id — and not that the purge works, which
 * `tests/unit/collab/offline-purge.spec.ts` owns.
 *
 * This is the repository's recurring shape: a primitive built and left unwired,
 * green in its own unit test, reachable by nobody.
 *
 * The purge is mocked rather than run: this spec is about the call, and a real
 * IndexedDB here would make a failure ambiguous between "not wired" and "the
 * polyfill did not settle".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

// `vi.mock` is hoisted above every import, so the spy cannot be a module-scope
// const here — `vi.hoisted` is the one place a variable can be built early
// enough for the factory to close over it.
const { purgeInspectionOfflineData } = vi.hoisted(() => ({
    purgeInspectionOfflineData: vi.fn(async () => ({
        pendingMediaDeleted: 0,
        resultsDbPurged: true,
        attempted: true,
    })),
}));
vi.mock("~/lib/collab/offline-purge", () => ({ purgeInspectionOfflineData }));

import InspectionsPage from "~/routes/inspections";

const EMPTY_BUCKETS = {
    needsAttention: [],
    today: [],
    thisWeek: [],
    later: [],
    recentReports: [],
    cancelled: [],
};

const TWO = {
    id: "insp-56",
    date: "2026-09-12",
    address: "744 Evergreen Terrace",
    clientName: "Ned Flanders",
    status: "scheduled",
    reportStatus: "in_progress",
};

const ONE = {
    id: "insp-55",
    date: "2026-09-12",
    address: "742 Evergreen Terrace",
    clientName: "Marge Simpson",
    status: "scheduled",
    reportStatus: "in_progress",
};

/** Every action call, as the ids it was asked to delete. */
const posted: string[][] = [];

function renderDashboard(deleteOk: boolean, rows: Array<typeof ONE> = [ONE]) {
    const Stub = createRoutesStub([
        {
            path: "/inspections",
            Component: InspectionsPage,
            loader: () => ({
                buckets: { ...EMPTY_BUCKETS, today: deleteOk && posted.length > 0 ? [] : rows },
                conciergePending: 0,
                greeting: "Good morning",
                tags: [],
                templates: [],
                services: [],
                teamMembers: [],
                checklistDismissed: true,
                templateCount: 1,
                serviceCount: 1,
                scheduleSet: true,
                quotaCaps: null,
                quotaUsage: null,
                loadFailed: false,
            }),
            action: async ({ request }: { request: Request }) => {
                const ids = String((await request.formData()).get("ids") ?? "").split(",");
                posted.push(ids);
                return deleteOk
                    ? { ok: true, intent: "delete-many", deleted: ids, failed: [] }
                    : { ok: false, intent: "delete-many", deleted: [], failed: ids.map((id) => ({ id, error: "Not allowed" })) };
            },
        },
    ]);
    return render(<Stub initialEntries={["/inspections"]} />);
}

async function selectAndDelete(view: ReturnType<typeof renderDashboard>, rowCount = 1, confirm = true) {
    // All, not one: the phone card and the desktop row both carry the address.
    await view.findAllByText("742 Evergreen Terrace");
    const boxes = [...view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].slice(0, rowCount);
    if (boxes.length < rowCount) throw new Error("no row selection checkbox");
    for (const box of boxes) fireEvent.click(box);
    const del = (await view.findAllByRole("button")).find((b) => b.textContent === "Delete");
    if (!del) throw new Error("no batch Delete button");
    fireEvent.click(del);
    // A permanent delete asks first.
    const dialog = await view.findByRole("dialog");
    const choice = [...dialog.querySelectorAll("button")].find((b) => b.textContent === (confirm ? "Delete" : "Cancel"));
    if (!choice) throw new Error("no confirm dialog button");
    fireEvent.click(choice);
}

describe("/inspections — deleting clears the device's copy (F55)", () => {
    beforeEach(() => {
        purgeInspectionOfflineData.mockClear();
        posted.length = 0;
    });

    it("purges the deleted inspection's offline data, by id", async () => {
        await selectAndDelete(renderDashboard(true));
        await waitFor(() => expect(purgeInspectionOfflineData).toHaveBeenCalledTimes(1));
        expect(purgeInspectionOfflineData).toHaveBeenCalledWith("insp-55");
    });

    it("does NOT purge when the server refused the delete", async () => {
        // The other half, and the reason the purge waits for the response. A
        // queued photo and an unsynced edit exist nowhere else; wiping them for a
        // delete that did not happen would be data loss caused by the cleanup.
        const view = renderDashboard(false);
        await selectAndDelete(view);
        // Wait for the action to have settled before asserting an absence — a
        // bare assertion here would pass simply by being early.
        await waitFor(() => expect(view.container.textContent).toContain("742 Evergreen Terrace"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(purgeInspectionOfflineData).not.toHaveBeenCalled();
    });

    it("sends the whole selection as ONE request, and purges each deleted id", async () => {
        // The old loop submitted once per row through one fetcher; each submit
        // cancelled the one before it, so only the last answer was ever seen.
        await selectAndDelete(renderDashboard(true, [ONE, TWO]), 2);
        await waitFor(() => expect(purgeInspectionOfflineData).toHaveBeenCalledTimes(2));
        expect(posted).toHaveLength(1);
        expect([...posted[0]].sort()).toEqual(["insp-55", "insp-56"]);
    });

    it("deletes nothing when the confirmation is cancelled", async () => {
        const view = renderDashboard(true);
        await selectAndDelete(view, 1, false);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(posted).toHaveLength(0);
        expect(view.container.textContent).toContain("742 Evergreen Terrace");
    });

    it("puts a refused row back and says why", async () => {
        const view = renderDashboard(false);
        await selectAndDelete(view);
        await view.findByText(/could not be deleted/);
        expect(view.container.textContent).toContain("Not allowed");
    });
});
