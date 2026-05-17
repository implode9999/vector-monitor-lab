import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "artifacts", "performance-audit");
const viewport = { width: 1366, height: 900 };
const warmupMs = 1200;
const sampleMs = 3500;

const scenarios = [
  { scene: "Asteroids", carrierSweep: true },
  { scene: "Asteroids", carrierSweep: false },
  { scene: "Stress", carrierSweep: true },
  { scene: "Stress", carrierSweep: false },
];

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
    server.on("error", reject);
  });
}

async function waitForUrl(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function withDevServer(callback) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `npm run dev -- --port ${port} --strictPort`]
      : ["run", "dev", "--", "--port", String(port), "--strictPort"];
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (data) => logs.push(data.toString()));
  child.stderr.on("data", (data) => logs.push(data.toString()));
  try {
    await waitForUrl(url);
    return await callback(url, logs);
  } finally {
    await stopProcessTree(child);
  }
}

function stopProcessTree(child) {
  return new Promise((resolveStop) => {
    if (!child.pid || child.killed) {
      resolveStop();
      return;
    }

    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => resolveStop());
      return;
    }

    child.once("exit", () => resolveStop());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolveStop();
    }, 3000).unref();
  });
}

function percentile(values, percent) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function summarizeFrames(deltas) {
  const totalMs = deltas.reduce((sum, delta) => sum + delta, 0);
  return {
    frames: deltas.length,
    durationMs: round(totalMs, 1),
    measuredFps: totalMs > 0 ? round((deltas.length * 1000) / totalMs, 1) : 0,
    frameMs: {
      average: deltas.length > 0 ? round(totalMs / deltas.length, 2) : 0,
      p50: round(percentile(deltas, 50), 2),
      p95: round(percentile(deltas, 95), 2),
      p99: round(percentile(deltas, 99), 2),
      max: deltas.length > 0 ? round(Math.max(...deltas), 2) : 0,
    },
    longFrames: deltas.filter((delta) => delta > 24).length,
    veryLongFrames: deltas.filter((delta) => delta > 50).length,
  };
}

async function collectReadouts(page) {
  return page.locator(".readout").evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((node) => {
        const label = node.querySelector("span")?.textContent?.trim() ?? "";
        const value = node.querySelector("strong")?.textContent?.trim() ?? "";
        return [label, value];
      }),
    ),
  );
}

async function collectFrameDeltas(page, durationMs) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const deltas = [];
        let started = 0;
        let last = 0;

        const step = (now) => {
          if (started === 0) {
            started = now;
            last = now;
          } else {
            deltas.push(now - last);
            last = now;
          }

          if (now - started >= duration) {
            resolve(deltas);
            return;
          }

          requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
      }),
    durationMs,
  );
}

async function setCarrierSweep(page, enabled) {
  const checkbox = page.locator(".toggle-row", { hasText: "120 Hz+ overdrive" }).locator("input[type='checkbox']");
  const checked = await checkbox.isChecked();
  if (checked !== enabled) {
    await checkbox.evaluate((input, nextEnabled) => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
      valueSetter?.call(input, nextEnabled);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, enabled);
  }
  await page.waitForTimeout(250);
}

async function selectScene(page, scene) {
  await page.getByRole("button", { name: scene }).click();
  await page.waitForTimeout(350);
  if (scene === "Asteroids") {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }
}

async function measureScenario(page, scenario) {
  await selectScene(page, scenario.scene);
  await setCarrierSweep(page, scenario.carrierSweep);
  await page.waitForTimeout(warmupMs);

  const startReadouts = await collectReadouts(page);
  const deltas = await collectFrameDeltas(page, sampleMs);
  const endReadouts = await collectReadouts(page);

  return {
    ...scenario,
    sampleMs,
    warmupMs,
    readouts: endReadouts,
    startReadouts,
    browserRaf: summarizeFrames(deltas),
  };
}

async function audit(url, serverLogs) {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage({ viewport });
  const consoleMessages = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({ type: "pageerror", text: error.message });
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Hardware Parameters" }).waitFor();
  await page.locator("canvas").waitFor();
  await page.bringToFront();

  const title = await page.title();
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const results = [];
  for (const scenario of scenarios) {
    results.push(await measureScenario(page, scenario));
  }

  await browser.close();

  const report = {
    url,
    title,
    viewport,
    userAgent,
    scenarios: results,
    consoleMessages,
    serverLogs: serverLogs.join("").split(/\r?\n/).filter(Boolean).slice(-30),
    generatedAt: new Date().toISOString(),
  };

  const reportPath = resolve(outDir, "performance-audit.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath };
}

await withDevServer(async (url, logs) => {
  const { report, reportPath } = await audit(url, logs);
  console.log(`Performance audit completed: ${report.scenarios.length} scenarios.`);
  for (const scenario of report.scenarios) {
    const carrier = scenario.carrierSweep ? "on" : "off";
    const readouts = scenario.readouts;
    console.log(
      `${scenario.scene} carrier ${carrier}: ${scenario.browserRaf.measuredFps} FPS browser RAF, Carrier readout ${readouts.Carrier}, VG Hz ${readouts["VG Hz"]}, vectors ${readouts.Vectors}, samples ${readouts.Samples}, load ${readouts.Load}`,
    );
  }
  console.log(`Report: ${reportPath}`);
});
