import { describe, it, expect } from "vitest";
import { matchCjCategory, resolveCategory, isExcludedFromStore } from "./cjCategoryMap";

// [leaf, parent, top] as CJ's category tree names them.
const cases: [string, string, string, string][] = [
  ["Phone Cases", "Phone Accessories", "Phones & Accessories", "cat-csv-mobile-acc"],
  ["Power Bank", "Mobile Phone Accessories", "Phones & Accessories", "cat-csv-mobile-acc"],
  ["Wireless Earphones", "Earphones & Headphones", "Consumer Electronics", "cat-csv-audio"],
  ["Smart Watches", "Smart Electronics", "Consumer Electronics", "cat-01"],
  ["Security Cameras", "Security & Protection", "Home Improvement", "cat-csv-smart-home"],
  ["Action Cameras", "Camera & Photo", "Consumer Electronics", "cat-csv-cameras"],
  ["Keyboards", "Computer Peripherals", "Computer & Office", "cat-csv-computer-acc"],
  ["Laptop Stands", "Laptop Accessories", "Computer & Office", "cat-csv-computer-acc"],
  ["Projectors", "Home Audio & Video", "Consumer Electronics", "cat-csv-tv"],
  ["Hair Dryers", "Hair Care & Styling", "Health, Beauty & Hair", "cat-csv-beauty"],
  ["Lipstick", "Makeup", "Health, Beauty & Hair", "cat-csv-beauty"],
  ["Massage Guns", "Massage & Relaxation", "Health, Beauty & Hair", "cat-csv-health"],
  ["Bedding Sets", "Home Textile", "Home, Garden & Furniture", "cat-csv-decor"],
  ["Throw Pillows", "Home Textile", "Home, Garden & Furniture", "cat-csv-decor"],
  ["Air Fryers", "Kitchen Appliances", "Home, Garden & Furniture", "cat-csv-kitchen"],
  ["Water Bottles", "Drinkware", "Home, Garden & Furniture", "cat-csv-kitchen"],
  ["Flower Pots & Planters", "Garden Supplies", "Home, Garden & Furniture", "cat-csv-garden"],
  ["Sofas", "Living Room Furniture", "Home, Garden & Furniture", "cat-csv-furniture"],
  ["Screwdrivers", "Hand Tools", "Home Improvement", "cat-csv-diy"],
  ["Dog Collars", "Dog Supplies", "Pet Supplies", "cat-csv-pets"],
  ["Cat Eye Sunglasses", "Eyewear", "Women's Clothing", "cat-csv-fashion"],
  ["Building Blocks", "Educational Toys", "Toys, Kids & Babies", "cat-csv-toys"],
  ["Baby Carriers", "Activity & Gear", "Toys, Kids & Babies", "cat-csv-baby"],
  ["Necklaces", "Fine Jewelry", "Jewelry & Watches", "cat-csv-jewellery"],
  ["Sneakers", "Men's Shoes", "Bags & Shoes", "cat-csv-shoes"],
  ["Backpacks", "Men's Bags", "Bags & Shoes", "cat-csv-bags"],
  ["Dresses", "Women's Clothing", "Women's Clothing", "cat-csv-fashion"],
  ["Hoodies & Sweatshirts", "Tops", "Men's Clothing", "cat-csv-fashion"],
  ["Yoga Mats", "Fitness & Bodybuilding", "Sports & Outdoors", "cat-csv-sports"],
  ["Tents", "Camping & Hiking", "Sports & Outdoors", "cat-csv-sports"],
  ["Car Chargers", "Car Electronics", "Automobiles & Motorcycles", "cat-csv-mobile-acc"],
  ["Seat Covers", "Interior Accessories", "Automobiles & Motorcycles", "cat-csv-automotive"],
  ["Gel Pens", "Writing Supplies", "Office & School Supplies", "cat-csv-office"],
  ["LED Strip Lights", "Lighting", "Lights & Lighting", "cat-csv-decor"],
];

describe("matchCjCategory", () => {
  it.each(cases)("%s (%s > %s) -> %s", (leaf, parent, top, expected) => {
    expect(matchCjCategory(leaf, parent, top)?.fine).toBe(expected);
  });

  it("falls back to the parent, then the top level, when the leaf is unrecognised", () => {
    expect(matchCjCategory("Novelty XYZ", "Phones & Accessories", "")?.fine).toBe("cat-csv-mobile-acc");
    expect(matchCjCategory("Novelty XYZ", "Other", "Pet Supplies")?.fine).toBe("cat-csv-pets");
  });
});

describe("resolveCategory", () => {
  it("uses the broad category when the fine one isn't in this database", () => {
    const m = matchCjCategory("Wireless Earphones");
    expect(resolveCategory(m, new Set(["cat-01", "cat-03"]), "cat-03")).toBe("cat-01");
    expect(resolveCategory(null, new Set(["cat-03"]), "cat-03")).toBe("cat-03");
    expect(resolveCategory(null, new Set(), "cat-03")).toBeNull();
  });
});

describe("isExcludedFromStore", () => {
  it("keeps adult, tobacco/vape and weapon categories off the storefront", () => {
    expect(isExcludedFromStore("Adult Products")).toBe(true);
    expect(isExcludedFromStore("Electronic Cigarettes")).toBe(true);
    expect(isExcludedFromStore("Vape Accessories")).toBe(true);
  });
  it("doesn't catch ordinary products", () => {
    expect(isExcludedFromStore("Massage Guns")).toBe(false);
    expect(isExcludedFromStore("Glue Guns", "Sussex Tea Towels")).toBe(false);
  });
});
