// Shared navigation for the creator (owner) flows.
//
// Since "Open Create an Edit directly from You" (686ab77) the You screen's
// "Create an Edit" button opens the composer straight away; the old creator
// dashboard (greeting, New Edit, Archive, Manage collections) is no longer
// on any route. Finishing or abandoning the composer returns to the You
// screen. Every spec that exercises the composer goes through these two
// helpers so the route lives in one place.
import { expect, type Page } from '@playwright/test';

type LangOptions = { ar?: boolean };

/** You tab → "Create an Edit" → the composer heading is visible. */
export async function openCreatorComposer(page: Page, options: LangOptions = {}): Promise<void> {
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await expect(page.getByRole('heading', { name: options.ar ? 'إنشاء منشور' : 'Create an Edit' })).toBeVisible();
}

/** After Publish, Back or an abandoned composer the app lands on the You screen. */
export async function expectBackOnYou(page: Page, options: LangOptions = {}): Promise<void> {
  await expect(page.getByRole('heading', { name: options.ar ? 'ملفك الشخصي' : 'Your profile' })).toBeVisible();
}
