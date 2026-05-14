import { Page } from 'puppeteer';
import { addBrokenProfile } from '../db/brokenProfile/addBrokenProfile.js';
import { deleteRequestFromQueue } from '../db/request/deleteRequestFromQueue.js';
import { puppeteerWaitForXpath } from './puppeteer-utils/waitForXpath.js';
/**
 * Navigates to a LinkedIn profile page and ensures it loads properly
 * Returns true if successful, throws error if not
 */
export async function getValidProfilePage({
    page,
    profileId,
    testMode,
    runId,
    debug
}: {
    page: Page;
    profileId: string;
    testMode: boolean;
    runId: string;
    debug: boolean;
}): Promise<boolean> {

    const profileUrl = `https://linkedin.com/in/${profileId}/`;

    // Navigate to profile page, bail if we get a network error
    try {
        await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
        debug && console.log(`[${runId}] profileUrl domcontentloaded`);
    } catch (error) {
        console.log(`[${runId}] Network error (not added to brokenProfiles) - ${profileUrl} - ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }

    // If we've been redirected to linkedin 404, bail softly
    if (await page.$('h2.artdeco-empty-state__headline--mercado-error-server-large')) {
        debug && console.log(`[${runId}] Profile is a 404 - adding to brokenProfiles`);
        await addBrokenProfile({ profileId, runId, debug, testMode }); // These get cleaned up separately
        await deleteRequestFromQueue({ profileId, runId, debug }); // No point trying again down the track if this was a connection request
        return false; // Handled in the calling function as 404
    }

    // Wait for "People you may know" section to load (indicates page is fully rendered)
    try {
        const xpath = '//h2[contains(., "People you may know")]';
        await puppeteerWaitForXpath(page, xpath, 10000);
        debug && console.log(`[${runId}] "People you may know" section loaded normally`);
    } catch (error) {
        throw new Error(`[${runId}] "People you may know" section didn't load, something's wrong - ${error instanceof Error ? error.message : String(error)}`);
    }

    return true;

}