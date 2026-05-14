import { Page } from 'puppeteer';
import { writeFile } from 'fs/promises';

export async function savePageHtmlLocal({ page, name, runId }: { page: Page, name: string, runId: string }) {
    try {
        const html = await page.content();
        await writeFile(`${name}.html`, html);
    } catch (error) {
        throw new Error(`[${runId}] Failed to save page HTML to local file: ${error instanceof Error ? error.message : String(error)}`);
    }
} 
