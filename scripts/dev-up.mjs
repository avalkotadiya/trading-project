#!/usr/bin/env node
// Ensures postgres + redis Docker containers are running and healthy
// before the Next.js dev server starts. Safe to run repeatedly:
// docker compose up -d is idempotent and skips already-running services.
//
// Behavior:
//   - If Docker engine is reachable: bring services up, wait for healthy, exit 0.
//   - If Docker engine is NOT reachable: print a clear message and exit 1 by
//     default so the app does not boot into Prisma/Redis connection errors.
//     Set ALLOW_OFFLINE_DEV=1 for UI-only work without local services.
//
// Override with SKIP_DOCKER=1 to bypass entirely (e.g. when running against
// a managed Postgres/Redis).

import { spawnSync } from "node:child_process";

const SERVICES = ["postgres", "redis"];
const HEALTH_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_500;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const log = (msg) => console.log(`${c.dim("[dev-up]")} ${msg}`);
const warn = (msg) => console.warn(`${c.dim("[dev-up]")} ${c.yellow(msg)}`);
const err = (msg) => console.error(`${c.dim("[dev-up]")} ${c.red(msg)}`);

if (process.env.SKIP_DOCKER === "1") {
  log("SKIP_DOCKER=1 set, skipping Docker check.");
  process.exit(0);
}

function run(cmd, args, { capture = false } = {}) {
  const result = spawnSync(cmd, args, {
    stdio: capture ? "pipe" : "inherit",
    shell: false,
    encoding: "utf8",
  });
  return result;
}

function dockerEngineReachable() {
  const r = run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true });
  return r.status === 0 && r.stdout && r.stdout.trim().length > 0;
}

function composeUp() {
  log(`docker compose up -d ${SERVICES.join(" ")}`);
  const r = run("docker", ["compose", "up", "-d", ...SERVICES]);
  return r.status === 0;
}

function getHealth(containerName) {
  const r = run(
    "docker",
    ["inspect", "--format", "{{.State.Health.Status}}", containerName],
    { capture: true }
  );
  if (r.status !== 0) return "missing";
  return (r.stdout || "").trim() || "unknown";
}

function getServiceContainer(service) {
  const r = run("docker", ["compose", "ps", "-q", service], { capture: true });
  if (r.status !== 0) return "";
  return (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(0) ?? "";
}

async function waitHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastReport = "";
  while (Date.now() < deadline) {
    const states = SERVICES.map((service) => {
      const container = getServiceContainer(service);
      return [service, container ? getHealth(container) : "missing"];
    });
    const allHealthy = states.every(([, state]) => state === "healthy");
    const report = states.map(([service, state]) => `${service}=${state}`).join("  ");
    if (report !== lastReport) {
      log(report);
      lastReport = report;
    }
    if (allHealthy) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  if (!dockerEngineReachable()) {
    warn("Docker engine not reachable — is Docker Desktop running?");
    if (process.env.ALLOW_OFFLINE_DEV === "1") {
      warn("ALLOW_OFFLINE_DEV=1 set; continuing without local Postgres/Redis.");
      process.exit(0);
    }

    err("Cannot start safely because .env points to local Docker Postgres/Redis.");
    err("Start Docker Desktop, or set SKIP_DOCKER=1 when using managed services.");
    err("For UI-only work without services, set ALLOW_OFFLINE_DEV=1.");
    process.exit(1);
  }

  if (!composeUp()) {
    err("docker compose up failed. See output above.");
    process.exit(1);
  }

  const ok = await waitHealthy();
  if (!ok) {
    err(`Services did not reach healthy state within ${HEALTH_TIMEOUT_MS / 1000}s.`);
    err(`Try: docker compose logs postgres redis`);
    process.exit(1);
  }

  log(c.green("postgres + redis ready."));
}

main().catch((e) => {
  err(`Unexpected failure: ${e?.message ?? e}`);
  process.exit(1);
});
