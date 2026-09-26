/**
 * Utility accent colors shared across DOM chrome
 * (ranked list names, detail card, legend utility dots).
 * Unknown utilities fall back to ink.
 */
export const UTILITY_COLORS: Record<string, string> = {
  GPC: '#D97B29',
  DESC: '#2E86AB',
  SanteeCooper: '#7A9E43',
  GTC: '#8E44AD',
  MEAG: '#B03A2E',
  DukeCarolinas: '#117A65',
  DukeProgress: '#7D6608',
  DU: '#4A5A6A',
  GRID: '#0E7C86',
}

export function utilityColor(utility: string | null | undefined): string {
  return (utility && UTILITY_COLORS[utility]) || '#2B2B2B'
}
