import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/dd-cli.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["commander", "@datadog/datadog-api-client", "open"],
});
