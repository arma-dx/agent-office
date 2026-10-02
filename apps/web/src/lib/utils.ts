import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Sınıf adlarını birleştirir; çakışan Tailwind sınıflarında sonuncusu geçerli olur. */
export function cn(...girdiler: ClassValue[]): string {
  return twMerge(clsx(girdiler));
}
