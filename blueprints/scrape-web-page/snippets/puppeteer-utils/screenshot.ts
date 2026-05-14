import { Page } from 'puppeteer';
import { screenshotGCS } from './screenshotGCS.js';
import { screenshotLocal } from './screenshotLocal.js';

export async function screenshot({ page, name, isCloud = true, runId }: { page: Page, name: string, isCloud?: boolean, runId: string }) {
    if (isCloud) {
        await screenshotGCS({ page, name, runId });  // let errors propogate as they're wrapped with runId
    } else {
        await screenshotLocal({ page, name, runId });  // let errors propogate as they're wrapped with runId
    }
}   