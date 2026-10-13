// @vitest-environment happy-dom
/**
 * DELIV-01 — the API now refuses to send an agreement that still carries
 * placeholders. That refusal used to land in a page-level line underneath the
 * modal's scrim, so Send looked like it did nothing. It must read inside the
 * dialog the inspector is looking at.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SendAgreementModal } from "./SendAgreementModal";

const base = {
  open: true,
  onSend: () => {},
  onClose: () => {},
  initialSigners: [{ name: "Pat Rivera", email: "pat@example.com", role: "client" as const }],
};

describe("SendAgreementModal serverError", () => {
  it("shows the API's refusal as an alert inside the dialog", () => {
    render(<SendAgreementModal {...base} serverError="This agreement cannot be sent yet: unfilled placeholders: [AMOUNT]." />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("cannot be sent yet");
    expect(alert.closest('[role="dialog"]')).not.toBeNull();
  });

  it("shows nothing when there is no refusal", () => {
    render(<SendAgreementModal {...base} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
