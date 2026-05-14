import * as puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Cookie } from 'puppeteer';

import { cleanLinkedInCookies } from '../utils/cleanLinkedinCookie.js';


export async function createPage({ cookies, isCloud, runId, debug }: { cookies: Cookie[], isCloud: boolean, runId?: string, debug: boolean }) {

  // @ts-ignore - puppeteer-extra types are not fully compatible with ESM
  puppeteerExtra.default.use(StealthPlugin());

  try {

    // Use consistent viewport dimensions for both local and cloud environments
    const viewportConfig = { width: 1200, height: 900 };

    let browser: Browser;
    if (isCloud) {
      // @ts-ignore - puppeteer-extra types are not fully compatible with ESM
      browser = await puppeteerExtra.default.launch({
        headless: true,
        defaultViewport: viewportConfig
      });
    } else {
      // @ts-ignore - puppeteer-extra types are not fully compatible with ESM
      browser = await puppeteerExtra.default.launch({
        headless: false,
        defaultViewport: viewportConfig
      });
    }
    const page = await browser.newPage();

    // Set default timeout to 10 seconds
    page.setDefaultTimeout(10000);

    // Only set cookies if they exist and aren't empty
    if (cookies && cookies.length > 0) {
      const cleanCookies = cleanLinkedInCookies(cookies);
      await browser.setCookie(...cleanCookies);
    }

    return { page, browser };
  } catch (error) {
    debug && console.log(`[${runId}] Failed to create Puppeteer page: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(`[${runId}] Failed to create Puppeteer page: ${error instanceof Error ? error.message : String(error)}`);
  }
}