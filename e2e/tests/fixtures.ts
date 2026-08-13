import { test as base, expect, type Page } from '@playwright/test';

export async function dismissOnboardingIfPresent(page: Page) {
  const skipOnboarding = page.getByRole('button', { name: 'Pular' });
  // locator.isVisible() takes a single, immediate snapshot — it does not poll despite
  // accepting a `timeout` option (that timeout only bounds the one underlying CDP call).
  // Called right after a fresh page.goto(), the onboarding dialog often hasn't mounted yet
  // (it renders after session/user data comes back), so the old isVisible() check here would
  // reliably miss it — then the dialog appears a moment later and blocks the test's next
  // click. waitFor() actually polls, so give it a real (bounded) chance to show up.
  const appeared = await skipOnboarding
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await skipOnboarding.click();
    await expect(skipOnboarding).toBeHidden({ timeout: 5000 }).catch(() => {});
  }
}

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
