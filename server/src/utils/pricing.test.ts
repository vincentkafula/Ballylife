import { describe, it, expect } from "vitest";
import {
  round2, calculateVat, convertToZar, calculatePercentageDuty, calculateZmVehicleDuty,
  calculatePlatformFee, calculateSellerPayout, zmVehicleAgeBand,
} from "./pricing";

describe("calculateVat", () => {
  it("computes South Africa's 15% VAT correctly", () => {
    expect(calculateVat(1000, 15)).toBe(150);
  });
  it("computes Zambia's 16% VAT correctly", () => {
    expect(calculateVat(1000, 16)).toBe(160);
  });
  it("rounds to 2 decimal places", () => {
    expect(calculateVat(33.33, 15)).toBe(5);
  });
});

describe("convertToZar", () => {
  const rates = new Map([["USD", 18.2], ["CNY", 2.52]]);

  it("converts a foreign amount to ZAR using the given rate", () => {
    expect(convertToZar(100, "USD", rates)).toBeCloseTo(1820, 5);
  });
  it("works with a plain object rate map too, not just a Map", () => {
    expect(convertToZar(100, "USD", { USD: 18.2 })).toBeCloseTo(1820, 5);
  });
  it("returns null (not a wrong number) when the currency has no rate on file", () => {
    expect(convertToZar(100, "JPY", rates)).toBeNull();
  });
  it("returns null for a null/undefined currency", () => {
    expect(convertToZar(100, null, rates)).toBeNull();
    expect(convertToZar(100, undefined, rates)).toBeNull();
  });
});

describe("calculatePercentageDuty — the currency-mixing regression test", () => {
  it("converts the foreign cost to ZAR BEFORE applying the duty rate", () => {
    // A $100 item, 2 units, at an 18.2 ZAR/USD rate, 25% duty:
    // cost in ZAR = 100 * 18.2 * 2 = 3640; duty = 3640 * 0.25 = 910
    const duty = calculatePercentageDuty(100, 2, 18.2, 25);
    expect(duty).toBeCloseTo(910, 5);
  });

  it("is NOT the same (wrong) number you'd get multiplying the raw foreign cost by the rate", () => {
    // This is exactly the bug that shipped and was later fixed — this
    // test exists so it can never silently come back. The wrong
    // calculation (no FX conversion at all) would give 100 * 2 * 0.25 = 50,
    // a number that looks plausible but is off by the FX rate (18.2x).
    const correct = calculatePercentageDuty(100, 2, 18.2, 25);
    const wrongUnconvertedResult = 100 * 2 * 0.25;
    expect(correct).not.toBeCloseTo(wrongUnconvertedResult, 0);
    expect(correct).toBeGreaterThan(wrongUnconvertedResult * 10); // it should be ~18x bigger, not coincidentally close
  });
});

describe("calculateZmVehicleDuty", () => {
  it("converts the flat kwacha duty+surtax to ZAR, not added raw", () => {
    // duty 39461.45 + surtax 123.20 kwacha, 1 unit, at 0.68 ZAR/ZMW
    const zar = calculateZmVehicleDuty(39461.45, 123.20, 1, 0.68);
    expect(zar).toBeCloseTo((39461.45 + 123.20) * 0.68, 2);
  });
  it("scales with quantity", () => {
    const one = calculateZmVehicleDuty(1000, 0, 1, 0.68);
    const three = calculateZmVehicleDuty(1000, 0, 3, 0.68);
    expect(three).toBeCloseTo(one * 3, 5);
  });
});

describe("zmVehicleAgeBand", () => {
  const CURRENT_YEAR = 2026;

  it("returns null for a vehicle under 2 years old", () => {
    expect(zmVehicleAgeBand(2025, "petrol", CURRENT_YEAR)).toBeNull();
    expect(zmVehicleAgeBand(2026, "petrol", CURRENT_YEAR)).toBeNull();
  });
  it("returns 2_to_5 for a 2-4 year old vehicle", () => {
    expect(zmVehicleAgeBand(2024, "petrol", CURRENT_YEAR)).toBe("2_to_5");
    expect(zmVehicleAgeBand(2022, "petrol", CURRENT_YEAR)).toBe("2_to_5");
  });
  it("returns 5_plus for a 5+ year old vehicle", () => {
    expect(zmVehicleAgeBand(2021, "petrol", CURRENT_YEAR)).toBe("5_plus");
    expect(zmVehicleAgeBand(2010, "diesel", CURRENT_YEAR)).toBe("5_plus");
  });
  it("returns null for hybrids and EVs regardless of age — ZRA's own rule", () => {
    expect(zmVehicleAgeBand(2015, "hybrid", CURRENT_YEAR)).toBeNull();
    expect(zmVehicleAgeBand(2010, "electric", CURRENT_YEAR)).toBeNull();
  });
});

describe("calculatePlatformFee", () => {
  it("applies the seller's commission rate to the gross line amount", () => {
    expect(calculatePlatformFee(1000, 8)).toBe(80);
  });
});

describe("calculateSellerPayout", () => {
  it("subtracts platform fee only, for a locally-sourced line (no supplier cost)", () => {
    expect(calculateSellerPayout(1000, 80, null)).toBe(920);
  });
  it("subtracts both platform fee and the ZAR-converted supplier cost, for an imported line", () => {
    expect(calculateSellerPayout(1000, 80, 300)).toBe(620);
  });
});

describe("round2", () => {
  it("rounds to 2 decimal places without floating-point artifacts", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(19.995)).toBe(20);
  });
});
