export function parseCredentials(value: unknown): { email: string; password: string } | null {
    if (!value || typeof value !== "object") return null;
    const { email, password } = value as Record<string, unknown>;
    if (typeof email !== "string" || typeof password !== "string") return null;
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return null;
    if (!password || new TextEncoder().encode(password).length > 72) return null;
    return { email: normalizedEmail, password };
}
