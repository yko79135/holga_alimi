export type AppRole = "admin" | "teacher" | "parent";
export type DashboardView = "staff" | "parent";

export const APP_ROLES: AppRole[] = ["admin", "teacher", "parent"];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as string[]).includes(value);
}

export function normalizeRoles(values: unknown): AppRole[] {
  const input = Array.isArray(values) ? values : [values];
  return APP_ROLES.filter((role) => input.includes(role));
}

export function hasRole(roles: AppRole[], role: AppRole): boolean { return roles.includes(role); }
export function canUseStaffView(roles: AppRole[]): boolean { return hasRole(roles, "admin") || hasRole(roles, "teacher"); }
export function canUseParentView(roles: AppRole[]): boolean { return hasRole(roles, "parent"); }
export function effectiveStaffRole(roles: AppRole[]): "admin" | "teacher" | null { return hasRole(roles, "admin") ? "admin" : hasRole(roles, "teacher") ? "teacher" : null; }
export function roleLabel(role: AppRole): string { return role === "admin" ? "관리자" : role === "teacher" ? "교사" : "학부모"; }
export function resolveDashboardView(roles: AppRole[], requested?: string | null, legacyRole?: string | null): DashboardView {
  if (requested === "parent" && canUseParentView(roles)) return "parent";
  if (requested === "staff" && canUseStaffView(roles)) return "staff";
  if (legacyRole === "parent" && canUseParentView(roles)) return "parent";
  if ((legacyRole === "admin" || legacyRole === "teacher") && canUseStaffView(roles)) return "staff";
  return canUseStaffView(roles) ? "staff" : "parent";
}
