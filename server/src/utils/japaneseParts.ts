/**
 * Japanese -> English for used car-part listings (UP-GARAGE), without a
 * translation service: the vocabulary of these titles is small and
 * repetitive (makers, models, part types, "genuine", "early model"...),
 * so a dictionary turns most of them into readable English. Anything left
 * untranslated is removed by englishOnly; titles with too little left fall
 * back to a plain description. With DEEPL_API_KEY set, services/translate.ts
 * translates the full title instead and this is only the fallback.
 */
import { englishOnly } from "./englishOnly";

const JP_TERMS: [string, string][] = ([
  // makers
  ["トヨタ", "Toyota"], ["ホンダ", "Honda"], ["日産", "Nissan"], ["ニッサン", "Nissan"], ["マツダ", "Mazda"], ["スバル", "Subaru"], ["スズキ", "Suzuki"],
  ["ダイハツ", "Daihatsu"], ["三菱", "Mitsubishi"], ["ミツビシ", "Mitsubishi"], ["レクサス", "Lexus"], ["いすゞ", "Isuzu"], ["ヤマハ", "Yamaha"],
  ["カワサキ", "Kawasaki"], ["メルセデスベンツ", "Mercedes-Benz"], ["ベンツ", "Mercedes-Benz"], ["フォルクスワーゲン", "Volkswagen"], ["アウディ", "Audi"],
  ["ポルシェ", "Porsche"], ["ボルボ", "Volvo"], ["ミニ", "Mini"], ["ジープ", "Jeep"],
  // models
  ["ランドクルーザープラド", "Land Cruiser Prado"], ["ランドクルーザー", "Land Cruiser"], ["プラド", "Prado"], ["ハイエース", "Hiace"], ["プリウス", "Prius"],
  ["アルファード", "Alphard"], ["ヴェルファイア", "Vellfire"], ["ヴォクシー", "Voxy"], ["ノア", "Noah"], ["エスティマ", "Estima"], ["クラウン", "Crown"],
  ["カローラ", "Corolla"], ["ヴィッツ", "Vitz"], ["アクア", "Aqua"], ["ハリアー", "Harrier"], ["ハイラックス", "Hilux"], ["マークX", "Mark X"],
  ["シビック", "Civic"], ["フィット", "Fit"], ["ステップワゴン", "Step WGN"], ["オデッセイ", "Odyssey"], ["ヴェゼル", "Vezel"], ["フリード", "Freed"],
  ["スカイライン", "Skyline"], ["シルビア", "Silvia"], ["セレナ", "Serena"], ["エクストレイル", "X-Trail"], ["ノート", "Note"], ["マーチ", "March"],
  ["ロードスター", "Roadster"], ["デミオ", "Demio"], ["アクセラ", "Axela"], ["インプレッサ", "Impreza"], ["レガシィ", "Legacy"], ["フォレスター", "Forester"],
  ["ジムニー", "Jimny"], ["スイフト", "Swift"], ["ワゴンR", "Wagon R"], ["ハスラー", "Hustler"], ["タント", "Tanto"], ["ムーヴ", "Move"], ["コペン", "Copen"],
  ["ランサー", "Lancer"], ["パジェロ", "Pajero"], ["デリカ", "Delica"], ["モデューロ", "Modulo"],
  // part types
  ["ステアリング", "steering wheel"], ["ハンドルカバー", "steering wheel cover"], ["ハンドル", "steering wheel"], ["ボス", "boss kit"],
  ["ヘッドライト", "headlight"], ["ヘッドランプ", "headlight"], ["テールランプ", "tail light"], ["テールライト", "tail light"], ["フォグランプ", "fog light"],
  ["ウインカー", "indicator"], ["ホイール", "wheels"], ["タイヤ", "tyres"], ["アルミ", "alloy"], ["マフラー", "muffler / exhaust"], ["触媒", "catalytic converter"],
  ["車高調", "coilovers"], ["サスペンション", "suspension"], ["ショック", "shock absorber"], ["スプリング", "springs"], ["ダウンサス", "lowering springs"],
  ["シート", "seat"], ["バケットシート", "bucket seat"], ["シートレール", "seat rail"], ["カーナビ", "car navigation unit"], ["ナビ", "navigation unit"],
  ["オーディオ", "audio unit"], ["スピーカー", "speakers"], ["バンパー", "bumper"], ["グリル", "grille"], ["ボンネット", "bonnet"], ["ミラー", "mirror"],
  ["エアロ", "aero kit"], ["スポイラー", "spoiler"], ["ウイング", "wing"], ["サイドステップ", "side skirt"], ["リップ", "lip"], ["ドア", "door"],
  ["エンジン", "engine"], ["ターボ", "turbo"], ["インタークーラー", "intercooler"], ["ラジエーター", "radiator"], ["エアクリーナー", "air filter"],
  ["ブレーキ", "brake"], ["キャリパー", "caliper"], ["ローター", "rotor"], ["クラッチ", "clutch"], ["ミッション", "transmission"], ["メーター", "gauge"],
  ["シフトノブ", "shift knob"], ["フロアマット", "floor mats"], ["ルーフキャリア", "roof carrier"], ["キャリア", "carrier"],
  // descriptors
  ["新車外し品", "removed from a new car"], ["新車外し", "removed from a new car"], ["メーカー不明", "unknown brand"], ["社外品", "aftermarket"], ["社外", "aftermarket"],
  ["純正", "genuine OEM"], ["前期", "early model"], ["中期", "mid model"], ["後期", "late model"], ["レザー", "leather"], ["本革", "genuine leather"],
  ["ウッドコンビ", "wood combination"], ["ウッド", "wood"], ["カーボン", "carbon"], ["左右", "left & right"], ["左", "left"], ["右", "right"],
  ["フロント", "front"], ["リア", "rear"], ["セット", "set"], ["インチ", "inch"], ["品番", "part no."], ["型式", "model code"], ["系", " series"],
  ["年式", "year"], ["中古", "used"], ["美品", "good condition"], ["訳あり", "with flaws"], ["ジャンク", "for parts / not working"], ["点灯確認済", "tested, lights up"],
  ["動作確認済", "tested, working"], ["未使用", "unused"], ["新品", "new"], ["本", " pcs"], ["個", " pcs"], ["枚", " pcs"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

const SYMBOLS = /[☆★※◎○●◆◇■□▲△▼▽♪♫〇･・]/g;

export function translateJapanesePartName(text: string): string {
  let s = String(text ?? "").replace(/[【［]/g, "(").replace(/[】］]/g, ")").replace(/～/g, "-");
  for (const [jp, en] of JP_TERMS) if (s.includes(jp)) s = s.split(jp).join(` ${en} `);
  s = englishOnly(s.replace(SYMBOLS, " "));
  return s
    .replace(/\(\s*[-/:,]*\s*\)/g, "")
    .replace(/\s+([:,)])/g, "$1").replace(/\(\s+/g, "(")
    .replace(/\s*[&/:+,-]\s*$/g, "").replace(/^\s*[&/:+,-]\s*/g, "")
    .replace(/\s{2,}/g, " ").trim();
}

/** True when a translated name still says something (not just "150" or "REAL &"). */
export function isMeaningfulName(name: string): boolean {
  const words = name.match(/[A-Za-z]{3,}/g) ?? [];
  return words.length >= 2 || (words.length === 1 && name.length >= 8);
}

const PREFECTURES: Record<string, string> = {
  北海道: "Hokkaido", 青森: "Aomori", 岩手: "Iwate", 宮城: "Miyagi", 秋田: "Akita", 山形: "Yamagata", 福島: "Fukushima", 茨城: "Ibaraki", 栃木: "Tochigi",
  群馬: "Gunma", 埼玉: "Saitama", 千葉: "Chiba", 東京: "Tokyo", 神奈川: "Kanagawa", 新潟: "Niigata", 富山: "Toyama", 石川: "Ishikawa", 福井: "Fukui",
  山梨: "Yamanashi", 長野: "Nagano", 岐阜: "Gifu", 静岡: "Shizuoka", 愛知: "Aichi", 三重: "Mie", 滋賀: "Shiga", 京都: "Kyoto", 大阪: "Osaka", 兵庫: "Hyogo",
  奈良: "Nara", 和歌山: "Wakayama", 鳥取: "Tottori", 島根: "Shimane", 岡山: "Okayama", 広島: "Hiroshima", 山口: "Yamaguchi", 徳島: "Tokushima", 香川: "Kagawa",
  愛媛: "Ehime", 高知: "Kochi", 福岡: "Fukuoka", 佐賀: "Saga", 長崎: "Nagasaki", 熊本: "Kumamoto", 大分: "Oita", 宮崎: "Miyazaki", 鹿児島: "Kagoshima", 沖縄: "Okinawa",
};

/** "神奈川県" -> "Kanagawa"; anything else goes through englishOnly. */
export function prefectureInEnglish(text: string | null | undefined): string | null {
  if (!text) return null;
  const hit = Object.keys(PREFECTURES).find(k => text.includes(k));
  return hit ? PREFECTURES[hit] : englishOnly(text) || null;
}
