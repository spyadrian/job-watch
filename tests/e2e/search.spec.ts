import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function followAcme(page: Page) {
  const res = await page.request.post("/api/companies", {
    data: { source: { type: "greenhouse", key: "acme" }, name: "Acme" },
  });
  expect(res.status()).toBe(201);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const rows = (page: Page) => page.getByRole("tabpanel").getByRole("listitem");
const search = (page: Page) => page.getByRole("searchbox", { name: "Search" });

test("searches the list being viewed, every word, ignoring accents and case, with highlights", async ({ page }) => {
  await followAcme(page);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(3);

  await search(page).fill("ZURICH engineer");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Senior Backend Engineer");
  const marks = rows(page).locator("mark");
  await expect(marks).toHaveText(["Engineer", "Zürich"]);

  await search(page).fill("zurich designer");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText(/No Jobs match/)).toBeVisible();

  // Search applies to the Saved list too.
  await search(page).fill("");
  await rows(page).filter({ hasText: "Product Designer" }).getByRole("button", { name: "Save" }).click();
  await tab(page, "Saved").click();
  await search(page).fill("lausanne");
  await expect(rows(page)).toHaveCount(1);
  await search(page).fill("acme office");
  await expect(rows(page)).toHaveCount(0);
});

test("/ focuses the search from anywhere and Esc clears it", async ({ page }) => {
  await followAcme(page);
  await page.goto("/");

  await tab(page, "Inbox").focus();
  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");

  await page.keyboard.type("designer");
  await expect(rows(page)).toHaveCount(1);
  // While typing, "/" is just a character.
  await page.keyboard.type("/");
  await expect(search(page)).toHaveValue("designer/");

  await page.keyboard.press("Escape");
  await expect(search(page)).toHaveValue("");
  await expect(rows(page)).toHaveCount(3);
});
