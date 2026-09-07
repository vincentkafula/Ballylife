/**
 * The two fulfilment-pipeline state machines used across the supplier/
 * seller/admin dashboards — extracted so the actual allowed-transition
 * rules have one tested definition, rather than living only as an
 * inline map next to whichever route handler happens to check it.
 */

export const SUPPLIER_ORDER_TRANSITIONS: Record<string, string[]> = {
  ordered_from_supplier: ["received_at_origin_hub"],
  received_at_origin_hub: ["qc_passed_origin", "qc_failed_origin"],
  qc_passed_origin: ["in_transit_to_destination"],
  qc_failed_origin: [], // terminal — handled manually (refund/reorder) outside this state machine
  in_transit_to_destination: ["received_at_destination_hub"],
  received_at_destination_hub: ["customs_cleared"],
  customs_cleared: ["shipped_to_customer"],
  shipped_to_customer: ["delivered"],
  delivered: [],
};

export const CUSTOMS_RECORD_TRANSITIONS: Record<string, string[]> = {
  duty_calculated: ["prepaid_to_agent"],
  prepaid_to_agent: ["declared_to_customs", "held"],
  declared_to_customs: ["cleared", "held"],
  held: ["declared_to_customs", "cleared"],
  cleared: [],
};

/** Whether `to` is a legal next state from `current`, per the given state machine. */
export function canTransition(machine: Record<string, string[]>, current: string, to: string): boolean {
  return (machine[current] ?? []).includes(to);
}

/** The set of legal next states from `current`, for building UI options or error messages. */
export function allowedNextStates(machine: Record<string, string[]>, current: string): string[] {
  return machine[current] ?? [];
}
