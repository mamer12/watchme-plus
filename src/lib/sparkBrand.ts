/** The product name of the assistant, from the build environment (never hardcoded in screens). */
export function sparkName(env: Record<string, unknown> = import.meta.env as Record<string, unknown>): string {
  const v = typeof env.VITE_SPARK_NAME === 'string' ? env.VITE_SPARK_NAME.trim().slice(0, 24) : '';
  return v || 'Spark';
}

/** The header icon's label and tooltip: "Ask Spark" / the Arabic equivalent. */
export function sparkAskLabel(lang: 'en' | 'ar', name: string = sparkName()): string {
  return lang === 'ar' ? `اسأل ${name}` : `Ask ${name}`;
}
