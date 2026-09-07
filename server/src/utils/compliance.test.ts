import { describe, it, expect } from "vitest";
import { checkVehicleCompliance } from "./compliance";

describe("checkVehicleCompliance", () => {
  it("blocks a used vehicle going to South Africa (ITAC restriction)", () => {
    const result = checkVehicleCompliance("cat-07", "ZA", "used", false, "Honda Fit");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("used vehicles");
    expect(result.reason).toContain("Honda Fit");
  });

  it("allows a used vehicle going to Zambia — no equivalent restriction there", () => {
    const result = checkVehicleCompliance("cat-07", "ZM", "used", false, "Honda Fit");
    expect(result.blocked).toBe(false);
  });

  it("blocks a new vehicle to South Africa without NRCS approval", () => {
    const result = checkVehicleCompliance("cat-07", "ZA", "new", false, "Toyota Corolla");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("NRCS");
  });

  it("allows a new, NRCS-approved vehicle to South Africa", () => {
    const result = checkVehicleCompliance("cat-07", "ZA", "new", true, "Toyota Corolla");
    expect(result.blocked).toBe(false);
  });

  it("allows a new vehicle to Zambia regardless of NRCS status — that requirement is SA-specific", () => {
    const result = checkVehicleCompliance("cat-07", "ZM", "new", false, "Toyota Corolla");
    expect(result.blocked).toBe(false);
  });

  it("never blocks a non-vehicle product, regardless of condition/NRCS fields", () => {
    const result = checkVehicleCompliance("cat-01", "ZA", "used", false, "Some Electronics Item");
    expect(result.blocked).toBe(false);
  });

  it("never blocks anything for a category of null/undefined (non-vehicle listings)", () => {
    expect(checkVehicleCompliance(null, "ZA", "used", false, "X").blocked).toBe(false);
    expect(checkVehicleCompliance(undefined, "ZA", "used", false, "X").blocked).toBe(false);
  });

  it("never blocks a vehicle order to a third country outside SA/ZM", () => {
    // Only South Africa's ITAC restriction is modelled — no other
    // country's vehicle-import rules are represented here, so nothing
    // outside ZA should ever be blocked by this check.
    const result = checkVehicleCompliance("cat-07", "MZ", "used", false, "Honda Fit");
    expect(result.blocked).toBe(false);
  });
});
