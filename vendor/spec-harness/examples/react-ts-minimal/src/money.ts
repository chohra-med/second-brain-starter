export interface Line {
  unitPriceMinor: number;
  quantity: number;
}

export function totalMinor(lines: readonly Line[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
}

export function formatMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}
