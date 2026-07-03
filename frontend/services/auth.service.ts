import type { User } from "@/types/user";
import type { Session } from "@/types/session";
import type { LoginCredentials, AuthResult } from "@/types/auth";

// Mock user — future me Supabase se aayega
const MOCK_USER: User = {
  id: "u1",
  name: "Demo Customer",
  email: "demo@algotraders24.ai",
  role: "customer",
  createdAt: "2025-06-01",
};

export const authService = {
  getCurrentUser: (): User | null => MOCK_USER,

  isAuthenticated: (): boolean => MOCK_USER !== null,

  login: (credentials: LoginCredentials): AuthResult => {
    // TODO: replace with Supabase auth
    if (!credentials.email) return { success: false, message: "Email required" };
    return { success: true };
  },

  logout: (): void => {
    // TODO: clear Supabase session
  },

  refreshSession: (): Session | null => {
    // TODO: refresh via Supabase
    return null;
  },
};