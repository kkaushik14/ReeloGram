export type UploadFileType = "image" | "video" | "pdf";

export const UPLOAD_OPTIONS = {
    image: { accept: "image/jpeg,image/png,image/webp", folder: "/images", maxSize: 5 * 1024 * 1024 },
    video: { accept: "video/*", folder: "/videos", maxSize: 100 * 1024 * 1024 },
    pdf: { accept: "application/pdf", folder: "/documents", maxSize: 5 * 1024 * 1024 },
} as const;

export function validateUpload(file: Pick<File, "type" | "size">, fileType: UploadFileType): string | null {
    const options = UPLOAD_OPTIONS[fileType];
    const validType = fileType === "video" ? file.type.startsWith("video/") :
        options.accept.split(",").includes(file.type);
    if (!validType) return `Please select a valid ${fileType} file (${options.accept}).`;
    if (file.size <= 0) return "The selected file is empty.";
    if (file.size > options.maxSize) return `File must be at most ${options.maxSize / 1024 / 1024} MB.`;
    return null;
}
