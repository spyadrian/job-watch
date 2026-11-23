import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The header shows one "Shortcuts" button; the Shortcuts themselves are in the menu it opens.
const menuButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^Shortcuts/ });
const menu = (page: Page) => page.getByRole("navigation", { name: "Shortcuts" });

async function openMenu(page: Page) {
  await menuButton(page).click();
  await expect(menu(page)).toBeVisible();
  return menu(page);
}

async function addShortcuts(page: Page, names: string[]) {
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
    const res = await page.request.post("/api/shortcuts", { data: { name, url: `https://${slug}.example/jobs` } });
    expect(res.status()).toBe(201);
  }
}

test("manages Shortcuts in the Companies tab and opens them in a new tab from the header menu", async ({ page }) => {
  await page.goto("/");

  const header = await openMenu(page);
  const jobup = header.getByRole("link", { name: /Jobup/ });
  await expect(jobup).toHaveAttribute("href", "https://www.jobup.ch");
  await expect(jobup).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Shortcuts" });
  await expect(section.getByRole("link", { name: /Indeed Switzerland/ })).toHaveAttribute("target", "_blank");

  // Add: an invalid link is refused with a message.
  await section.getByLabel("Name", { exact: true }).fill("Acme careers");
  await section.getByLabel("Link", { exact: true }).fill("acme careers");
  await section.getByRole("button", { name: "Add Shortcut" }).click();
  await expect(section.getByRole("alert")).toContainText(/link/i);

  await section.getByLabel("Link", { exact: true }).fill("https://careers.acme.example/jobs");
  await section.getByRole("button", { name: "Add Shortcut" }).click();
  const added = section.getByRole("link", { name: /Acme careers/ });
  await expect(added).toHaveAttribute("href", "https://careers.acme.example/jobs");
  await expect(menuButton(page)).toHaveAccessibleName("Shortcuts · 3");
  await openMenu(page);
  await expect(header.getByRole("link", { name: /Acme careers/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Rename: Cancel keeps the old name, Save applies the new one.
  await section.getByRole("button", { name: "Rename Acme careers" }).click();
  await section.getByLabel("New name for Acme careers").fill("Ignored");
  await section.getByRole("button", { name: "Cancel" }).click();
  await expect(added).toBeVisible();

  await section.getByRole("button", { name: "Rename Acme careers" }).click();
  await section.getByLabel("New name for Acme careers").fill("Acme jobs");
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section.getByRole("link", { name: /Acme jobs/ })).toBeVisible();
  await openMenu(page);
  await expect(header.getByRole("link", { name: /Acme jobs/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Remove.
  await section.getByRole("button", { name: "Remove Acme jobs" }).click();
  await expect(section.getByRole("link", { name: /Acme jobs/ })).toHaveCount(0);
  await expect(menuButton(page)).toHaveAccessibleName("Shortcuts · 2");
  await openMenu(page);
  await expect(header.getByRole("link", { name: /Acme jobs/ })).toHaveCount(0);
});

test("the header shows one Shortcuts button that opens a dropdown, and opening a Shortcut closes it", async ({
  page,
  context,
}) => {
  await context.route("https://www.jobup.ch/**", (route) => route.fulfill({ body: "Jobup" }));
  await page.goto("/");

  const button = menuButton(page);
  await expect(button).toHaveAccessibleName("Shortcuts · 2");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu(page)).toBeHidden();
  // No inline links in the header any more.
  await expect(page.getByRole("banner").getByRole("link")).toHaveCount(0);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const panelId = await button.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  // Few Shortcuts: no search field.
  await expect(menu(page).getByRole("searchbox")).toHaveCount(0);
  await expect(menu(page).getByRole("link")).toHaveText([/Jobup/, /Indeed Switzerland/]);

  // A floating dropdown under the button on wide screens.
  const buttonBox = (await button.boundingBox())!;
  const panelBox = (await menu(page).boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 1);
  const tabsBox = (await page.getByRole("tablist").boundingBox())!;
  expect(panelBox.y).toBeLessThan(tabsBox.y + tabsBox.height); // over the tabs, not pushing them down

  const [opened] = await Promise.all([context.waitForEvent("page"), menu(page).getByRole("link", { name: /Jobup/ }).click()]);
  await expect(opened).toHaveURL("https://www.jobup.ch/");
  await expect(menu(page)).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("a click outside closes the menu, and Manage Shortcuts goes to the Companies tab", async ({ page }) => {
  await page.goto("/");
  await openMenu(page);
  await page.getByRole("tablist").click({ position: { x: 600, y: 5 } });
  await expect(menu(page)).toBeHidden();

  await openMenu(page);
  await menu(page).getByRole("button", { name: "Manage Shortcuts" }).click();
  await expect(menu(page)).toBeHidden();
  await expect(page.getByRole("tab", { name: /Companies/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Shortcuts" })).toBeFocused();
});

test("many Shortcuts: a search field ignoring case and accents, arrow keys, Enter opens, Esc closes", async ({
  page,
  context,
}) => {
  await context.route("https://**.example/**", (route) => route.fulfill({ body: "Careers" }));
  await addShortcuts(page, [
    "Genève Emploi",
    "Lausanne Jobs",
    "Zurich Careers",
    "Basel Work",
    "Bern Jobs",
    "Lugano Lavoro",
    "Sion Emplois",
    "Fribourg Jobs",
    "Neuchâtel Emploi",
    "Valais Jobs",
  ]);
  await page.goto("/");

  const button = menuButton(page);
  await expect(button).toHaveAccessibleName("Shortcuts · 12");

  // g opens the menu from anywhere; the search field has focus.
  await page.keyboard.press("g");
  const search = menu(page).getByRole("searchbox", { name: "Search Shortcuts" });
  await expect(search).toBeFocused();
  await expect(menu(page).getByRole("link")).toHaveCount(12);

  // Typing never triggers the app's keys (j, k, e, s, a, u, /, ?, g).
  await page.keyboard.type("jksaeu/?g");
  await expect(search).toHaveValue("jksaeu/?g");
  await expect(page.getByRole("dialog")).toBeHidden();
  await search.fill("");

  await page.keyboard.type("GENEVE");
  await expect(menu(page).getByRole("link")).toHaveText([/Genève Emploi/]);
  await search.fill("emploi");
  await expect(menu(page).getByRole("link")).toHaveText([/Genève Emploi/, /Sion Emplois/, /Neuchâtel Emploi/]);
  await search.fill("nothing like this");
  await expect(menu(page)).toContainText("No Shortcut matches");
  await search.fill("chatel");
  await expect(menu(page).getByRole("link")).toHaveText([/Neuchâtel Emploi/]);

  // Arrow keys move through the items; Enter opens the focused one in a new tab and closes the menu.
  await search.fill("jobs");
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("link", { name: /Lausanne Jobs/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("link", { name: /Bern Jobs/ })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu(page).getByRole("link", { name: /Lausanne Jobs/ })).toBeFocused();
  const [opened] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")]);
  await expect(opened).toHaveURL("https://lausanne-jobs.example/jobs");
  await expect(menu(page)).toBeHidden();

  // Reopened, the search starts empty; Esc closes and gives focus back to the button.
  await page.bringToFront();
  await button.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(button).toBeFocused();

  // Long lists scroll inside the panel, never the page.
  await page.setViewportSize({ width: 1024, height: 400 });
  await button.click();
  const list = menu(page).getByRole("list");
  const scrolls = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  const panelBox = (await menu(page).boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(400);
});

test("while the menu is open, the Job list's keys do nothing", async ({ page }) => {
  const res = await page.request.post("/api/companies", { data: { source: { type: "greenhouse", key: "acme" }, name: "Acme" } });
  expect(res.status()).toBe(201);
  await page.goto("/");
  const tab = (name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
  const selected = page.getByRole("tabpanel").locator('[aria-current="true"]');
  await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(3);
  await page.keyboard.press("j");
  await page.keyboard.press("e");
  await expect(tab("Seen")).toHaveAccessibleName("Seen 1");
  const selectedTitle = await selected.locator(".job-title").innerText();

  await page.keyboard.press("g");
  const jobup = menu(page).getByRole("link", { name: /Jobup/ });
  await expect(jobup).toBeFocused();
  for (const key of ["j", "k", "e", "s", "a", "u", "/"]) await page.keyboard.press(key);

  await expect(jobup).toBeFocused();
  await expect(selected.locator(".job-title")).toHaveText(selectedTitle);
  for (const [name, n] of Object.entries({ Inbox: 2, Seen: 1, Saved: 0, Applied: 0 })) {
    await expect(tab(name)).toHaveAccessibleName(`${name} ${n}`);
  }
});

test("g is listed in the keyboard help", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog").locator("kbd").filter({ hasText: /^g$/ })).toHaveCount(1);
});

test("on a narrow screen the button takes the full width and the list unfolds in the page", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/");

  const button = menuButton(page);
  const header = (await page.getByRole("banner").boundingBox())!;
  const buttonBox = (await button.boundingBox())!;
  expect(buttonBox.width).toBeGreaterThan(header.width - 40);

  await button.click();
  const panelBox = (await menu(page).boundingBox())!;
  const tabsBox = (await page.getByRole("tablist").boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 1);
  expect(tabsBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height - 1); // pushes the tabs down
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
});

test("no Shortcuts: no Shortcuts button", async ({ page }) => {
  const { shortcuts } = (await (await page.request.get("/api/shortcuts")).json()) as { shortcuts: { id: number }[] };
  for (const s of shortcuts) await page.request.delete(`/api/shortcuts/${s.id}`);
  await page.goto("/");
  await expect(page.getByRole("tab", { name: /Inbox/ })).toBeVisible();
  await expect(menuButton(page)).toHaveCount(0);
});

const tenMore = [
  "Genève Emploi",
  "Lausanne Jobs",
  "Zurich Careers",
  "Basel Work",
  "Bern Jobs",
  "Lugano Lavoro",
  "Sion Emplois",
  "Fribourg Jobs",
  "Neuchâtel Emploi",
  "Valais Jobs",
];

test("Open all carries the count of the listed Shortcuts and follows the search", async ({ page }) => {
  await addShortcuts(page, tenMore);
  await page.goto("/");
  await openMenu(page);
  const openAll = menu(page).getByRole("button", { name: /^Open all/ });
  await expect(openAll).toHaveText("Open all 12");

  const search = menu(page).getByRole("searchbox", { name: "Search Shortcuts" });
  await search.fill("emploi");
  await expect(openAll).toHaveText("Open all 3");
  await search.fill("nothing like this");
  await expect(openAll).toHaveCount(0);
});

test("Open all opens each listed Shortcut in a new tab, in order, from the keyboard, and closes the menu", async ({
  page,
  context,
}) => {
  await context.route("https://**.example/**", (route) => route.fulfill({ body: "Careers" }));
  await addShortcuts(page, tenMore);
  await page.goto("/");
  await openMenu(page);
  await menu(page).getByRole("searchbox", { name: "Search Shortcuts" }).fill("emploi");

  const opened: string[] = [];
  context.on("page", (p) => opened.push(p.url()));
  await menu(page).getByRole("button", { name: "Open all 3" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => opened.length).toBe(3);
  await expect(menu(page)).toBeHidden();
  const pages = context.pages().slice(1);
  await Promise.all(pages.map((p) => p.waitForURL(/example/)));
  expect(pages.map((p) => p.url())).toEqual([
    "https://gen-ve-emploi.example/jobs",
    "https://sion-emplois.example/jobs",
    "https://neuch-tel-emploi.example/jobs",
  ]);
  // The new tabs can't reach back into Job Watch.
  expect(await pages[0]!.evaluate(() => window.opener)).toBeNull();
});

test("on a narrow screen, Space on Open all opens the Shortcuts too", async ({ page, context }) => {
  await context.route("https://www.jobup.ch/**", (route) => route.fulfill({ body: "Jobup" }));
  await context.route("https://**.indeed.com/**", (route) => route.fulfill({ body: "Indeed" }));
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto("/");
  await openMenu(page);
  const opened: string[] = [];
  context.on("page", (p) => opened.push(p.url()));
  await menu(page).getByRole("button", { name: "Open all 2" }).focus();
  await page.keyboard.press(" ");
  await expect.poll(() => opened.length).toBe(2);
  await expect(menu(page)).toBeHidden();
});

test("when the browser blocks pop-ups, Open all says so in the panel and stays open", async ({ page }) => {
  // Like Chromium and Firefox with their pop-up blocker on: one tab per click, the rest return null.
  await page.addInitScript(() => {
    let calls = 0;
    window.open = () => (calls++ === 0 ? ({ opener: window } as unknown as Window) : null);
  });
  await page.goto("/");
  await openMenu(page);
  await menu(page).getByRole("button", { name: "Open all 2" }).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("status")).toHaveText(
    "Your browser blocked some tabs. Allow pop-ups for this site, then try again.",
  );
  await expect(page.getByRole("dialog")).toBeHidden();

  // The message goes when the menu closes.
  await page.keyboard.press("Escape");
  await openMenu(page);
  await expect(menu(page).getByRole("status")).toBeEmpty();
});
