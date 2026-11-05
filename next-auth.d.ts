import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }
  interface Session {
    user: {
      id: string;
      emailVerified: boolean;
      profileComplete: boolean;
      parentRequired: boolean;
      parentConfirmed: boolean;
      canPublish: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
  }
}
