// @vitest-environment node
import { expect, test } from "vitest";
import { SEVERITY_LABEL, SEVERITIES, isSeverity } from "./severity";

/**
 * The order is part of the contract, not incidental: every picker renders
 * `SEVERITIES` in this order, which is ascending defect grade followed by the
 * non-grade state. `minor` sits LAST and reads "N/A" because it is the
 * "does not apply" slot carried by Not Inspected / Not Present — it is not the
 * bottom of a severity ramp despite the name.
 */
test("severity vocabulary is the canonical five, in picker order", () => {
  expect([...SEVERITIES]).toEqual(["good", "marginal", "significant", "safety", "minor"]);
});

test("each severity carries its display label", () => {
  expect(SEVERITY_LABEL.good).toBe("Satisfactory");
  expect(SEVERITY_LABEL.marginal).toBe("Minor");
  expect(SEVERITY_LABEL.significant).toBe("Moderate");
  expect(SEVERITY_LABEL.safety).toBe("Safety/Major");
  expect(SEVERITY_LABEL.minor).toBe("N/A");
});

test("isSeverity narrows unknown values to the canonical vocabulary", () => {
  expect(isSeverity("good")).toBe(true);
  expect(isSeverity("significant")).toBe(true);
  expect(isSeverity("safety")).toBe(true);
  expect(isSeverity("satisfactory")).toBe(false);
  expect(isSeverity(null)).toBe(false);
  expect(isSeverity(undefined)).toBe(false);
});
