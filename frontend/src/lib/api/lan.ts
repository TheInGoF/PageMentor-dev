// API: Zugriff aus dem Heimnetz und Anmeldung von anderen Geräten
import { request } from "./request";

export interface LanInfo {
  enabled: boolean;
  passwordSet: boolean;
  port: number;
  addresses: string[];
  host: string;
  fixedHost: boolean;
  // true/false auf Windows, null anderswo
  firewall: boolean | null;
}

export const lanApi = {
  lan: {
    get: () => request<LanInfo>("/api/auth/lan"),
    put: (body: { enabled?: boolean; password?: string }) => request<LanInfo>("/api/auth/lan", { method: "PUT", body: JSON.stringify(body) }),
    firewall: () => request<{ ok: boolean; error?: string; firewall: boolean | null }>("/api/auth/lan/firewall", { method: "POST" }),
  },
  auth: {
    check: () => request<{ authenticated: boolean; local: boolean; lan: boolean }>("/api/auth/check"),
    login: (password: string) => request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  },
};
