// Every e2e spec imports `test` and `expect` from here instead of @playwright/test.
// An automatic fixture resets the server to a fresh first start (empty database plus
// default Shortcuts) before each test, so tests never depend on each other or on order.
// The reset endpoint exists only when the server runs against recorded Sources.
import { expect, test as base } from "@playwright/test";

export const test = base.extend<{ freshServer: void }>({
  freshServer: [
    async ({ request }, use) => {
      const res = await request.post("/api/test/reset");
      expect(res.status(), "POST /api/test/reset (is the server in recorded-Sources mode?)").toBe(204);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
