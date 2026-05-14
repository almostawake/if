import { Page } from 'puppeteer';

export async function waitForElementToDisappear(page: Page, selector: string): Promise<boolean> {
    const timeout = 5000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const element = await page.$(selector);
        if (!element) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Element ${selector} did not disappear within ${timeout}ms`);
} 