import { Page } from 'puppeteer';

export async function screenshotLocal({
    page,
    name,
    runId
}: {
    page: Page;
    name: string;
    runId: string;
}) {
    try {
        await page.screenshot({
            path: `${name}.png`,
            fullPage: true
        });
    } catch (error) {
        throw new Error(`[${runId}] Failed to save screenshot to local: ${error instanceof Error ? error.message : String(error)}`);
    }
} 