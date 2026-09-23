import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parseISO } from "date-fns"
import { sl } from "date-fns/locale"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string) {
  try {
    return format(parseISO(dateString), "dd.MM.yyyy", { locale: sl })
  } catch (e) {
    return dateString;
  }
}

export function formatTime(timeString: string) {
  if (timeString.length === 8) {
    return timeString.substring(0, 5); // 14:30:00 -> 14:30
  }
  return timeString;
}

export function formatCurrency(cents: number, currency: string = "EUR") {
  return new Intl.NumberFormat("sl-SI", {
    style: "currency",
    currency: currency,
  }).format(cents / 100);
}
