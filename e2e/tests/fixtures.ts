import { test as base, expect } from '@playwright/test';

// The app loads Google Fonts from an external CDN. That's irrelevant to what these
// tests verify, and in network-restricted environments the request can hang instead
// of failing fast — since it's a render-blocking <link rel="stylesheet">, a hang there
// stalls `domcontentloaded` for the whole page. Abort it so tests never depend on
// reaching a third-party CDN.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await use(page);
  },
});

export { expect };
