import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import User from "@/models/User";
import { connectToDatabase } from "./db";
import bcrypt from "bcryptjs"
import { parseCredentials } from "./credentials";

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: "Credential",
            credentials: {
                email: {label: "Email", type: "text"},
                password: {label: "Password", type: "password"}
            },
            async authorize(credentials) {
                const parsed = parseCredentials(credentials);
                if (!parsed) return null;
                await connectToDatabase()
                const user = await User.findOne({email: parsed.email});

                if(!user) {
                    return null;
                }

                const isMatched = await bcrypt.compare(
                    parsed.password,
                    user.password
                )

                if(!isMatched) {
                    return null;
                }

                return {
                    id: user._id.toString(),
                    email: user.email
                }
            }
        })
    ],
    callbacks: {
        async jwt({token, user}) {
            if(user) {
                token.id = user.id;
            }
            return token;
        },

        async session({session, token}) {
            if(session.user) {
                session.user.id = token.id as string;
            }

            return session
        }
    },

    pages: {
        signIn: "/login",
        error: "/login"
    },

    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60
    },

    secret: process.env.NEXTAUTH_SECRET
};
