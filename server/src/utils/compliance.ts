/**
 * South Africa/Zambia vehicle import compliance — extracted out of
 * POST /orders so the actual legal rule (not just "some code somewhere
 * throws an error") has its own tested definition. This is the check
 * that stands between a listing and a customer actually being sold
 * something that can't legally clear customs, so it earns real test
 * coverage on its own.
 *
 * Checked against the ORDER's actual delivery country, never the
 * listing alone — the same used-vehicle listing is legal for Zambia but
 * not South Africa, so a category+country+condition combination is what
 * matters, not the product in isolation.
 */

export interface VehicleComplianceResult {
  blocked: boolean;
  reason?: string;
}

const VEHICLES_CATEGORY_ID = "cat-07";

export function checkVehicleCompliance(
  categoryId: string | null | undefined,
  destinationCountry: string,
  condition: string | null | undefined,
  nrcsApproved: boolean,
  productName: string
): VehicleComplianceResult {
  if (categoryId !== VEHICLES_CATEGORY_ID) return { blocked: false };
  if (destinationCountry !== "ZA") return { blocked: false }; // Zambia has no equivalent restriction

  if (condition === "used") {
    return {
      blocked: true,
      reason: `"${productName}" can't be delivered to a South African address — South Africa (ITAC) restricts commercial resale of used vehicles to narrow personal exemptions only. This vehicle can still be ordered for delivery to Zambia.`,
    };
  }
  if (!nrcsApproved) {
    return {
      blocked: true,
      reason: `"${productName}" doesn't yet have NRCS type-approval on file, which South Africa requires for every imported vehicle before it can be delivered. Contact support once approval is obtained.`,
    };
  }
  return { blocked: false };
}
