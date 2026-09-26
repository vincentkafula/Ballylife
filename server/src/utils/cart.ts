/**
 * Cart running-total math — extracted out of the cart routes. Note this
 * is deliberately an ESTIMATE: it always assumes South Africa's 15% VAT
 * and flat shipping, since the cart is built before an address is
 * necessarily chosen. POST /orders recomputes tax properly (see
 * pricing.ts's calculateVat) once the real shipping country is known —
 * this function's `tax` and `total` are only ever shown to the customer
 * as a running estimate, never charged as-is.
 */

export interface CartItem {
  unitPrice: number;
  quantity: number;
  /** Supplier-fulfilled item whose price already includes delivery -- never charged the local delivery fee. */
  shippingIncluded?: boolean;
}

export const LOCAL_DELIVERY_FEE = 99;
export const FREE_LOCAL_DELIVERY_OVER = 500;

export interface Coupon {
  type: "percentage" | "fixed_amount" | "free_shipping";
  value: number | string;
  max_discount_amount?: number | string | null;
}

export interface CartTotals {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  couponDiscount: number;
}

export function recalcCartTotals(items: CartItem[], coupon: Coupon | null): CartTotals {
  const subtotal = +items.reduce((s, i) => s + i.unitPrice * i.quantity, 0).toFixed(2);

  let couponDiscount = 0;
  if (coupon) {
    if (coupon.type === "percentage") {
      const maxDiscount = coupon.max_discount_amount ? Number(coupon.max_discount_amount) : Infinity;
      couponDiscount = Math.min(+(subtotal * Number(coupon.value) / 100).toFixed(2), maxDiscount);
    } else if (coupon.type === "fixed_amount") {
      couponDiscount = Math.min(Number(coupon.value), subtotal);
    }
  }

  // The local delivery fee applies only to locally dispatched items, and the
  // free-delivery threshold is measured on those items alone. Supplier-
  // fulfilled items already carry their shipping in the price.
  const localItems = items.filter(i => !i.shippingIncluded);
  const localSubtotal = localItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const shipping = !localItems.length || localSubtotal > FREE_LOCAL_DELIVERY_OVER || coupon?.type === "free_shipping" ? 0 : LOCAL_DELIVERY_FEE;
  const tax = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + shipping + tax - couponDiscount).toFixed(2);

  return { subtotal, shipping, tax, total, couponDiscount };
}
