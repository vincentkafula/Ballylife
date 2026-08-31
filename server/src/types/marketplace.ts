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
