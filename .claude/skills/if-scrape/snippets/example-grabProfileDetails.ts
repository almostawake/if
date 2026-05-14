import { grabProfileContactDetails } from './grabProfileContactDetails.js';
import { grabProfileRoles } from './grabProfileRoles.js';
import { Page } from 'puppeteer';
import { Human, historySchema, Env } from '../types.js';
import { getTodayISODate } from '../helpers/util/getTodayISODate.js';
import { wait } from '../helpers/util/wait.js';
import { GhostCursor } from 'ghost-cursor';

export async function grabProfileDetails({
  human,
  page,
  runId,
  debug,
  env,
  cursor
}: {
  human: Partial<Human>,
  page: Page,
  runId: string,
  debug: boolean,
  env: Env,
  cursor: GhostCursor
}): Promise<void> {

  try {

    await wait(2);

    human.linkedInLastGrabbed = getTodayISODate();

    // Grab NAME
    const nameHTML = await page.$eval("main section h2",
      element => element?.textContent || null
    );
    const nameResult = nameHTML
      ? nameHTML
        .trim()
        .replace(/\s*\([^)]*\)\s*$/, '')  // Remove pronouns in parentheses
        .trim()
      : null;
    human.name = nameResult;

    // Grab DISTANCE (visible degree marker in first section, LinkedIn renders multiple but hides all but one)
    const distanceStr = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('main section p'));
      for (const p of ps) {
        const t = p.textContent?.trim() || '';
        if (/^·\s*(1st|2nd|3rd)$/.test(t) && (p as HTMLElement).getBoundingClientRect().width > 0) {
          return t.replace('· ', '');
        }
      }
      return null;
    });
    human.linkedInDistance = distanceStr;

    // Grab LOCATION (visible leaf <p> after the degree marker + headline in the first section)
    const locationStr = await page.evaluate(() => {
      const mainSection = document.querySelector('main section');
      if (!mainSection) return null;
      const ps = Array.from(mainSection.querySelectorAll('p'));
      const visibleLeafPs = ps.filter(p => p.children.length === 0 && (p as HTMLElement).getBoundingClientRect().width > 0 && p.textContent?.trim());
      let afterDegree = false;
      let skippedHeadline = false;
      for (const p of visibleLeafPs) {
        const t = p.textContent?.trim() || '';
        if (/^·\s*(1st|2nd|3rd)$/.test(t)) { afterDegree = true; continue; }
        if (afterDegree && !skippedHeadline) { skippedHeadline = true; continue; }
        if (afterDegree && skippedHeadline) return t;
      }
      return null;
    });
    human.linkedInLocation = locationStr;

    // Grab PENDING (changed from button to anchor tag)
    const isPending = !!(await page.$('a[aria-label^="Pending"]')
      .catch(() => null));
    human.linkedInPendingConnectionRequest = isPending;

    // Grab ROLES
    await grabProfileRoles({ human, page, runId, debug, env });


    // Grab CONTACT DETAILSx
    await grabProfileContactDetails({ human, page, cursor, debug, runId });

    // Record the grab, allowing for null history
    !human.history && (human.history = []);
    human.history.push(historySchema.parse({ comment: 'Grabbed profile' }));

    console.log(`[${runId}] Grabbed profile details`);

  } catch (error) {
    throw new Error(`[${runId}] Failed to grab profile details - ${error instanceof Error ? error.message : String(error)}`);
  }
} 