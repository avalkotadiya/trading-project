/**
 * Next.js server-side instrumentation hook.
 *
 * IMPORTANT: this file is compiled for BOTH the Node and Edge runtimes. Any
 * dynamic import here gets traced into both bundles — so a Node-only module
 * (`node:fs`, `node:path`, Prisma, the Dhan services, …) would break the Edge
 * build. We dispatch by `process.env.NEXT_RUNTIME`, which Next statically
 * inlines at build time, so each bundle only sees the import that belongs to it.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
  // Edge runtime currently has no instrumentation — add an
  // ./instrumentation-edge import here if that changes.
}
