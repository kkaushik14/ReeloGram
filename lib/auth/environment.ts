/** Server-only bridge for NextAuth's reserved names. Never expose these through next.config.env. */
export function configureNextAuthEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  for (const key of [
    "NEXTAUTH_URL",
    "NEXTAUTH_URL_INTERNAL",
    "NEXTAUTH_SECRET",
  ] as const) {
    const value = environment[`REELOGRAM_${key}`];
    if (value) environment[key] = value;
    else delete environment[key];
  }
}
configureNextAuthEnvironment();
