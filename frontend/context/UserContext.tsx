// context/UserContext.tsx
// Sprint 14C - Client-side user context. Holds the authenticated app user
// (Prisma profile shape) resolved on the server and passed down at mount.
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export interface CurrentUser {
  id: string;
  authId: string | null;
  email: string;
  name: string;
  role: "user" | "admin";
  planId: string;
  status: "active" | "suspended";
  emailVerified: boolean;
}

interface UserContextValue {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  setUser: (user: CurrentUser | null) => void;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({
  initialUser,
  children,
}: {
  initialUser: CurrentUser | null;
  children: ReactNode;
}) {
  const [user, setUser] = useState<CurrentUser | null>(initialUser);

  return (
    <UserContext.Provider
      value={{ user, isAuthenticated: user != null, setUser }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUserContext(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUserContext must be used within a UserProvider");
  }
  return ctx;
}
