import { describe, it, expect } from "vitest";
import { classifyProductName, categorizeProduct } from "./productCategorizer";

describe("classifyProductName", () => {
  // Real product names that CJ's category pages had filed wrongly.
  it.each([
    ["Extra-absorbent Full-body Wrap Towel", "cat-csv-decor"], // was Office Supplies
    ["KW850 OBD2 CAN BUS Code Reader Car Engine Fault Code Detector Scanner", "cat-csv-automotive"], // was Office Supplies
    ["Dog Slow Feeder Bowl Companion Intelligence-Boosting Puzzle Toy", "cat-csv-pets"], // was Toys & Games
    ["Women's Multifunctional Electric Shaver", "cat-csv-beauty"], // was Toys & Games
    ["Double-layer Cationic Jacquard Taffeta Fleece Blanket", "cat-csv-decor"], // was School Supplies
    ["Hand Crocheted Finished Tulip Bouquet Knitted Yarn Handheld Bouquet Artificial Flower", "cat-csv-decor"], // was School Supplies
    ["Fashionable And Unique Watch Box", "cat-csv-jewellery"], // was Cleaning & Household
    ["66-in-1 Ratchet Screwdriver Set S2 Steel Bits", "cat-csv-diy"], // was Cleaning & Household
    ["Faucet Water Filter", "cat-csv-home-appliances"], // was TV & Home Entertainment
    ["Portable Blood Glucose Meter Kit, Auto Coding, Fast 10s Results", "cat-csv-health"], // not a car part
    ["Anti-allergy AAA Zircon Bracelet Necklace Earring Ring", "cat-csv-jewellery"], // not batteries
    ["For Lenovo Tab P12 Tablet Protective Case", "cat-csv-computer-acc"],
    ["Anti-fingerprint Phone Case With Alien Design", "cat-csv-mobile-acc"],
    ["Children's Summer New Jumpsuit For Girls", "cat-csv-baby"],
    ["Warm Plush Slippers Waterproof And Non-slip Cotton Slippers", "cat-csv-shoes"],
    ["Professional 6 Inch 11 Note Lotus Heart Steel Tongue Drum", "cat-csv-audio"],
    ["Wireless Projector And Mobile Phone Computer HDMI Transmitter", "cat-csv-tv"],
    ["Washing Machine Cleaner", "cat-csv-cleaning"],
  ])("%s", (name, expected) => {
    expect(classifyProductName(name)).toBe(expected);
  });

  it("returns null when the name says nothing recognisable", () => {
    expect(classifyProductName("Urban Simplicity, Minimalist Leisure")).toBeNull();
  });
});

describe("categorizeProduct", () => {
  const known = new Set(["cat-01", "cat-02", "cat-03", "cat-csv-pets", "cat-csv-kitchen"]);

  it("prefers the product's name over the supplier page it was found on", () => {
    expect(categorizeProduct("Stainless Steel Dog Bowl", ["Toys", "Toys & Hobbies"], known, "cat-01")).toBe("cat-csv-pets");
  });

  it("rolls a fine category up to its broad one when this database lacks it", () => {
    expect(categorizeProduct("Wireless Bluetooth Earbuds", [], known, "cat-03")).toBe("cat-01");
  });

  it("falls back to the supplier category path, then the fallback", () => {
    expect(categorizeProduct("Urban Simplicity", ["Kitchen", "Home"], known, "cat-01")).toBe("cat-csv-kitchen");
    expect(categorizeProduct("Urban Simplicity", [], known, "cat-02")).toBe("cat-02");
  });
});

describe("handmade flowers", () => {
  it.each([
    "Fully Handmade Crochet Open Tulip Yarn Flower Artificial Knitted Flower",
    "Handmade Finished Pointed Artificial Rose Crochet Knitted Yarn Flower Hand Hooked Flower",
  ])("%s is decor, not school supplies", name => {
    expect(classifyProductName(name)).toBe("cat-csv-decor");
  });

  it("a flower-print dress is still clothing", () => {
    expect(classifyProductName("Women's Summer Flower Print Dress")).toBe("cat-csv-fashion");
  });
});
