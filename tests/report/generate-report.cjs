const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const read = (file) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch { return null; } };
const unit = read("test-results/unit.json");
const e2e = read("test-results/e2e.json");
const rows = [];
const walk = (suite, prefix = "") => {
  for (const child of suite?.suites ?? []) walk(child, `${prefix}${child.title} / `);
  for (const spec of suite?.specs ?? []) for (const test of spec.tests ?? []) rows.push({ name: `${prefix}${spec.title}`, status: test.status === "expected" ? "PASS" : test.status === "skipped" ? "SKIP" : "FAIL", errors: (test.results ?? []).flatMap((result) => result.errors ?? []).map((error) => error.message).join(" | ") });
};
if (e2e) walk(e2e);
if (unit?.testResults) for (const file of unit.testResults) for (const result of file.assertionResults ?? []) rows.push({ name: result.fullName, status: result.status === "passed" ? "PASS" : ["pending", "skipped", "todo", "disabled"].includes(result.status) ? "SKIP" : "FAIL", errors: (result.failureMessages ?? []).join(" | ") });
const counts = rows.reduce((value, row) => ({ ...value, [row.status]: (value[row.status] ?? 0) + 1 }), { PASS: 0, FAIL: 0, SKIP: 0 });
const screenshots = fs.existsSync(path.join(root, "test-results/artifacts")) ? fs.readdirSync(path.join(root, "test-results/artifacts"), { recursive: true }).filter((file) => /\.png$/i.test(String(file))).map(String) : [];
const failures = rows.filter((row) => row.status === "FAIL");
const resolved = read("tests/report/resolved-regressions.json") ?? [];
const markdown = [
  "# ServeFlow Production Regression Report", "", `Generated: ${new Date().toISOString()}`, "",
  "## Result", "", "| PASS | FAIL | SKIP |", "| ---: | ---: | ---: |", `| ${counts.PASS} | ${counts.FAIL} | ${counts.SKIP} |`, "",
  "## Regressions", "", ...(failures.length ? failures.map((row) => `- FAIL - ${row.name}: ${row.errors || "No error detail"}`) : ["No failing regressions."]), "",
  "## Resolved regressions", "", ...(resolved.length ? resolved.map((item) => `- ${item.id} - ${item.summary} (${item.fix})`) : ["None recorded."]), "",
  "## Test cases", "", ...rows.map((row) => `- ${row.status} - ${row.name}`), "",
  "## Screenshots", "", ...(screenshots.length ? screenshots.map((file) => `- [${file}](../artifacts/${file.replace(/\\/g, "/")})`) : ["No screenshots were generated."]),
].join("\n");
fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
fs.writeFileSync(path.join(root, "test-results/REGRESSION_REPORT.md"), markdown);
console.log(markdown);
process.exitCode = counts.FAIL ? 1 : 0;
