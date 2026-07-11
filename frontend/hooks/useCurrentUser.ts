// hooks/useCurrentUser.ts
// Sprint 14C - Convenience hook to read the current authenticated user.
"use client";

import { useUserContext, type CurrentUser } from "@/context/UserContext";

export interface UseCurrentUser {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

export function useCurrentUser(): UseCurrentUser {
  const { user, isAuthenticated } = useUserContext();
  return {
    user,
    isAuthenticated,
    isAdmin: user?.role === "admin",
  };
}
