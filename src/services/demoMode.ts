// ─── Demo Mode ────────────────────────────────────────────────────────────────
// When the backend at localhost:3001 is unreachable, all API services fall back
// to this module so every dashboard works without running the server.

export const DEMO_TOKEN = "demo." + btoa(JSON.stringify({ userId: "demo-001", username: "superadmin", role: "superadmin" })) + ".demo";

export const isDemoMode  = () => localStorage.getItem("vink_demo") === "1";
export const setDemoMode = (v: boolean) => { if (v) localStorage.setItem("vink_demo","1"); else localStorage.removeItem("vink_demo"); };

// ─── Fake login ───────────────────────────────────────────────────────────────
export const DEMO_USERS: Record<string, { token: string; user: { id: string; username: string; name: string; role: string } }> = {
  superadmin: { token: DEMO_TOKEN, user: { id: "demo-001", username: "superadmin", name: "Super Administrator", role: "superadmin" } },
  noc1:       { token: DEMO_TOKEN, user: { id: "demo-002", username: "noc1",       name: "NOC Engineer 1",      role: "noc_engineer" } },
  billing1:   { token: DEMO_TOKEN, user: { id: "demo-003", username: "billing1",   name: "Billing Admin",       role: "billing_admin" } },
};

export function demoLogin(username: string) {
  const u = DEMO_USERS[username] ?? DEMO_USERS["superadmin"];
  return { success: true, ...u };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
type R = Record<string, any>;
const rand  = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randF = (min: number, max: number) => +(Math.random() * (max - min) + min).toFixed(2);
const ago   = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const uuid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── MVNO Mock Data ───────────────────────────────────────────────────────────
export const mvnoMock = {
  kpiCurrent: () => ({
    success: true, data: {
      timestamp: new Date().toISOString(),
      totalSubscribers: 2_401_840, activeSubscribers: 1_800_000,
      networkUptimePct: 99.97, activeDataSessions: 1_248_300,
      activeVoiceCalls: 48_290, smsQueueDepth: 240,
      revenueToday: 284_120, fraudAlertsActive: 12,
      avgNetworkLoadPct: 68, totalTowerCount: 120,
      towersOnline: 117, activeSims: 2_401_840,
      openTickets: 1_840, roamingUsers: 18_400, dataThroughputGbps: 9.8,
    },
  }),

  kpiHistory: () => ({
    success: true,
    data: Array.from({ length: 24 }, (_, i) => ({
      timestamp: ago((23 - i) * 60),
      activeDataSessions: 1_200_000 + rand(-30_000, 50_000),
      avgNetworkLoadPct:  68 + rand(-5, 8),
      revenueToday:       280_000 + rand(-5_000, 8_000),
      towersOnline: 117, totalTowerCount: 120,
    })),
  }),

  towers: () => ({
    success: true,
    data: Array.from({ length: 120 }, (_, i) => ({
      id: `TOWER-${String(i + 1).padStart(4, "0")}`,
      name: `Tower ${i + 1}`,
      status: i % 30 === 0 ? "offline" : i % 8 === 0 ? "warning" : "online",
      loadPercent: rand(20, 95), connectedSubscribers: rand(50, 800),
      technology: ["4G","4G","4G","5G","3G"][i % 5],
      region: ["Gauteng","Western Cape","KZN","Limpopo","Eastern Cape","Free State"][i % 6],
    })),
  }),

  callStats: () => ({ success: true, data: { total: 50, connected: 38, ringing: 5, held: 4, failed: 3, avgDuration: 185 } }),

  smsStats: () => ({ success: true, data: { total: 1_100, delivered: 1_067, queued: 24, failed: 9, deliveryRate: 97.0 } }),

  billingSummary: () => ({ success: true, data: { totalRevenue: 284_120, paidInvoices: 42, overdueInvoices: 3, pendingInvoices: 5, arOutstanding: 120_000, byType: [
    { type: "voice", count: 120, revenue: 84_000 }, { type: "data", count: 280, revenue: 140_000 },
    { type: "sms", count: 450, revenue: 18_000 },   { type: "roaming", count: 30, revenue: 42_120 },
  ]}}),

  fraudSummary: () => ({ success: true, data: { total: 20, active: 12, blocked: 8, avgRisk: 5.4, byType: [
    { type: "cloning", count: 3, blocked: 2 }, { type: "roaming_abuse", count: 4, blocked: 3 },
    { type: "premium_rate", count: 5, blocked: 3 }, { type: "sim_swap", count: 4, blocked: 0 },
    { type: "dos", count: 2, blocked: 0 }, { type: "bypass", count: 2, blocked: 0 },
  ]}}),

  fraudAlerts: () => ({
    success: true,
    data: [
      { id: uuid(), msisdn: "+27821000001", type: "cloning",       severity: "critical", description: "Duplicate IMSI on multiple cells", detectedAt: ago(2),   resolvedAt: null, blocked: true,  riskScore: 9.2 },
      { id: uuid(), msisdn: "+27821000002", type: "roaming_abuse", severity: "warning",  description: "Abnormal roaming data spike",     detectedAt: ago(8),   resolvedAt: null, blocked: false, riskScore: 7.4 },
      { id: uuid(), msisdn: "+27821000003", type: "premium_rate",  severity: "info",     description: "Premium-rate call pattern",        detectedAt: ago(14),  resolvedAt: null, blocked: true,  riskScore: 6.1 },
      { id: uuid(), msisdn: "+27821000004", type: "sim_swap",      severity: "warning",  description: "SIM swap without verification",    detectedAt: ago(22),  resolvedAt: ago(5), blocked: false, riskScore: 5.3 },
    ],
    meta: { total: 20, active: 12 },
  }),

  alerts: () => ({
    success: true,
    data: [
      { id: uuid(), component: "Packet Core",   title: "High Load",       message: "GGSN/PGW load at 81% — approaching threshold", severity: "warning",  createdAt: ago(2),  acknowledgedAt: null, resolvedAt: null },
      { id: uuid(), component: "Fraud Engine",  title: "New Fraud Cases", message: "3 new suspicious IMSIs flagged",                severity: "warning",  createdAt: ago(8),  acknowledgedAt: null, resolvedAt: null },
      { id: uuid(), component: "SMSC",          title: "Queue Spike",     message: "SMS delivery queue depth exceeded 200",         severity: "info",     createdAt: ago(14), acknowledgedAt: ago(12), resolvedAt: null },
      { id: uuid(), component: "Cell Tower",    title: "Tower Offline",   message: "TOWER-0031 has gone offline",                  severity: "critical", createdAt: ago(35), acknowledgedAt: ago(30), resolvedAt: null },
    ],
    meta: { total: 12, active: 12, critical: 1, warning: 2, info: 1 },
  }),

  alertSummary: () => ({ success: true, data: { total: 12, active: 12, critical: 1, warning: 2, info: 9 } }),

  simStats: () => ({ success: true, data: { total: 500, active: 200, unallocated: 250, esim: 100, physical: 400, suspended: 10 } }),

  sessions: () => ({ success: true, data: Array.from({ length: 20 }, (_, i) => ({
    id: uuid(), imsi: `65501${String(i).padStart(10,"0")}`, msisdn: `+2782${String(7000000+i).padStart(7,"0")}`,
    apn: ["internet","mms","iot.vink.net"][i%3], ipv4: `10.${rand(0,255)}.${rand(0,255)}.${rand(1,254)}`,
    uplinkKbps: rand(100,50000), downlinkKbps: rand(500,200000),
    startedAt: ago(rand(0,480)), rat: ["4G","4G","5G","3G"][i%4],
  })), meta: { total: 80, totalDlGbps: 9.8, totalUlGbps: 3.2 } }),

  support: () => ({ success: true, data: {
    total: 60, open: 24, inProgress: 16, resolved: 14, closed: 6, urgent: 3, avgCsat: 4.2,
    byCategory: ["billing","technical","porting","activation","roaming","fraud","general"].map(c => ({ category: c, count: rand(3,12), open: rand(1,5) })),
  }}),

  interSummary: () => ({ success: true, data: { activePartners: 7, totalRoamers: 18_400, roamingRevenue30d: 67_800, activeRoutes: 5, avgAsr: 70.8, activeIntercepts: 4 } }),
};

// ─── Banking Mock Data ────────────────────────────────────────────────────────
const BANK_USERS = [
  { id: "bu-001", role: "passenger", firstName: "Margaret",  lastName: "Botha",    email: "margaret@example.com",  phone: "+27821000001", kycStatus: "approved",  amlStatus: "clear",        accountCount: 2, cardCount: 2, totalBalance: 24_580.00, createdAt: ago(43800) },
  { id: "bu-002", role: "passenger", firstName: "Johannes",  lastName: "van Berg",  email: "johannes@example.com",  phone: "+27821000002", kycStatus: "approved",  amlStatus: "clear",        accountCount: 2, cardCount: 1, totalBalance: 8_200.00,  createdAt: ago(30000) },
  { id: "bu-003", role: "driver",    firstName: "Themba",    lastName: "Dlamini",  email: "themba@example.com",    phone: "+27811000001", kycStatus: "approved",  amlStatus: "clear",        accountCount: 1, cardCount: 1, totalBalance: 12_340.00, createdAt: ago(22000) },
  { id: "bu-004", role: "driver",    firstName: "Sipho",     lastName: "Ndlovu",   email: "sipho@example.com",     phone: "+27811000002", kycStatus: "approved",  amlStatus: "clear",        accountCount: 1, cardCount: 1, totalBalance: 9_870.00,  createdAt: ago(18000) },
  { id: "bu-005", role: "investor",  firstName: "Patricia",  lastName: "Osei",     email: "patricia@example.com",  phone: "+27831000001", kycStatus: "approved",  amlStatus: "clear",        accountCount: 2, cardCount: 2, totalBalance: 480_000.00,createdAt: ago(50000) },
  { id: "bu-006", role: "investor",  firstName: "David",     lastName: "Nkosi",    email: "david@example.com",     phone: "+27831000002", kycStatus: "in_review", amlStatus: "under_review", accountCount: 2, cardCount: 1, totalBalance: 220_000.00,createdAt: ago(40000) },
  { id: "bu-007", role: "owner",     firstName: "Vincent",   lastName: "Karimi",   email: "vincent@example.com",   phone: "+27841000001", kycStatus: "approved",  amlStatus: "clear",        accountCount: 3, cardCount: 3, totalBalance: 1_240_000, createdAt: ago(60000) },
  { id: "bu-008", role: "admin",     firstName: "Sarah",     lastName: "Williams", email: "admin@vink.co.za",         phone: "+27851000001", kycStatus: "approved",  amlStatus: "clear",        accountCount: 1, cardCount: 0, totalBalance: 0,          createdAt: ago(43800) },
  { id: "bu-009", role: "compliance",firstName: "Nadia",     lastName: "Petersen", email: "compliance@vink.co.za",   phone: "+27851000002", kycStatus: "approved",  amlStatus: "clear",        accountCount: 1, cardCount: 0, totalBalance: 0,          createdAt: ago(43800) },
  { id: "bu-010", role: "treasury",  firstName: "James",     lastName: "Molefe",   email: "treasury@vink.co.za",     phone: "+27851000003", kycStatus: "approved",  amlStatus: "clear",        accountCount: 1, cardCount: 0, totalBalance: 0,          createdAt: ago(43800) },
  { id: "bu-011", role: "passenger", firstName: "Amahle",    lastName: "Ngcobo",   email: "amahle@example.com",    phone: "+27821000003", kycStatus: "pending",   amlStatus: "clear",        accountCount: 1, cardCount: 0, totalBalance: 3_100.00,  createdAt: ago(5000) },
  { id: "bu-012", role: "driver",    firstName: "Farai",     lastName: "Moyo",     email: "farai@example.com",     phone: "+27811000003", kycStatus: "approved",  amlStatus: "clear",        accountCount: 1, cardCount: 1, totalBalance: 7_600.00,  createdAt: ago(15000) },
];

const BANK_ACCOUNTS = [
  { id: "acct-001", userId: "bu-001", accountNumber: "VNK10000000", iban: "ZA21 VINK 00000000 0001", sortCode: "30-00-01", type: "current",  currency: "ZAR", balance: 18_580.00, availableBalance: 17_980.00, pendingBalance: 600.00, status: "active",  interestRate: 2.5, overdraftLimit: 5000,  label: "Primary Account" },
  { id: "acct-002", userId: "bu-001", accountNumber: "VNK10000100", iban: "ZA21 VINK 00000100 0001", sortCode: "30-00-01", type: "savings",  currency: "ZAR", balance: 6_000.00,  availableBalance: 6_000.00,  pendingBalance: 0,      status: "active",  interestRate: 8.0, overdraftLimit: 0,     label: "Savings Account" },
  { id: "acct-003", userId: "bu-003", accountNumber: "VNK20000000", iban: "ZA21 VINK 20000000 0001", sortCode: "30-00-01", type: "wallet",   currency: "ZAR", balance: 12_340.00, availableBalance: 12_340.00, pendingBalance: 0,      status: "active",  interestRate: 2.5, overdraftLimit: 0,     label: "Earnings Wallet" },
  { id: "acct-004", userId: "bu-005", accountNumber: "VNK30000000", iban: "ZA21 VINK 30000000 0001", sortCode: "30-00-01", type: "current",  currency: "ZAR", balance: 280_000.00,availableBalance: 278_500.00,pendingBalance: 1500.00,status: "active",  interestRate: 2.5, overdraftLimit: 50000, label: "Primary Account" },
  { id: "acct-005", userId: "bu-005", accountNumber: "VNK30000100", iban: "ZA21 VINK 30000100 0001", sortCode: "30-00-01", type: "savings",  currency: "ZAR", balance: 200_000.00,availableBalance: 200_000.00,pendingBalance: 0,      status: "active",  interestRate: 8.0, overdraftLimit: 0,     label: "Investment Account" },
  { id: "acct-006", userId: "bu-007", accountNumber: "VNK40000000", iban: "ZA21 VINK 40000000 0001", sortCode: "30-00-01", type: "business", currency: "ZAR", balance: 1_240_000, availableBalance: 1_230_000, pendingBalance: 10000,  status: "active",  interestRate: 2.5, overdraftLimit: 100000,label: "Business Account" },
];

const BANK_CARDS = [
  { id: "card-001", userId: "bu-001", accountId: "acct-001", network: "visa",       type: "virtual",  tier: "standard",  pan: "4242 **** **** 4521", last4: "4521", expiry: "09/28", cvv: "***", nameOnCard: "MARGARET BOTHA",    status: "active",  contactless: true,  applePayEnrolled: true,  googlePayEnrolled: false, dailyLimit: 10000,  monthlyLimit: 50000,  spentToday: 342.50, spentThisMonth: 4_820, atmWithdrawalLimit: 5000, onlineTxnEnabled: true,  internationalEnabled: false, issuedAt: ago(4380), lastUsedAt: ago(2),   tokenized: true, binCode: "424242" },
  { id: "card-002", userId: "bu-001", accountId: "acct-001", network: "mastercard", type: "physical", tier: "standard",  pan: "5111 **** **** 8834", last4: "8834", expiry: "03/27", cvv: "***", nameOnCard: "MARGARET BOTHA",    status: "active",  contactless: true,  applePayEnrolled: false, googlePayEnrolled: true,  dailyLimit: 20000,  monthlyLimit: 80000,  spentToday: 0,      spentThisMonth: 2_100, atmWithdrawalLimit: 10000,onlineTxnEnabled: true,  internationalEnabled: true,  issuedAt: ago(8760), lastUsedAt: ago(240), tokenized: true, binCode: "511111" },
  { id: "card-003", userId: "bu-003", accountId: "acct-003", network: "mastercard", type: "virtual",  tier: "standard",  pan: "5200 **** **** 2291", last4: "2291", expiry: "12/26", cvv: "***", nameOnCard: "THEMBA DLAMINI",     status: "active",  contactless: true,  applePayEnrolled: false, googlePayEnrolled: true,  dailyLimit: 5000,   monthlyLimit: 20000,  spentToday: 120,    spentThisMonth: 680,   atmWithdrawalLimit: 2000, onlineTxnEnabled: true,  internationalEnabled: false, issuedAt: ago(2190), lastUsedAt: ago(60),  tokenized: true, binCode: "520000" },
  { id: "card-004", userId: "bu-005", accountId: "acct-004", network: "visa",       type: "physical", tier: "premium",   pan: "4111 **** **** 1111", last4: "1111", expiry: "06/29", cvv: "***", nameOnCard: "PATRICIA OSEI",      status: "active",  contactless: true,  applePayEnrolled: true,  googlePayEnrolled: true,  dailyLimit: 50000,  monthlyLimit: 200000, spentToday: 4_800,  spentThisMonth: 28_000,atmWithdrawalLimit: 25000,onlineTxnEnabled: true,  internationalEnabled: true,  issuedAt: ago(4380), lastUsedAt: ago(12),  tokenized: true, binCode: "411111" },
  { id: "card-005", userId: "bu-007", accountId: "acct-006", network: "mastercard", type: "physical", tier: "corporate", pan: "5555 **** **** 4444", last4: "4444", expiry: "11/28", cvv: "***", nameOnCard: "VINCENT KARIMI",     status: "active",  contactless: true,  applePayEnrolled: true,  googlePayEnrolled: true,  dailyLimit: 100000, monthlyLimit: 500000, spentToday: 12_400, spentThisMonth: 84_000,atmWithdrawalLimit: 50000,onlineTxnEnabled: true,  internationalEnabled: true,  issuedAt: ago(8760), lastUsedAt: ago(4),   tokenized: true, binCode: "555555" },
  { id: "card-006", userId: "bu-006", accountId: "acct-004", network: "visa",       type: "virtual",  tier: "premium",   pan: "4929 **** **** 7777", last4: "7777", expiry: "04/27", cvv: "***", nameOnCard: "DAVID NKOSI",        status: "frozen", contactless: true,  applePayEnrolled: false, googlePayEnrolled: false, dailyLimit: 30000,  monthlyLimit: 120000, spentToday: 0,      spentThisMonth: 0,     atmWithdrawalLimit: 15000,onlineTxnEnabled: true,  internationalEnabled: true,  issuedAt: ago(3650), lastUsedAt: ago(720), tokenized: true, binCode: "492900" },
];

const TXN_MERCHANTS = ["Woolworths","Pick n Pay","Shell","Netflix","MTN","Takealot","Dis-Chem","BP","Uber Eats","Checkers"];
const TXN_CATS = ["Groceries","Fuel","Entertainment","Mobile","E-commerce","Pharmacy","Transport","Fuel","Dining","Groceries"];

const BANK_TXNS_BASE = Array.from({ length: 25 }, (_, i) => ({
  id: `txn-${i}`, accountId: "acct-001", userId: "bu-001",
  type: i % 5 === 0 ? "credit" : "debit",
  category: i % 5 === 0 ? "deposit" : "card_payment",
  amount: randF(i % 5 === 0 ? 2000 : 50, i % 5 === 0 ? 10000 : 1800),
  currency: "ZAR", fxRate: null,
  description: i % 5 === 0 ? "Account deposit" : `Payment at ${TXN_MERCHANTS[i % 10]}`,
  reference: `VNK${rand(1000000, 9999999)}`,
  counterpartyName: i % 5 === 0 ? "VINK PLATFORM" : TXN_MERCHANTS[i % 10],
  counterpartyAccount: null,
  rail: i % 5 === 0 ? "internal" : "visa_direct",
  status: "completed", cardId: i % 5 === 0 ? null : "card-001",
  merchantName: i % 5 === 0 ? null : TXN_MERCHANTS[i % 10],
  merchantCategory: i % 5 === 0 ? null : TXN_CATS[i % 10],
  location: i % 5 === 0 ? null : "Cape Town, ZA",
  fraudScore: rand(0, 10), flagged: i === 23,
  createdAt: ago(rand(i * 20, i * 20 + 180)), settledAt: ago(rand(0, i * 20)),
}));

export const bankMock = {
  users: (params?: Record<string, string>) => {
    let users = BANK_USERS;
    if (params?.role) users = users.filter(u => u.role === params.role);
    if (params?.search) {
      const q = params.search.toLowerCase();
      users = users.filter(u => `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q));
    }
    return { success: true, data: users, meta: { total: users.length } };
  },
  userById: (id: string) => {
    const user = BANK_USERS.find(u => u.id === id) ?? BANK_USERS[0];
    const accounts = BANK_ACCOUNTS.filter(a => a.userId === user.id);
    const cards    = BANK_CARDS.filter(c => c.userId === user.id);
    return { success: true, data: { user, accounts, cards, kyc: { status: user.kycStatus, faceMatchScore: 94, documentType: "national_id" }, aml: [], portfolio: null } };
  },
  userStats: () => ({
    success: true, data: {
      total: BANK_USERS.length,
      byRole: ["passenger","driver","investor","owner","admin","compliance","treasury"].map(r => ({
        role: r, count: BANK_USERS.filter(u => u.role === r).length,
        kycApproved: BANK_USERS.filter(u => u.role === r && u.kycStatus === "approved").length,
      })),
      kycPending: 2,
    },
  }),
  accounts: (params?: Record<string, string>) => {
    let data = BANK_ACCOUNTS;
    if (params?.userId) data = data.filter(a => a.userId === params.userId);
    if (params?.type)   data = data.filter(a => a.type === params.type);
    return { success: true, data, meta: { total: data.length } };
  },
  accountById: (id: string) => ({ success: true, data: BANK_ACCOUNTS.find(a => a.id === id) ?? BANK_ACCOUNTS[0] }),
  accountTxns: (id: string) => ({
    success: true,
    data: BANK_TXNS_BASE.map(t => ({ ...t, accountId: id })),
    meta: { page: 1, limit: 25, total: 25, pages: 1 },
  }),
  accountSummary: (id: string) => {
    const acct = BANK_ACCOUNTS.find(a => a.id === id) ?? BANK_ACCOUNTS[0];
    return { success: true, data: {
      balance: acct.balance, availableBalance: acct.availableBalance,
      totalIn: 48_000, totalOut: 23_420, txnCount: 25,
      byCategory: TXN_CATS.slice(0, 5).map((cat, i) => ({ category: cat, amount: randF(500, 4000), count: rand(2, 8) })),
    }};
  },
  cards: (params?: Record<string, string>) => {
    let data = BANK_CARDS;
    if (params?.userId) data = data.filter(c => c.userId === params.userId);
    if (params?.network) data = data.filter(c => c.network === params.network);
    if (params?.status)  data = data.filter(c => c.status === params.status);
    return { success: true, data, meta: { total: data.length, active: data.filter(c=>c.status==="active").length } };
  },
  cardById: (id: string) => ({ success: true, data: BANK_CARDS.find(c => c.id === id) ?? BANK_CARDS[0] }),
  cardTxns: (id: string) => ({ success: true, data: BANK_TXNS_BASE.filter(t => t.cardId === id).slice(0, 10) }),
  payments: () => ({ success: true, data: [] }),
  sendPayment: (body: Record<string, unknown>) => ({ success: true, data: { id: uuid(), ...body, status: "completed", executedAt: new Date().toISOString() } }),
  instantPayout: (amount: number) => ({ success: true, data: { amount, currency: "ZAR", status: "completed" }, message: `R${Number(amount).toFixed(2)} instant payout processed` }),
  treasury: () => ({ success: true, data: [
    { id: "tr-1", label: "Settlement Account",  purpose: "settlement",  currency: "ZAR", balance: 12_500_000, reserveBalance: 2_500_000 },
    { id: "tr-2", label: "Reserve Fund",        purpose: "reserve",     currency: "ZAR", balance: 45_000_000, reserveBalance: 45_000_000 },
    { id: "tr-3", label: "Revenue Account",     purpose: "revenue",     currency: "ZAR", balance: 3_200_000,  reserveBalance: 0 },
    { id: "tr-4", label: "Operational Account", purpose: "operational", currency: "ZAR", balance: 8_100_000,  reserveBalance: 500_000 },
    { id: "tr-5", label: "Suspense Account",    purpose: "suspense",    currency: "ZAR", balance: 145_000,    reserveBalance: 0 },
  ], meta: { total: 68_945_000, totalReserve: 48_000_000 } }),
  settlements: () => ({ success: true, data: Array.from({ length: 12 }, (_, i) => ({
    id: uuid(), date: new Date(Date.now() - i * 86_400_000).toISOString().split("T")[0],
    totalVolume: randF(800_000, 3_000_000), netAmount: randF(780_000, 2_950_000),
    currency: "ZAR", network: ["visa","mastercard","internal"][i % 3],
    txnCount: rand(2000, 15000), status: i === 0 ? "in_progress" : "settled",
    settledAt: i === 0 ? null : ago((i - 1) * 1440),
  })) }),
  revenueSplits: () => ({ success: true,
    data: Array.from({ length: 10 }, (_, i) => { const total = randF(50000, 200000); return {
      id: uuid(), sourceType: "ride_fare", totalAmount: total, currency: "ZAR",
      splits: [
        { recipient: "driver",   percentage: 75, amount: +(total*0.75).toFixed(2) },
        { recipient: "investor", percentage: 10, amount: +(total*0.10).toFixed(2) },
        { recipient: "owner",    percentage: 15, amount: +(total*0.15).toFixed(2) },
      ], createdAt: ago(rand(0, 10080)),
    }; }),
    meta: { totalRevenue: 1_240_000, driverShare: 930_000, investorShare: 124_000, ownerShare: 186_000 },
  }),
  portfolios: () => ({ success: true, data: [
    { userId: "bu-005", capitalDeposited: 500_000, currentValue: 560_000, totalReturns: 60_000, returnPct: 12, dividendsPaid: 24_000, revenueSharePct: 10, nextDividendDate: new Date(Date.now() + 15*86400000).toISOString().split("T")[0], userName: "Patricia Osei" },
    { userId: "bu-006", capitalDeposited: 220_000, currentValue: 242_000, totalReturns: 22_000, returnPct: 10, dividendsPaid: 8_800, revenueSharePct: 10, nextDividendDate: new Date(Date.now() + 15*86400000).toISOString().split("T")[0], userName: "David Nkosi" },
  ] }),
  bankingKpi: () => ({ success: true, data: {
    timestamp: new Date().toISOString(),
    totalUsers: 12, activeCards: 5, totalVolume24h: 284_120, txnCount24h: 8_420,
    fraudAlertsActive: 8, kycPending: 2, treasuryBalance: 68_945_000,
    revenueToday: 42_600, avgFraudScore: 4.2, settlementsPending: 1,
  }}),
  kyc: (params?: Record<string, string>) => {
    const recs = BANK_USERS.map(u => ({
      id: `kyc-${u.id}`, userId: u.id, status: u.kycStatus,
      documentType: "national_id", documentNumber: u.id.replace("bu-","ZA8") + "000",
      documentCountry: "ZA", documentExpiry: "2034-01-01",
      faceMatchScore: u.kycStatus === "approved" ? rand(88,99) : null,
      addressVerified: u.kycStatus === "approved",
      submittedAt: ago(rand(720,4320)), reviewedAt: u.kycStatus === "approved" ? ago(rand(60,720)) : null,
      reviewedBy: u.kycStatus === "approved" ? "compliance@vink.co.za" : null,
      rejectionReason: null, user: u,
    }));
    const filtered = params?.status ? recs.filter(r => r.status === params.status) : recs;
    return { success: true, data: filtered, meta: { total: filtered.length, pending: recs.filter(r=>r.status==="pending"||r.status==="in_review").length } };
  },
  approveKyc: (id: string) => ({ success: true, data: { id, status: "approved", reviewedAt: new Date().toISOString() } }),
  rejectKyc:  (id: string) => ({ success: true, data: { id, status: "rejected", reviewedAt: new Date().toISOString() } }),
  aml: () => ({ success: true, data: BANK_USERS.map(u => ({ id: uuid(), userId: u.id, checkType: "ofac", result: "clear", riskScore: rand(0,15), checkedAt: ago(rand(0,4320)), sarFiled: false, user: u })) }),
  fraudAlerts: (params?: Record<string, string>) => {
    const rules = ["velocity_check","geo_anomaly","device_new","high_value_unusual","foreign_txn"];
    const data = Array.from({ length: 8 }, (_, i) => ({
      id: `fa-${i}`, userId: BANK_USERS[i%BANK_USERS.length].id, accountId: BANK_ACCOUNTS[i%BANK_ACCOUNTS.length].id, txnId: null,
      riskLevel: ["low","medium","high","critical"][i%4], ruleTriggered: rules[i%5],
      description: `Suspicious activity — ${rules[i%5].replace(/_/g," ")}`,
      blocked: i%2===0, resolved: i<3, createdAt: ago(rand(0,2880)), resolvedAt: i<3 ? ago(rand(0,60)) : null,
      user: BANK_USERS[i%BANK_USERS.length],
    }));
    const filtered = params?.resolved === "false" ? data.filter(f=>!f.resolved) : params?.resolved === "true" ? data.filter(f=>f.resolved) : data;
    return { success: true, data: filtered, meta: { total: data.length, active: data.filter(f=>!f.resolved).length } };
  },
  resolveFraud: (id: string) => ({ success: true, data: { id, resolved: true, resolvedAt: new Date().toISOString() } }),
  complianceSummary: () => ({ success: true, data: {
    kyc: { total: 12, approved: 9, pending: 2, rejected: 1 },
    aml: { total: 12, clear: 11, flagged: 1 },
    fraud: { total: 8, active: 5, critical: 1 },
  }}),
};

// ─── Healing Apple Mock Data ──────────────────────────────────────────────────
export const haMock = {
  login: () => ({ success: true, token: DEMO_TOKEN, user: { id: "ha-driver-001", name: "Themba Dlamini", role: "driver" } }),
  drivers: {
    get: () => ({ success: true, data: {
      id: "ha-driver-001", name: "Themba Dlamini", phone: "+27811000001", email: "themba@healingapple.co.za",
      avatarInitials: "TD", licenceNo: "ZA12345678",
      vehicleType: "standard", vehicleMake: "Toyota", vehicleModel: "Corolla Quest", vehicleYear: 2021,
      vehiclePlate: "CA 442 801", vehicleColour: "White",
      onlineStatus: "online", position: { lat: -33.92, lng: 18.42 }, heading: 45,
      totalTrips: 284, totalEarningsZAR: 48_200, earningsToday: 840, earningsThisWeek: 4_200,
      avgRating: 4.9, acceptanceRate: 94, completionRate: 98,
      firstAidCertified: true, backgroundCheckStatus: "approved",
      vehicleInspectionStatus: "approved", accessibilityTrainingStatus: "approved",
      joinedAt: ago(43800), lastActiveAt: ago(5),
    }}),
    earnings: () => ({ success: true, data: {
      summary: { today: 840, thisWeek: 4200, allTime: 48200, pending: 1260, nextPayoutDate: new Date(Date.now()+7*86400000).toISOString().split("T")[0] },
      records: [
        { id: uuid(), rideId: uuid(), amount: 68*0.75, currency: "ZAR", type: "trip",  description: "Trip: Groote Schuur Hospital → Clicks Pharmacy", createdAt: ago(120), paid: true },
        { id: uuid(), rideId: uuid(), amount: 45*0.75, currency: "ZAR", type: "trip",  description: "Trip: Mediclinic Cape Gate → Red Cross Hospital", createdAt: ago(240), paid: true },
        { id: uuid(), rideId: uuid(), amount: 120,     currency: "ZAR", type: "bonus", description: "Weekly performance bonus",                        createdAt: ago(1440),paid: true },
        { id: uuid(), rideId: uuid(), amount: 95*0.75, currency: "ZAR", type: "trip",  description: "Trip: Tygerberg Hospital → City Park Pharmacy",   createdAt: ago(1460),paid: false },
      ],
    }}),
    documents: () => ({ success: true, data: [
      { id: uuid(), type: "licence",               status: "approved", expires: "2026-08-15", filename: "licence.pdf" },
      { id: uuid(), type: "id_document",           status: "approved", expires: null,         filename: "id.pdf" },
      { id: uuid(), type: "vehicle_registration",  status: "approved", expires: "2025-10-01", filename: "reg.pdf" },
      { id: uuid(), type: "insurance",             status: "approved", expires: "2025-12-31", filename: "insurance.pdf" },
      { id: uuid(), type: "first_aid_cert",        status: "approved", expires: "2025-06-30", filename: "first_aid.pdf" },
      { id: uuid(), type: "background_check",      status: "approved", expires: null,         filename: "bg_check.pdf" },
      { id: uuid(), type: "accessibility_training",status: "approved", expires: "2025-06-30", filename: "accessibility.pdf" },
    ]}),
    trips: () => ({ success: true, data: [
      { id: uuid(), passengerId: "p-001", passengerName: "Margaret Botha",  status: "completed", vehicleType: "standard",  estimatedFareZAR: 68,  distanceKm: 6.2, driverName: "Themba Dlamini", createdAt: ago(120)  },
      { id: uuid(), passengerId: "p-002", passengerName: "Amahle Ngcobo",   status: "completed", vehicleType: "wheelchair", estimatedFareZAR: 115, distanceKm: 9.4, driverName: "Themba Dlamini", createdAt: ago(240)  },
      { id: uuid(), passengerId: "p-003", passengerName: "Patrick Osei",    status: "completed", vehicleType: "standard",  estimatedFareZAR: 95,  distanceKm: 8.1, driverName: "Themba Dlamini", createdAt: ago(1440) },
    ]}),
  },
  rides: {
    incoming: () => ({ success: true, data: [{
      id: "ride-incoming-001",
      passengerId: "p-wheelchair-001", passengerName: "Amahle Ngcobo", passengerPhone: "+27821000003",
      vehicleType: "wheelchair",
      pickupAddress:  { label: "Tygerberg Hospital",  lat: -33.91, lng: 18.63 },
      dropoffAddress: { label: "City Park Pharmacy",  lat: -33.93, lng: 18.42 },
      medicalNote: "I use a rollator walker — please allow extra boarding time.",
      estimatedFareZAR: 120, distanceKm: 9.4,
      status: "searching", createdAt: ago(1),
    }] }),
    stats: () => ({ success: true, data: { activeRides: 2, onlineDrivers: 6, ridesCompletedToday: 28, totalPassengers: 8, totalDrivers: 8, activeSosEvents: 0, avgEtaMinutes: 7, revenueToday: 2_840, acceptanceRatePct: 92, cancellationRatePct: 4 } }),
    list: () => ({ success: true, data: [], meta: { total: 0 } }),
    accept:  () => ({ success: true, data: { status: "accepted", etaMinutes: 4 } }),
    decline: () => ({ success: true }),
    status:  () => ({ success: true, data: { status: "completed" } }),
    rate:    () => ({ success: true }),
  },
  passengers: {
    get: () => ({ success: true, data: {
      id: "p-001", name: "Margaret Botha", phone: "+27821000001", walletBalance: 245.50,
      currency: "ZAR", preferredVehicleType: "standard", medicalProfile: "I use a walker — allow extra boarding time.",
      emergencyContacts: [{ name: "Johan Botha", phone: "+27821000099", relationship: "Spouse" }],
      totalTrips: 42, avgRating: 4.8, linkedCaregiverId: null,
    }}),
    trips: () => ({ success: true, data: [
      { id: uuid(), driverName: "Themba Dlamini", pickupAddress: { label: "Groote Schuur Hospital" }, dropoffAddress: { label: "Clicks Pharmacy" }, status: "completed", estimatedFareZAR: 68,  passengerRating: 5, createdAt: ago(120) },
      { id: uuid(), driverName: "Sipho Ndlovu",   pickupAddress: { label: "Red Cross Hospital" },     dropoffAddress: { label: "Mowbray, Cape Town" }, status: "completed", estimatedFareZAR: 85,  passengerRating: 4, createdAt: ago(2880) },
      { id: uuid(), driverName: "Farai Moyo",     pickupAddress: { label: "Tygerberg Hospital" },     dropoffAddress: { label: "Somerset Hospital" }, status: "cancelled", estimatedFareZAR: 110, passengerRating: null, createdAt: ago(5760) },
    ]}),
    active: () => ({ success: true, data: null }),
    scheduled: () => ({ success: true, data: [
      { id: uuid(), vehicleType: "standard", pickupAddress: { label: "Netcare Claremont" }, dropoffAddress: { label: "Physio & Rehab Centre" }, scheduledTime: new Date(Date.now()+18*3600000).toISOString(), recurrence: "weekly", active: true },
    ]}),
  },
  sos: {
    trigger: () => ({ success: true, data: { id: uuid(), status: "active" }, message: "SOS active. Emergency contacts notified." }),
  },
};

// ─── Vehicle Tracking Mock Data ───────────────────────────────────────────────
const PLATE = (i: number) => `CA ${String(100000 + i).slice(1)} GP`;
const MAKES  = ["Toyota","Ford","Volkswagen","Isuzu","Mercedes","Hyundai","Nissan","BMW","Volvo","MAN"];
const MODELS = ["Hilux","Ranger","Crafter","D-Max","Sprinter","H1","NP300","X5","FH16","TGX"];
const GROUPS = ["Delivery","Executive","Field","Security","Maintenance","Logistics"];
const STATUSES = ["moving","moving","moving","idle","stopped","offline","maintenance"] as const;

const VEHICLE_POSITIONS = Array.from({ length: 50 }, (_, i) => ({
  id: `veh-${String(i + 1).padStart(3, "0")}`,
  plateNumber: PLATE(i),
  make: MAKES[i % MAKES.length],
  model: MODELS[i % MODELS.length],
  fleetGroup: GROUPS[i % GROUPS.length],
  colour: ["White","Silver","Black","Grey","Blue"][i % 5],
  year: 2018 + (i % 6),
  status: STATUSES[i % STATUSES.length],
  commChannel: ["cellular_4g","cellular_4g","cellular_3g","satellite","offline"][i % 5],
  position: {
    lat: -26.20 + (Math.sin(i * 1.3) * 4.5),
    lng: 28.05 + (Math.cos(i * 1.1) * 5.5),
    altitude: 1400 + rand(0, 200),
    accuracy: rand(3, 15),
    heading: rand(0, 359),
    timestamp: ago(rand(0, 3)),
  },
  sensors: {
    speedKph:    STATUSES[i % STATUSES.length] === "moving" ? rand(40, 120) : 0,
    fuelPercent: rand(15, 100),
    engineTempC: rand(75, 95),
    engineOn:    STATUSES[i % STATUSES.length] !== "offline",
    odometreKm:  rand(15000, 180000),
    rpm:         STATUSES[i % STATUSES.length] === "moving" ? rand(1200, 3200) : 0,
    batteryV:    randF(12.1, 14.4),
    doorOpen:    false,
    ignitionOn:  STATUSES[i % STATUSES.length] !== "offline",
  },
  speedKph:    STATUSES[i % STATUSES.length] === "moving" ? rand(40, 120) : 0,
  fuelPercent: rand(15, 100),
  lastSeen: ago(rand(0, 5)),
  driverId: i < 30 ? `drv-${String(i + 1).padStart(3, "0")}` : null,
  deviceId: `GPS-${String(10000 + i)}`,
  simIccid:  `8927${String(i).padStart(15, "0")}`,
  vin: `WDB${String(i).padStart(14, "0")}`,
  registeredAt: ago(rand(8760, 43800)),
  insuranceExpiry: new Date(Date.now() + rand(30, 365) * 86400000).toISOString().split("T")[0],
  licenceExpiry:   new Date(Date.now() + rand(30, 365) * 86400000).toISOString().split("T")[0],
  nextServiceKm: rand(1000, 8000),
}));

const FLEET_DRIVERS = Array.from({ length: 30 }, (_, i) => ({
  id: `drv-${String(i + 1).padStart(3, "0")}`,
  name: ["Themba Dlamini","Sipho Ndlovu","Farai Moyo","Abebe Bekele","Kagiso Sithole",
         "Lwazi Mokoena","Nomsa Khumalo","Patrick Osei","Samuel Petersen","Fatima Ismail",
         "David Nkosi","Grace Mthembu","Johannes van Berg","Amahle Ngcobo","Vincent Karimi",
         "Sarah Williams","James Molefe","Nadia Petersen","Themba Zulu","Sipho Khumalo",
         "Farai Sithole","Abebe Dlamini","Kagiso Ndlovu","Lwazi Bekele","Nomsa Moyo",
         "Patrick van Berg","Samuel Ngcobo","Fatima Karimi","David Petersen","Grace Molefe"][i],
  licenceNo: `ZA${rand(10000000, 99999999)}`,
  phone: `+2781${String(rand(1000000, 9999999))}`,
  email: `driver${i + 1}@fleet.co.za`,
  status: (["active","active","active","inactive","suspended"][i % 5]) as string,
  assignedVehicleId: i < 25 ? `veh-${String(i + 1).padStart(3, "0")}` : null,
  totalTrips: rand(50, 800),
  totalKm: rand(8000, 120000),
  safetyScore: rand(55, 99),
  joinedAt: ago(rand(4380, 43800)),
  avatarInitials: ["TD","SN","FM","AB","KS","LM","NK","PO","SP","FI","DN","GM","JvB","AN","VK","SW","JM","NP","TZ","SK","FS","AD","KN","LB","NM","PvB","SN","FK","DP","GM"][i],
}));

const FLEET_ALERTS = Array.from({ length: 18 }, (_, i) => {
  const types = ["speeding","low_fuel","harsh_braking","geofence_breach","engine_off","sos","tampering","accident"] as const;
  const type = types[i % types.length];
  return {
    id: `alert-${String(i + 1).padStart(3, "0")}`,
    vehicleId: `veh-${String((i % 50) + 1).padStart(3, "0")}`,
    plateNumber: PLATE(i % 50),
    driverId: i < 15 ? `drv-${String((i % 30) + 1).padStart(3, "0")}` : null,
    type,
    severity: (["critical","warning","warning","info","critical"][i % 5]) as string,
    message: {
      speeding: `Speed limit exceeded — ${rand(90, 140)} km/h in 80 zone`,
      low_fuel: `Fuel level critical — ${rand(5, 18)}% remaining`,
      harsh_braking: "Harsh braking event detected — safety score deducted",
      geofence_breach: "Vehicle exited designated operating zone",
      engine_off: "Engine switched off in unauthorised location",
      sos: "Driver triggered SOS emergency alert",
      tampering: "Potential GPS device tampering detected",
      accident: "Possible collision — airbag sensor triggered",
    }[type],
    position: { lat: -26.20 + rand(-4, 4), lng: 28.05 + rand(-5, 5) },
    detectedAt: ago(rand(0, 480)),
    resolvedAt: i < 5 ? ago(rand(0, 60)) : null,
    acknowledged: i < 8,
    value: type === "speeding" ? rand(90, 140) : null,
  };
});

const GEOFENCES = [
  { id: "gf-001", name: "Johannesburg CBD",    description: "Central business district operating zone", shape: "circle", centerLat: -26.2041, centerLng: 28.0473, radiusM: 8000,  active: true,  triggerOn: "exit",  alertVehicleGroups: ["Delivery","Executive"], createdAt: ago(43800), breachCount: 12 },
  { id: "gf-002", name: "Cape Town Metro",      description: "Cape Town metropolitan area",              shape: "circle", centerLat: -33.9249, centerLng: 18.4241, radiusM: 15000, active: true,  triggerOn: "both",  alertVehicleGroups: ["Logistics"],            createdAt: ago(30000), breachCount: 7  },
  { id: "gf-003", name: "Durban Port Zone",     description: "Port operations area",                    shape: "circle", centerLat: -29.8587, centerLng: 31.0218, radiusM: 5000,  active: true,  triggerOn: "enter", alertVehicleGroups: ["Field"],                createdAt: ago(20000), breachCount: 3  },
  { id: "gf-004", name: "Pretoria HQ",          description: "Company headquarters zone",               shape: "circle", centerLat: -25.7479, centerLng: 28.2293, radiusM: 3000,  active: true,  triggerOn: "exit",  alertVehicleGroups: ["Security","Maintenance"],createdAt: ago(43800), breachCount: 1  },
  { id: "gf-005", name: "Restricted Night Zone", description: "Vehicles must return by 22:00",          shape: "circle", centerLat: -26.1052, centerLng: 28.0560, radiusM: 20000, active: false, triggerOn: "both",  alertVehicleGroups: ["Delivery"],             createdAt: ago(8760),  breachCount: 0  },
];

export const vehicleMock = {
  positions: () => ({
    success: true,
    data: VEHICLE_POSITIONS.map(v => ({
      id: v.id, plateNumber: v.plateNumber, make: v.make, model: v.model,
      fleetGroup: v.fleetGroup, status: v.status,
      position: v.position, speedKph: v.speedKph, fuelPercent: v.fuelPercent, lastSeen: v.lastSeen,
    })),
  }),

  list: (params?: Record<string, string>) => {
    let data = VEHICLE_POSITIONS as typeof VEHICLE_POSITIONS;
    if (params?.status && params.status !== "all") data = data.filter(v => v.status === params.status);
    if (params?.fleetGroup) data = data.filter(v => v.fleetGroup === params.fleetGroup);
    return { success: true, data, meta: { total: data.length } };
  },

  snapshot: () => ({
    success: true, data: {
      timestamp: new Date().toISOString(),
      totalVehicles:   50,
      movingNow:       VEHICLE_POSITIONS.filter(v => v.status === "moving").length,
      idleNow:         VEHICLE_POSITIONS.filter(v => v.status === "idle").length,
      stoppedNow:      VEHICLE_POSITIONS.filter(v => v.status === "stopped").length,
      offlineNow:      VEHICLE_POSITIONS.filter(v => v.status === "offline").length,
      maintenanceNow:  VEHICLE_POSITIONS.filter(v => v.status === "maintenance").length,
      activeAlerts:    FLEET_ALERTS.filter(a => !a.resolvedAt).length,
      avgSpeedKph:     Math.round(VEHICLE_POSITIONS.filter(v=>v.speedKph>0).reduce((s,v)=>s+v.speedKph,0) / Math.max(1, VEHICLE_POSITIONS.filter(v=>v.speedKph>0).length)),
      avgFuelPercent:  Math.round(VEHICLE_POSITIONS.reduce((s,v)=>s+v.fuelPercent,0) / VEHICLE_POSITIONS.length),
      totalKmToday:    randF(1800, 4200),
      activeDrivers:   25,
      geofenceBreaches: 3,
    },
  }),

  getVehicle: (id: string) => {
    const v = VEHICLE_POSITIONS.find(v => v.id === id) ?? VEHICLE_POSITIONS[0];
    return { success: true, data: v };
  },

  update: () => ({ success: true, data: {} }),

  history: (id: string) => ({
    success: true,
    data: Array.from({ length: 20 }, (_, i) => ({
      lat: -26.20 + Math.sin(i * 0.3) * 0.05,
      lng: 28.05 + Math.cos(i * 0.3) * 0.05,
      speedKph: rand(30, 110), timestamp: ago(20 - i),
    })),
  }),

  drivers: (params?: Record<string, string>) => {
    let data = FLEET_DRIVERS;
    if (params?.status) data = data.filter(d => d.status === params.status);
    return { success: true, data, meta: { total: data.length } };
  },

  driver: (id: string) => {
    const d = FLEET_DRIVERS.find(d => d.id === id) ?? FLEET_DRIVERS[0];
    return { success: true, data: d };
  },

  assignDriver: () => ({ success: true, data: {} }),

  alerts: (params?: Record<string, string>) => {
    let data = FLEET_ALERTS;
    if (params?.resolved === "false") data = data.filter(a => !a.resolvedAt);
    if (params?.resolved === "true")  data = data.filter(a => !!a.resolvedAt);
    if (params?.severity) data = data.filter(a => a.severity === params.severity);
    data.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
    return { success: true, data, meta: { total: FLEET_ALERTS.length, active: FLEET_ALERTS.filter(a => !a.resolvedAt).length } };
  },

  acknowledgeAlert: (id: string) => ({ success: true, data: { id, acknowledged: true } }),
  resolveAlert:     (id: string) => ({ success: true, data: { id, resolvedAt: new Date().toISOString() } }),

  geofences: () => ({ success: true, data: GEOFENCES }),
  createGeofence: (body: unknown) => ({ success: true, data: { id: uuid(), ...(body as object), createdAt: new Date().toISOString(), breachCount: 0 } }),
  updateGeofence: (id: string, body: unknown) => ({ success: true, data: { id, ...(body as object) } }),
  deleteGeofence: (id: string) => ({ success: true, message: `Geofence ${id} deleted` }),

  trips: () => ({
    success: true,
    data: Array.from({ length: 15 }, (_, i) => ({
      id: uuid(), vehicleId: `veh-${String((i % 50) + 1).padStart(3, "0")}`,
      driverId: `drv-${String((i % 30) + 1).padStart(3, "0")}`,
      startTime: ago(rand(60, 480)), endTime: ago(rand(0, 59)),
      distanceKm: randF(5, 120), avgSpeedKph: rand(40, 90), maxSpeedKph: rand(90, 130),
      fuelUsedL: randF(3, 15), ongoing: i === 0,
      startPos: { lat: -26.20, lng: 28.05 }, endPos: { lat: -26.25, lng: 28.10 },
    })),
  }),

  analytics: () => ({
    success: true,
    data: {
      byFleet: GROUPS.map(g => ({
        fleet: g, count: Math.floor(50 / GROUPS.length) + rand(0, 3),
        moving: rand(2, 6), avgFuel: rand(50, 80), avgSpeed: rand(40, 70),
      })),
      byStatus: (["moving","idle","stopped","offline","maintenance"] as const).map(s => ({
        status: s, count: VEHICLE_POSITIONS.filter(v => v.status === s).length,
        pct: Math.round((VEHICLE_POSITIONS.filter(v => v.status === s).length / 50) * 100),
      })),
      alertsByType: (["speeding","low_fuel","harsh_braking","geofence_breach","engine_off","sos","tampering","accident"] as const).map(t => ({
        type: t, count: FLEET_ALERTS.filter(a => a.type === t).length,
        active: FLEET_ALERTS.filter(a => a.type === t && !a.resolvedAt).length,
      })),
      topDrivers: FLEET_DRIVERS.slice(0, 5).map(d => ({ ...d, trips: rand(10, 40) })),
      totalKmToday: randF(3000, 8000), avgFuelConsumption: randF(9, 14),
    },
  }),
};

// ─── Marketplace Mock Data ────────────────────────────────────────────────────
const MKT_CATS = [
  { id:"cat-01", name:"Electronics",       slug:"electronics",    icon:"💻", parentId:null, productCount:5, featured:true  },
  { id:"cat-02", name:"Fashion",           slug:"fashion",        icon:"👗", parentId:null, productCount:3, featured:true  },
  { id:"cat-03", name:"Home & Garden",     slug:"home-garden",    icon:"🏠", parentId:null, productCount:2, featured:true  },
  { id:"cat-04", name:"Health & Beauty",   slug:"health-beauty",  icon:"💄", parentId:null, productCount:2, featured:true  },
  { id:"cat-05", name:"Sports",            slug:"sports",         icon:"⚽", parentId:null, productCount:2, featured:true  },
  { id:"cat-06", name:"Books & Media",     slug:"books-media",    icon:"📚", parentId:null, productCount:1, featured:false },
  { id:"cat-07", name:"Toys & Kids",       slug:"toys-kids",      icon:"🧸", parentId:null, productCount:0, featured:false },
  { id:"cat-08", name:"Automotive",        slug:"automotive",     icon:"🚗", parentId:null, productCount:0, featured:false },
  { id:"cat-09", name:"Office & Business", slug:"office-business",icon:"💼", parentId:null, productCount:7, featured:true },
];

const MKT_PRODUCTS = [
  { id:"p-01", sellerId:"sel-01", sellerName:"TechZone SA",   categoryId:"cat-01", categoryName:"Electronics",    name:"Samsung Galaxy S25 Ultra",    shortDescription:"6.8\" Dynamic AMOLED, 200MP camera, S Pen included",   price:22999, compareAtPrice:25999, currency:"ZAR", images:["#1a1a2e","#16213e"], emoji:"📱", status:"active", stock:48,  sku:"SAM-S25U",   brand:"Samsung",   avgRating:4.8, reviewCount:342, totalSold:184, isFeatured:true,  isFlashDeal:false, flashDealEndsAt:null, tags:["flagship","android","5g"], variants:[{id:"v1",type:"color",value:"Phantom Black",additionalPrice:0,stock:28,sku:"SAM-S25U-BLK"}], attributes:{Storage:"512GB",RAM:"12GB"}, description:"The Samsung Galaxy S25 Ultra represents the pinnacle of smartphone technology with its revolutionary 200MP camera system.", slug:"samsung-galaxy-s25-ultra", createdAt:ago(4380), updatedAt:ago(60) },
  { id:"p-02", sellerId:"sel-01", sellerName:"TechZone SA",   categoryId:"cat-01", categoryName:"Electronics",    name:"Apple MacBook Pro 14\" M4",    shortDescription:"Apple M4 chip, 16GB RAM, 512GB SSD",                   price:36999, compareAtPrice:39999, currency:"ZAR", images:["#2d3748","#1a202c"], emoji:"💻", status:"active", stock:22,  sku:"MBP14M4",    brand:"Apple",     avgRating:4.9, reviewCount:218, totalSold:96,  isFeatured:true,  isFlashDeal:false, flashDealEndsAt:null, tags:["laptop","macos"], variants:[], attributes:{RAM:"16GB",Storage:"512GB"}, description:"The MacBook Pro with M4 chip delivers extraordinary performance for professionals.", slug:"apple-macbook-pro-14-m4", createdAt:ago(8760), updatedAt:ago(120) },
  { id:"p-03", sellerId:"sel-01", sellerName:"TechZone SA",   categoryId:"cat-01", categoryName:"Electronics",    name:"Sony WH-1000XM6 Headphones",  shortDescription:"Industry-leading noise cancellation, 40h battery",     price:5999,  compareAtPrice:7499,  currency:"ZAR", images:["#1a1a2e","#2d3748"], emoji:"🎧", status:"active", stock:85,  sku:"SONY-WH1000", brand:"Sony",      avgRating:4.7, reviewCount:520, totalSold:340, isFeatured:false, isFlashDeal:true,  flashDealEndsAt:new Date(Date.now()+86400000).toISOString(), tags:["audio","wireless"], variants:[{id:"v2",type:"color",value:"Black",additionalPrice:0,stock:50,sku:"SONY-BLK"}], attributes:{BatteryLife:"40h"}, description:"Experience unparalleled sound with Sony's flagship noise-cancelling headphones.", slug:"sony-wh-1000xm6", createdAt:ago(2190), updatedAt:ago(30) },
  { id:"p-04", sellerId:"sel-01", sellerName:"TechZone SA",   categoryId:"cat-01", categoryName:"Electronics",    name:"Apple Watch Series 10",        shortDescription:"Heart rate, ECG, crash detection, 18h battery",        price:12999, compareAtPrice:14999, currency:"ZAR", images:["#1c1c1e","#2d3748"], emoji:"⌚", status:"active", stock:63,  sku:"APPL-AW10",  brand:"Apple",     avgRating:4.8, reviewCount:175, totalSold:88,  isFeatured:true,  isFlashDeal:false, flashDealEndsAt:null, tags:["smartwatch","fitness"], variants:[{id:"v3",type:"size",value:"42mm",additionalPrice:0,stock:40,sku:"AW10-42"},{id:"v4",type:"size",value:"46mm",additionalPrice:500,stock:23,sku:"AW10-46"}], attributes:{Case:"Titanium"}, description:"Apple Watch Series 10 is the most advanced Apple Watch ever.", slug:"apple-watch-series-10", createdAt:ago(3650), updatedAt:ago(90) },
  { id:"p-05", sellerId:"sel-01", sellerName:"TechZone SA",   categoryId:"cat-01", categoryName:"Electronics",    name:"Samsung 65\" QLED 4K TV",     shortDescription:"Quantum HDR, 120Hz, Smart TV with Alexa",              price:18999, compareAtPrice:22999, currency:"ZAR", images:["#0a0a0a","#1a1a2e"], emoji:"📺", status:"active", stock:15,  sku:"SAM-65QLED", brand:"Samsung",   avgRating:4.6, reviewCount:89,  totalSold:52,  isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["tv","4k","smart"], variants:[], attributes:{Size:"65 inch",Resolution:"4K"}, description:"Transform your living room with stunning 4K QLED visuals.", slug:"samsung-65-qled-4k", createdAt:ago(5000), updatedAt:ago(200) },
  { id:"p-06", sellerId:"sel-02", sellerName:"Fashion Hub",   categoryId:"cat-02", categoryName:"Fashion",         name:"Nike Air Max 270",             shortDescription:"Max Air unit, breathable mesh, all-day comfort",       price:2499,  compareAtPrice:2999,  currency:"ZAR", images:["#E8E8E8","#CCCCCC"], emoji:"👟", status:"active", stock:120, sku:"NIKE-AM270",  brand:"Nike",      avgRating:4.6, reviewCount:890, totalSold:620, isFeatured:true,  isFlashDeal:false, flashDealEndsAt:null, tags:["shoes","sneakers"], variants:[{id:"v5",type:"size",value:"8",additionalPrice:0,stock:30,sku:"AM270-8"},{id:"v6",type:"size",value:"9",additionalPrice:0,stock:35,sku:"AM270-9"},{id:"v7",type:"size",value:"10",additionalPrice:0,stock:25,sku:"AM270-10"}], attributes:{Material:"Mesh"}, description:"The Nike Air Max 270 delivers all-day comfort with a large Max Air unit.", slug:"nike-air-max-270", createdAt:ago(10000), updatedAt:ago(400) },
  { id:"p-07", sellerId:"sel-02", sellerName:"Fashion Hub",   categoryId:"cat-02", categoryName:"Fashion",         name:"Levi's 501 Original Jeans",   shortDescription:"Classic straight fit, button fly, 100% cotton denim", price:1299,  compareAtPrice:null,  currency:"ZAR", images:["#1a237e","#283593"], emoji:"👖", status:"active", stock:200, sku:"LEVI-501",    brand:"Levi's",    avgRating:4.5, reviewCount:412, totalSold:380, isFeatured:false, isFlashDeal:true,  flashDealEndsAt:new Date(Date.now()+86400000).toISOString(), tags:["jeans","denim"], variants:[{id:"v8",type:"size",value:"32x32",additionalPrice:0,stock:60,sku:"LEVI-3232"},{id:"v9",type:"size",value:"34x32",additionalPrice:0,stock:60,sku:"LEVI-3432"}], attributes:{Fit:"Straight"}, description:"The Levi's 501 is the original blue jean that defined American style.", slug:"levis-501-original", createdAt:ago(12000), updatedAt:ago(500) },
  { id:"p-08", sellerId:"sel-03", sellerName:"HomeStyle",     categoryId:"cat-03", categoryName:"Home & Garden",   name:"KitchenAid Artisan Stand Mixer",shortDescription:"5.7L bowl, 10 speeds, 59 touch points",               price:8999,  compareAtPrice:10999, currency:"ZAR", images:["#E53935","#B71C1C"], emoji:"🍳", status:"active", stock:28,  sku:"KA-5KSM",    brand:"KitchenAid",avgRating:4.9, reviewCount:182, totalSold:94,  isFeatured:true,  isFlashDeal:false, flashDealEndsAt:null, tags:["kitchen","baking"], variants:[{id:"v10",type:"color",value:"Empire Red",additionalPrice:0,stock:15,sku:"KA-RED"},{id:"v11",type:"color",value:"Ice Blue",additionalPrice:0,stock:8,sku:"KA-BLUE"}], attributes:{Capacity:"5.7L"}, description:"The KitchenAid Artisan Stand Mixer is the complete kitchen companion for baking enthusiasts.", slug:"kitchenaid-artisan-stand-mixer", createdAt:ago(7000), updatedAt:ago(300) },
  { id:"p-09", sellerId:"sel-05", sellerName:"BeautyBar",     categoryId:"cat-04", categoryName:"Health & Beauty", name:"The Ordinary Skincare Bundle", shortDescription:"Hyaluronic Acid, Niacinamide, AHA/BHA Peeling",       price:599,   compareAtPrice:799,   currency:"ZAR", images:["#FAFAFA","#F0F0F0"], emoji:"💆", status:"active", stock:340, sku:"ORD-BUNDLE",  brand:"The Ordinary",avgRating:4.7, reviewCount:892, totalSold:740, isFeatured:true,  isFlashDeal:true,  flashDealEndsAt:new Date(Date.now()+86400000).toISOString(), tags:["skincare","routine"], variants:[], attributes:{SkinType:"All Types",Items:"4"}, description:"Clinical skincare formulations with integrity at accessible prices.", slug:"the-ordinary-skincare-bundle", createdAt:ago(6000), updatedAt:ago(240) },
  { id:"p-10", sellerId:"sel-04", sellerName:"SportsPro",     categoryId:"cat-05", categoryName:"Sports",          name:"Garmin Fenix 8 GPS Watch",    shortDescription:"Multi-sport GPS, AMOLED, 29-day battery",             price:19999, compareAtPrice:22999, currency:"ZAR", images:["#1a1a2e","#2d3748"], emoji:"🏃", status:"active", stock:18,  sku:"GAR-FENIX8",  brand:"Garmin",    avgRating:4.8, reviewCount:128, totalSold:74,  isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["gps","sport"], variants:[{id:"v12",type:"size",value:"47mm",additionalPrice:0,stock:10,sku:"FENIX8-47"}], attributes:{Display:"AMOLED"}, description:"The ultimate multi-sport GPS smartwatch for athletes.", slug:"garmin-fenix-8", createdAt:ago(8000), updatedAt:ago(350) },
  { id:"p-11", sellerId:"sel-06", sellerName:"BookWorld",     categoryId:"cat-06", categoryName:"Books & Media",   name:"Atomic Habits",               shortDescription:"Proven framework for building good habits — #1 bestseller",price:349,  compareAtPrice:399,   currency:"ZAR", images:["#1A237E","#283593"], emoji:"📖", status:"active", stock:500, sku:"BOOK-AH",     brand:"Random House",avgRating:4.9, reviewCount:1204, totalSold:892, isFeatured:true,  isFlashDeal:false, flashDealEndsAt:null, tags:["self-help","bestseller"], variants:[{id:"v13",type:"style",value:"Paperback",additionalPrice:0,stock:400,sku:"AH-PB"},{id:"v14",type:"style",value:"Hardcover",additionalPrice:150,stock:100,sku:"AH-HC"}], attributes:{Format:"Paperback",Pages:"320"}, description:"No matter your goals, Atomic Habits offers a proven framework for improving every day.", slug:"atomic-habits", createdAt:ago(9000), updatedAt:ago(400) },
  { id:"p-12", sellerId:"sel-03", sellerName:"HomeStyle",     categoryId:"cat-03", categoryName:"Home & Garden",   name:"Dyson V15 Detect Cordless",   shortDescription:"Laser dust detection, 60min runtime, HEPA filtration", price:12999, compareAtPrice:14999, currency:"ZAR", images:["#F9A825","#F57F17"], emoji:"🧹", status:"active", stock:35,  sku:"DYSON-V15",   brand:"Dyson",     avgRating:4.8, reviewCount:267, totalSold:156, isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["vacuum","cordless"], variants:[], attributes:{BatteryLife:"60 min"}, description:"The Dyson V15 Detect automatically adapts to different floor types for a thorough clean.", slug:"dyson-v15-detect", createdAt:ago(11000), updatedAt:ago(450) },
  { id:"p-13", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Executive High-Back Office Chair", shortDescription:"Genuine leather, adjustable lumbar support, headrest", price:4299, compareAtPrice:5299, currency:"ZAR", images:["#2d2320","#1a1512"], emoji:"🪑", status:"active", stock:32, sku:"OFC-EXEC-HB", brand:"", avgRating:4.6, reviewCount:214, totalSold:168, isFeatured:true, isFlashDeal:false, flashDealEndsAt:null, tags:["office chair","executive","leather"], variants:[{id:"v15",type:"color",value:"Black",additionalPrice:0,stock:20,sku:"OFC-EXEC-BLK"},{id:"v16",type:"color",value:"Brown",additionalPrice:0,stock:12,sku:"OFC-EXEC-BRN"}], attributes:{Material:"Leather",WeightCapacity:"150kg"}, description:"A high-back executive chair built for long working days — adjustable lumbar support, padded armrests, and a smooth-tilt recline mechanism.", slug:"executive-high-back-office-chair", createdAt:ago(1800), updatedAt:ago(20) },
  { id:"p-14", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Ergonomic Mesh Task Chair", shortDescription:"Breathable mesh back, adjustable armrests, tilt lock", price:1899, compareAtPrice:2399, currency:"ZAR", images:["#37474F","#263238"], emoji:"🪑", status:"active", stock:58, sku:"OFC-MESH-TASK", brand:"", avgRating:4.5, reviewCount:389, totalSold:302, isFeatured:true, isFlashDeal:true, flashDealEndsAt:new Date(Date.now()+86400000).toISOString(), tags:["office chair","ergonomic","mesh"], variants:[{id:"v17",type:"color",value:"Black",additionalPrice:0,stock:40,sku:"OFC-MESH-BLK"},{id:"v18",type:"color",value:"Grey",additionalPrice:0,stock:18,sku:"OFC-MESH-GRY"}], attributes:{Material:"Mesh",WeightCapacity:"130kg"}, description:"An everyday ergonomic task chair with breathable mesh back, adjustable-height armrests, and a locking tilt mechanism for all-day comfort.", slug:"ergonomic-mesh-task-chair", createdAt:ago(2200), updatedAt:ago(35) },
  { id:"p-15", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Mid-Back Manager Chair", shortDescription:"PU leather, padded seat, 360° swivel", price:2599, compareAtPrice:null, currency:"ZAR", images:["#4E342E","#3E2723"], emoji:"🪑", status:"active", stock:41, sku:"OFC-MGR-MB", brand:"", avgRating:4.4, reviewCount:156, totalSold:120, isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["office chair","manager","pu leather"], variants:[{id:"v19",type:"color",value:"Black",additionalPrice:0,stock:25,sku:"OFC-MGR-BLK"}], attributes:{Material:"PU Leather",WeightCapacity:"140kg"}, description:"A mid-back manager's chair in durable PU leather with a padded seat, gas-lift height adjustment, and smooth 360° swivel base.", slug:"mid-back-manager-chair", createdAt:ago(2600), updatedAt:ago(60) },
  { id:"p-16", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Conference Room Chair", shortDescription:"Fixed arms, cantilever base, stackable", price:1499, compareAtPrice:1799, currency:"ZAR", images:["#263238","#1C2529"], emoji:"🪑", status:"active", stock:64, sku:"OFC-CONF", brand:"", avgRating:4.3, reviewCount:98, totalSold:210, isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["office chair","conference","meeting"], variants:[], attributes:{Material:"Fabric",Stackable:"Yes"}, description:"A clean-lined conference room chair with a cantilever frame, fixed armrests, and a stackable design for easy storage.", slug:"conference-room-chair", createdAt:ago(1500), updatedAt:ago(15) },
  { id:"p-17", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Height-Adjustable Drafting Stool", shortDescription:"Gas-lift, footring, 360° swivel", price:1299, compareAtPrice:null, currency:"ZAR", images:["#37474F","#455A64"], emoji:"🪑", status:"active", stock:29, sku:"OFC-DRAFT", brand:"", avgRating:4.5, reviewCount:64, totalSold:58, isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["office chair","stool","drafting"], variants:[], attributes:{Material:"Mesh",AdjustableHeight:"58-78cm"}, description:"A height-adjustable drafting stool with a footring and 360° swivel, suited to standing desks and reception counters.", slug:"height-adjustable-drafting-stool", createdAt:ago(1200), updatedAt:ago(10) },
  { id:"p-18", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Visitor Chair with Sled Base", shortDescription:"Cushioned seat, chrome sled frame, no wheels", price:999, compareAtPrice:1249, currency:"ZAR", images:["#546E7A","#455A64"], emoji:"🪑", status:"active", stock:76, sku:"OFC-VISIT", brand:"", avgRating:4.2, reviewCount:73, totalSold:145, isFeatured:false, isFlashDeal:false, flashDealEndsAt:null, tags:["office chair","visitor","guest"], variants:[], attributes:{Material:"Fabric",Frame:"Chrome sled"}, description:"A simple, sturdy visitor chair with a cushioned seat and chrome sled base — a reliable choice for reception areas and guest seating.", slug:"visitor-chair-sled-base", createdAt:ago(1000), updatedAt:ago(8) },
  { id:"p-19", sellerId:"sel-07", sellerName:"WorkSpace Direct", categoryId:"cat-09", categoryName:"Office & Business", name:"Racing-Style Gaming/Office Chair", shortDescription:"High-back, adjustable armrests, recline to 155°", price:3499, compareAtPrice:4199, currency:"ZAR", images:["#1A1A2E","#0F0F1E"], emoji:"🪑", status:"active", stock:23, sku:"OFC-GAME", brand:"", avgRating:4.6, reviewCount:201, totalSold:167, isFeatured:true, isFlashDeal:false, flashDealEndsAt:null, tags:["office chair","gaming","racing"], variants:[{id:"v20",type:"color",value:"Black/Red",additionalPrice:0,stock:14,sku:"OFC-GAME-RED"},{id:"v21",type:"color",value:"Black/Blue",additionalPrice:0,stock:9,sku:"OFC-GAME-BLU"}], attributes:{Material:"PU Leather",Recline:"90-155°"}, description:"A racing-style chair with a high back, 4D adjustable armrests, and deep recline — built for long sessions at a desk.", slug:"racing-style-gaming-office-chair", createdAt:ago(1600), updatedAt:ago(25) },
];

const MKT_ORDERS = Array.from({ length: 8 }, (_, i) => {
  const p = MKT_PRODUCTS[i % MKT_PRODUCTS.length];
  const statuses = ["delivered","delivered","shipped","processing","pending","delivered","cancelled","delivered"];
  const status = statuses[i];
  const sub = p.price;
  return {
    id: `ord-${i}`, orderNumber: `VNK-ORD-${String(100000+i).padStart(6,"0")}`,
    userId:"demo-customer-001", customerName:"Margaret Botha", customerEmail:"margaret@example.com",
    items:[{productId:p.id,productName:p.name,emoji:p.emoji,variantId:null,variantLabel:null,quantity:1,unitPrice:p.price,totalPrice:p.price,sellerId:p.sellerId,sellerName:p.sellerName}],
    subtotal:sub,shippingCost:sub>500?0:99,taxAmount:+(sub*0.15).toFixed(2),discountAmount:i%4===0?200:0,
    totalAmount:+(sub+(sub>500?0:99)+sub*0.15-(i%4===0?200:0)).toFixed(2),currency:"ZAR",
    status,paymentStatus:status==="pending"?"pending":"paid",
    paymentMethod:["card","paypal","card","google_pay"][i%4],
    shippingAddress:{label:"Home",firstName:"Margaret",lastName:"Botha",line1:"42 Kloof Street",line2:null,city:"Cape Town",state:"Western Cape",postalCode:"8001",country:"ZA",phone:"+27821000001"},
    shippingStatus:status==="delivered"?"delivered":status==="shipped"?"in_transit":"not_shipped",
    trackingNumber:(status==="shipped"||status==="delivered")?`VNK${rand(10000000,99999999)}`:null,
    carrier:(status==="shipped"||status==="delivered")?"DHL Express":null,
    estimatedDelivery:new Date(Date.now()+5*86400000).toISOString(),
    couponCode:i%4===0?"SAVE200":null,notes:null,
    placedAt:ago(rand(i*60+10,i*60+4320)),confirmedAt:ago(rand(i*50,i*50+30)),
    shippedAt:(status==="shipped"||status==="delivered")?ago(rand(i*40,i*40+60)):null,
    deliveredAt:status==="delivered"?ago(rand(i*30,i*30+60)):null,
    cancelledAt:status==="cancelled"?ago(rand(0,120)):null,
  };
});

const DEMO_CART = { id:"cart-demo", userId:"demo-customer-001", items:[] as { productId:string;variantId:string|null;quantity:number;unitPrice:number;name:string;emoji:string;sellerName:string;maxStock:number }[], couponCode:null as string|null, couponDiscount:0, subtotal:0, shipping:0, tax:0, total:0, createdAt:ago(60), updatedAt:ago(5) };

// ─── Supply chain mock data (mutable, in-memory for the demo session) ───────
const MKT_WAREHOUSES = [
  { id: "wh-origin-cn", name: "Guangzhou Consolidation Hub", country: "CN", type: "origin", address: "Baiyun District, Guangzhou, China", status: "active", createdAt: ago(4380*60) },
  { id: "wh-origin-jp", name: "Osaka Sourcing Hub", country: "JP", type: "origin", address: "Konohana-ku, Osaka, Japan", status: "active", createdAt: ago(4380*60) },
  { id: "wh-origin-kr", name: "Incheon Sourcing Hub", country: "KR", type: "origin", address: "Yeonsu-gu, Incheon, South Korea", status: "active", createdAt: ago(4380*60) },
  { id: "wh-dest-za", name: "Cape Town Fulfilment Centre", country: "ZA", type: "destination", address: "Epping Industria, Cape Town, South Africa", status: "active", createdAt: ago(4380*60) },
  { id: "wh-dest-zm", name: "Lusaka Fulfilment Centre", country: "ZM", type: "destination", address: "Heavy Industrial Area, Lusaka, Zambia", status: "active", createdAt: ago(4380*60) },
];

const MKT_SUPPLIERS: R[] = [
  { id: "sup-cn-01", name: "Guangzhou Fortune Trading Co.", country: "CN", contactName: "Li Wei", contactEmail: "liwei@fortunetrading.example", contactPhone: "+86 20 5555 0101", platform: "Alibaba Trade Assurance", paymentTerms: "30% deposit / 70% before shipment", leadTimeDays: 12, dropshipSupported: true, verified: true, status: "active", notes: "Electronics accessories and home goods.", createdAt: ago(3000*60) },
  { id: "sup-cn-02", name: "Shenzhen Bright Electronics Ltd.", country: "CN", contactName: "Chen Jing", contactEmail: "chenjing@brightelec.example", contactPhone: "+86 755 5555 0202", platform: "1688.com (via sourcing agent)", paymentTerms: "T/T, 50/50", leadTimeDays: 15, dropshipSupported: true, verified: true, status: "active", notes: "Consumer electronics.", createdAt: ago(2500*60) },
  { id: "sup-jp-01", name: "Osaka Craft & Home Co.", country: "JP", contactName: "Tanaka Yuki", contactEmail: "tanaka@osakacraft.example", contactPhone: "+81 6 5555 0303", platform: "JETRO-matched", paymentTerms: "T/T on confirmation", leadTimeDays: 18, dropshipSupported: true, verified: true, status: "active", notes: "Home goods and stationery.", createdAt: ago(2000*60) },
  { id: "sup-kr-01", name: "Seoul Beauty Export Group", country: "KR", contactName: "Park Min-jun", contactEmail: "parkminjun@seoulbeauty.example", contactPhone: "+82 2 5555 0404", platform: "Gobizkorea", paymentTerms: "30% deposit / 70% on shipment", leadTimeDays: 14, dropshipSupported: true, verified: true, status: "active", notes: "K-beauty and skincare.", createdAt: ago(1800*60) },
  { id: "sup-kr-02", name: "Incheon Home Living Co.", country: "KR", contactName: "Kim Soo-jin", contactEmail: "kimsoojin@incheonhome.example", contactPhone: "+82 32 5555 0505", platform: "EC21", paymentTerms: "T/T, 50/50", leadTimeDays: 16, dropshipSupported: true, verified: false, status: "active", notes: "Newer relationship, pending verification.", createdAt: ago(200*60) },
];

const MKT_SUPPLIER_PRODUCTS = [
  { id: "spr-01", supplierId: "sup-cn-01", supplierName: "Guangzhou Fortune Trading Co.", supplierCountry: "CN", categoryId: "cat-01", name: "Wireless Earbuds Pro Case", description: "TWS earbuds with charging case, Bluetooth 5.3.", costPrice: 8.5, currency: "USD", retailPrice: 349, compareAtPrice: 399, moq: 20, images: ["#1a1a2e"], emoji: "🎧", originCountry: "CN", status: "active", importCount: 0, createdAt: ago(1200*60), updatedAt: ago(30*60) },
  { id: "spr-02", supplierId: "sup-cn-01", supplierName: "Guangzhou Fortune Trading Co.", supplierCountry: "CN", categoryId: "cat-03", name: "Foldable Silicone Storage Set", description: "Collapsible kitchen storage containers, 5-piece set.", costPrice: 4.2, currency: "USD", retailPrice: 199, compareAtPrice: 249, moq: 50, images: ["#0e7490"], emoji: "🍱", originCountry: "CN", status: "active", importCount: 0, createdAt: ago(900*60), updatedAt: ago(20*60) },
  { id: "spr-03", supplierId: "sup-cn-02", supplierName: "Shenzhen Bright Electronics Ltd.", supplierCountry: "CN", categoryId: "cat-01", name: "Mini Portable Projector", description: "1080p-supported mini projector with HDMI/USB.", costPrice: 22, currency: "USD", retailPrice: 899, compareAtPrice: 1099, moq: 10, images: ["#2d3748"], emoji: "📽️", originCountry: "CN", status: "active", importCount: 0, createdAt: ago(700*60), updatedAt: ago(10*60) },
  { id: "spr-04", supplierId: "sup-cn-02", supplierName: "Shenzhen Bright Electronics Ltd.", supplierCountry: "CN", categoryId: "cat-01", name: "Smart Fitness Tracker Band", description: "Heart-rate and sleep tracking, 7-day battery.", costPrice: 6.8, currency: "USD", retailPrice: 299, compareAtPrice: 349, moq: 30, images: ["#1c1c1e"], emoji: "⌚", originCountry: "CN", status: "active", importCount: 0, createdAt: ago(500*60), updatedAt: ago(5*60) },
  { id: "spr-05", supplierId: "sup-jp-01", supplierName: "Osaka Craft & Home Co.", supplierCountry: "JP", categoryId: "cat-03", name: "Japanese Ceramic Tea Set", description: "4-cup traditional ceramic tea set, hand-glazed finish.", costPrice: 15, currency: "USD", retailPrice: 599, compareAtPrice: 699, moq: 10, images: ["#78350f"], emoji: "🍵", originCountry: "JP", status: "active", importCount: 0, createdAt: ago(1000*60), updatedAt: ago(40*60) },
  { id: "spr-06", supplierId: "sup-jp-01", supplierName: "Osaka Craft & Home Co.", supplierCountry: "JP", categoryId: "cat-06", name: "Washi Tape Stationery Bundle", description: "12-roll decorative washi tape set for journaling.", costPrice: 5.5, currency: "USD", retailPrice: 249, compareAtPrice: null, moq: 25, images: ["#f59e0b"], emoji: "📝", originCountry: "JP", status: "active", importCount: 0, createdAt: ago(650*60), updatedAt: ago(15*60) },
  { id: "spr-07", supplierId: "sup-kr-01", supplierName: "Seoul Beauty Export Group", supplierCountry: "KR", categoryId: "cat-04", name: "K-Beauty Snail Mucin Serum", description: "Hydrating repair serum, 100ml, dermatologist-tested.", costPrice: 3.9, currency: "USD", retailPrice: 179, compareAtPrice: 219, moq: 40, images: ["#fecaca"], emoji: "💧", originCountry: "KR", status: "active", importCount: 0, createdAt: ago(800*60), updatedAt: ago(25*60) },
  { id: "spr-08", supplierId: "sup-kr-01", supplierName: "Seoul Beauty Export Group", supplierCountry: "KR", categoryId: "cat-04", name: "K-Beauty Sheet Mask Variety Pack (10)", description: "Assorted hydrating and brightening sheet masks.", costPrice: 6.2, currency: "USD", retailPrice: 249, compareAtPrice: 299, moq: 30, images: ["#fda4af"], emoji: "🧖", originCountry: "KR", status: "active", importCount: 0, createdAt: ago(400*60), updatedAt: ago(8*60) },
  { id: "spr-09", supplierId: "sup-kr-02", supplierName: "Incheon Home Living Co.", supplierCountry: "KR", categoryId: "cat-03", name: "Minimalist LED Desk Lamp", description: "Touch-dimmable LED lamp with USB charging port.", costPrice: 9.4, currency: "USD", retailPrice: 399, compareAtPrice: null, moq: 15, images: ["#e2e8f0"], emoji: "💡", originCountry: "KR", status: "active", importCount: 0, createdAt: ago(150*60), updatedAt: ago(3*60) },
];

const ORIGIN_WH_BY_COUNTRY: Record<string,string> = { CN: "wh-origin-cn", JP: "wh-origin-jp", KR: "wh-origin-kr" };

const MKT_SUPPLIER_ORDERS: Record<string, unknown>[] = [
  { id: "so-01", orderId: "ord-1001", orderNumber: "VNK-ORD-100003", productId: "p-imp-01", productName: "K-Beauty Snail Mucin Serum", supplierId: "sup-kr-01", supplierName: "Seoul Beauty Export Group", supplierProductId: "spr-07", sellerId: "sel-02", sellerName: "Fashion Hub", quantity: 3, costAmount: 11.7, originWarehouseId: "wh-origin-kr", originWarehouseName: "Incheon Sourcing Hub", destinationWarehouseId: "wh-dest-za", destinationWarehouseName: "Cape Town Fulfilment Centre", shipmentId: null, status: "ordered_from_supplier", qcNotes: null, createdAt: ago(2880), updatedAt: ago(2880) },
  { id: "so-02", orderId: "ord-1002", orderNumber: "VNK-ORD-100004", productId: "p-imp-02", productName: "Mini Portable Projector", supplierId: "sup-cn-02", supplierName: "Shenzhen Bright Electronics Ltd.", supplierProductId: "spr-03", sellerId: "sel-03", sellerName: "HomeStyle", quantity: 1, costAmount: 22, originWarehouseId: "wh-origin-cn", originWarehouseName: "Guangzhou Consolidation Hub", destinationWarehouseId: "wh-dest-za", destinationWarehouseName: "Cape Town Fulfilment Centre", shipmentId: null, status: "received_at_origin_hub", qcNotes: null, createdAt: ago(4320), updatedAt: ago(1440) },
  { id: "so-03", orderId: "ord-1003", orderNumber: "VNK-ORD-100005", productId: "p-imp-03", productName: "Japanese Ceramic Tea Set", supplierId: "sup-jp-01", supplierName: "Osaka Craft & Home Co.", supplierProductId: "spr-05", sellerId: "sel-05", sellerName: "BeautyBar", quantity: 2, costAmount: 30, originWarehouseId: "wh-origin-jp", originWarehouseName: "Osaka Sourcing Hub", destinationWarehouseId: "wh-dest-zm", destinationWarehouseName: "Lusaka Fulfilment Centre", shipmentId: null, status: "qc_passed_origin", qcNotes: "Passed — no chips or cracks.", createdAt: ago(5760), updatedAt: ago(720) },
  { id: "so-04", orderId: "ord-1004", orderNumber: "VNK-ORD-100006", productId: "p-imp-04", productName: "Smart Fitness Tracker Band", supplierId: "sup-cn-02", supplierName: "Shenzhen Bright Electronics Ltd.", supplierProductId: "spr-04", sellerId: "sel-04", sellerName: "SportsPro", quantity: 5, costAmount: 34, originWarehouseId: "wh-origin-cn", originWarehouseName: "Guangzhou Consolidation Hub", destinationWarehouseId: "wh-dest-za", destinationWarehouseName: "Cape Town Fulfilment Centre", shipmentId: "sh-01", status: "in_transit_to_destination", qcNotes: "Passed QC — batched into shipment.", createdAt: ago(10080), updatedAt: ago(2880) },
  { id: "so-05", orderId: "ord-1005", orderNumber: "VNK-ORD-100007", productId: "p-imp-05", productName: "K-Beauty Sheet Mask Variety Pack (10)", supplierId: "sup-kr-01", supplierName: "Seoul Beauty Export Group", supplierProductId: "spr-08", sellerId: "sel-01", sellerName: "TechZone SA", quantity: 4, costAmount: 24.8, originWarehouseId: "wh-origin-kr", originWarehouseName: "Incheon Sourcing Hub", destinationWarehouseId: "wh-dest-za", destinationWarehouseName: "Cape Town Fulfilment Centre", shipmentId: null, status: "delivered", qcNotes: "Passed QC, cleared customs, delivered on schedule.", createdAt: ago(20160), updatedAt: ago(4320) },
];

const MKT_SHIPMENTS: Record<string, unknown>[] = [
  { id: "sh-01", originWarehouseId: "wh-origin-cn", originWarehouseName: "Guangzhou Consolidation Hub", destinationWarehouseId: "wh-dest-za", destinationWarehouseName: "Cape Town Fulfilment Centre", status: "in_transit", carrier: "DHL Global Forwarding", trackingNumber: "DHL-GZ-CT-88213", dispatchedAt: ago(2880), receivedAt: null, customsClearedAt: null, closedAt: null, orderCount: 1, createdAt: ago(2880) },
];

// ─── Tax & customs mock data ──────────────────────────────────────────────────
const MKT_TAX_RATES: Record<string, unknown>[] = [
  { country: "ZA", vatRatePct: 15, defaultDutyRatePct: 20, notes: "SARS: 15% VAT on all imports (no de minimis since Nov 2024). Duty 0-45% by HS code; 20% used here as an unclassified-goods placeholder.", updatedAt: ago(4380*60) },
  { country: "ZM", vatRatePct: 16, defaultDutyRatePct: 25, notes: "ZRA: 16% VAT. Duty bands 0/5/15/25/40% by HS code; 25% (\"most finished consumer goods\") used as the unclassified-goods placeholder.", updatedAt: ago(4380*60) },
];

const MKT_DUTY_RATES: Record<string, unknown>[] = [
  { id: "dr-01", country: "ZA", categoryId: "cat-01", categoryName: "Electronics", dutyRatePct: 0, notes: "Phones/laptops/most electronics are duty-free under the WTO Information Technology Agreement." },
  { id: "dr-02", country: "ZA", categoryId: "cat-02", categoryName: "Fashion", dutyRatePct: 45, notes: "SARS Schedule 1, Chapters 61-62 (clothing)." },
  { id: "dr-03", country: "ZA", categoryId: "cat-06", categoryName: "Books & Media", dutyRatePct: 0, notes: "Books typically duty-free." },
  { id: "dr-04", country: "ZM", categoryId: "cat-06", categoryName: "Books & Media", dutyRatePct: 0, notes: "Educational materials commonly exempt — verify per ASYCUDA classification." },
];

const MKT_CUSTOMS_RECORDS: Record<string, unknown>[] = [];

export const mktMock = {
  categories: () => ({ success:true, data:MKT_CATS }),
  products: (qs?: Record<string,string>) => {
    let data = [...MKT_PRODUCTS];
    if (qs?.category) data = data.filter(p => p.categoryId === qs.category || p.categoryName.toLowerCase() === qs.category.toLowerCase());
    if (qs?.search)   data = data.filter(p => p.name.toLowerCase().includes(qs.search.toLowerCase()) || p.brand.toLowerCase().includes(qs.search.toLowerCase()));
    if (qs?.featured === "true") data = data.filter(p => p.isFeatured);
    if (qs?.flashDeal === "true") data = data.filter(p => p.isFlashDeal);
    if (qs?.sort === "price_asc")  data.sort((a,b) => a.price-b.price);
    if (qs?.sort === "price_desc") data.sort((a,b) => b.price-a.price);
    if (qs?.sort === "rating")     data.sort((a,b) => b.avgRating-a.avgRating);
    return { success:true, data, meta:{ page:1, limit:48, total:data.length, pages:1, brands:[...new Set(data.map(p=>p.brand))] } };
  },
  productById: (id: string) => {
    const p = MKT_PRODUCTS.find(p => p.id === id || p.slug === id) ?? MKT_PRODUCTS[0];
    const seller = { id:p.sellerId, storeName:p.sellerName, avgRating:4.7, reviewCount:rand(100,500), totalSales:rand(100,2000), status:"active", kycVerified:true, country:"ZA", description:"Trusted seller on Ballylife" };
    const related = MKT_PRODUCTS.filter(r => r.categoryId === p.categoryId && r.id !== p.id).slice(0,4);
    const reviews = [
      { id:uuid(), productId:p.id, reviewerName:"Margaret B.", rating:5, title:"Absolutely love it!", body:"Exceeded all my expectations. Quality is outstanding.", verifiedPurchase:true, helpful:24, createdAt:ago(120) },
      { id:uuid(), productId:p.id, reviewerName:"James M.", rating:4, title:"Great value for money", body:"Very happy with the purchase. Works exactly as described.", verifiedPurchase:true, helpful:12, createdAt:ago(480) },
      { id:uuid(), productId:p.id, reviewerName:"Thandi Z.", rating:5, title:"Highly recommend", body:"Perfect product! Already recommended to friends.", verifiedPurchase:true, helpful:8, createdAt:ago(1440) },
    ];
    return { success:true, data:{ product:p, seller, reviews, related } };
  },
  searchSuggest: (q: string) => {
    const matches = MKT_PRODUCTS.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.brand.toLowerCase().includes(q.toLowerCase())).slice(0,5).map(p => ({ id:p.id, name:p.name, price:p.price, emoji:p.emoji, category:p.categoryName }));
    return { success:true, data:matches };
  },
  reviews: (productId: string) => ({
    success:true, data:[
      { id:uuid(), productId, reviewerName:"Margaret B.", rating:5, title:"Absolutely love it!", body:"Exceeded all my expectations.", verifiedPurchase:true, helpful:24, createdAt:ago(120) },
      { id:uuid(), productId, reviewerName:"James M.", rating:4, title:"Great value", body:"Very happy with this purchase.", verifiedPurchase:true, helpful:12, createdAt:ago(480) },
    ], meta:{ total:2, avg:4.5, distribution:[{stars:5,count:1},{stars:4,count:1},{stars:3,count:0},{stars:2,count:0},{stars:1,count:0}] }
  }),
  addReview: (body: Record<string,unknown>) => ({ success:true, data:{ id:uuid(), ...body, status:"approved", createdAt:new Date().toISOString() } }),
  cart: () => ({ success:true, data:DEMO_CART }),
  addToCart: (body: Record<string,unknown>) => {
    const p = MKT_PRODUCTS.find(p => p.id === body.productId);
    if (!p) return { success:false, error:"Product not found" };
    const existing = DEMO_CART.items.find(i => i.productId === p.id);
    if (existing) { existing.quantity += Number(body.quantity ?? 1); }
    else { DEMO_CART.items.push({ productId:p.id, variantId:String(body.variantId ?? ""), quantity:Number(body.quantity ?? 1), unitPrice:p.price, name:p.name, emoji:p.emoji, sellerName:p.sellerName, maxStock:p.stock }); }
    DEMO_CART.subtotal = +DEMO_CART.items.reduce((s,i) => s+i.unitPrice*i.quantity, 0).toFixed(2);
    DEMO_CART.shipping = DEMO_CART.subtotal > 500 ? 0 : 99;
    DEMO_CART.tax = +(DEMO_CART.subtotal * 0.15).toFixed(2);
    DEMO_CART.total = +(DEMO_CART.subtotal + DEMO_CART.shipping + DEMO_CART.tax - DEMO_CART.couponDiscount).toFixed(2);
    return { success:true, data:DEMO_CART };
  },
  updateCartItem: (body: Record<string,unknown>) => {
    const item = DEMO_CART.items.find(i => i.productId === body.productId);
    if (item) { if (Number(body.quantity) <= 0) { DEMO_CART.items = DEMO_CART.items.filter(i => i.productId !== body.productId); } else { item.quantity = Number(body.quantity); } }
    DEMO_CART.subtotal = +DEMO_CART.items.reduce((s,i) => s+i.unitPrice*i.quantity, 0).toFixed(2);
    DEMO_CART.total = +(DEMO_CART.subtotal + DEMO_CART.shipping + DEMO_CART.tax).toFixed(2);
    return { success:true, data:DEMO_CART };
  },
  removeCartItem: (productId: string) => {
    DEMO_CART.items = DEMO_CART.items.filter(i => i.productId !== productId);
    DEMO_CART.subtotal = +DEMO_CART.items.reduce((s,i) => s+i.unitPrice*i.quantity, 0).toFixed(2);
    DEMO_CART.total = +(DEMO_CART.subtotal + DEMO_CART.shipping + DEMO_CART.tax).toFixed(2);
    return { success:true, data:DEMO_CART };
  },
  applyCoupon: (code: string) => {
    const coupons: Record<string,{discount:number;msg:string}> = { "WELCOME10":{discount:DEMO_CART.subtotal*0.1, msg:"10% discount applied!"}, "SAVE200":{discount:200,msg:"R200 discount applied!"}, "FREESHIP":{discount:DEMO_CART.shipping,msg:"Free shipping applied!"} };
    const c = coupons[code?.toUpperCase()];
    if (!c) return { success:false, error:"Invalid or expired coupon code" };
    DEMO_CART.couponCode = code.toUpperCase(); DEMO_CART.couponDiscount = +c.discount.toFixed(2);
    DEMO_CART.total = +(DEMO_CART.subtotal + DEMO_CART.shipping + DEMO_CART.tax - DEMO_CART.couponDiscount).toFixed(2);
    return { success:true, data:DEMO_CART, message:c.msg };
  },
  placeOrder: (_body: unknown) => {
    const order = { id:`ord-new-${uuid()}`, orderNumber:`VNK-ORD-${String(100008+MKT_ORDERS.length).padStart(6,"0")}`, userId:"demo-customer-001", status:"confirmed", paymentStatus:"paid", items:DEMO_CART.items.map(i => ({...i,totalPrice:i.unitPrice*i.quantity,productName:i.name,sellerId:"sel-01",variantLabel:null})), subtotal:DEMO_CART.subtotal, shippingCost:DEMO_CART.shipping, taxAmount:DEMO_CART.tax, discountAmount:DEMO_CART.couponDiscount, totalAmount:DEMO_CART.total, currency:"ZAR", paymentMethod:"card", shippingAddress:{label:"Home",firstName:"Margaret",lastName:"Botha",line1:"42 Kloof Street",line2:null,city:"Cape Town",state:"Western Cape",postalCode:"8001",country:"ZA",phone:"+27821000001"}, shippingStatus:"not_shipped", trackingNumber:null, carrier:null, estimatedDelivery:new Date(Date.now()+5*86400000).toISOString(), couponCode:DEMO_CART.couponCode, notes:null, placedAt:new Date().toISOString(), confirmedAt:new Date().toISOString(), shippedAt:null, deliveredAt:null, cancelledAt:null, customerName:"Margaret Botha", customerEmail:"margaret@example.com" };
    DEMO_CART.items = []; DEMO_CART.subtotal = 0; DEMO_CART.shipping = 0; DEMO_CART.tax = 0; DEMO_CART.total = 0; DEMO_CART.couponCode = null; DEMO_CART.couponDiscount = 0;
    return { success:true, data:order };
  },
  orders: () => ({ success:true, data:MKT_ORDERS, meta:{ total:MKT_ORDERS.length } }),
  wishlist: () => ({ success:true, data:MKT_PRODUCTS.slice(0,3), meta:{ total:3 } }),
  sellers: () => ({ success:true, data:[
    { id:"sel-01", storeName:"TechZone SA",  avgRating:4.7, totalSales:1842, totalRevenue:2480000, status:"active", kycVerified:true, totalProducts:5 },
    { id:"sel-02", storeName:"Fashion Hub",  avgRating:4.5, totalSales:934,  totalRevenue:480000,  status:"active", kycVerified:true, totalProducts:3 },
    { id:"sel-03", storeName:"HomeStyle",    avgRating:4.6, totalSales:521,  totalRevenue:920000,  status:"active", kycVerified:true, totalProducts:2 },
    { id:"sel-04", storeName:"SportsPro",    avgRating:4.4, totalSales:683,  totalRevenue:340000,  status:"active", kycVerified:true, totalProducts:2 },
    { id:"sel-05", storeName:"BeautyBar",    avgRating:4.8, totalSales:1103, totalRevenue:210000,  status:"active", kycVerified:true, totalProducts:2 },
    { id:"sel-07", storeName:"WorkSpace Direct", avgRating:4.6, totalSales:412, totalRevenue:1380000, status:"active", kycVerified:true, totalProducts:7 },
  ], meta:{ total:6 } }),
  sellerAnalytics: () => ({ success:true, data:{
    seller:{ id:"sel-01", storeName:"TechZone SA", avgRating:4.7, totalSales:1842, totalRevenue:2480000 },
    products:MKT_PRODUCTS.filter(p=>p.sellerId==="sel-01"),
    revenue:Array.from({length:7},(_,i)=>({ day:new Date(Date.now()-(6-i)*86400000).toLocaleDateString("en",{weekday:"short"}), revenue:rand(15000,80000), orders:rand(5,25) })),
    topProducts:MKT_PRODUCTS.filter(p=>p.sellerId==="sel-01").slice(0,3).map(p=>({ id:p.id, name:p.name, emoji:p.emoji, sold:p.totalSold, revenue:p.totalSold*p.price })),
  }}),
  adminStats: () => ({ success:true, data:{ totalProducts:12, totalSellers:5, totalOrders:8, totalRevenue:MKT_ORDERS.reduce((s,o)=>s+o.totalAmount,0), activeCustomers:4820, pendingReviews:14, pendingSellerApprovals:3, topCategories:MKT_CATS.slice(0,5).map(c=>({name:c.name,count:c.productCount})) } }),
  addresses: () => ({ success:true, data:[{ id:"addr-1", userId:"demo-customer-001", label:"Home", firstName:"Margaret", lastName:"Botha", line1:"42 Kloof Street", line2:"Apt 3B", city:"Cape Town", state:"Western Cape", postalCode:"8001", country:"ZA", phone:"+27821000001", isDefault:true }] }),

  // ─── Supply chain (supplier catalog, warehouses, shipments, supplier orders) ─
  supplierCatalog: (qs: Record<string,string>) => {
    let list = MKT_SUPPLIER_PRODUCTS.filter(sp => sp.status === "active");
    if (qs.country)  list = list.filter(sp => sp.originCountry === qs.country);
    if (qs.category) list = list.filter(sp => sp.categoryId === qs.category);
    if (qs.search)   list = list.filter(sp => sp.name.toLowerCase().includes(qs.search.toLowerCase()));
    return { success:true, data:list, meta:{ page:1, limit:20, total:list.length, pages:1 } };
  },
  supplierCatalogItem: (id: string) => {
    const item = MKT_SUPPLIER_PRODUCTS.find(sp => sp.id === id);
    return item ? { success:true, data:item } : { success:false, error:"Catalog item not found" };
  },
  importListing: (body: R) => {
    const sp = MKT_SUPPLIER_PRODUCTS.find(s => s.id === body.supplierProductId);
    if (!sp) return { success:false, error:"Supplier catalog item not found or no longer available" };
    if (!sp.retailPrice || sp.retailPrice <= 0) return { success:false, error:"This catalog item has no retail price set yet — ask a manager to set one before importing." };
    sp.importCount = (sp.importCount ?? 0) + 1;
    const newProduct = {
      id:`p-new-${uuid()}`, sellerId:"sel-01", sellerName:"TechZone SA", categoryId:sp.categoryId, categoryName:"Electronics",
      name:sp.name, slug:sp.name.toLowerCase().replace(/[^a-z0-9]+/g,"-"), shortDescription:sp.description, description:sp.description,
      price:sp.retailPrice, compareAtPrice:sp.compareAtPrice ?? null, currency:"ZAR", images:sp.images, emoji:sp.emoji,
      status:"pending_review", stock:Number(body.stock) || 0, sku:null, brand:"Imported", tags:[], attributes:{}, variants:[],
      avgRating:0, reviewCount:0, totalSold:0, isFeatured:false, isFlashDeal:false, flashDealEndsAt:null,
      fulfillmentType:"imported", supplierProductId:sp.id, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    };
    MKT_PRODUCTS.push(newProduct as never);
    return { success:true, data:newProduct, message:"Imported to your store — it will appear once approved by the marketplace team." };
  },
  adminSuppliers: () => ({ success:true, data:MKT_SUPPLIERS }),
  adminCreateSupplier: (body: R) => {
    if (!body.name || !body.country) return { success:false, error:"name and country are required" };
    const s = { id:`sup-${String(body.country).toLowerCase()}-${uuid()}`, name:body.name, country:body.country, contactName:body.contactName ?? null,
      contactEmail:body.contactEmail ?? null, contactPhone:body.contactPhone ?? null, platform:body.platform ?? null, paymentTerms:body.paymentTerms ?? null,
      leadTimeDays:body.leadTimeDays ?? 14, dropshipSupported:body.dropshipSupported ?? true, verified:body.verified ?? false, status:"active",
      notes:body.notes ?? null, createdAt:new Date().toISOString() };
    MKT_SUPPLIERS.push(s as never);
    return { success:true, data:s };
  },
  adminUpdateSupplier: (id: string, body: R) => {
    const s = MKT_SUPPLIERS.find(x => x.id === id);
    if (!s) return { success:false, error:"Supplier not found" };
    Object.assign(s, body);
    return { success:true, data:s };
  },
  adminSupplierProducts: () => ({ success:true, data:MKT_SUPPLIER_PRODUCTS }),
  adminCreateSupplierProduct: (body: R) => {
    if (!body.supplierId || !body.name || body.costPrice === undefined || !body.originCountry) return { success:false, error:"supplierId, name, costPrice and originCountry are required" };
    const supplier = MKT_SUPPLIERS.find(s => s.id === body.supplierId);
    const sp = { id:`spr-${uuid()}`, supplierId:body.supplierId, supplierName:supplier?.name ?? "", supplierCountry:supplier?.country ?? body.originCountry,
      categoryId:body.categoryId ?? null, name:body.name, description:body.description ?? "", costPrice:Number(body.costPrice), currency:body.currency ?? "USD",
      retailPrice:Number(body.retailPrice) || 0, compareAtPrice:body.compareAtPrice !== undefined && body.compareAtPrice !== "" ? Number(body.compareAtPrice) : null,
      moq:body.moq ?? 1, images:body.images ?? [], emoji:body.emoji ?? "📦", originCountry:body.originCountry, status:"active", importCount:0,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    MKT_SUPPLIER_PRODUCTS.push(sp as never);
    return { success:true, data:sp };
  },
  adminUpdateSupplierProduct: (id: string, body: R) => {
    const sp = MKT_SUPPLIER_PRODUCTS.find(x => x.id === id);
    if (!sp) return { success:false, error:"Catalog item not found" };
    Object.assign(sp, body);
    return { success:true, data:sp };
  },
  adminWarehouses: () => ({ success:true, data:MKT_WAREHOUSES }),
  adminCreateWarehouse: (body: R) => {
    if (!body.name || !body.country || !body.type) return { success:false, error:"name, country and type are required" };
    const w = { id:`wh-${body.type === "origin" ? "origin" : "dest"}-${String(body.country).toLowerCase()}-${uuid()}`, name:body.name, country:body.country,
      type:body.type, address:body.address ?? null, status:"active", createdAt:new Date().toISOString() };
    MKT_WAREHOUSES.push(w as never);
    return { success:true, data:w };
  },
  adminSupplierOrders: () => ({ success:true, data:MKT_SUPPLIER_ORDERS, meta:{ total:MKT_SUPPLIER_ORDERS.length } }),
  adminUpdateSupplierOrderStatus: (id: string, body: R) => {
    const TRANSITIONS: Record<string,string[]> = {
      ordered_from_supplier: ["received_at_origin_hub"], received_at_origin_hub: ["qc_passed_origin","qc_failed_origin"],
      qc_passed_origin: ["in_transit_to_destination"], qc_failed_origin: [], in_transit_to_destination: ["received_at_destination_hub"],
      received_at_destination_hub: ["customs_cleared"], customs_cleared: ["shipped_to_customer"], shipped_to_customer: ["delivered"], delivered: [],
    };
    const so = MKT_SUPPLIER_ORDERS.find(x => x.id === id);
    if (!so) return { success:false, error:"Supplier order not found" };
    const allowed = TRANSITIONS[so.status as string] ?? [];
    if (!allowed.includes(body.status as string)) return { success:false, error:`Cannot move from "${so.status}" to "${body.status}" — valid next step(s): ${allowed.join(", ") || "none (terminal state)"}` };
    so.status = body.status; if (body.qcNotes) so.qcNotes = body.qcNotes; so.updatedAt = new Date().toISOString();
    return { success:true, data:so };
  },
  adminShipments: () => ({ success:true, data:MKT_SHIPMENTS }),
  adminCreateShipment: (body: R) => {
    const batch = MKT_SUPPLIER_ORDERS.filter(so => so.originWarehouseId === body.originWarehouseId && so.destinationWarehouseId === body.destinationWarehouseId && so.status === "qc_passed_origin");
    if (!batch.length) return { success:false, error:"No QC-passed orders waiting at this origin/destination pair to batch into a shipment." };
    const originWh = MKT_WAREHOUSES.find(w => w.id === body.originWarehouseId);
    const destWh = MKT_WAREHOUSES.find(w => w.id === body.destinationWarehouseId);
    const sh = { id:`sh-${uuid()}`, originWarehouseId:body.originWarehouseId, originWarehouseName:originWh?.name ?? "", destinationWarehouseId:body.destinationWarehouseId,
      destinationWarehouseName:destWh?.name ?? "", status:"in_transit", carrier:body.carrier ?? null, trackingNumber:body.trackingNumber ?? null,
      dispatchedAt:new Date().toISOString(), receivedAt:null, customsClearedAt:null, closedAt:null, orderCount:batch.length, createdAt:new Date().toISOString() };
    MKT_SHIPMENTS.push(sh as never);
    batch.forEach(so => { so.shipmentId = sh.id; so.status = "in_transit_to_destination"; so.updatedAt = new Date().toISOString(); });
    return { success:true, data:sh, message:`${batch.length} order(s) batched into this shipment.` };
  },
  adminUpdateShipmentStatus: (id: string, body: R) => {
    const sh = MKT_SHIPMENTS.find(x => x.id === id);
    if (!sh) return { success:false, error:"Shipment not found" };
    sh.status = body.status;
    const CASCADE: Record<string,string> = { received_at_destination:"received_at_destination_hub", customs_cleared:"customs_cleared" };
    if (body.status === "received_at_destination") sh.receivedAt = new Date().toISOString();
    if (body.status === "customs_cleared") sh.customsClearedAt = new Date().toISOString();
    if (body.status === "closed") sh.closedAt = new Date().toISOString();
    if (CASCADE[body.status as string]) {
      MKT_SUPPLIER_ORDERS.filter(so => so.shipmentId === id).forEach(so => { so.status = CASCADE[body.status as string]; so.updatedAt = new Date().toISOString(); });
    }
    return { success:true, data:sh };
  },
  adminResolveSupplierOrder: (id: string, body: R) => {
    const so = MKT_SUPPLIER_ORDERS.find(x => x.id === id);
    if (!so) return { success:false, error:"Supplier order not found" };
    if (so.status !== "qc_failed_origin") return { success:false, error:`Only a failed-QC order can be resolved — this one is "${so.status}"` };
    if (body.action === "refund") {
      so.status = "refunded"; so.qcNotes = body.notes ?? so.qcNotes; so.updatedAt = new Date().toISOString();
      const order = MKT_ORDERS.find((o: R) => o.id === so.orderId);
      if (order) { order.status = "refunded"; order.paymentStatus = "refunded"; }
      return { success:true, data:so, message:"Order refunded." };
    } else if (body.action === "reorder") {
      so.status = "ordered_from_supplier"; so.qcNotes = body.notes ?? "Reordered after failed origin QC."; so.updatedAt = new Date().toISOString();
      return { success:true, data:so, message:"Sent back to the supplier for reorder." };
    }
    return { success:false, error:"action must be 'refund' or 'reorder'" };
  },
  sellerSupplierOrders: (sellerId: string) => ({ success:true, data:MKT_SUPPLIER_ORDERS.filter(so => so.sellerId === sellerId), meta:{ total:MKT_SUPPLIER_ORDERS.filter(so => so.sellerId === sellerId).length } }),
  pendingProducts: () => { const list = MKT_PRODUCTS.filter((p: R) => p.status === "pending_review"); return { success:true, data:list, meta:{ total:list.length } }; },
  approveProduct: (id: string) => {
    const p = MKT_PRODUCTS.find((x: R) => x.id === id);
    if (!p) return { success:false, error:"Product not found" };
    p.status = "active";
    return { success:true, data:p };
  },
  adminAllProducts: (qs: Record<string,string>) => {
    let list = [...MKT_PRODUCTS] as R[];
    if (qs.search) list = list.filter(p => String(p.name).toLowerCase().includes(qs.search.toLowerCase()) || String(p.sellerName).toLowerCase().includes(qs.search.toLowerCase()));
    if (qs.fulfillmentType) list = list.filter(p => (p.fulfillmentType ?? "local") === qs.fulfillmentType);
    return { success:true, data:list, meta:{ page:1, limit:24, total:list.length, pages:1 } };
  },
  adminUpdateProductPrice: (id: string, body: R) => {
    const p = MKT_PRODUCTS.find((x: R) => x.id === id);
    if (!p) return { success:false, error:"Product not found" };
    p.price = Number(body.price); p.compareAtPrice = body.compareAtPrice !== undefined ? (body.compareAtPrice === null ? null : Number(body.compareAtPrice)) : p.compareAtPrice;
    p.updatedAt = new Date().toISOString();
    return { success:true, data:p };
  },
  adminTaxRates: () => ({ success:true, data:MKT_TAX_RATES }),
  adminCreateTaxRate: (body: R) => {
    if (!body.country || body.vatRatePct === undefined) return { success:false, error:"country and vatRatePct are required" };
    let t = MKT_TAX_RATES.find(x => x.country === body.country);
    if (!t) { t = { country: body.country }; MKT_TAX_RATES.push(t); }
    t.vatRatePct = Number(body.vatRatePct); t.defaultDutyRatePct = Number(body.defaultDutyRatePct) || 0; t.notes = body.notes ?? null; t.updatedAt = new Date().toISOString();
    return { success:true, data:t };
  },
  adminUpdateTaxRate: (country: string, body: R) => {
    const t = MKT_TAX_RATES.find(x => x.country === country);
    if (!t) return { success:false, error:"Country not found — create it first via POST /admin/tax-rates" };
    if (body.vatRatePct !== undefined) t.vatRatePct = Number(body.vatRatePct);
    if (body.defaultDutyRatePct !== undefined) t.defaultDutyRatePct = Number(body.defaultDutyRatePct);
    if (body.notes !== undefined) t.notes = body.notes;
    t.updatedAt = new Date().toISOString();
    return { success:true, data:t };
  },
  adminDutyRates: (qs: Record<string,string>) => {
    let list = [...MKT_DUTY_RATES];
    if (qs.country) list = list.filter(d => d.country === qs.country);
    return { success:true, data:list };
  },
  adminCreateDutyRate: (body: R) => {
    if (!body.country || !body.categoryId || body.dutyRatePct === undefined) return { success:false, error:"country, categoryId and dutyRatePct are required" };
    let d = MKT_DUTY_RATES.find(x => x.country === body.country && x.categoryId === body.categoryId);
    const cat = MKT_CATS.find(c => c.id === body.categoryId);
    if (!d) { d = { id:`dr-${uuid()}`, country: body.country, categoryId: body.categoryId, categoryName: cat?.name ?? "" }; MKT_DUTY_RATES.push(d); }
    d.dutyRatePct = Number(body.dutyRatePct); d.notes = body.notes ?? null;
    return { success:true, data:d };
  },
  adminUpdateDutyRate: (id: string, body: R) => {
    const d = MKT_DUTY_RATES.find(x => x.id === id);
    if (!d) return { success:false, error:"Duty rate not found" };
    if (body.dutyRatePct !== undefined) d.dutyRatePct = Number(body.dutyRatePct);
    if (body.notes !== undefined) d.notes = body.notes;
    return { success:true, data:d };
  },
  adminCustomsRecords: () => ({ success:true, data:MKT_CUSTOMS_RECORDS }),
  adminGenerateCustomsRecord: (body: R) => {
    const shipment = MKT_SHIPMENTS.find(s => s.id === body.shipmentId);
    if (!shipment) return { success:false, error:"Shipment not found" };
    const destWh = MKT_WAREHOUSES.find(w => w.id === shipment.destinationWarehouseId);
    const destinationCountry = (destWh?.country as string) ?? "ZA";
    const lines = MKT_SUPPLIER_ORDERS.filter(so => so.shipmentId === shipment.id);
    if (!lines.length) return { success:false, error:"This shipment has no supplier orders to base a customs record on." };
    const taxRate = MKT_TAX_RATES.find(t => t.country === destinationCountry);
    const vatRatePct = Number(taxRate?.vatRatePct ?? 15);
    const defaultDutyRatePct = Number(taxRate?.defaultDutyRatePct ?? 20);
    let declaredValue = 0, dutyAmount = 0;
    for (const line of lines) {
      const product = MKT_PRODUCTS.find(p => p.id === line.productId);
      const rate = product ? Number(MKT_DUTY_RATES.find(d => d.country === destinationCountry && d.categoryId === product.categoryId)?.dutyRatePct ?? defaultDutyRatePct) : defaultDutyRatePct;
      const cost = Number(line.costAmount ?? 0);
      declaredValue += cost;
      dutyAmount += cost * (rate / 100);
    }
    const vatAmount = (declaredValue + dutyAmount) * (vatRatePct / 100);
    const totalPayable = dutyAmount + vatAmount;
    let record = MKT_CUSTOMS_RECORDS.find(r => r.shipmentId === shipment.id);
    const originWh = MKT_WAREHOUSES.find(w => w.id === shipment.originWarehouseId);
    if (!record) {
      record = { id:`cr-${uuid()}`, shipmentId: shipment.id, originWarehouseName: originWh?.name, destinationWarehouseName: destWh?.name,
        status: "duty_calculated", clearingAgent: null, referenceNumber: null, prepaidAt: null, declaredAt: null, clearedAt: null, notes: null,
        currency: "ZAR", orderCount: lines.length, createdAt: new Date().toISOString() };
      MKT_CUSTOMS_RECORDS.push(record);
    }
    record.destinationCountry = destinationCountry; record.declaredValue = +declaredValue.toFixed(2);
    record.dutyAmount = +dutyAmount.toFixed(2); record.vatAmount = +vatAmount.toFixed(2); record.totalPayable = +totalPayable.toFixed(2);
    record.updatedAt = new Date().toISOString();
    return { success:true, data:record };
  },
  adminUpdateCustomsRecord: (id: string, body: R) => {
    const TRANSITIONS: Record<string, string[]> = {
      duty_calculated: ["prepaid_to_agent"], prepaid_to_agent: ["declared_to_customs","held"],
      declared_to_customs: ["cleared","held"], held: ["declared_to_customs","cleared"], cleared: [],
    };
    const r = MKT_CUSTOMS_RECORDS.find(x => x.id === id);
    if (!r) return { success:false, error:"Customs record not found" };
    if (body.status !== undefined) {
      const allowed = TRANSITIONS[r.status as string] ?? [];
      if (!allowed.includes(body.status)) return { success:false, error:`Cannot move from "${r.status}" to "${body.status}" — valid next step(s): ${allowed.join(", ") || "none (terminal state)"}` };
      r.status = body.status;
      if (body.status === "prepaid_to_agent") r.prepaidAt = new Date().toISOString();
      if (body.status === "declared_to_customs") r.declaredAt = new Date().toISOString();
      if (body.status === "cleared") r.clearedAt = new Date().toISOString();
    }
    if (body.clearingAgent !== undefined) r.clearingAgent = body.clearingAgent;
    if (body.referenceNumber !== undefined) r.referenceNumber = body.referenceNumber;
    if (body.notes !== undefined) r.notes = body.notes;
    r.updatedAt = new Date().toISOString();
    return { success:true, data:r };
  },
  // ─── Supplier self-service (demo persona: always sup-cn-01) ─────────────
  supplierByUser: (_userId: string) => {
    const s = MKT_SUPPLIERS.find(x => x.id === "sup-cn-01");
    return s ? { success:true, data:s } : { success:false, error:"No supplier account linked to this login" };
  },
  supplierGet: (id: string) => {
    const s = MKT_SUPPLIERS.find(x => x.id === id);
    return s ? { success:true, data:s } : { success:false, error:"Supplier not found" };
  },
  supplierUpdateProfile: (id: string, body: R) => {
    const s = MKT_SUPPLIERS.find(x => x.id === id);
    if (!s) return { success:false, error:"Supplier not found" };
    Object.assign(s, body);
    return { success:true, data:s };
  },
  supplierProducts: (id: string) => ({ success:true, data:MKT_SUPPLIER_PRODUCTS.filter(sp => sp.supplierId === id) }),
  supplierAddProduct: (id: string, body: R) => {
    if (!body.name || body.costPrice === undefined) return { success:false, error:"name and costPrice are required" };
    const supplier = MKT_SUPPLIERS.find(s => s.id === id);
    const sp = { id:`spr-${uuid()}`, supplierId:id, supplierName:supplier?.name ?? "", supplierCountry:supplier?.country ?? "CN",
      categoryId:null, categoryName:null, name:body.name, description:body.description ?? "", costPrice:Number(body.costPrice),
      currency:body.currency ?? "USD", retailPrice:0, compareAtPrice:null, moq:body.moq ?? 1, images:body.images ?? [],
      emoji:body.emoji ?? "📦", originCountry:supplier?.country ?? "CN", status:"pending_review", importCount:0,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    MKT_SUPPLIER_PRODUCTS.push(sp as never);
    return { success:true, data:sp, message:"Submitted — a manager will categorize, price, and approve it before it's importable." };
  },
  supplierUpdateProduct: (supplierId: string, productId: string, body: R) => {
    const sp = MKT_SUPPLIER_PRODUCTS.find(x => x.id === productId && x.supplierId === supplierId);
    if (!sp) return { success:false, error:"Catalog item not found" };
    const allowed: (keyof typeof sp)[] = ["name","description","costPrice","currency","moq","emoji","images"] as never;
    for (const f of allowed) { if (body[f as string] !== undefined) (sp as R)[f as string] = body[f as string]; }
    sp.updatedAt = new Date().toISOString();
    return { success:true, data:sp };
  },
  supplierOrdersFor: (id: string) => { const list = MKT_SUPPLIER_ORDERS.filter(so => so.supplierId === id); return { success:true, data:list, meta:{ total:list.length } }; },
  adminCreateSupplierLogin: (id: string, body: R) => {
    if (!body.username || !body.password) return { success:false, error:"username and password are required" };
    if (typeof body.password !== "string" || body.password.length < 8) return { success:false, error:"Password must be at least 8 characters" };
    const s = MKT_SUPPLIERS.find(x => x.id === id);
    if (!s) return { success:false, error:"Supplier not found" };
    if (s.userId) return { success:false, error:"This supplier already has a login" };
    s.userId = `demo-supplier-user-${id}`;
    return { success:true, message:"Login created — share the username and password with the supplier directly; they aren't stored anywhere else." };
  },
};
