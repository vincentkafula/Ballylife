import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Most route tests build hand-made products and catalogue items, which
    // the production CJ-only catalogue policy forbids. catalogPolicy tests
    // switch it back on explicitly.
    // A generous CJ points budget too: tests fire many CJ calls in quick
    // succession; the pacing itself is tested with _setCatalogPointsForTests.
    // DEMO_MODE keeps the demo-account order walkthrough the older order tests
    // exercise (off in production); a low BCRYPT_COST just keeps hashing fast.
    env: {
      CJ_ONLY_CATALOG: "false", CJ_CATALOG_POINTS_BUCKET: "100000000", CJ_CATALOG_POINTS_PER_MIN: "100000000",
      DEMO_MODE: "true", BCRYPT_COST: "5",
    },
  },
});
