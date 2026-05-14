import { deleteRequestFromQueue } from '../db/request/deleteRequestFromQueue.js';
import { type Page } from 'puppeteer';
import { Human } from '../types.js';
import { historySchema } from '../types.js';
import { GhostCursor } from 'ghost-cursor';
import { wait } from '../helpers/util/wait.js';
import { roughly } from '../helpers/util/roughly.js';
/*
Assumes we're already on the LinkedIn profile page and the DOM is loaded.
The invite modal lives inside #interop-outlet's shadow DOM, so we use
page.waitForFunction/page.evaluate to reach into the shadow root.
*/

function waitForShadowEl(page: Page, selector: string, timeout = 10000) {
  return page.waitForFunction((sel: string) => {
    return !!document.querySelector('#interop-outlet')?.shadowRoot?.querySelector(sel);
  }, { timeout }, selector);
}

function clickShadowEl(page: Page, selector: string) {
  return page.evaluate((sel: string) => {
    const el = document.querySelector('#interop-outlet')?.shadowRoot?.querySelector(sel) as HTMLElement;
    if (el) el.click();
  }, selector);
}

export async function requestConnection({
  human,
  page,
  requestText,
  testMode,
  runId,
  cursor,
  debug
}: {
  human: Partial<Human>,
  page: Page,
  requestText: string | null,
  testMode: boolean,
  runId: string,
  cursor: GhostCursor,
  debug: boolean
}): Promise<boolean> {

  // Connect button can be directly visible or hidden inside "More" menu
  const directConnectSelector = 'main section a[aria-label^="Invite"]';
  const dropdownConnectSelector = 'a[role="menuitem"][href*="custom-invite"]';
  debug && console.log(`[${runId}] Looking for connect button`);

  let connectSelector = directConnectSelector;
  let connectVisible = await page.$(directConnectSelector);

  if (!connectVisible) {
    const clickedMore = await page.evaluate(() => {
      const ms = document.querySelector('main section');
      if (!ms) return false;
      const btns = Array.from(ms.querySelectorAll('button'));
      const moreBtn = btns.find(b => b.getAttribute('aria-label') === 'More' || b.textContent?.trim() === 'More');
      if (moreBtn) { (moreBtn as HTMLElement).click(); return true; }
      return false;
    });
    if (clickedMore) await wait(roughly(2000, 0.25));
    connectSelector = dropdownConnectSelector;
    await page.waitForSelector(connectSelector, { timeout: 5000 });
  }

  debug && console.log(`[${runId}] Clicking connect button`);
  await cursor.move(connectSelector);
  await wait(roughly(1000, 0.75));
  await page.evaluate((selector) => {
    const button = document.querySelector(selector) as HTMLElement;
    if (button) button.click();
  }, connectSelector);

  debug && console.log(`[${runId}] Waiting for modal to load`);
  await waitForShadowEl(page, 'button[aria-label="Add a note"]');

  debug && console.log(`[${runId}] Modal loaded, checking for email wall`);
  const hasEmailWall = await page.evaluate(() => {
    return !!document.querySelector('#interop-outlet')?.shadowRoot?.querySelector('input[name="email"]');
  });

  if (hasEmailWall) {
    if (human.linkedInProfileId) await deleteRequestFromQueue({ profileId: human.linkedInProfileId, testMode, runId, debug });
    console.log(`[${runId}] Email wall detected - request deleted from queue`);
    return false;
  }

  if (requestText) {
    debug && console.log(`[${runId}] Clicking "Add a note" button`);
    await wait(roughly(2000, 0.75));
    await clickShadowEl(page, 'button[aria-label="Add a note"]');

    debug && console.log(`[${runId}] Waiting for custom message textarea`);
    await waitForShadowEl(page, 'textarea');
    await wait(roughly(1500, 0.75));

    await page.evaluate((text: string) => {
      const textarea = document.querySelector('#interop-outlet')?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, requestText);
    await wait(roughly(1500, 0.75));
  }

  if (testMode) {
    debug && console.log(`[${runId}] Test mode - clicking dismiss button`);
    await wait(roughly(750, 0.25));
    await clickShadowEl(page, 'button[aria-label="Dismiss"]');
  } else {
    const sendLabel = requestText ? 'Send invitation' : 'Send without a note';
    debug && console.log(`[${runId}] Clicking "${sendLabel}" button`);
    await wait(roughly(750, 0.25));
    await clickShadowEl(page, `button[aria-label="${sendLabel}"]`);
  }

  debug && console.log(`[${runId}] Waiting for invitation modal to disappear`);
  await page.waitForFunction(() => {
    const shadow = document.querySelector('#interop-outlet')?.shadowRoot;
    return !shadow?.querySelector('[role="dialog"]');
  }, { timeout: 5000 });
  debug && console.log(`[${runId}] Invitation modal disappeared`);

  !human.history && (human.history = []);
  human.history.push(historySchema.parse({ comment: 'Sent connection request' }));

  return true;

}
