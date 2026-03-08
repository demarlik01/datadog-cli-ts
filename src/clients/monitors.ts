import { v1 } from "@datadog/datadog-api-client";
import { createConfig } from "./config";

export interface ListMonitorsOptions {
  state?: string;
  tags?: string;
}

export async function listMonitors(options: ListMonitorsOptions) {
  const config = await createConfig();
  const api = new v1.MonitorsApi(config);

  const params: v1.MonitorsApiListMonitorsRequest = {};

  if (options.state) {
    params.groupStates = options.state;
  }

  if (options.tags) {
    params.monitorTags = options.tags;
  }

  return api.listMonitors(params);
}
