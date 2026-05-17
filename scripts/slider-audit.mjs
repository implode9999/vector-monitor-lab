import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "artifacts", "slider-audit");
const viewport = { width: 1366, height: 900 };
const scenarios = ["Asteroids", "Stress"];

const formatOutput = (value) => {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) {
    return value.toFixed(0);
  }
  return value.toFixed(Math.min(4, Math.max(0, decimalPlaces(currentStep))));
};

let currentStep = 0.01;

function decimalPlaces(value) {
  if (!Number.isFinite(value)) {
    return 2;
  }
  const text = value.toString();
  if (text.includes("e-")) {
    return Number(text.split("e-")[1]);
  }
  return text.includes(".") ? text.split(".")[1].length : 0;
}

const controlTolerance = (step) => {
  if (!Number.isFinite(step) || step <= 0) {
    return 1e-9;
  }
  return Math.max(1e-9, step * 0.51);
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

async function installDeterministicRaf(page) {
  await page.addInitScript(() => {
    window.__vectorMonitorAuditFreeze = true;
    let now = 1000;
    let frameId = 1;
    let queue = [];
    const originalPerformanceNow = performance.now.bind(performance);

    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => now,
    });

    window.requestAnimationFrame = (callback) => {
      const id = frameId;
      frameId += 1;
      queue.push({ id, callback });
      return id;
    };

    window.cancelAnimationFrame = (id) => {
      queue = queue.filter((entry) => entry.id !== id);
    };

    window.__sliderAuditAdvance = async (frames = 1, stepMs = 16.667) => {
      for (let i = 0; i < frames; i += 1) {
        now += stepMs;
        const callbacks = queue;
        queue = [];
        for (const entry of callbacks) {
          entry.callback(now);
        }
        await Promise.resolve();
      }
      return originalPerformanceNow();
    };
  });
}

async function advance(page, frames = 8) {
  await page.evaluate(async (count) => {
    await window.__sliderAuditAdvance(count);
  }, frames);
}

async function setSliderValue(row, value) {
  await row.locator("input[type='range']").evaluate((input, nextValue) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, String(nextValue));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function readSlider(page, row) {
  const input = row.locator("input[type='range']");
  const output = row.locator("output");
  const key = await input.evaluate((node) => node.id.replace(/^control-/, ""));
  return {
    key,
    value: Number(await input.inputValue()),
    output: ((await output.textContent()) ?? "").trim(),
    rendererValue: await page.evaluate((paramKey) => window.__vectorMonitorAudit?.getParams?.()[paramKey], key),
    canvasSample: await canvasSample(page),
  };
}

async function clearPhosphor(page) {
  await page.evaluate(() => {
    window.__vectorMonitorAudit?.clear();
  });
}

async function canvasSample(page) {
  return page.locator("canvas").evaluate((canvas) => {
    const width = 64;
    const height = 48;
    const probe = document.createElement("canvas");
    probe.width = width;
    probe.height = height;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return [];
    }
    context.drawImage(canvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const luma = new Array(width * height);
    for (let i = 0; i < luma.length; i += 1) {
      const offset = i * 4;
      luma[i] = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
    }
    return luma;
  });
}

function meanAbsDiff(a, b) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}

async function selectScene(page, scene) {
  await page.getByRole("button", { name: scene }).click();
  await advance(page, 24);
  if (scene === "Asteroids") {
    await page.keyboard.press("Enter");
    await advance(page, 12);
  }
}

