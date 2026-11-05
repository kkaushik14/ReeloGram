import mongoose from "mongoose";

const cached = global.mongoose ?? (global.mongoose = { conn: null, promise: null });

export async function connectToDatabase() {
    if (cached.conn?.readyState === 1) return cached.conn;
    if (cached.conn) {
        cached.conn = null;
        cached.promise = null;
    }
    if (!cached.promise) {
        const uri = process.env.REELOGRAM_MONGODB_URL;
        if (!uri) throw new Error("REELOGRAM_MONGODB_URL is not configured");
        cached.promise = mongoose.connect(uri, {
            bufferCommands: false,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 10000,
        }).then(() => mongoose.connection);
    }
    try {
        cached.conn = await cached.promise;
        return cached.conn;
    } catch (error) {
        cached.promise = null;
        throw error;
    }
}
