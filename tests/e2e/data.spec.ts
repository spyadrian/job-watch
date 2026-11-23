import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import type { Job } from "../../src/shared/types.ts";
import { expect, test } from "./fixtures.ts";

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const dataSection = (page: Page) => page.getByRole("region", { name: "Data" });

async function populate(page: Page) {
  const res = await page.request.post("/api/companies", { data: { source: { type: "greenhouse", key: "acme" }, name: "Acme" } });
  expect(res.status()).toBe(201);
  await page.request.post("/api/shortcuts", { data: { name: "Acme careers", url: "https://careers.acme.example" } });
  const { jobs } = (await (await page.request.get("/api/jobs")).json()) as { jobs: Job[] };
  const designer = jobs.find((j) => j.title === "Product Designer")!;
  await page.request.post(`/api/jobs/${designer.id}/status`, { data: { action: "save" } });
}

test("exports all data to a dated file and imports it back with a summary in plain English", async ({ page, request }) => {
  await populate(page);
  await page.goto("/");
  await tab(page, "Companies").click();

  // The hint says what Export saves, and that Unseen Jobs are left out.
  await expect(dataSection(page).locator(".hint")).toHaveText(
    "Save your Companies, Shortcuts, Filter and Job statuses to one file (Unseen Jobs are left out: the next Refresh reads them again), or load such a file here to merge it with what you already have.",
  );

  // Export downloads one JSON file named after today's date.
  const downloadPromise = page.waitForEvent("download");
  await dataSection(page).getByRole("link", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^job-watch-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await readFile(await download.path(), "utf8");
  expect(JSON.parse(file)).toMatchObject({ format: "job-watch", version: 1 });

  // Into a fresh instance: the import says what it added, and the Companies tab shows it at once.
  expect((await request.post("/api/test/reset")).status()).toBe(204);
  await page.reload();
  await tab(page, "Companies").click();
  const section = dataSection(page);
  await expect(section.getByRole("checkbox", { name: /Replace my Filter/ })).toBeChecked();
  await section.getByLabel("Import a file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(file) });

  await expect(section.getByRole("status")).toHaveText(
    "Added 1 Company and 1 Shortcut; restored 1 Job status. Refresh to read the new Companies' Jobs.",
  );
  await expect(page.getByRole("region", { name: "Followed Companies" }).getByText("Acme", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Shortcuts" }).getByRole("link", { name: /Acme careers/ })).toBeVisible();
  await expect(tab(page, "Saved")).toContainText("1");

  // The same file again adds nothing.
  await section.getByLabel("Import a file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await expect(section.getByRole("status")).toHaveText("Nothing new to import: everything in this file is already here.");
});

test("explains why an invalid file is refused", async ({ page }) => {
  await page.goto("/");
  await tab(page, "Companies").click();

  await dataSection(page)
    .getByLabel("Import a file")
    .setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello": "world"}') });

  await expect(dataSection(page).getByRole("alert")).toHaveText("This file isn't a Job Watch export.");

  await dataSection(page)
    .getByLabel("Import a file")
    .setInputFiles({ name: "notes.txt", mimeType: "application/json", buffer: Buffer.from("just some notes") });

  await expect(dataSection(page).getByRole("alert")).toHaveText("This file isn't valid JSON.");
});