async function audit(url, serverLogs) {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
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

  await installDeterministicRaf(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Hardware Parameters" }).waitFor();
  await advance(page, 24);

  const title = await page.title();
  const scenarioReports = [];

  for (const scene of scenarios) {
    await selectScene(page, scene);
    const sliderCount = await page.locator(".control-row input[type='range']").count();
    const results = [];

    for (let index = 0; index < sliderCount; index += 1) {
      const row = page.locator(".control-row").nth(index);
      await row.scrollIntoViewIfNeeded();

      const label = (await row.locator("span").first().textContent())?.trim() ?? `Slider ${index + 1}`;
      const input = row.locator("input[type='range']");
      const output = row.locator("output");
      const min = Number(await input.getAttribute("min"));
      const max = Number(await input.getAttribute("max"));
      const step = Number(await input.getAttribute("step"));
      currentStep = step;

      await setSliderValue(row, min);
      await clearPhosphor(page);
      await advance(page, 12);
      const minState = await readSlider(page, row);
      await setSliderValue(row, min);
      await clearPhosphor(page);
      await advance(page, 12);
      const minDriftState = await readSlider(page, row);

      await setSliderValue(row, max);
      await clearPhosphor(page);
      await advance(page, 12);
      const maxState = await readSlider(page, row);
      await setSliderValue(row, max);
      await clearPhosphor(page);
      await advance(page, 12);
      const maxDriftState = await readSlider(page, row);

      const expectedMinOutput = formatOutput(min);
      const expectedMaxOutput = formatOutput(max);
      const stateChanged =
        minState.value === min &&
        maxState.value === max &&
        minState.output === expectedMinOutput &&
        maxState.output === expectedMaxOutput &&
        minState.output !== maxState.output;
      const tolerance = controlTolerance(step);
      const rendererParamChanged = Math.abs(minState.rendererValue - min) <= tolerance && Math.abs(maxState.rendererValue - max) <= tolerance;
      const effectDiff = meanAbsDiff(minState.canvasSample, maxState.canvasSample);
      const minDriftDiff = meanAbsDiff(minState.canvasSample, minDriftState.canvasSample);
      const maxDriftDiff = meanAbsDiff(maxState.canvasSample, maxDriftState.canvasSample);
      const driftDiff = Math.max(minDriftDiff, maxDriftDiff);
      const rendererResponded = effectDiff > Math.max(0.0005, driftDiff * 1.08);

      results.push({
        index,
        label,
        min,
        max,
        step,
        minValue: minState.value,
        maxValue: maxState.value,
        minOutput: minState.output,
        maxOutput: maxState.output,
        expectedMinOutput,
        expectedMaxOutput,
        stateChanged,
        minRendererValue: minState.rendererValue,
        maxRendererValue: maxState.rendererValue,
        rendererParamChanged,
        canvasChanged: effectDiff > 0,
        effectDiff: Number(effectDiff.toFixed(6)),
        minDriftDiff: Number(minDriftDiff.toFixed(6)),
        maxDriftDiff: Number(maxDriftDiff.toFixed(6)),
        rendererResponded,
        pass: stateChanged && rendererParamChanged,
      });
    }

    await page.locator(".control-panel").screenshot({ path: resolve(outDir, `hardware-panel-${scene.toLowerCase()}.png`) });
    scenarioReports.push({ scene, sliderCount, results });
  }
  await browser.close();

  const failed = scenarioReports.flatMap((scenario) => scenario.results.filter((result) => !result.pass).map((result) => ({ ...result, scene: scenario.scene })));
  const report = {
    url,
    title,
    viewport,
    sliderCount: scenarioReports.reduce((sum, scenario) => sum + scenario.sliderCount, 0),
    passed: failed.length === 0,
    failedCount: failed.length,
    consoleMessages,
    scenarios: scenarioReports,
    serverLogs: serverLogs.join("").split(/\r?\n/).filter(Boolean).slice(-20),
    generatedAt: new Date().toISOString(),
  };

  await writeFile(resolve(outDir, "slider-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failed.length > 0) {
    throw new Error(`Slider audit failed for: ${failed.map((result) => `${result.scene}/${result.label}`).join(", ")}`);
  }

  return report;
}

await withDevServer(async (url, logs) => {
  const report = await audit(url, logs);
  console.log(`Slider audit passed: ${report.sliderCount}/${report.sliderCount} slider checks responded.`);
  console.log(`Report: ${resolve(outDir, "slider-audit.json")}`);
  for (const scene of scenarios) {
    console.log(`Screenshot: ${resolve(outDir, `hardware-panel-${scene.toLowerCase()}.png`)}`);
  }
});
