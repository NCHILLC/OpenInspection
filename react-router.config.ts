import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // The five v8_* future flags this file used to carry are the default in v8 and
  // no longer valid keys. splitRouteModules is the one that survives as real
  // configuration: "enforce" fails the build on a route module that cannot be
  // split rather than falling back silently, so the cost stays visible.
  splitRouteModules: "enforce",
  // Ship the whole route manifest with the first document. The default ("lazy")
  // asks the server GET /__manifest before any navigation or fetcher call to a
  // path it has not seen, so a phone with no signal could not open an editor
  // section it had not visited yet (QA sweep NET-01).
  routeDiscovery: { mode: "initial" },
} satisfies Config;
