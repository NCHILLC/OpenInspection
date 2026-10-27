// @vitest-environment happy-dom
/**
 * Canvas S10: the phone's finish screen lists what the server's publish gate
 * blocks, lets a missing location be filled in place, and publishes only once
 * nothing blocks. Its done state comes from the publish settling with ok.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { PhoneFinishScreen, type PhoneFinishScreenProps } from "./PhoneFinishScreen";
import type { PublishReadiness } from "../../lib/types";

vi.mock("~/lib/collab/media-pending-store", () => ({ listPendingMedia: () => Promise.resolve([]) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const gap = { sectionId: "s1", sectionTitle: "Roof", itemId: "i1", itemLabel: "Chimney", cannedId: "c1", cannedTitle: "Damaged flue liner", missing: ["location" as const], unresolvedTokens: [] };

function setup(readiness: PublishReadiness, over: Partial<PhoneFinishScreenProps> = {}) {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ readiness })))));
    const props: PhoneFinishScreenProps = {
        open: true, onClose: vi.fn(), inspectionId: "insp-1", address: "4417 Sample Creek Dr",
        rated: 40, total: 40, findings: 6, status: "in_progress", isAmendment: false,
        autoSign: false, onAutoSignToggle: vi.fn(), publishError: null, isSubmitting: false, publishOk: false,
        onPublish: vi.fn(), onFinishFieldwork: vi.fn(), finishingFieldwork: false, onFill: vi.fn(), onOpen: vi.fn(),
        ...over,
    };
    return { props, ...render(<PhoneFinishScreen {...props} />) };
}

describe("PhoneFinishScreen", () => {
    it("blocks publish on a gate gap, and filling the location in place clears it", async () => {
        const { props } = setup({ ready: false, blockingDefects: [gap], warningDefects: [] });
        expect(await screen.findByText("Damaged flue liner")).toBeTruthy();
        const go = screen.getByRole("button", { name: "Fill 1 to publish" });
        fireEvent.click(go);
        expect(props.onPublish).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("radio", { name: "Rear" }));
        expect(props.onFill).toHaveBeenCalledWith(gap, { location: "Rear" });
        expect(screen.getByText("Every required field is filled")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Publish report" }));
        // Not completed yet, so publishing from the field also closes the order axis.
        expect(props.onPublish).toHaveBeenCalledWith(true, {});
    });

    it("shows the published state with the ISN line once a publish settles ok", async () => {
        const { props, rerender } = setup({ ready: true, blockingDefects: [], warningDefects: [] });
        await screen.findByText("Every required field is filled");
        rerender(<PhoneFinishScreen {...props} isSubmitting />);
        rerender(<PhoneFinishScreen {...props} isSubmitting={false} publishOk isnSync={{ ok: false, error: "timeout" }} onIsnRetry={vi.fn()} />);
        expect(screen.getByText("Report published")).toBeTruthy();
        expect(screen.getByText("The report link did not reach ISN: timeout")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Send to ISN again" })).toBeTruthy();
    });

    it("finishes fieldwork without publishing, then says so once the status is completed", async () => {
        const { props, rerender } = setup({ ready: false, blockingDefects: [gap], warningDefects: [] });
        await screen.findByText("Damaged flue liner");
        fireEvent.click(screen.getByRole("radio", { name: /Finish fieldwork, publish later/ }));
        fireEvent.click(screen.getByRole("button", { name: "Finish fieldwork" }));
        expect(props.onFinishFieldwork).toHaveBeenCalled();
        expect(props.onPublish).not.toHaveBeenCalled();
        rerender(<PhoneFinishScreen {...props} status="completed" onFinishFieldwork={null} />);
        expect(screen.getByText("Fieldwork finished")).toBeTruthy();
    });
});

describe("PhoneFinishScreen missing facts", () => {
    it("names the missing temperature and weather, blocks publish, and opens the details form", async () => {
        const onOpenDetails = vi.fn();
        const { props } = setup(
            { ready: false, blockingDefects: [], warningDefects: [], missingFacts: ["temperature", "weather"] },
            { onOpenDetails },
        );
        expect(await screen.findByText("Record the temperature and weather")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Record details to publish" }));
        expect(props.onPublish).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Open details" }));
        expect(onOpenDetails).toHaveBeenCalledTimes(1);
    });

    it("names only the fact that is missing", async () => {
        setup({ ready: false, blockingDefects: [], warningDefects: [], missingFacts: ["weather"] });
        expect(await screen.findByText("Record the weather")).toBeTruthy();
    });
});
