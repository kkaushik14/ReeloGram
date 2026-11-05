"use client"

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import React from "react";


function Header() {

    const { data: session } = useSession();

    const handleSignout = async () => {
        try {
            await signOut({ callbackUrl: "/" })
        } catch (error) {
            console.error("Sign out failed", error);
        }
    }
    return (
        <div>
            {session ? (
                <div>Welcome <button onClick={handleSignout}>Sign out</button></div>
            ) : (
                <div>
                    <Link href="/login">Login</Link>
                    <Link href="/register">register</Link>
                </div>
            )}
        </div>
    )
}

export default Header
