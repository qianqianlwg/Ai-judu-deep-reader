import type { ExternalPermissions } from "./external-permissions";
export function externalAvailability(env: Record<string, string | undefined> = process.env): ExternalPermissions {
  return { openalex: true, crossref: true, web: Boolean(env.TAVILY_API_KEY?.trim()) };
}
