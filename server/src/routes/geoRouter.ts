import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";

const router = Router();

// Every country in the world (all ~195 sovereign states, using the
// commonly-recognized UN-membership-plus-a-few-observers list), each
// mapped to its real official currency -- kept tightly matched to
// what's really in mkt_fx_rates so every entry converts correctly.
// Several groups share one currency in reality (the Eurozone, the
// East Caribbean Dollar, the two CFA francs, several USD-dollarized
// economies), so this isn't ~195 independent rates, it's ~195
// countries correctly mapped onto however many distinct currencies
// actually exist. Adding a country without a real rate behind it would
// just silently show wrong converted numbers, so this list is verified
// programmatically (see geoRouter.integration.test.ts) against
// mkt_fx_rates before shipping, not just assumed correct.
interface CountryOption {
  countryCode: string;
  country: string;
  code: string;
  symbol: string;
  name: string;
}

const SUPPORTED_COUNTRIES: CountryOption[] = [
  // Southern Africa (Ballylife's home region)
  { countryCode: "ZM", country: "Zambia", code: "ZMW", symbol: "K", name: "Zambian Kwacha" },
  { countryCode: "ZA", country: "South Africa", code: "ZAR", symbol: "R", name: "South African Rand" },
  { countryCode: "ZW", country: "Zimbabwe", code: "USD", symbol: "$", name: "US Dollar" }, // Zimbabwe's own currency (ZWL) has a history of severe instability -- USD is what's actually used day to day
  { countryCode: "BW", country: "Botswana", code: "BWP", symbol: "P", name: "Botswana Pula" },
  { countryCode: "NA", country: "Namibia", code: "NAD", symbol: "N$", name: "Namibian Dollar" },
  { countryCode: "LS", country: "Lesotho", code: "LSL", symbol: "L", name: "Lesotho Loti" },
  { countryCode: "SZ", country: "Eswatini", code: "SZL", symbol: "L", name: "Swazi Lilangeni" },
  { countryCode: "MZ", country: "Mozambique", code: "MZN", symbol: "MT", name: "Mozambican Metical" },
  { countryCode: "MW", country: "Malawi", code: "MWK", symbol: "MK", name: "Malawian Kwacha" },
  { countryCode: "MG", country: "Madagascar", code: "MGA", symbol: "Ar", name: "Malagasy Ariary" },
  { countryCode: "MU", country: "Mauritius", code: "MUR", symbol: "₨", name: "Mauritian Rupee" },
  { countryCode: "SC", country: "Seychelles", code: "SCR", symbol: "₨", name: "Seychellois Rupee" },
  { countryCode: "KM", country: "Comoros", code: "KMF", symbol: "CF", name: "Comorian Franc" },
  // East Africa
  { countryCode: "KE", country: "Kenya", code: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  { countryCode: "TZ", country: "Tanzania", code: "TZS", symbol: "TSh", name: "Tanzanian Shilling" },
  { countryCode: "UG", country: "Uganda", code: "UGX", symbol: "USh", name: "Ugandan Shilling" },
  { countryCode: "RW", country: "Rwanda", code: "RWF", symbol: "FRw", name: "Rwandan Franc" },
  { countryCode: "BI", country: "Burundi", code: "BIF", symbol: "FBu", name: "Burundian Franc" },
  { countryCode: "ET", country: "Ethiopia", code: "ETB", symbol: "Br", name: "Ethiopian Birr" },
  { countryCode: "ER", country: "Eritrea", code: "ERN", symbol: "Nfk", name: "Eritrean Nakfa" },
  { countryCode: "SO", country: "Somalia", code: "SOS", symbol: "Sh", name: "Somali Shilling" },
  { countryCode: "SS", country: "South Sudan", code: "SSP", symbol: "£", name: "South Sudanese Pound" },
  { countryCode: "SD", country: "Sudan", code: "SDG", symbol: "ج.س.", name: "Sudanese Pound" },
  { countryCode: "DJ", country: "Djibouti", code: "DJF", symbol: "Fdj", name: "Djiboutian Franc" },
  // Central Africa (XAF)
  { countryCode: "CM", country: "Cameroon", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "CF", country: "Central African Republic", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "TD", country: "Chad", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "CG", country: "Republic of the Congo", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "GQ", country: "Equatorial Guinea", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "GA", country: "Gabon", code: "XAF", symbol: "FCFA", name: "Central African CFA Franc" },
  { countryCode: "CD", country: "DR Congo", code: "CDF", symbol: "FC", name: "Congolese Franc" },
  { countryCode: "ST", country: "São Tomé and Príncipe", code: "STN", symbol: "Db", name: "São Tomé and Príncipe Dobra" },
  // West Africa (mostly XOF)
  { countryCode: "NG", country: "Nigeria", code: "NGN", symbol: "₦", name: "Nigerian Naira" },
  { countryCode: "GH", country: "Ghana", code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
  { countryCode: "CI", country: "Ivory Coast", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "SN", country: "Senegal", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "ML", country: "Mali", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "BF", country: "Burkina Faso", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "NE", country: "Niger", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "BJ", country: "Benin", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "TG", country: "Togo", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "GW", country: "Guinea-Bissau", code: "XOF", symbol: "CFA", name: "West African CFA Franc" },
  { countryCode: "GN", country: "Guinea", code: "GNF", symbol: "FG", name: "Guinean Franc" },
  { countryCode: "SL", country: "Sierra Leone", code: "SLL", symbol: "Le", name: "Sierra Leonean Leone" },
  { countryCode: "LR", country: "Liberia", code: "LRD", symbol: "L$", name: "Liberian Dollar" },
  { countryCode: "GM", country: "Gambia", code: "GMD", symbol: "D", name: "Gambian Dalasi" },
  { countryCode: "CV", country: "Cape Verde", code: "CVE", symbol: "$", name: "Cape Verdean Escudo" },
  { countryCode: "MR", country: "Mauritania", code: "MRU", symbol: "UM", name: "Mauritanian Ouguiya" },
  // North Africa
  { countryCode: "EG", country: "Egypt", code: "EGP", symbol: "E£", name: "Egyptian Pound" },
  { countryCode: "MA", country: "Morocco", code: "MAD", symbol: "د.م.", name: "Moroccan Dirham" },
  { countryCode: "DZ", country: "Algeria", code: "DZD", symbol: "دج", name: "Algerian Dinar" },
  { countryCode: "TN", country: "Tunisia", code: "TND", symbol: "د.ت", name: "Tunisian Dinar" },
  { countryCode: "LY", country: "Libya", code: "LYD", symbol: "ل.د", name: "Libyan Dinar" },
  // Southern Africa (rest)
  { countryCode: "AO", country: "Angola", code: "AOA", symbol: "Kz", name: "Angolan Kwanza" },
  // Non-African reference currencies, kept from the original selector
  { countryCode: "US", country: "United States", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "CN", country: "China", code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { countryCode: "JP", country: "Japan", code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { countryCode: "KR", country: "South Korea", code: "KRW", symbol: "₩", name: "South Korean Won" },
  // ── Europe ──
  { countryCode: "AL", country: "Albania", code: "ALL", symbol: "L", name: "Albanian Lek" },
  { countryCode: "AD", country: "Andorra", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "AT", country: "Austria", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "BY", country: "Belarus", code: "BYN", symbol: "Br", name: "Belarusian Ruble" },
  { countryCode: "BE", country: "Belgium", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "BA", country: "Bosnia and Herzegovina", code: "BAM", symbol: "KM", name: "Convertible Mark" },
  { countryCode: "BG", country: "Bulgaria", code: "BGN", symbol: "лв", name: "Bulgarian Lev" },
  { countryCode: "HR", country: "Croatia", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "CY", country: "Cyprus", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "CZ", country: "Czech Republic", code: "CZK", symbol: "Kč", name: "Czech Koruna" },
  { countryCode: "DK", country: "Denmark", code: "DKK", symbol: "kr", name: "Danish Krone" },
  { countryCode: "EE", country: "Estonia", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "FI", country: "Finland", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "FR", country: "France", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "DE", country: "Germany", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "GR", country: "Greece", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "HU", country: "Hungary", code: "HUF", symbol: "Ft", name: "Hungarian Forint" },
  { countryCode: "IS", country: "Iceland", code: "ISK", symbol: "kr", name: "Icelandic Krona" },
  { countryCode: "IE", country: "Ireland", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "IT", country: "Italy", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "XK", country: "Kosovo", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "LV", country: "Latvia", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "LI", country: "Liechtenstein", code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { countryCode: "LT", country: "Lithuania", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "LU", country: "Luxembourg", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "MT", country: "Malta", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "MD", country: "Moldova", code: "MDL", symbol: "L", name: "Moldovan Leu" },
  { countryCode: "MC", country: "Monaco", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "ME", country: "Montenegro", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "NL", country: "Netherlands", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "MK", country: "North Macedonia", code: "MKD", symbol: "ден", name: "Macedonian Denar" },
  { countryCode: "NO", country: "Norway", code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { countryCode: "PL", country: "Poland", code: "PLN", symbol: "zł", name: "Polish Zloty" },
  { countryCode: "PT", country: "Portugal", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "RO", country: "Romania", code: "RON", symbol: "lei", name: "Romanian Leu" },
  { countryCode: "RU", country: "Russia", code: "RUB", symbol: "₽", name: "Russian Ruble" },
  { countryCode: "SM", country: "San Marino", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "RS", country: "Serbia", code: "RSD", symbol: "дин", name: "Serbian Dinar" },
  { countryCode: "SK", country: "Slovakia", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "SI", country: "Slovenia", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "ES", country: "Spain", code: "EUR", symbol: "€", name: "Euro" },
  { countryCode: "SE", country: "Sweden", code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { countryCode: "CH", country: "Switzerland", code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { countryCode: "UA", country: "Ukraine", code: "UAH", symbol: "₴", name: "Ukrainian Hryvnia" },
  { countryCode: "GB", country: "United Kingdom", code: "GBP", symbol: "£", name: "British Pound" },
  { countryCode: "VA", country: "Vatican City", code: "EUR", symbol: "€", name: "Euro" },
  // ── Asia ──
  { countryCode: "AF", country: "Afghanistan", code: "AFN", symbol: "؋", name: "Afghan Afghani" },
  { countryCode: "AM", country: "Armenia", code: "AMD", symbol: "֏", name: "Armenian Dram" },
  { countryCode: "AZ", country: "Azerbaijan", code: "AZN", symbol: "₼", name: "Azerbaijani Manat" },
  { countryCode: "BH", country: "Bahrain", code: "BHD", symbol: ".د.ب", name: "Bahraini Dinar" },
  { countryCode: "BD", country: "Bangladesh", code: "BDT", symbol: "৳", name: "Bangladeshi Taka" },
  { countryCode: "BT", country: "Bhutan", code: "BTN", symbol: "Nu.", name: "Bhutanese Ngultrum" },
  { countryCode: "BN", country: "Brunei", code: "BND", symbol: "$", name: "Brunei Dollar" },
  { countryCode: "KH", country: "Cambodia", code: "KHR", symbol: "៛", name: "Cambodian Riel" },
  { countryCode: "GE", country: "Georgia", code: "GEL", symbol: "₾", name: "Georgian Lari" },
  { countryCode: "HK", country: "Hong Kong", code: "HKD", symbol: "$", name: "Hong Kong Dollar" },
  { countryCode: "IN", country: "India", code: "INR", symbol: "₹", name: "Indian Rupee" },
  { countryCode: "ID", country: "Indonesia", code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  { countryCode: "IR", country: "Iran", code: "IRR", symbol: "﷼", name: "Iranian Rial" },
  { countryCode: "IQ", country: "Iraq", code: "IQD", symbol: "ع.د", name: "Iraqi Dinar" },
  { countryCode: "IL", country: "Israel", code: "ILS", symbol: "₪", name: "Israeli Shekel" },
  { countryCode: "JO", country: "Jordan", code: "JOD", symbol: "د.ا", name: "Jordanian Dinar" },
  { countryCode: "KZ", country: "Kazakhstan", code: "KZT", symbol: "₸", name: "Kazakhstani Tenge" },
  { countryCode: "KW", country: "Kuwait", code: "KWD", symbol: "د.ك", name: "Kuwaiti Dinar" },
  { countryCode: "KG", country: "Kyrgyzstan", code: "KGS", symbol: "с", name: "Kyrgyzstani Som" },
  { countryCode: "LA", country: "Laos", code: "LAK", symbol: "₭", name: "Lao Kip" },
  { countryCode: "LB", country: "Lebanon", code: "LBP", symbol: "ل.ل", name: "Lebanese Pound" },
  { countryCode: "MY", country: "Malaysia", code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
  { countryCode: "MV", country: "Maldives", code: "MVR", symbol: "Rf", name: "Maldivian Rufiyaa" },
  { countryCode: "MN", country: "Mongolia", code: "MNT", symbol: "₮", name: "Mongolian Tugrik" },
  { countryCode: "MM", country: "Myanmar", code: "MMK", symbol: "K", name: "Myanmar Kyat" },
  { countryCode: "NP", country: "Nepal", code: "NPR", symbol: "₨", name: "Nepalese Rupee" },
  { countryCode: "KP", country: "North Korea", code: "KPW", symbol: "₩", name: "North Korean Won" },
  { countryCode: "OM", country: "Oman", code: "OMR", symbol: "ر.ع.", name: "Omani Rial" },
  { countryCode: "PK", country: "Pakistan", code: "PKR", symbol: "₨", name: "Pakistani Rupee" },
  { countryCode: "PS", country: "Palestine", code: "ILS", symbol: "₪", name: "Israeli Shekel" },
  { countryCode: "PH", country: "Philippines", code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { countryCode: "QA", country: "Qatar", code: "QAR", symbol: "ر.ق", name: "Qatari Riyal" },
  { countryCode: "SA", country: "Saudi Arabia", code: "SAR", symbol: "ر.س", name: "Saudi Riyal" },
  { countryCode: "SG", country: "Singapore", code: "SGD", symbol: "$", name: "Singapore Dollar" },
  { countryCode: "LK", country: "Sri Lanka", code: "LKR", symbol: "₨", name: "Sri Lankan Rupee" },
  { countryCode: "SY", country: "Syria", code: "SYP", symbol: "£", name: "Syrian Pound" },
  { countryCode: "TW", country: "Taiwan", code: "TWD", symbol: "NT$", name: "New Taiwan Dollar" },
  { countryCode: "TJ", country: "Tajikistan", code: "TJS", symbol: "SM", name: "Tajikistani Somoni" },
  { countryCode: "TH", country: "Thailand", code: "THB", symbol: "฿", name: "Thai Baht" },
  { countryCode: "TL", country: "Timor-Leste", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "TR", country: "Turkey", code: "TRY", symbol: "₺", name: "Turkish Lira" },
  { countryCode: "TM", country: "Turkmenistan", code: "TMT", symbol: "m", name: "Turkmenistani Manat" },
  { countryCode: "AE", country: "United Arab Emirates", code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { countryCode: "UZ", country: "Uzbekistan", code: "UZS", symbol: "so'm", name: "Uzbekistani Som" },
  { countryCode: "VN", country: "Vietnam", code: "VND", symbol: "₫", name: "Vietnamese Dong" },
  { countryCode: "YE", country: "Yemen", code: "YER", symbol: "﷼", name: "Yemeni Rial" },
  // ── Americas ──
  { countryCode: "CA", country: "Canada", code: "CAD", symbol: "$", name: "Canadian Dollar" },
  { countryCode: "MX", country: "Mexico", code: "MXN", symbol: "$", name: "Mexican Peso" },
  { countryCode: "AG", country: "Antigua and Barbuda", code: "XCD", symbol: "$", name: "East Caribbean Dollar" },
  { countryCode: "BS", country: "Bahamas", code: "BSD", symbol: "$", name: "Bahamian Dollar" },
  { countryCode: "BB", country: "Barbados", code: "BBD", symbol: "$", name: "Barbadian Dollar" },
  { countryCode: "CU", country: "Cuba", code: "CUP", symbol: "$", name: "Cuban Peso" },
  { countryCode: "DM", country: "Dominica", code: "XCD", symbol: "$", name: "East Caribbean Dollar" },
  { countryCode: "DO", country: "Dominican Republic", code: "DOP", symbol: "$", name: "Dominican Peso" },
  { countryCode: "GD", country: "Grenada", code: "XCD", symbol: "$", name: "East Caribbean Dollar" },
  { countryCode: "HT", country: "Haiti", code: "HTG", symbol: "G", name: "Haitian Gourde" },
  { countryCode: "JM", country: "Jamaica", code: "JMD", symbol: "$", name: "Jamaican Dollar" },
  { countryCode: "KN", country: "Saint Kitts and Nevis", code: "XCD", symbol: "$", name: "East Caribbean Dollar" },
  { countryCode: "LC", country: "Saint Lucia", code: "XCD", symbol: "$", name: "East Caribbean Dollar" },
  { countryCode: "VC", country: "Saint Vincent and the Grenadines", code: "XCD", symbol: "$", name: "East Caribbean Dollar" },
  { countryCode: "TT", country: "Trinidad and Tobago", code: "TTD", symbol: "$", name: "Trinidad and Tobago Dollar" },
  { countryCode: "BZ", country: "Belize", code: "BZD", symbol: "$", name: "Belize Dollar" },
  { countryCode: "CR", country: "Costa Rica", code: "CRC", symbol: "₡", name: "Costa Rican Colon" },
  { countryCode: "SV", country: "El Salvador", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "GT", country: "Guatemala", code: "GTQ", symbol: "Q", name: "Guatemalan Quetzal" },
  { countryCode: "HN", country: "Honduras", code: "HNL", symbol: "L", name: "Honduran Lempira" },
  { countryCode: "NI", country: "Nicaragua", code: "NIO", symbol: "C$", name: "Nicaraguan Cordoba" },
  { countryCode: "PA", country: "Panama", code: "PAB", symbol: "B/.", name: "Panamanian Balboa" },
  { countryCode: "AR", country: "Argentina", code: "ARS", symbol: "$", name: "Argentine Peso" },
  { countryCode: "BO", country: "Bolivia", code: "BOB", symbol: "Bs", name: "Bolivian Boliviano" },
  { countryCode: "BR", country: "Brazil", code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { countryCode: "CL", country: "Chile", code: "CLP", symbol: "$", name: "Chilean Peso" },
  { countryCode: "CO", country: "Colombia", code: "COP", symbol: "$", name: "Colombian Peso" },
  { countryCode: "EC", country: "Ecuador", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "GY", country: "Guyana", code: "GYD", symbol: "$", name: "Guyanese Dollar" },
  { countryCode: "PY", country: "Paraguay", code: "PYG", symbol: "₲", name: "Paraguayan Guarani" },
  { countryCode: "PE", country: "Peru", code: "PEN", symbol: "S/", name: "Peruvian Sol" },
  { countryCode: "SR", country: "Suriname", code: "SRD", symbol: "$", name: "Surinamese Dollar" },
  { countryCode: "UY", country: "Uruguay", code: "UYU", symbol: "$", name: "Uruguayan Peso" },
  { countryCode: "VE", country: "Venezuela", code: "VES", symbol: "Bs", name: "Venezuelan Bolivar" },
  // ── Oceania ──
  { countryCode: "AU", country: "Australia", code: "AUD", symbol: "$", name: "Australian Dollar" },
  { countryCode: "FJ", country: "Fiji", code: "FJD", symbol: "$", name: "Fijian Dollar" },
  { countryCode: "KI", country: "Kiribati", code: "AUD", symbol: "$", name: "Australian Dollar" },
  { countryCode: "MH", country: "Marshall Islands", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "FM", country: "Micronesia", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "NR", country: "Nauru", code: "AUD", symbol: "$", name: "Australian Dollar" },
  { countryCode: "NZ", country: "New Zealand", code: "NZD", symbol: "$", name: "New Zealand Dollar" },
  { countryCode: "PW", country: "Palau", code: "USD", symbol: "$", name: "US Dollar" },
  { countryCode: "PG", country: "Papua New Guinea", code: "PGK", symbol: "K", name: "Papua New Guinean Kina" },
  { countryCode: "WS", country: "Samoa", code: "WST", symbol: "T", name: "Samoan Tala" },
  { countryCode: "SB", country: "Solomon Islands", code: "SBD", symbol: "$", name: "Solomon Islands Dollar" },
  { countryCode: "TO", country: "Tonga", code: "TOP", symbol: "T$", name: "Tongan Pa'anga" },
  { countryCode: "TV", country: "Tuvalu", code: "AUD", symbol: "$", name: "Australian Dollar" },
  { countryCode: "VU", country: "Vanuatu", code: "VUV", symbol: "VT", name: "Vanuatu Vatu" },
];
const ZM_DEFAULT = SUPPORTED_COUNTRIES[0];

router.get("/geo/countries", (_req: Request, res: Response) => {
  res.json({ success: true, data: SUPPORTED_COUNTRIES });
});

// IP-based country detection. Requires app.set("trust proxy", ...) in
// index.ts so req.ip reflects Railway's X-Forwarded-For rather than
// the proxy's own address -- without that this always resolves to a
// private/internal IP and silently falls back to the default, which
// is exactly the symptom this route exists to fix.
router.get("/geo/detect", async (req: Request, res: Response) => {
  const ip = req.ip ?? "";
  const isPrivate = !ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("::ffff:127.");
  if (isPrivate) {
    // Local dev / no real client IP to resolve -- fall back rather
    // than send a loopback address to a geolocation service.
    res.json({ success: true, data: ZM_DEFAULT });
    return;
  }
  try {
    const geoRes = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`);
    const geo = await geoRes.json() as { status: string; countryCode?: string };
    const match = geo.status === "success" ? SUPPORTED_COUNTRIES.find(c => c.countryCode === geo.countryCode) : undefined;
    res.json({ success: true, data: match ?? ZM_DEFAULT });
  } catch (err) {
    console.error("[geo] IP detection failed, falling back to default:", err);
    res.json({ success: true, data: ZM_DEFAULT });
  }
});

// Live-location detection: the browser's own Geolocation API gives an
// actual GPS/network-assisted position, which is more precise than IP
// lookup (no VPN/proxy/corporate-network skew) -- the frontend calls
// this once the user grants location permission and gets back a real
// lat/lng pair. Reverse-geocoded via OpenStreetMap's free Nominatim
// API (no key required; a descriptive User-Agent is required by their
// usage policy).
router.post("/geo/reverse", async (req: Request, res: Response) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ success: false, error: "lat and lng (numbers) are required" });
    return;
  }
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`,
      { headers: { "User-Agent": "Ballylife-Marketplace/1.0 (contact: vincent.kafula@gmail.com)" } }
    );
    const geo = await geoRes.json() as { address?: { country_code?: string } };
    const countryCode = geo.address?.country_code?.toUpperCase();
    const match = countryCode ? SUPPORTED_COUNTRIES.find(c => c.countryCode === countryCode) : undefined;
    if (!match) {
      res.json({ success: true, data: ZM_DEFAULT, meta: { matchedSupportedList: false } });
      return;
    }
    res.json({ success: true, data: match });
  } catch (err) {
    console.error("[geo] Reverse geocoding failed:", err);
    res.status(502).json({ success: false, error: "Could not resolve your location right now" });
  }
});

router.get("/currency/rates", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool!.query(`SELECT currency, rate_to_zar, updated_at FROM mkt_fx_rates`);
    // rate_to_zar is "1 unit of currency = this many ZAR" (admin-facing,
    // used for duty/settlement math elsewhere in this app) -- the
    // storefront's own display prices are treated as ZAR-denominated,
    // so what the frontend needs is the inverse: how many units of
    // {currency} does 1 ZAR buy.
    const rates: Record<string, number> = { ZAR: 1 };
    let oldestUpdate = new Date();
    for (const r of rows) {
      const rateToZar = Number(r.rate_to_zar);
      if (rateToZar > 0) rates[r.currency] = 1 / rateToZar;
      const updatedAt = new Date(r.updated_at);
      if (updatedAt < oldestUpdate) oldestUpdate = updatedAt;
    }
    const staleMs = 1000 * 60 * 60 * 24 * 7; // a week with no rate refresh is worth flagging
    const stale = rows.length > 0 && (Date.now() - oldestUpdate.getTime()) > staleMs;
    res.json({ success: true, data: { rates }, stale });
  } catch (err) {
    console.error("[currency] Failed to load FX rates:", err);
    res.status(500).json({ success: false, error: "Failed to load currency rates" });
  }
});

export default router;
