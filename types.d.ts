import { Connection } from "mongoose";

declare global {
    // A var declaration is required to augment globalThis across hot reloads.
    // eslint-disable-next-line no-var
    var mongoose: {
        conn: Connection | null
        //               dataTypes
        promise: Promise<Connection> | null;
    }
}

// Ek obj export kiya ki agar kisi ko use karna hai toh kar ssakta hai....
export {};
