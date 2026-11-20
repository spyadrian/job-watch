import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function followAcme(page: Page) {
  const res = await page.request.post("/api/companies", {
    data: { source: { type: "greenhouse", key: "acme" }, name: "Acme" },
  });
  expect(res.status()).toBe(201);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });
const toast = (page: Page) => page.getByRole("status").filter({ hasText: /\w/ });

async function expectCounts(page: Page, counts: Record<string, number>) {
  for (const [name, n] of Object.entries(counts)) await expect(tab(page, name)).toHaveAccessibleName(`${name} ${n}`);
}

async function expectToastClear(page: Page, t: Locator) {
  // Never takes focus.
  expect(await t.evaluate((el) => el.contains(document.activeElement))).toBe(false);
}

test("moves Jobs between lists with Seen, Save and Applied, with counts and an undo toast", async ({ page }) => {
  await followAcme(page);
  await page.goto("/");
  await expectCounts(page, { Inbox: 3, Saved: 0, Applied: 0, Seen: 0 });

  // Mark Seen: leaves the Inbox, toast appears without taking focus or covering the list.
  const job = row(page, "Senior Backend Engineer");
  await job.getByRole("button", { name: "Seen" }).click();
  await expect(job).toHaveCount(0);
  await expectCounts(page, { Inbox: 2, Seen: 1 });
  await expect(toast(page)).toContainText("Marked as seen");
  await expectToastClear(page, toast(page));

  // Undo reverts the last change.
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(job).toHaveCount(1);
  await expectCounts(page, { Inbox: 3, Seen: 0 });

  // Save → Applied → un-Applied returns to Saved.
  await job.getByRole("button", { name: "Save" }).click();
  await expectCounts(page, { Inbox: 2, Saved: 1 });
  await tab(page, "Saved").click();
  await expect(job.getByRole("button", { name: "Save" })).toHaveAttribute("aria-pressed", "true");
  await job.getByRole("button", { name: "Applied" }).click();
  await expectCounts(page, { Saved: 0, Applied: 1 });
  await tab(page, "Applied").click();
  await job.getByRole("button", { name: "Applied" }).click();
  await expect(toast(page)).toContainText(/applied/i);
  await expectCounts(page, { Saved: 1, Applied: 0 });

  // Un-saving moves it to Seen; un-marking Seen returns it to the Inbox.
  await tab(page, "Saved").click();
  await job.getByRole("button", { name: "Save" }).click();
  await expectCounts(page, { Saved: 0, Seen: 1 });
  await tab(page, "Seen").click();
  await job.getByRole("button", { name: "Seen" }).click();
  await expectCounts(page, { Inbox: 3, Seen: 0 });
});

test("the Inbox header counts its Jobs, and an Inbox with every Job triaged is caught up", async ({ page }) => {
  await followAcme(page);
  await page.goto("/");
  const actions = page.locator(".list-actions");
  await expect(actions).toContainText("3 Jobs");
  await expect(actions.getByText(/Marks the/)).toHaveCount(0);

  // Narrow screens: the bar fits, no horizontal scroll.
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const bar = (await actions.boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(320);

  await row(page, "Senior Backend Engineer").getByRole("button", { name: "Seen" }).click();
  await expect(actions).toContainText("2 Jobs");

  await page.getByRole("button", { name: "Mark all as seen" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("You're all caught up: nothing new to review.");
  await expect(page.getByText(/hidden by your Filter/)).toHaveCount(0);
});

test("the toast floats over the list without changing the layout, and the list stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const res = await page.request.post("/api/companies", {
    data: { source: { type: "greenhouse", key: "manyroles" }, name: "Many Roles" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/");
  const jobs = page.getByRole("tabpanel").getByRole("listitem");
  await expect(jobs).toHaveCount(50);

  const panel = page.locator("main.panel");
  const before = (await panel.boundingBox())!;
  await jobs.first().getByRole("button", { name: "Seen" }).click();
  await expect(toast(page)).toContainText("Marked as seen");
  // Showing the toast does not shrink the scrolling panel.
  expect(await panel.boundingBox()).toEqual(before);

  // Scrolled to the bottom, the last row and "Show N more" sit fully above the toast.
  await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const t = (await toast(page).locator(".toast").boundingBox())!;
  for (const el of [jobs.last(), page.getByRole("button", { name: /Show \d+ more/ })]) {
    const box = (await el.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(t.y);
  }

  // Clicks next to the toast reach what is under it.
  await expect(page.getByRole("status")).toHaveCSS("pointer-events", "none");
  await expect(toast(page).locator(".toast")).toHaveCSS("pointer-events", "auto");

  // On a narrow screen it sits bottom-centre with 16px side gutters.
  await page.setViewportSize({ width: 400, height: 600 });
  expect(await page.getByRole("status").boundingBox()).toMatchObject({ x: 16, width: 400 - 32 });
});

test("the toast disappears on its own and statuses survive a reload", async ({ page }) => {
  await followAcme(page);
  await page.goto("/");

  await row(page, "Senior Backend Engineer").getByRole("button", { name: "Applied" }).click();
  await expect(toast(page)).toContainText("Marked as applied");
  await expect(toast(page)).toHaveCount(0, { timeout: 10_000 });

  await page.reload();
  await expectCounts(page, { Inbox: 2, Applied: 1 });
  await tab(page, "Applied").click();
  await expect(row(page, "Senior Backend Engineer")).toHaveCount(1);
});
