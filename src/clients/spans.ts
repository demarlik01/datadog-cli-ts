import { v2 } from "@datadog/datadog-api-client";
import { createConfig } from "./config";
import { resolveTime } from "../utils/time";

export interface SearchSpansOptions {
  query: string;
  from: string;
  to?: string;
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

export async function searchSpans(options: SearchSpansOptions) {
  const config = createConfig();
  const api = new v2.SpansApi(config);
  const { from, to } = resolveTime(options.from, options.to ?? "now");
  const limit = normalizeLimit(options.limit, 25);

  return api.listSpans({
    body: {
      data: {
        type: "search_request" as v2.SpansListRequestType,
        attributes: {
          filter: {
            query: options.query,
            from,
            to,
          },
          sort: "timestamp" as v2.SpansSort,
          page: {
            limit,
          },
        },
      },
    },
  });
}
