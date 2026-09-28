/**
 * "Chat on WhatsApp" button for shoppers: opens a WhatsApp chat with
 * Ballylife's number (the bot answers straight away). Bottom-left, so it
 * doesn't cover the install prompt; hidden on the staff/seller dashboards.
 * Number from VITE_WHATSAPP_NUMBER (digits, international format).
 */
import { useLocation } from "react-router-dom";

const NUMBER = String(import.meta.env.VITE_WHATSAPP_NUMBER ?? "27614615035").replace(/\D/g, "");
const HIDDEN_ON = ["/admin", "/seller", "/supplier", "/revenue-authority", "/shipping", "/credit-provider", "/checkout"];

export function WhatsAppChatButton() {
  const { pathname } = useLocation();
  if (!NUMBER || HIDDEN_ON.some(p => pathname.startsWith(p))) return null;
  const href = `https://wa.me/${NUMBER}?text=${encodeURIComponent("Hi Ballylife!")}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Chat with Ballylife on WhatsApp"
      className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-full bg-[#25D366] hover:bg-[#1EBE5A] text-white shadow-lg pl-3 pr-4 py-2.5 text-sm font-semibold">
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" fill="currentColor">
        <path d="M16.04 3C9.4 3 4 8.34 4 14.92c0 2.3.66 4.45 1.8 6.27L4 29l8.03-1.76a12.1 12.1 0 0 0 4.01.68C22.68 27.92 28 22.58 28 16S22.68 3 16.04 3zm0 21.77c-1.26 0-2.49-.24-3.63-.7l-.52-.21-4.77 1.05 1.08-4.6-.34-.55a9.73 9.73 0 0 1-1.53-5.24c0-5.43 4.45-9.84 9.71-9.84 5.28 0 9.73 4.41 9.73 9.84 0 5.44-4.45 10.25-9.73 10.25zm5.33-7.33c-.29-.15-1.73-.85-2-.95-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.14-.17.2-.34.22-.63.07-.29-.15-1.23-.45-2.35-1.44-.87-.77-1.45-1.72-1.62-2.01-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.66-1.58-.9-2.16-.24-.57-.48-.49-.66-.5h-.56c-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.43 0 1.44 1.05 2.82 1.19 3.02.15.2 2.06 3.14 5 4.4.7.3 1.24.48 1.67.61.7.22 1.34.19 1.84.12.56-.08 1.73-.7 1.97-1.38.24-.68.24-1.26.17-1.38-.07-.12-.27-.2-.56-.34z" />
      </svg>
      <span className="hidden sm:inline">Chat on WhatsApp</span>
    </a>
  );
}
