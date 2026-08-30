import "server-only";

/** The file an operator has to run in the Supabase SQL Editor to get `request_type`. */
export const REQUEST_TYPE_MIGRATION = "supabase/20260831_early_dismissal_absence_request_type.sql";

/** True when a query failed only because this database has not been given `request_type` yet.
 * PostgREST reports it two ways -- PGRST204 from its own schema cache on a write, 42703 from
 * Postgres on a read -- and both mean the same thing: the migration above has not been run.
 *
 * 조퇴 신청 predates that column, so the code falls back to the shape the database actually has
 * instead of failing. A migration that is one deploy behind must not take the parents' form down. */
export function isMissingRequestTypeError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  const code = error.code || "";
  if (code !== "PGRST204" && code !== "42703") return false;
  return (error.message || "").includes("request_type");
}

/** The same select list, minus request_type, for a database that has not been migrated yet.
 * serializeRequestRow already reads a row without the column as 조퇴, which is what it would be. */
export function withoutRequestType(select: string) {
  return select
    .split(",")
    .filter((column) => column.trim() !== "request_type")
    .join(",");
}

export function warnRequestTypeMissing(where: string) {
  console.error("early-dismissal-request-type-column-missing", { where, migration: REQUEST_TYPE_MIGRATION });
}
