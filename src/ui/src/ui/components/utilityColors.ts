/**
 * Utility accent colors shared across DOM chrome
 * (ranked list names, detail card, legend utility dots).
 * Unknown utilities fall back to ink.
 */
export const UTILITY_COLORS: Record<string, string> = {
  GPC: '#D97B29',
  DESC: '#2E86AB',
}

export function utilityColor(utility: string | null | undefined): string {
  return (utility && UTILITY_COLORS[utility]) || '#2B2B2B'
}
