// Keyboard triage (spec "Keyboard and accessibility"): j/k move the selection, Enter opens
// the selected Job, e/s/a toggle Seen/Saved/Applied, u undoes, ? shows the shortcuts.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function follow(page: Page, key: string, name: string) {
  const res = await page.request.post("/api/companies", { data: { source: { type: "greenhouse", key }, name } });
  expect(res.status()).toBe(201);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const rows = (page: Page) => page.getByRole("tabpanel").getByRole("listitem");
const titles = (page: Page) => page.getByRole("tabpanel").locator(".job-title");
const selected = (page: Page) => page.getByRole("tabpanel").locator('[aria-current="true"]');

async function expectCounts(page: Page, counts: Record<string, number>) {
  for (const [name, n] of Object.entries(counts)) await expect(tab(page, name)).toHaveAccessibleName(`${name} ${n}`);
}

/** The visible Job titles, in list order, without the screen-reader suffix. */
async function listTitles(page: Page): Promise<string[]> {
  return (await titles(page).allInnerTexts()).map((t) => t.replace(/\s*\(opens in a new tab\)$/, ""));
}

test("j and k move the selection and Enter opens the selected Job in a new tab", async ({ page, context }) => {
  await follow(page, "acme", "Acme");
  await page.goto("/");
  await expect(rows(page)).toHaveCount(3);
  const [first, second] = await listTitles(page);
  await expect(selected(page)).toHaveCount(0);

  await page.keyboard.press("j");
  await expect(selected(page)).toContainText(first!);
  await expect(selected(page)).toBeFocused();
  await page.keyboard.press("j");
  await expect(selected(page)).toContainText(second!);
  await page.keyboard.press("k");
  await expect(selected(page)).toContainText(first!);
  // k at the top stays on the first Job.
  await page.keyboard.press("k");
  await expect(selected(page)).toContainText(first!);

  // The Job page itself is never fetched from the network.
  await context.route("https://job-boards.greenhouse.io/**", (route) => route.fulfill({ body: "Job page" }));
  const href = await selected(page).getByRole("link").getAttribute("href");
  const [opened] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")]);
  await expect.poll(() => opened.url()).toBe(href);
  await opened.close();
});

test("e, s and a triage the selected Job, the next Job takes its place, and u undoes", async ({ page }) => {
  await follow(page, "acme", "Acme");
  await page.goto("/");
  await expect(rows(page)).toHaveCount(3);
  const [first, second, third] = await listTitles(page);

  // e marks Seen: the Job leaves the Inbox and the next one is selected, still focused.
  await page.keyboard.press("j");
  await page.keyboard.press("e");
  await expect(rows(page)).toHaveCount(2);
  await expectCounts(page, { Inbox: 2, Seen: 1 });
  await expect(selected(page)).toContainText(second!);
  await expect(selected(page)).toBeFocused();

  // The toast is announced politely and never takes focus.
  const toast = page.getByRole("status").filter({ hasText: "Marked as seen" });
  await expect(toast).toHaveAttribute("aria-live", "polite");
  expect(await toast.evaluate((el) => el.contains(document.activeElement))).toBe(false);

  // s saves, a marks Applied, each time on the Job that took the previous one's place.
  await page.keyboard.press("s");
  await expect(selected(page)).toContainText(third!);
  await page.keyboard.press("a");
  await expectCounts(page, { Inbox: 0, Saved: 1, Applied: 1, Seen: 1 });

  // u undoes the last change only.
  await page.keyboard.press("u");
  await expectCounts(page, { Inbox: 1, Saved: 1, Applied: 0 });
  await expect(rows(page)).toHaveText([new RegExp(third!)]);

  // The keys toggle in the other lists too: e on a Seen Job sends it back to the Inbox…
  await tab(page, "Seen").click();
  await page.keyboard.press("j");
  await expect(selected(page)).toContainText(first!);
  await page.keyboard.press("e");
  await expectCounts(page, { Inbox: 2, Seen: 0 });
  // …and s on a Saved Job un-saves it.
  await tab(page, "Saved").click();
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await expectCounts(page, { Saved: 0, Seen: 1 });
});

