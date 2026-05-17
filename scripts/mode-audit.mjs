import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "artifacts", "mode-audit");
const viewport = { width: 1366, height: 900 };
const scenes = ["Cal", "Blocks", "Text", "Scope", "Stress", "Storage", "Asteroids"];
const presets = ["asteroids-bw", "arcade-rgb", "p31-green", "amber-terminal", "blue-scope", "storage-green"];
const expectedPresetFields = {
  "asteroids-bw": { refreshHz: 61.5234375, beamIntensity: 0.036, persistence: 0.32, focus: 0.6, beamWidth: 4.25, temporalSweep: true, antiAlias: true },
  "arcade-rgb": { refreshHz: 38, beamIntensity: 0.68, persistence: 0.22, focus: 0.6, beamWidth: 4.25, temporalSweep: true, antiAlias: true },
  "p31-green": { refreshHz: 38, beamIntensity: 0.88, persistence: 0.34, focus: 0.6, beamWidth: 4.25, temporalSweep: true, antiAlias: true },
  "amber-terminal": { refreshHz: 38, beamIntensity: 0.78, persistence: 0.6, focus: 0.6, beamWidth: 4.25, temporalSweep: true, antiAlias: true },
  "blue-scope": { refreshHz: 38, beamIntensity: 0.82, persistence: 0.2, focus: 0.6, beamWidth: 4.25, temporalSweep: true, antiAlias: true },
  "storage-green": { refreshHz: 3, beamIntensity: 0.65, persistence: 0.99, focus: 0.6, beamWidth: 4.25, temporalSweep: true, antiAlias: true },
};

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

async function collectReadouts(page) {
  return Object.fromEntries(
    await page.locator(".readout").evaluateAll((nodes) =>
      nodes.map((node) => [
        node.querySelector("span")?.textContent?.trim() ?? "",
        node.querySelector("strong")?.textContent?.trim() ?? "",
      ]),
    ),
  );
}

async function canvasStats(page) {
  const box = await page.locator("canvas").boundingBox();
  return {
    visible: Boolean(box && box.width > 100 && box.height > 75),
    width: Number((box?.width ?? 0).toFixed(2)),
    height: Number((box?.height ?? 0).toFixed(2)),
    aspect: box && box.height > 0 ? Number((box.width / box.height).toFixed(4)) : 0,
  };
}

async function setToggle(page, label, enabled) {
  const row = page.locator(".toggle-row", { hasText: label });
  await row.scrollIntoViewIfNeeded();
  const checkbox = row.locator("input[type='checkbox']");
  const checked = await checkbox.isChecked();
  if (checked !== enabled) {
    await row.click();
  }
  await page.waitForTimeout(350);
}

