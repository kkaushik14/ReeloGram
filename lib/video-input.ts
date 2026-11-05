const fileIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

export function parseVideoUpdate(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const keys = Object.keys(data);
    if (!keys.length || keys.some((key) => !["title", "description", "controls"].includes(key))) return null;
    const update: { title?: string; description?: string; controls?: boolean } = {};
    for (const key of ["title", "description"] as const) {
        if (key in data) {
            const text = data[key];
            if (typeof text !== "string" || !text.trim() || text.trim().length > (key === "title" ? 120 : 2000)) return null;
            update[key] = text.trim();
        }
    }
    if ("controls" in data) {
        if (typeof data.controls !== "boolean") return null;
        update.controls = data.controls;
    }
    return update;
}

export function parseVideoInput(value: unknown) {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    if (typeof data.title !== "string" || !data.title.trim() || data.title.trim().length > 120 ||
        typeof data.description !== "string" || !data.description.trim() || data.description.trim().length > 2000 ||
        typeof data.fileId !== "string" || !fileIdPattern.test(data.fileId) ||
        typeof data.thumbnailFileId !== "string" || !fileIdPattern.test(data.thumbnailFileId) ||
        (data.controls !== undefined && typeof data.controls !== "boolean")) return null;
    return {
        title: data.title.trim(), description: data.description.trim(), fileId: data.fileId,
        thumbnailFileId: data.thumbnailFileId, controls: data.controls ?? true,
    };
}

export function parseFeedQuery(params: URLSearchParams) {
    const rawLimit = params.get("limit") ?? (params.has("cursor") ? "1" : "5");
    if (!/^\d{1,3}$/.test(rawLimit)) return null;
    const limit = Number(rawLimit);
    if (limit < 1 || limit > 5) return null;
    const sort = params.get("sort") ?? "newest";
    const period = params.get("period") ?? "any";
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const mine = params.get("mine") ?? "false";
    const source = params.get("source") ?? "all";
    if (!["newest", "oldest"].includes(sort) || !["any", "week", "month", "year"].includes(period) || q.length > 160 || !["true", "false"].includes(mine) || !["all", "pexels", "pixabay", "coverr", "mixkit", "community"].includes(source)) return null;
    const context = JSON.stringify([q, sort, period, mine, source]);
    const rawCursor = params.get("cursor");
    let cursor: { id: string; createdAt: Date } | undefined;
    if (rawCursor !== null) {
        if (rawCursor.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(rawCursor)) return null;
        try {
            const decoded = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"));
            if (typeof decoded.id !== "string" || !/^[a-f0-9]{24}$/i.test(decoded.id) ||
                typeof decoded.createdAt !== "string") return null;
            if (decoded.context !== undefined ? decoded.context !== context : context !== JSON.stringify(["", "newest", "any", "false", "all"])) return null;
            const createdAt = new Date(decoded.createdAt);
            if (!Number.isFinite(createdAt.getTime())) return null;
            cursor = { id: decoded.id, createdAt };
        } catch {
            return null;
        }
    }
    return { limit: cursor ? Math.min(limit, 1) : limit, cursor, sort: sort as "newest" | "oldest", period, q, mine: mine === "true", source, context };
}
