import { clsx } from "clsx";

export function cn(...values: Array<string | undefined | null | false>) {
  return clsx(values);
}