test("e, s and a do nothing when the selected Job's button for them is disabled", async ({ page }) => {
  await follow(page, "acme", "Acme");
  const { jobs } = await (await page.request.get("/api/jobs")).json();
  expect((await page.request.post(`/api/jobs/${jobs[0].id}/status`, { data: { action: "apply" } })).status()).toBe(200);
  const statusAnswers: number[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/status")) statusAnswers.push(res.status());
  });
  await page.goto("/");
  await tab(page, "Applied").click();
  await page.keyboard.press("j");
  await expect(selected(page).getByRole("button", { name: "Seen" })).toBeDisabled();
  await expect(selected(page).getByRole("button", { name: "Save" })).toBeDisabled();

  await page.keyboard.press("e");
  await page.keyboard.press("s");
  // a is allowed (un-mark Applied): once it is done, e and s have had every chance to call the API.
  await page.keyboard.press("a");
  await expect(page.getByRole("status")).toContainText("Unmarked as applied");

  expect(statusAnswers).toEqual([200]);
  await expectCounts(page, { Applied: 0, Seen: 1 });
});

test("Show 50 more pages the list, j past the last shown Job too, and Mark all as seen takes the shown Jobs", async ({
  page,
}) => {
  await follow(page, "manyroles", "Many Roles");
  await page.goto("/");
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText("Showing 50 of 55")).toBeVisible();

  // The button shows the rest.
  await page.getByRole("button", { name: "Show 5 more" }).click();
  await expect(rows(page)).toHaveCount(55);
  await expect(page.getByRole("button", { name: /Show \d+ more/ })).toHaveCount(0);

  // j past the 50th Job shows the next page and keeps going.
  await page.reload();
  await expect(rows(page)).toHaveCount(50);
  for (let i = 0; i < 50; i++) await page.keyboard.press("j");
  await expect(rows(page)).toHaveCount(50);
  await expect(selected(page)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows(page)).toHaveCount(55);
  await expect(selected(page)).toBeFocused();
  await expect(rows(page).nth(50)).toHaveAttribute("aria-current", "true");

  // Mark all as seen marks the 50 Jobs shown, not the 5 beyond the page.
  await page.reload();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.locator(".list-actions")).toContainText("55 Jobs");
  const markShown = page.locator(".list-actions").getByRole("button");
  await expect(markShown).toHaveText("Mark 50 as seen");
  await markShown.click();
  await expectCounts(page, { Inbox: 5, Seen: 50 });
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator(".list-actions")).toContainText("5 Jobs");
  await expect(page.getByRole("button", { name: "Mark all as seen" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Marked 50 Jobs as seen");
});

test("shortcuts don't fire while typing in a text field", async ({ page }) => {
  await follow(page, "acme", "Acme");
  await page.goto("/");
  await expect(rows(page)).toHaveCount(3);

  const search = page.getByRole("searchbox", { name: "Search" });
  await search.click();
  await page.keyboard.type("jeksau?");
  await expect(search).toHaveValue("jeksau?");
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCounts(page, { Inbox: 3, Seen: 0, Saved: 0, Applied: 0 });
});

test("? shows the keyboard shortcuts in a dialog that Esc closes", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Keyboard shortcuts" });
  await opener.focus();

  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  for (const key of ["j", "k", "Enter", "e", "s", "a", "u", "/", "Esc", "?"]) {
    await expect(dialog.locator("kbd").filter({ hasText: new RegExp(`^${key.replace(/[/?]/, "\\$&")}$`) })).toHaveCount(1);
  }
  // Triage keys do nothing behind the open dialog.
  await page.keyboard.press("j");
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  // The button opens it too, and Close returns focus.
  await opener.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
