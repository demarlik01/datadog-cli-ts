export const DEFAULT_SCOPES: readonly string[] = [
  "logs_read_data",
  "apm_read",
  "events_read",
  "monitors_read",
  "dashboards_read",
  "metrics_read",
  "timeseries_query",
  "hosts_read",
  "incident_read",
  "error_tracking_read",
] as const;

export const READ_ONLY_SCOPES: readonly string[] = DEFAULT_SCOPES;
