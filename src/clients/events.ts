import { v2 } from "@datadog/datadog-api-client";
import { createConfig } from "./config";
import { resolveTime } from "../utils/time";

export interface ListEventsOptions {
  from: string;
  to?: string;
  query?: string;
  limit?: number;
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return fallback;
  }

  if (limit <= 0) {
    throw new Error("`--limit`은 1 이상의 정수여야 합니다.");
  }

  return Math.floor(limit);
}

export async function listEvents(options: ListEventsOptions) {
  const config = createConfig();
  const api = new v2.EventsApi(config);
  const { from, to } = resolveTime(options.from, options.to ?? "now");
  const limit = normalizeLimit(options.limit, 25);

  const params: v2.EventsApiListEventsRequest = {
    filterFrom: from,
    filterTo: to,
    pageLimit: limit,
  };

  if (options.query) {
    params.filterQuery = options.query;
  }

  return api.listEvents(params);
}
