const fileIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

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
    const rawLimit = params.get("limit") ?? "20";
    if (!/^\d{1,3}$/.test(rawLimit)) return null;
    const limit = Number(rawLimit);
    if (limit < 1 || limit > 100) return null;
    const rawCursor = params.get("cursor");
    let cursor: { id: string; createdAt: Date } | undefined;
    if (rawCursor !== null) {
        if (rawCursor.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(rawCursor)) return null;
        try {
            const decoded = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"));
            if (typeof decoded.id !== "string" || !/^[a-f0-9]{24}$/i.test(decoded.id) ||
                typeof decoded.createdAt !== "string") return null;
            const createdAt = new Date(decoded.createdAt);
            if (!Number.isFinite(createdAt.getTime())) return null;
            cursor = { id: decoded.id, createdAt };
        } catch {
            return null;
        }
    }
    return { limit, cursor };
}
