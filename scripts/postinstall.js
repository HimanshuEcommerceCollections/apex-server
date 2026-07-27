/* eslint-disable */
// Deploy-host build hook, ported from elevate-server (docs/architecture/01 decision #5).
// Gated on the RENDER env var: it is a no-op on developer machines and runs
// `prisma generate` + `tsc` + best-effort `prisma migrate deploy` on the deploy host.
// If Apex deploys somewhere other than Render, change only the gate variable below.
const { execSync } = require("node:child_process");

if (!process.env.RENDER) {
  process.exit(0);
}

function run(cmd) {
  console.log(`postinstall> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("prisma generate");
  run("tsc");
  try {
    run("prisma migrate deploy");
  } catch (err) {
    // Non-fatal: the DB may not be reachable at build time on some hosts.
    console.warn("postinstall> migrate deploy skipped:", err.message);
  }
} catch (err) {
  console.error("postinstall failed:", err.message);
  process.exit(1);
}
