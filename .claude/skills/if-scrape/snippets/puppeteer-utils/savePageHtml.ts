import { Page } from 'puppeteer';
import { savePageHtmlGCS } from './savePageHtmlGCS.js';
import { savePageHtmlLocal } from './savePageHtmlLocal.js';

export async function savePageHtml({ page, name, isCloud = true, runId }: { page: Page, name: string, isCloud?: boolean, runId: string }) {
    if (isCloud) {
        await savePageHtmlGCS({ page, name, runId }); //  Let errors propogate as they're wrapped with runId
    } else {
        await savePageHtmlLocal({ page, name, runId }); //  Let errors propogate as they're wrapped with runId
    }
} 