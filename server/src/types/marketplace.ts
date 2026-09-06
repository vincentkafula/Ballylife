// ─── Enums ────────────────────────────────────────────────────────────────────
export type UserRole          = "customer" | "seller" | "admin" | "support";
export type ProductStatus     = "active" | "inactive" | "pending_review" | "rejected" | "out_of_stock";
export type OrderStatus       = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled" | "return_requested" | "returned" | "refunded";
export type PaymentStatus     = "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
export type PaymentMethod     = "card" | "paypal" | "apple_pay" | "google_pay" | "bnpl" | "wallet";
export type ShippingStatus    = "not_shipped" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "failed";
export type SellerStatus      = "pending_kyc" | "active" | "suspended" | "rejected";
export type ReviewStatus      = "pending" | "approved" | "rejected";
export type CouponType        = "percentage" | "fixed_amount" | "free_shipping";
export type VariantType       = "color" | "size" | "style" | "material";

// ─── Seller ───────────────────────────────────────────────────────────────────
export interface Seller {
  id: string;
  userId: string;
  storeName: string;
  storeSlug: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  email: string;
  phone: string;
  country: string;
  status: SellerStatus;
  kycVerified: boolean;
  taxId: string | null;
  totalProducts: number;
  totalSales: number;
  totalRevenue: number;
  avgRating: number;
  reviewCount: number;
  joinedAt: string;
  commissionPct: number;
}

// ─── Category ─────────────────────────────────────────────────────────────────
export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  parentId: string | null;
  productCount: number;
  featured: boolean;
}

// ─── Product ──────────────────────────────────────────────────────────────────
export interface ProductVariant {
  id: string;
  type: VariantType;
  value: string;
  additionalPrice: number;
  stock: number;
  sku: string;
}

