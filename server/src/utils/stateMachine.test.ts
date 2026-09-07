import { describe, it, expect } from "vitest";
import { SUPPLIER_ORDER_TRANSITIONS, CUSTOMS_RECORD_TRANSITIONS, canTransition, allowedNextStates } from "./stateMachine";

describe("canTransition — supplier order pipeline", () => {
  it("allows the normal forward path, one step at a time", () => {
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "ordered_from_supplier", "received_at_origin_hub")).toBe(true);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "received_at_origin_hub", "qc_passed_origin")).toBe(true);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "qc_passed_origin", "in_transit_to_destination")).toBe(true);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "in_transit_to_destination", "received_at_destination_hub")).toBe(true);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "received_at_destination_hub", "customs_cleared")).toBe(true);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "customs_cleared", "shipped_to_customer")).toBe(true);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "shipped_to_customer", "delivered")).toBe(true);
  });

  it("allows a QC failure branch from received_at_origin_hub", () => {
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "received_at_origin_hub", "qc_failed_origin")).toBe(true);
  });

  it("blocks skipping a stage (can't jump straight to delivered)", () => {
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "ordered_from_supplier", "delivered")).toBe(false);
  });

  it("blocks moving backward", () => {
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "in_transit_to_destination", "qc_passed_origin")).toBe(false);
  });

  it("treats delivered and qc_failed_origin as terminal — no further moves allowed", () => {
    expect(allowedNextStates(SUPPLIER_ORDER_TRANSITIONS, "delivered")).toEqual([]);
    expect(allowedNextStates(SUPPLIER_ORDER_TRANSITIONS, "qc_failed_origin")).toEqual([]);
  });

  it("returns an empty allowed-list (not a throw) for an unknown state", () => {
    expect(allowedNextStates(SUPPLIER_ORDER_TRANSITIONS, "not_a_real_status")).toEqual([]);
    expect(canTransition(SUPPLIER_ORDER_TRANSITIONS, "not_a_real_status", "delivered")).toBe(false);
  });
});

describe("canTransition — customs record pipeline", () => {
  it("allows the normal forward path", () => {
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "duty_calculated", "prepaid_to_agent")).toBe(true);
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "prepaid_to_agent", "declared_to_customs")).toBe(true);
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "declared_to_customs", "cleared")).toBe(true);
  });

  it("allows being held from either prepaid or declared, and recovering from held", () => {
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "prepaid_to_agent", "held")).toBe(true);
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "declared_to_customs", "held")).toBe(true);
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "held", "declared_to_customs")).toBe(true);
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "held", "cleared")).toBe(true);
  });

  it("treats cleared as terminal", () => {
    expect(allowedNextStates(CUSTOMS_RECORD_TRANSITIONS, "cleared")).toEqual([]);
  });

  it("blocks skipping straight from duty_calculated to cleared", () => {
    expect(canTransition(CUSTOMS_RECORD_TRANSITIONS, "duty_calculated", "cleared")).toBe(false);
  });
});
