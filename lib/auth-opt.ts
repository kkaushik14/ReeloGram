import "@/lib/auth/environment";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import User from "@/models/User";
import { publicUploader } from "./public-uploader";
import { connectToDatabase } from "./db";
import bcrypt from "bcryptjs";
import { parseCredentials } from "./credentials";
import { parseEmail, validResetToken } from "./auth/validation";
import { signInGrantDigest } from "./auth/sign-in-grant";
import { limitAuth, RateLimitError } from "./auth/rate-limit";
const dummyHash = bcrypt.hashSync("unavailable-account-verification", 10);

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credential",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        completionToken: { label: "Sign-in handoff", type: "text" },
      },
      async authorize(credentials, request) {
        const parsed = parseCredentials(credentials);
        const completionEmail = parseEmail(credentials?.email);
        const completionToken = credentials?.completionToken;
        if (
          completionToken !== undefined &&
          (!completionEmail || !validResetToken(completionToken))
        )
          return null;
        if (!completionToken && !parsed) return null;
        try {
          await connectToDatabase();
          if (completionToken && completionEmail) {
            const digest = signInGrantDigest(completionToken);
            await limitAuth(
              "complete",
              digest,
              new Headers(
                Object.fromEntries(
                  Object.entries(request.headers ?? {}).map(([key, value]) => [
                    key,
                    String(value),
                  ]),
                ),
              ),
            );
            const user = await User.findOneAndUpdate(
              {
                email: completionEmail,
                "signInGrant.digest": digest,
                "signInGrant.expiresAt": { $gt: new Date() },
              },
              { $unset: { signInGrant: 1 } },
            );
            if (!user) return null;
            const identity = publicUploader(user);
            return {
              id: String(user._id),
              email: user.email,
              name: identity.name,
              image: identity.image,
              sessionVersion: user.sessionVersion ?? 0,
            };
          }
          if (!parsed) return null;
          await limitAuth(
            "login",
            parsed.email,
            new Headers(
              Object.fromEntries(
                Object.entries(request.headers ?? {}).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              ),
            ),
          );
          const user = await User.findOne({ email: parsed.email });

          if (!user) {
            await bcrypt.compare(parsed.password, dummyHash);
            return null;
          }

          const isMatched = await bcrypt.compare(
            parsed.password,
            user.password,
          );

          if (!isMatched) {
            return null;
          }

          return {
            id: user._id.toString(),
            email: user.email,
            name: publicUploader(user).name,
            image: publicUploader(user).image,
            sessionVersion: user.sessionVersion ?? 0,
          };
        } catch (error) {
          if (error instanceof RateLimitError)
            throw new Error(
              "Too many sign-in attempts. Please wait before trying again.",
            );
          // NextAuth serializes authorize errors into its response URL.
          // Keep database hosts and connection details server-side.
          console.error(
            "Sign-in failed",
            error instanceof Error ? error.name : "Unknown error",
          );
          throw new Error(
            "Sign-in is temporarily unavailable. Please try again later.",
          );
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
      } else if (token.id) {
        await connectToDatabase();
        if (typeof token.id !== "string" || !/^[a-f0-9]{24}$/i.test(token.id))
          throw new Error("Invalid session");
        const current = await User.findById(token.id)
          .select("sessionVersion")
          .lean<{ sessionVersion?: number }>();
        if (
          !current ||
          (current.sessionVersion ?? 0) !== (token.sessionVersion ?? 0)
        )
          throw new Error("Session has ended");
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }

      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },

  secret: process.env.REELOGRAM_NEXTAUTH_SECRET,
};
