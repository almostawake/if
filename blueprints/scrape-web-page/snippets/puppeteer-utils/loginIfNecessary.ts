import { saveCookies } from "../../db/user/saveCookies.js";
import { Page } from 'puppeteer';
import { createHmac } from 'crypto';
import { roughly } from '../../helpers/util/roughly.js';
import { wait } from '../../helpers/util/wait.js';
import { Env } from '../../types.js';

function generateTOTP(secret: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    const key = Buffer.from(bytes);
    const time = Math.floor(Date.now() / 1000 / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeUInt32BE(Math.floor(time / 0x100000000), 0);
    timeBuffer.writeUInt32BE(time & 0xffffffff, 4);
    const hmac = createHmac('sha1', key).update(timeBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
    return code.toString().padStart(6, '0');
}

export async function loginIfNecessary({ page, runId, debug, testMode, env }: { page: Page, runId: string, debug: boolean, testMode: boolean, env: Env }): Promise<void> {

    debug && console.log(`[${runId}] Going to login URL which will redirect to feed page if we're logged in`);
    await page.goto('https://www.linkedin.com/login', { waitUntil: "domcontentloaded", timeout: 10000 });

    // If there's a login challenge, log in and save cookies
    if (await page.$('button[aria-label="Sign in"]')) {
        console.log(`[${runId}] -- Login challenge detected, waiting 5 seconds --`);
        await wait(roughly(5000, 0.25));

        let isFreshLogin = false;

        // Enter username if it's there (cold new sign-in)
        if (await page.$('#username')) {
            isFreshLogin = true;
            console.log(`[${runId}] Entering username`);
            await page.keyboard.type(env.LINKEDIN_EMAIL, { delay: roughly(300, 0.25) });
            console.log(`[${runId}] Pressing tab`);
            await page.keyboard.press('Tab', { delay: roughly(1000, 0.25) });
        } else {
            console.log(`[${runId}] No username field, skipping that`);
        }

        // Enter password, hit <Enter>
        if (await page.$('#password')) {

            console.log(`[${runId}] Entering password`);
            await page.keyboard.type(env.LINKEDIN_PASSWORD, { delay: roughly(300, 0.25) });
            console.log(`[${runId}] Pressing enter`);
            await page.keyboard.press('Enter');
            await wait(roughly(3000, 0.25));

            // Handle TOTP challenge if it appears
            if (isFreshLogin && await page.$('#input__phone_verification_pin')) {
                if (!env.LINKEDIN_TOTP_SECRET) {
                    throw new Error(`[${runId}] TOTP challenge detected but no LINKEDIN_TOTP_SECRET configured`);
                }
                const totpCode = generateTOTP(env.LINKEDIN_TOTP_SECRET);
                console.log(`[${runId}] TOTP challenge detected, entering code`);
                await page.type('#input__phone_verification_pin', totpCode, { delay: roughly(200, 0.25) });
                await page.click('#two-step-submit-button');
                await wait(roughly(3000, 0.25));
            }

            // Wait for the feed page to load (redirected from login page)
            console.log(`[${runId}] Waiting for feed page to load`);
            await page.waitForSelector('main', { timeout: 15000 });
            console.log(`[${runId}] Feed page loaded, login seems successful`);
            console.log(`[${runId}] -- Login seems successful --`);

            // Save cookies
            debug && console.log(`[${runId}] Saving cookies`);
            await saveCookies(env, page, runId, debug, testMode);

        } else {
            throw new Error(`[${runId}] No password field found, something's wrong`);
        }

    } else {

        debug && console.log(`[${runId}] No login challenge detected, on with the real work..`);
    }

}
