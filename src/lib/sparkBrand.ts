/** The product name of the assistant, from the build environment (never hardcoded in screens). */
export function sparkName(env: Record<string, unknown> = import.meta.env as Record<string, unknown>): string {
  const v = typeof env.VITE_SPARK_NAME === 'string' ? env.VITE_SPARK_NAME.trim().slice(0, 24) : '';
  return v || 'Spark';
}
