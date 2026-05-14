import { saveCookies } from "../../db/user/saveCookies.js";
import { Page } from 'puppeteer';
import { roughly } from '../../helpers/util/roughly.js';
import { wait } from '../../helpers/util/wait.js';
import { Env } from '../../types.js';

// Go to a LinkedIn URL and handle login challenges
// If the user is already logged in, it will just go to the URL
// If the user is not logged in, it will log in and save cookies
// If the user is logged in but has a login challenge, it will handle the login challenge

export async function pageGotoAuthenticated({ page, url, runId, debug, testMode, env }: { page: Page, url: string, runId: string, debug: boolean, testMode: boolean, env: Env }): Promise<boolean> {

    // Check it's a LinkedIn URL, otherwise throw an error
    if (!url.includes('linkedin.com')) {
        throw new Error('URL is not a LinkedIn URL');
    }

    // Go to the URL, return false if we get an exception (e.g. 404 or network error)
    debug && console.log(`[${runId}] Going to ${url}`);
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
        console.log(`[${runId}] Error going to ${url}: ${e}`);
        return false;
    }

    // If there's a login challenge, log in and save cookies
    debug && console.log(`[${runId}] Page loaded, checking for login challenge`);
    if (await page.$('button[data-modal="base-sign-in-modal"]')) {

        // Explicitly log in instead of trying to deal with all variants of the login challenge
        console.log(`[${runId}] Going to LinkedIn login page`);
        await page.goto('https://www.linkedin.com/login', { waitUntil: "domcontentloaded", timeout: 5000 });
        console.log(`[${runId}] DOM loaded`);
        console.log(`[${runId}] Waiting 10 seconds for redirects`);
        await wait(roughly(10000, 0.25));

        // Enter username if required
        console.log(`[${runId}] Entering username if it's there`);
        if (await page.$('#username')) {
            console.log(`[${runId}] Entering username`);
            await page.keyboard.type(env.LINKEDIN_EMAIL, { delay: roughly(300, 0.25) });
            console.log(`[${runId}] Pressing tab`);
            await page.keyboard.press('Tab', { delay: roughly(1000, 0.25) });
        } else {
            console.log(`[${runId}] No username found, skipping`);
        }

        // Enter password, hit <Enter>
        console.log(`[${runId}] Entering password if it's there`);
        if (await page.$('#password')) {
            console.log(`[${runId}] Entering password`);
            await page.keyboard.type(env.LINKEDIN_PASSWORD, { delay: roughly(300, 0.25) });
            console.log(`[${runId}] Pressing enter`);
            await page.keyboard.press('Enter');
            console.log(`[${runId}] Waiting for 2 seconds`);
            await wait(roughly(2000, 0.25));
        } else {
            console.log(`[${runId}] No password found, skipping`);
        }

        // Goto the requested URL again, this time we just assume it's worked, let it throw an error if it doesn't
        console.log(`[${runId}] Navigating to ${url} again`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        console.log(`[${runId}] "Page loaded`);
        console.log(`[${runId}] -- Login seems successful --`);
    }
    return true;
}
