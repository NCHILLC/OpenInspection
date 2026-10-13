// @vitest-environment happy-dom
/**
 * Staff have to be able to CORRECT a contact's language, which is a stronger
 * requirement than being able to set one: the booking form can leave the choice
 * unanswered forever, but this form is the only place a wrong answer gets
 * undone. So "Not set" is an option here rather than merely the initial state,
 * and it is first — a pre-selected English would turn every contact anyone ever
 * edits into a stated preference, and a stated preference is the only thing the
 * column is evidence of.
 */
import { describe, it, expect, vi } from "vitest";
import { render, within, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { ContactModal } from "./ContactModal";
import type { Contact } from "./contacts-helpers";
import { asSelect } from "../../../tests/helpers/dom";

const BASE: Contact = {
  id: "c1",
  name: "Tomas Beck",
  email: "tomas@example.com",
  phone: "",
  type: "client",
  agency: "",
};

function renderModal(contact: Contact | null) {
  const Stub = createRoutesStub([
    {
      path: "/contacts",
      Component: () => <ContactModal open onClose={() => {}} contact={contact} />,
    },
  ]);
  return render(<Stub initialEntries={["/contacts"]} />);
}

describe("ContactModal — preferred language", () => {
  it("offers 'not set' first, so a language can be taken back off", async () => {
    const { findByLabelText } = renderModal({ ...BASE, locale: "es-419" });
    const select = asSelect(await findByLabelText("Preferred language"), "the language picker");

    const [first, ...rest] = Array.from(select.options);
    expect(first.value).toBe("");
    // Every other option carries a real tag — nothing else is a way out.
    expect(rest.map((o) => o.value)).toEqual(["en", "es-419"]);
  });

  it("shows what the contact already asked for", async () => {
    const { findByLabelText } = renderModal({ ...BASE, locale: "es-419" });
    const select = asSelect(await findByLabelText("Preferred language"), "the language picker");

    expect(select.value).toBe("es-419");
    expect(within(select).getByRole("option", { selected: true })).toHaveTextContent(
      // Same label the booking form and the profile picker use — one
      // vocabulary for one choice.
      "Español (Latinoamérica)",
    );
  });

  it("sits on 'not set' for a contact who has never said", async () => {
    const { findByLabelText } = renderModal({ ...BASE, locale: null });
    const select = asSelect(await findByLabelText("Preferred language"), "the language picker");
    expect(select.value).toBe("");
  });

  it("sits on 'not set' for a brand-new contact", async () => {
    const { findByLabelText } = renderModal(null);
    const select = asSelect(await findByLabelText("Preferred language"), "the language picker");
    expect(select.value).toBe("");
  });
});

describe("ContactModal - closing after a save (FORM-01)", () => {
  it("closes when the first save comes back ok, and not before", async () => {
    const onClose = vi.fn();
    const Stub = createRoutesStub([
      {
        path: "/contacts",
        Component: () => <ContactModal open onClose={onClose} contact={null} />,
        action: async () => ({ ok: true }),
      },
    ]);
    const { findByLabelText, getByRole } = render(<Stub initialEntries={["/contacts"]} />);

    fireEvent.change(await findByLabelText(/^Full Name/), { target: { value: "Ada Lovelace" } });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Save" }));

    // The pre-fix modal read the PREVIOUS result at click time (none), so this
    // never fired on a first save and the dialog sat open after a 200.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
