/** Browser-side operational settings, kept separate from UI components. */
export const operationsConfig = {
  refreshIntervalMs: 2_000,
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
} as const;
