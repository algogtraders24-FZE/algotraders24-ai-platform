import type { User } from "@/types/user";

export interface Session {
  user: User;
  token: string;
  expiresAt: string; // ISO date
}