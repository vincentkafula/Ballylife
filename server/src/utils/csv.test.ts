import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple CSV with a header row", () => {
    const csv = "name,price\nWidget,100\nGadget,200";
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", price: "100" },
      { name: "Gadget", price: "200" },
    ]);
  });

  it("handles a quoted field containing a comma — the exact case a naive split(',') breaks on", () => {
    const csv = 'name,description\nWidget,"A great widget, on sale now"';
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", description: "A great widget, on sale now" },
    ]);
  });

  it("handles doubled-quote escaping inside a quoted field", () => {
    const csv = 'name,description\nWidget,"She said ""hello"" to it"';
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", description: 'She said "hello" to it' },
    ]);
  });

  it("handles a quoted field containing a newline", () => {
    const csv = 'name,description\nWidget,"Line one\nLine two"';
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", description: "Line one\nLine two" },
    ]);
  });

  it("skips blank rows", () => {
    const csv = "name,price\nWidget,100\n\n\nGadget,200\n";
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", price: "100" },
      { name: "Gadget", price: "200" },
    ]);
  });

  it("handles Windows-style CRLF line endings", () => {
    const csv = "name,price\r\nWidget,100\r\nGadget,200\r\n";
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", price: "100" },
      { name: "Gadget", price: "200" },
    ]);
  });

  it("trims whitespace around header and field values", () => {
    const csv = "name , price\n Widget , 100 ";
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", price: "100" },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("returns an empty array for a header-only CSV (no data rows)", () => {
    expect(parseCsv("name,price")).toEqual([]);
  });

  it("fills missing trailing fields with an empty string rather than dropping the row", () => {
    const csv = "name,price,notes\nWidget,100";
    expect(parseCsv(csv)).toEqual([
      { name: "Widget", price: "100", notes: "" },
    ]);
  });
});