export interface Product {
  id: string;
  sellerId: string;
  sellerName: string;
  categoryId: string;
  categoryName: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  price: number;
  compareAtPrice: number | null;  // original/crossed-out price
  currency: string;
  images: string[];               // placeholder colour codes
  emoji: string;
  status: ProductStatus;
  stock: number;
  sku: string;
  brand: string;
  tags: string[];
  attributes: Record<string, string>;
  variants: ProductVariant[];
  avgRating: number;
  reviewCount: number;
  totalSold: number;
  isFeatured: boolean;
  isFlashDeal: boolean;
  flashDealEndsAt: string | null;
  // Optional: absent/undefined means "local" (seller-sourced), the same as
  // every product created before the supplier-catalog feature existed —
  // only imports (see mkt_supplier_orders) set these.
  fulfillmentType?: "local" | "imported";
  supplierProductId?: string | null;
  vehicleDetails?: VehicleDetails | null;
  condition?: "new" | "used" | null;
  nrcsApproved?: boolean;
  nrcsReference?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Cart ─────────────────────────────────────────────────────────────────────
export interface CartItem {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  name: string;
  emoji: string;
  sellerName: string;
  maxStock: number;
}

export interface Cart {
  id: string;
  userId: string;
  items: CartItem[];
  couponCode: string | null;
  couponDiscount: number;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Address ──────────────────────────────────────────────────────────────────
export interface Address {
  id: string;
  userId: string;
  label: string;
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}

// ─── Order ────────────────────────────────────────────────────────────────────
export interface OrderItem {
  productId: string;
  productName: string;
  emoji: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sellerId: string;
  sellerName: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  dutyAmount?: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  shippingAddress: Omit<Address, "id" | "userId" | "isDefault">;
  shippingStatus: ShippingStatus;
  trackingNumber: string | null;
  carrier: string | null;
  estimatedDelivery: string | null;
  couponCode: string | null;
  notes: string | null;
  placedAt: string;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

// ─── Review ───────────────────────────────────────────────────────────────────
export interface Review {
  id: string;
  productId: string;
  userId: string;
  orderId: string;
  rating: number;        // 1-5
  title: string;
  body: string;
  verifiedPurchase: boolean;
  status: ReviewStatus;
  helpful: number;
  images: string[];
  createdAt: string;
  reviewerName: string;
}

// ─── Coupon ───────────────────────────────────────────────────────────────────
export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;         // pct or fixed
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usageCount: number;
  validFrom: string;
  validTo: string;
  active: boolean;
  sellerId: string | null;  // null = platform-wide
}

// ─── Wishlist ─────────────────────────────────────────────────────────────────
export interface WishlistItem {
  userId: string;
  productId: string;
  addedAt: string;
}

// ─── Platform Stats ───────────────────────────────────────────────────────────
export interface MarketplaceStats {
  totalProducts: number;
  totalSellers: number;
  totalOrders: number;
  totalRevenue: number;
  activeCustomers: number;
  pendingReviews: number;
  pendingSellerApprovals: number;
  topCategories: { name: string; count: number }[];
}

// ─── Supply chain (international sourcing + dropship-to-warehouse) ───────────
export type SupplierCountry        = "CN" | "JP" | "KR";
export type WarehouseCountry       = "CN" | "JP" | "KR" | "ZA" | "ZM";
export type WarehouseType          = "origin" | "destination";
export type ShipmentStatus         = "preparing" | "in_transit" | "received_at_destination" | "customs_cleared" | "closed";
export type SupplierOrderStatus    =
  | "ordered_from_supplier" | "received_at_origin_hub" | "qc_passed_origin" | "qc_failed_origin"
  | "in_transit_to_destination" | "received_at_destination_hub" | "customs_cleared"
  | "shipped_to_customer" | "delivered";
export type FulfillmentType        = "local" | "imported";

export interface Supplier {
  id: string;
  name: string;
  country: SupplierCountry;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  platform: string | null;
  paymentTerms: string | null;
  leadTimeDays: number;
  dropshipSupported: boolean;
  verified: boolean;
  status: "active" | "suspended";
  notes: string | null;
  userId?: string | null;
  createdAt: string;
}

export interface SupplierProduct {
  id: string;
  supplierId: string;
  supplierName?: string;
  supplierCountry?: SupplierCountry;
  categoryId: string | null;
  name: string;
  description: string | null;
  costPrice: number;
  currency: string;
  retailPrice: number;
  compareAtPrice: number | null;
  moq: number;
  images: string[];
  emoji: string | null;
  originCountry: SupplierCountry;
  status: "active" | "inactive";
  importCount: number;
  vehicleDetails?: VehicleDetails | null;
  condition?: "new" | "used" | null;
  nrcsApproved?: boolean;
  nrcsReference?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleDetails {
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  engineCc: number;
  bodyType: "sedan" | "hatchback" | "station_wagon" | "suv" | "pickup_single_cab" | "pickup_double_cab" | "panel_van";
  transmission: "automatic" | "manual";
  fuelType: "petrol" | "diesel" | "hybrid" | "electric";
  vin?: string;
}

export interface VehicleDutyZm {
  id: string;
  bodyType: string;
  engineCcMin: number;
  engineCcMax: number | null;
  ageBand: "2_to_5" | "5_plus";
  dutyKwacha: number;
  carbonSurtaxKwacha: number;
  notes: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  country: WarehouseCountry;
  type: WarehouseType;
  address: string | null;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Shipment {
  id: string;
  originWarehouseId: string;
  originWarehouseName?: string;
  destinationWarehouseId: string;
  destinationWarehouseName?: string;
  status: ShipmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  customsClearedAt: string | null;
  closedAt: string | null;
  orderCount?: number;
  createdAt: string;
}

export interface SupplierOrder {
  id: string;
  orderId: string;
  orderNumber?: string;
  productId: string;
  productName?: string;
  supplierId: string;
  supplierName?: string;
  supplierProductId: string;
  sellerId: string;
  sellerName?: string;
  quantity: number;
  costAmount: number;
  originWarehouseId: string;
  originWarehouseName?: string;
  destinationWarehouseId: string;
  destinationWarehouseName?: string;
  shipmentId: string | null;
  status: SupplierOrderStatus;
  qcNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Tax & customs ────────────────────────────────────────────────────────────
export type CustomsStatus = "duty_calculated" | "prepaid_to_agent" | "declared_to_customs" | "cleared" | "held";

export interface TaxRate {
  country: string;
  vatRatePct: number;
  defaultDutyRatePct: number;
  notes: string | null;
  updatedAt: string;
}

export interface DutyRate {
  id: string;
  country: string;
  categoryId: string;
  categoryName?: string;
  dutyRatePct: number;
  notes: string | null;
}

export interface CustomsRecord {
  id: string;
  shipmentId: string;
  destinationCountry: string;
  declaredValue: number;
  dutyAmount: number;
  vatAmount: number;
  totalPayable: number;
  currency: string;
  clearingAgent: string | null;
  referenceNumber: string | null;
  status: CustomsStatus;
  prepaidAt: string | null;
  declaredAt: string | null;
  clearedAt: string | null;
  notes: string | null;
  originWarehouseName?: string;
  destinationWarehouseName?: string;
  orderCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Revenue authority (read-only, country-scoped tax portal) ────────────────
export interface RevenueAuthority {
  id: string;
  name: string;
  country: string;
  contactName: string | null;
  contactEmail: string | null;
  status: "not_agreed" | "agreement_pending" | "active";
  notes: string | null;
  userId?: string | null;
  createdAt: string;
}
