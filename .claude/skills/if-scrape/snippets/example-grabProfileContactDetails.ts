import { Page } from 'puppeteer';
import { GhostCursor } from 'ghost-cursor';
import { Human } from '../types.js';
import { getISODateFromConnectedDate } from './utils/getISODateFromConnectedDate.js';
import { roughly } from '../helpers/util/roughly.js';
import { wait } from '../helpers/util/wait.js';

// Extracts contact details from LinkedIn profile's "Contact info" dialog overlay
export async function grabProfileContactDetails({ human, page, cursor, debug, runId }: {
  human: Partial<Human>,
  page: Page,
  cursor: GhostCursor,
  debug: boolean,
  runId: string
}): Promise<void> {

  const dismissButtonSelector = 'dialog button[aria-label="Dismiss"]';

  const contactInfoSelector = 'a[href*="overlay/contact-info"]';
  await page.waitForSelector(contactInfoSelector);
  await cursor.move(contactInfoSelector);
  debug && console.log(`[${runId}] Clicking the contact info element to open the contact info dialog`);
  await page.click(contactInfoSelector);

  debug && console.log(`[${runId}] Waiting for the contact info dialog to load`);
  await wait(roughly(3000, 0.15));
  await page.waitForSelector('dialog');

  const contactData = await page.evaluate(() => {
    const dialog = document.querySelector('dialog');
    if (!dialog) return null;

    const leafEls = Array.from(dialog.querySelectorAll('*')).filter(el =>
      el.children.length === 0 && el.textContent?.trim() && (el as HTMLElement).getBoundingClientRect().width > 0
    );

    const items: { label: string | null, tag: string, text: string }[] = [];
    let currentLabel: string | null = null;

    for (const el of leafEls) {
      const tag = el.tagName;
      const text = el.textContent!.trim();
      if (tag === 'H2') continue;
      if (tag === 'P') { currentLabel = text; continue; }
      items.push({ label: currentLabel, tag, text });
    }

    return items;
  });

  if (contactData) {
    for (const item of contactData) {

      if (item.label?.endsWith('profile') && item.tag === 'A') {
        const newProfileId = item.text.split('/').pop()?.replace(/\/$/, '');
        if (newProfileId && newProfileId !== human.linkedInProfileId) {
          human.linkedInOldProfileId = human.linkedInProfileId;
          human.linkedInProfileId = newProfileId;
        }
      }

      if (item.label === 'Website') {
        if (!human.linkedInWebsites) human.linkedInWebsites = [];
        human.linkedInWebsites.push({ url: item.text, type: '' });
      }

      if (item.label === 'Phone') {
        human.linkedInPhone = item.text;
      }

      if (item.label === 'Email' && item.tag === 'A') {
        human.linkedInEmail = item.text;
      }

      if (item.label === 'Birthday') {
        const [month, day] = item.text.split(' ');
        const monthNum = new Date(`${month} 1`).getMonth() + 1;
        human.linkedInBirthday = `${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      if (item.label === 'Connected since') {
        human.linkedInConnectedDate = getISODateFromConnectedDate(item.text);
      }
    }
  }

  await wait(roughly(2000, 0.25));

  await cursor.move(dismissButtonSelector);
  await page.click(dismissButtonSelector);
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
}