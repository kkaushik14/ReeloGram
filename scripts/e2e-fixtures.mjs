// Synthetic fixtures only: a 1px PNG, a tiny PDF, and one uncompressed AVI frame.
function chunk(name, bytes) {
    const header = Buffer.alloc(8);
    header.write(name);
    header.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([header, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]);
}

function list(name, children) {
    return chunk("LIST", Buffer.concat([Buffer.from(name), ...children]));
}

function video() {
    const frame = Buffer.alloc(32 * 32 * 3, 128);
    const header = Buffer.alloc(56);
    [1000000, frame.length, 0, 16, 1, 0, 1, frame.length, 32, 32, 0, 0, 0, 0]
        .forEach((value, i) => header.writeUInt32LE(value, i * 4));
    const stream = Buffer.alloc(56);
    stream.write("vidsDIB ");
    stream.writeUInt32LE(1, 20); // scale
    stream.writeUInt32LE(1, 24); // rate
    stream.writeUInt32LE(1, 32); // frame count
    stream.writeUInt32LE(frame.length, 36);
    stream.writeUInt32LE(0xffffffff, 40); // default quality
    stream.writeInt16LE(32, 52);
    stream.writeInt16LE(32, 54);
    const bitmap = Buffer.alloc(40);
    bitmap.writeUInt32LE(40);
    bitmap.writeInt32LE(32, 4);
    bitmap.writeInt32LE(32, 8);
    bitmap.writeUInt16LE(1, 12);
    bitmap.writeUInt16LE(24, 14);
    bitmap.writeUInt32LE(frame.length, 20);
    const index = Buffer.alloc(16);
    index.write("00db");
    index.writeUInt32LE(16, 4);
    index.writeUInt32LE(4, 8);
    index.writeUInt32LE(frame.length, 12);
    return chunk("RIFF", Buffer.concat([Buffer.from("AVI "),
        list("hdrl", [chunk("avih", header), list("strl", [chunk("strh", stream), chunk("strf", bitmap)])]),
        list("movi", [chunk("00db", frame)]), chunk("idx1", index)]));
}

export const fixtures = [
    { name: "pixel.png", type: "image/png", folder: "/images", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64") },
    { name: "frame.avi", type: "video/x-msvideo", folder: "/videos", bytes: video() },
    { name: "document.pdf", type: "application/pdf", folder: "/documents", bytes: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n") },
];
