/**
 * Everything shoppers read must be in English. Supplier data (1688 above
 * all, sometimes CJ) arrives with Chinese option names, spec lines and
 * marketplace badges. This translates the handful of terms that make up
 * almost every option label (colours, sizes, units), and removes whatever
 * Chinese is left -- a line that's still Chinese after that is dropped
 * rather than shown half-translated.
 */

const CJK = /[⺀-⿿　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏]/;
const CJK_ALL = new RegExp(CJK.source, "g");

export const hasChinese = (s: string | null | undefined): boolean => Boolean(s) && CJK.test(String(s));

// Longest terms first so 深蓝色 wins over 蓝色.
const TERMS: [string, string][] = ([
  // colours
  ["深蓝色", "Navy"], ["藏青色", "Navy"], ["浅蓝色", "Light Blue"], ["天蓝色", "Sky Blue"], ["宝蓝色", "Royal Blue"], ["湖蓝色", "Lake Blue"],
  ["酒红色", "Wine Red"], ["玫红色", "Rose Red"], ["军绿色", "Army Green"], ["墨绿色", "Dark Green"], ["浅绿色", "Light Green"], ["薄荷绿", "Mint Green"],
  ["浅灰色", "Light Grey"], ["深灰色", "Dark Grey"], ["粉红色", "Pink"], ["浅粉色", "Light Pink"], ["玫瑰金", "Rose Gold"], ["香槟色", "Champagne"],
  ["卡其色", "Khaki"], ["咖啡色", "Coffee"], ["焦糖色", "Caramel"], ["杏色", "Apricot"], ["米白色", "Off-White"], ["米色", "Beige"],
  ["黑色", "Black"], ["白色", "White"], ["红色", "Red"], ["蓝色", "Blue"], ["绿色", "Green"], ["黄色", "Yellow"], ["粉色", "Pink"],
  ["紫色", "Purple"], ["灰色", "Grey"], ["棕色", "Brown"], ["橙色", "Orange"], ["金色", "Gold"], ["银色", "Silver"], ["透明", "Clear"],
  ["彩色", "Multicolour"], ["混色", "Mixed Colours"], ["随机色", "Random Colour"], ["随机", "Random"], ["原色", "Natural"], ["木色", "Wood"],
  ["黑", "Black"], ["白", "White"], ["红", "Red"], ["蓝", "Blue"], ["绿", "Green"], ["黄", "Yellow"], ["粉", "Pink"], ["紫", "Purple"], ["灰", "Grey"],
  // option names and sizes
  ["颜色分类", "Colour"], ["颜色", "Colour"], ["尺码", "Size"], ["尺寸", "Size"], ["规格", "Spec"], ["款式", "Style"], ["型号", "Model"],
  ["容量", "Capacity"], ["套餐", "Package"], ["适用", "For"], ["均码", "One Size"], ["加大码", "XL"], ["特大号", "XXL"], ["大号", "Large"],
  ["中号", "Medium"], ["小号", "Small"], ["大", "Large"], ["中", "Medium"], ["小", "Small"], ["单个", "Single"], ["一套", "1 Set"], ["套装", "Set"],
  ["标准版", "Standard"], ["标准", "Standard"], ["升级版", "Upgraded"], ["豪华版", "Deluxe"], ["基础款", "Basic"], ["新款", ""], ["款", "Style"],
  ["男士", "Men's"], ["女士", "Women's"], ["男", "Men's"], ["女", "Women's"], ["儿童", "Kids"], ["成人", "Adult"], ["婴儿", "Baby"],
  ["充电款", "Rechargeable"], ["充电", "Rechargeable"], ["电池款", "Battery"], ["电池", "Battery"], ["插电", "Plug-in"], ["无线", "Wireless"],
  ["有线", "Wired"], ["默认", "Default"], ["其他", "Other"], ["包邮", ""], ["现货", ""], ["一件代发", ""], ["厂家直销", ""], ["批发", ""],
  // units
  ["毫米", "mm"], ["厘米", "cm"], ["千克", "kg"], ["公斤", "kg"], ["毫升", "ml"], ["个装", "-pack"], ["只装", "-pack"], ["片装", "-pack"],
  ["米", "m"], ["克", "g"], ["升", "L"], ["个", " pcs"], ["只", " pcs"], ["件", " pcs"], ["片", " pcs"], ["条", " pcs"], ["双", " pairs"], ["对", " pairs"], ["瓦", "W"], ["伏", "V"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

/** Full-width ASCII (Ａ１，) to normal, and CJK punctuation to its English equivalent. */
function normalisePunctuation(s: string): string {
  return s
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, " ").replace(/[，、]/g, ", ").replace(/[；]/g, "; ").replace(/[：]/g, ": ").replace(/[（【「『]/g, "(").replace(/[）】」』]/g, ")")
    .replace(/[。]/g, ". ").replace(/[～〜]/g, "~").replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
}

function translateTerms(s: string): string {
  let out = s;
  for (const [zh, en] of TERMS) if (out.includes(zh)) out = out.split(zh).join(en ? ` ${en} ` : " ");
  return out;
}

const tidy = (s: string) => s
  .replace(/\(\s*\)/g, "").replace(/\s+([,.;:)])/g, "$1").replace(/([(])\s+/g, "$1")
  .replace(/\s*([,;:/|])\s*(?=[,;:/|]|$)/g, "").replace(/^[\s,.;:/|+-]+|[\s,;:/|+-]+$/g, "")
  .replace(/\s+-(?=\S)/g, "-").replace(/\s{2,}/g, " ").trim();

/** Short text (names, option labels): translate known terms, then remove any Chinese left. */
export function englishOnly(text: string | null | undefined): string {
  if (!text) return "";
  const s = translateTerms(normalisePunctuation(String(text)));
  return tidy(s.replace(CJK_ALL, " "));
}

/** Long text (descriptions): a line still in Chinese after translating known terms is dropped whole. */
export function englishLines(text: string | null | undefined): string {
  if (!text) return "";
  return String(text).split("\n")
    .map(line => tidy(translateTerms(normalisePunctuation(line))))
    .filter(line => line && !CJK.test(line) && /[A-Za-z]{2}/.test(line))
    .join("\n");
}
