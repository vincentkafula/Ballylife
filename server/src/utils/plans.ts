/**
 * Every paid plan and programme on Ballylife, in one place. The storefront
 * reads this through GET /api/marketplace/plans, so prices and benefits on
 * the pricing pages, dashboards and checkout can never drift from what the
 * server actually charges and applies. All amounts are ZAR.
 *
 * The terms pages quote these numbers as legal text -- change them too
 * when anything here changes: src/components/BallylifeMorePage.tsx (benefits
 * table), BusinessTermsPage.tsx (rebate tiers), CreditRewardsPage.tsx (rate).
 */

export type MorePlanId = "standard" | "premium";

export interface MorePlan {
  id: MorePlanId;
  name: string;
  monthlyPriceZar: number;
  /** Off every order's merchandise subtotal while the membership is active. */
  orderDiscountPct: number;
  /** Extra discount on items marked as deals (Premium "member deals"). */
  dealExtraDiscountPct: number;
  /** Days after delivery a return may be requested. */
  returnWindowDays: number;
  prioritySupport: boolean;
  benefits: string[];
}

export const MORE_PLANS: Record<MorePlanId, MorePlan> = {
  standard: {
    id: "standard", name: "Standard", monthlyPriceZar: 49, orderDiscountPct: 5, dealExtraDiscountPct: 0,
    returnWindowDays: 7, prioritySupport: false,
    benefits: ["5% off every order", "Delivery included on Ballylife store items", "Cancel anytime"],
  },
  premium: {
    id: "premium", name: "Premium", monthlyPriceZar: 99, orderDiscountPct: 10, dealExtraDiscountPct: 5,
    returnWindowDays: 30, prioritySupport: true,
    benefits: ["10% off every order", "Member deals: an extra 5% off deal items", "30-day returns (instead of 7)", "Priority support", "Cancel anytime"],
  },
};

export const MORE_TRIAL_DAYS = 30;
export const COOLING_OFF_DAYS = 7;
export const STANDARD_RETURN_WINDOW_DAYS = 7;
/** A renewal not received this many days after it's due pauses benefits. */
export const PAYMENT_GRACE_DAYS = 2;
/** Consecutive unpaid periods after which a subscription ends. */
export const MAX_MISSED_PERIODS = 3;

/** Ballylife for Business: rebate on a month's Net Merchandise Value, by tier. */
// Matches the ladder published in the Ballylife for Business terms
// (src/components/BusinessTermsPage.tsx, clause 04).
export const BUSINESS_REBATE_TIERS: { minMonthlySpendZar: number; rebatePct: number }[] = [
  { minMonthlySpendZar: 5_000, rebatePct: 0.5 },
  { minMonthlySpendZar: 10_001, rebatePct: 1 },
  { minMonthlySpendZar: 20_001, rebatePct: 1.5 },
  { minMonthlySpendZar: 50_001, rebatePct: 2 },
  { minMonthlySpendZar: 100_001, rebatePct: 2.5 },
  { minMonthlySpendZar: 200_001, rebatePct: 3 },
  { minMonthlySpendZar: 300_001, rebatePct: 3.5 },
  { minMonthlySpendZar: 500_001, rebatePct: 4 },
];

export function businessRebatePct(monthlySpendZar: number): number {
  let pct = 0;
  for (const t of BUSINESS_REBATE_TIERS) if (monthlySpendZar >= t.minMonthlySpendZar) pct = t.rebatePct;
  return pct;
}

/** Ballylife.credit Rewards: share of the amount paid with a Ballylife.credit account. */
export const CREDIT_REWARD_PCT = 1;
/** Rewards accrue this many days after delivery (returns window), then pay out at the next quarter start. */
export const CREDIT_REWARD_DELAY_DAYS = 30;
/** Store credit from rebates and rewards expires after this many years. */
export const STORE_CREDIT_EXPIRY_YEARS = 3;

export function publicPlans() {
  return {
    currency: "ZAR",
    more: { plans: Object.values(MORE_PLANS), trialDays: MORE_TRIAL_DAYS, coolingOffDays: COOLING_OFF_DAYS },
    business: { tiers: BUSINESS_REBATE_TIERS, creditExpiryYears: STORE_CREDIT_EXPIRY_YEARS },
    creditRewards: { rewardPct: CREDIT_REWARD_PCT, delayDays: CREDIT_REWARD_DELAY_DAYS, payout: "quarterly", creditExpiryYears: STORE_CREDIT_EXPIRY_YEARS },
    standardReturnWindowDays: STANDARD_RETURN_WINDOW_DAYS,
  };
}