async function selectScene(page, scene) {
  await page.getByRole("button", { name: scene }).click();
  await page.waitForTimeout(450);
  if (scene === "Asteroids") {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
}

async function selectPreset(page, preset) {
  await page.locator(".select-row select").selectOption(preset);
  await page.waitForTimeout(450);
}

function passCanvas(stats) {
  return stats.visible && Math.abs(stats.aspect - 4 / 3) < 0.01;
}

function matchesExpectedPreset(params, preset) {
  const expected = expectedPresetFields[preset];
  if (!params || !expected || params.preset !== preset) {
    return false;
  }
  return (
    Math.abs(params.refreshHz - expected.refreshHz) < 0.001 &&
    Math.abs(params.beamIntensity - expected.beamIntensity) < 0.001 &&
    Math.abs(params.persistence - expected.persistence) < 0.001 &&
    Math.abs(params.focus - expected.focus) < 0.001 &&
    Math.abs(params.beamWidth - expected.beamWidth) < 0.001 &&
    params.temporalSweep === expected.temporalSweep &&
    params.antiAlias === expected.antiAlias
  );
}

async function audit(url, serverLogs) {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage({ viewport });
  const consoleMessages = [];
  page.on("console", (message) => {
    const text = message.text();
    const knownReadbackWarning = text.includes("GPU stall due to ReadPixels");
    if (["error", "warning"].includes(message.type()) && !knownReadbackWarning) {
      consoleMessages.push({ type: message.type(), text });
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({ type: "pageerror", text: error.message });
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Hardware Parameters" }).waitFor();
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(700);

  const sceneReports = [];
  for (const scene of scenes) {
    await selectScene(page, scene);
    const readouts = await collectReadouts(page);
    const stats = await canvasStats(page);
    const active = await page.locator(".scene-tabs button.active").textContent();
    const screenshot = resolve(outDir, `scene-${scene.toLowerCase()}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    sceneReports.push({
      scene,
      active: active?.trim() ?? "",
      readouts,
      canvas: stats,
      screenshot,
      pass: active?.trim() === scene && Number(readouts.Vectors) > 0 && Number(readouts["VG Hz"]) > 0 && passCanvas(stats),
    });
  }

  await selectScene(page, "Blocks");
  const presetReports = [];
  for (const preset of presets) {
    await selectPreset(page, preset);
    const params = await page.evaluate(() => window.__vectorMonitorAudit?.getParams?.());
    const stats = await canvasStats(page);
    presetReports.push({
      preset,
      rendererPreset: params?.preset,
      temporalSweep: params?.temporalSweep,
      antiAlias: params?.antiAlias,
      refreshHz: params?.refreshHz,
      beamIntensity: params?.beamIntensity,
      persistence: params?.persistence,
      canvas: stats,
      pass: matchesExpectedPreset(params, preset) && passCanvas(stats),
    });
  }

  await selectPreset(page, "arcade-rgb");
  const overdriveReports = [];
  for (const enabled of [false, true]) {
    await setToggle(page, "120 Hz+ overdrive", enabled);
    const params = await page.evaluate(() => window.__vectorMonitorAudit?.getParams?.());
    overdriveReports.push({
      enabled,
      rendererTemporalSweep: params?.temporalSweep,
      pass: params?.temporalSweep === enabled,
    });
  }

  const overdrivePersistenceReports = [];
  await setToggle(page, "120 Hz+ overdrive", false);
  for (const preset of ["storage-green", "asteroids-bw", "p31-green"]) {
    await selectPreset(page, preset);
    const params = await page.evaluate(() => window.__vectorMonitorAudit?.getParams?.());
    overdrivePersistenceReports.push({
      action: `preset:${preset}`,
      expected: false,
      rendererTemporalSweep: params?.temporalSweep,
      pass: params?.temporalSweep === false,
    });
  }
  for (const scene of ["Storage", "Asteroids", "Blocks"]) {
    await selectScene(page, scene);
    const params = await page.evaluate(() => window.__vectorMonitorAudit?.getParams?.());
    overdrivePersistenceReports.push({
      action: `scene:${scene}`,
      expected: false,
      rendererTemporalSweep: params?.temporalSweep,
      pass: params?.temporalSweep === false,
    });
  }
  await setToggle(page, "120 Hz+ overdrive", true);
  for (const preset of ["storage-green", "blue-scope", "arcade-rgb"]) {
    await selectPreset(page, preset);
    const params = await page.evaluate(() => window.__vectorMonitorAudit?.getParams?.());
    overdrivePersistenceReports.push({
      action: `preset:${preset}`,
      expected: true,
      rendererTemporalSweep: params?.temporalSweep,
      pass: params?.temporalSweep === true,
    });
  }

  const aaReports = [];
  for (const enabled of [false, true]) {
    await setToggle(page, "Vector AA", enabled);
    const params = await page.evaluate(() => window.__vectorMonitorAudit?.getParams?.());
    const screenshot = resolve(outDir, `vector-aa-${enabled ? "on" : "off"}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    const stats = await canvasStats(page);
    aaReports.push({
      enabled,
      rendererAntiAlias: params?.antiAlias,
      canvas: stats,
      screenshot,
      pass: params?.antiAlias === enabled && passCanvas(stats),
    });
  }

  await browser.close();

  const report = {
    url,
    title: "Vector Monitor Lab",
    viewport,
    passed:
      consoleMessages.length === 0 &&
      sceneReports.every((result) => result.pass) &&
      presetReports.every((result) => result.pass) &&
      overdriveReports.every((result) => result.pass) &&
      overdrivePersistenceReports.every((result) => result.pass) &&
      aaReports.every((result) => result.pass),
    consoleMessages,
    scenes: sceneReports,
    presets: presetReports,
    overdrive: overdriveReports,
    overdrivePersistence: overdrivePersistenceReports,
    antiAlias: aaReports,
    serverLogs: serverLogs.join("").split(/\r?\n/).filter(Boolean).slice(-20),
    generatedAt: new Date().toISOString(),
  };

  const reportPath = resolve(outDir, "mode-audit.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!report.passed) {
    throw new Error(`Mode audit failed. Report: ${reportPath}`);
  }
  return { report, reportPath };
}

await withDevServer(async (url, logs) => {
  const { report, reportPath } = await audit(url, logs);
  console.log(`Mode audit passed: ${report.scenes.length} scenes, ${report.presets.length} presets, ${report.overdrive.length} overdrive states, ${report.antiAlias.length} AA states.`);
  console.log(`Report: ${reportPath}`);
  console.log(`AA off screenshot: ${resolve(outDir, "vector-aa-off.png")}`);
  console.log(`AA on screenshot: ${resolve(outDir, "vector-aa-on.png")}`);
});
