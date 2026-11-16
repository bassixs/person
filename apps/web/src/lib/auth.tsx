import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post, setCsrfToken } from "../api/client";
import type { Me } from "../api/types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const me = await get<Me>("/auth/me");
        setCsrfToken(me.csrf_token);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const value: AuthState = {
    me: data ?? null,
    loading: isLoading,
    can: (perm) => !!data?.permissions.includes(perm),
    login: async (email, password) => {
      const me = await post<Me>("/auth/login", { email, password });
      setCsrfToken(me.csrf_token);
      qc.setQueryData(["me"], me);
    },
    logout: async () => {
      try {
        await post("/auth/logout");
      } finally {
        setCsrfToken(null);
        qc.clear();
        qc.setQueryData(["me"], null);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth вне AuthProvider");
  return v;
}
