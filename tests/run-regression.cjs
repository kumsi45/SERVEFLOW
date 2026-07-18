const { spawnSync } = require("node:child_process");
const run = (script) => {
  const result = spawnSync(`npm run ${script}`, { stdio: "inherit", shell: true });
  if (result.error) console.error(result.error);
  return result.status ?? 1;
};
const unit = run("test:unit");
const e2e = run("test:e2e");
const report = run("test:report");
process.exitCode = unit || e2e || report;
