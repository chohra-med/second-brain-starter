import { formatMinor, totalMinor, type Line } from './money';

export function summary(lines: readonly Line[]): string {
  return `Total: ${formatMinor(totalMinor(lines))}`;
}
