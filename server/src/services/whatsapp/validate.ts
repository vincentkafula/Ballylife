/**
 * Input checks for the WhatsApp registration flows. Each returns the
 * cleaned value, or null when the input isn't acceptable.
 */

export function personName(input: string): string | null {
  const s = input.replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 80) return null;
  if (!/^[\p{L}][\p{L}'’.\- ]*[\p{L}.]$/u.test(s)) return null;
  if (s.split(" ").length < 2) return null; // first and last name
  return s.replace(/\b\p{Ll}/gu, c => c.toUpperCase());
}

export function businessName(input: string): string | null {
  const s = input.replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 60 && /[\p{L}\p{N}]/u.test(s) ? s : null;
}

export function email(input: string): string | null {
  const s = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) && s.length <= 120 ? s : null;
}

/** South African address: some text plus a 4-digit postal code. */
export function address(input: string): { line1: string; city: string; postalCode: string; full: string } | null {
  const full = input.replace(/\s+/g, " ").trim();
  const postal = full.match(/\b(\d{4})\b(?!.*\b\d{4}\b)/);
  if (full.length < 10 || full.length > 250 || !postal) return null;
  const parts = full.replace(postal[1], "").split(",").map(p => p.trim()).filter(Boolean);
  return { line1: parts[0] ?? full, city: parts.length > 1 ? parts[parts.length - 1] : "", postalCode: postal[1], full };
}

/** SA ID number: 13 digits, valid date of birth, Luhn check digit. */
export function saIdNumber(input: string): string | null {
  const s = input.replace(/\s+/g, "");
  if (!/^\d{13}$/.test(s)) return null;
  const mm = Number(s.slice(2, 4)), dd = Number(s.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(s[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0 ? s : null;
}

/** CIPC company registration number, e.g. 2021/123456/07. */
export function cipcNumber(input: string): string | null {
  const s = input.replace(/\s+/g, "").replace(/[-\\]/g, "/");
  return /^(19|20)\d{2}\/\d{6}\/\d{2}$/.test(s) ? s : null;
}

export function accountNumber(input: string): string | null {
  const s = input.replace(/[\s-]/g, "");
  return /^\d{6,13}$/.test(s) ? s : null;
}

export function branchCode(input: string): string | null {
  const s = input.replace(/\s+/g, "");
  return /^\d{6}$/.test(s) ? s : null;
}

/** Banks with their universal branch codes. */
export const BANKS: { id: string; name: string; branch: string | null }[] = [
  { id: "absa", name: "ABSA", branch: "632005" },
  { id: "capitec", name: "Capitec", branch: "470010" },
  { id: "fnb", name: "FNB", branch: "250655" },
  { id: "nedbank", name: "Nedbank", branch: "198765" },
  { id: "standard", name: "Standard Bank", branch: "051001" },
  { id: "tyme", name: "TymeBank", branch: "678910" },
  { id: "discovery", name: "Discovery Bank", branch: "679000" },
  { id: "african", name: "African Bank", branch: "430000" },
  { id: "investec", name: "Investec", branch: "580105" },
  { id: "other", name: "Other bank", branch: null },
];

/** "+27 82 ••• 4821" -- for summaries. */
export const maskPhone = (phone: string) => `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ••• ${phone.slice(-4)}`;
