// Captures the README images from the real app fed with the test fixtures:
//   docs/images/inbox.png   the Inbox with keywords of the Filter highlighted (1280×800)
//   docs/images/triage.gif  keyboard triage: j/k, e/s, the Undo toast, a search
//
// Rerun with:  node scripts/screenshots.ts
// Needs the Playwright Chromium (`npx playwright install chromium`) and `ffmpeg` on PATH.
//
// Like the e2e tests, the server runs with an in-memory database and answers every Source
// read from tests/fixtures/sources/, so nothing is fetched from the network and only
// fixture data (fictional Companies and Jobs) appears in the images.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const fixtures = join(root, "tests/fixtures/sources");
const outDir = join(root, "docs/images");
const port = Number(process.env.SCREENSHOTS_PORT ?? 8797);
const base = `http://127.0.0.1:${port}`;

/** Source URL → fixture file. */
const recorded: Record<string, { file?: string; contentType: string; status?: number; body?: string }> = {
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs": { file: "greenhouse/acme.json", contentType: "application/json" },
  "https://api.lever.co/v0/postings/northwind?mode=json": { file: "lever/northwind.json", contentType: "application/json" },
  "https://api.ashbyhq.com/posting-api/job-board/lumen": { file: "ashby/lumen.json", contentType: "application/json" },
  "https://api.smartrecruiters.com/v1/companies/helveticafoods/postings?limit=100&offset=0": {
    file: "smartrecruiters/helvetica-foods.json",
    contentType: "application/json",
  },
  "https://initech.jobs.personio.de/xml": { file: "personio/acme.xml", contentType: "text/xml" },
  "https://globex.example/jobs.atom": { file: "feed/globex-atom.xml", contentType: "application/atom+xml" },
  // Past the feed's last page.
  "https://globex.example/jobs.atom?paged=2": { status: 404, body: "", contentType: "text/plain" },
};

const companies = [
  { source: { type: "greenhouse", key: "acme" }, name: "Acme" },
  { source: { type: "lever", key: "northwind" }, name: "Northwind" },
  { source: { type: "ashby", key: "lumen" }, name: "Lumen" },
  { source: { type: "smartrecruiters", key: "helveticafoods" }, name: "Helvetica Foods" },
  { source: { type: "personio", key: "initech" }, name: "Initech" },
  { source: { type: "feed", key: "https://globex.example/jobs.atom" }, name: "Globex" },
];

const filter = {
  cities: [],
  required: ["engineer", "designer", "manager", "lead", "scientist", "planner"],
  boosted: ["senior", "data"],
  excluded: ["intern", "student"],
  includeRemote: true,
};

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
}

async function api(method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/jobs`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the server did not start");
}

/** Records the GIF as still frames, each shown for its own duration, then encodes them with ffmpeg. */
class Gif {
  private frames: { file: string; ms: number }[] = [];
  private page: Page;
  private dir: string;
  constructor(page: Page, dir: string) {
    this.page = page;
    this.dir = dir;
  }

  async frame(ms: number): Promise<void> {
    const file = join(this.dir, `frame-${String(this.frames.length).padStart(3, "0")}.png`);
    await this.page.screenshot({ path: file });
    this.frames.push({ file, ms });
  }

  encode(out: string): void {
    const list = join(this.dir, "frames.txt");
    const lines = this.frames.flatMap((f) => [`file '${f.file}'`, `duration ${f.ms / 1000}`]);
    // The concat demuxer ignores the last duration unless the last file is listed again.
    lines.push(`file '${this.frames.at(-1)!.file}'`);
    writeFileSync(list, lines.join("\n") + "\n");
    run("ffmpeg", [
      "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
      "-vf", "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
      "-loop", "0", out,
    ]);
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "job-watch-screenshots-"));
  const manifest = join(tmp, "sources.json");
  writeFileSync(
    manifest,
    JSON.stringify(
      Object.fromEntries(Object.entries(recorded).map(([url, r]) => [url, r.file ? { ...r, file: join(fixtures, r.file) } : r])),
    ),
  );
  mkdirSync(outDir, { recursive: true });

  run("npm", ["run", "build"]);
  const server = spawn(process.execPath, ["src/server/main.ts"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", JOB_WATCH_DB: ":memory:", JOB_WATCH_RECORDED_SOURCES: manifest },
  });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    for (const company of companies) await api("POST", "/api/companies", company);
    await api("PUT", "/api/filter", filter);

    // Image 1: the Inbox, keywords of the Filter highlighted.
    const shot = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    await shot.goto(base);
    await shot.locator(".job-list .job-title").first().waitFor();
    await shot.mouse.move(0, 0);
    await shot.screenshot({ path: join(outDir, "inbox.png") });
    await shot.close();

    // Image 2: keyboard triage.
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, colorScheme: "light" });
    await page.goto(base);
    await page.locator(".job-list .job-title").first().waitFor();
    await page.mouse.move(0, 0);
    const gif = new Gif(page, tmp);
    const key = async (k: string, ms = 650) => {
      await page.keyboard.press(k);
      await page.waitForTimeout(200);
      await gif.frame(ms);
    };
    await gif.frame(1200);
    await key("j");
    await key("j");
    await key("e", 900); // Seen: the Job leaves the Inbox, the toast offers Undo
    await key("s", 900); // Saved
    await key("u", 1100); // Undo
    await key("/", 400);
    for (const c of "zurich") {
      await page.keyboard.type(c);
      await page.waitForTimeout(120);
      await gif.frame(160);
    }
    await page.waitForTimeout(200);
    await gif.frame(1500);
    await key("Escape", 1200);
    gif.encode(join(outDir, "triage.gif"));
    await page.close();
  } finally {
    await browser.close();
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`Wrote ${join(outDir, "inbox.png")} and ${join(outDir, "triage.gif")}`);
}

await main();
