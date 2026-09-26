import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Most route tests build hand-made products and catalogue items, which
    // the production CJ-only catalogue policy forbids. catalogPolicy tests
    // switch it back on explicitly.
    env: { CJ_ONLY_CATALOG: "false" },
  },
});
