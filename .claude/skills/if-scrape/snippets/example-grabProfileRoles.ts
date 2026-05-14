import { Page } from 'puppeteer';
import { Human, Role, Env } from '../types.js';

/*
 * Extracts current roles from a LinkedIn profile's Experience section.
 * Finds "Present" text in the Experience section, walks up to the role container
 * (identified by having a company link), then extracts position and company from
 * the first two visible <p> elements.
 */
export async function grabProfileRoles({ human, page, runId, debug, env }: { human: Partial<Human>, page: Page, runId: string, debug: boolean, env: Env }): Promise<void> {

  const linkedInPresentRoles: Role[] = await page.evaluate(() => {
    const roles: { position: string, company: string, mode: string | null, companyId: string | null }[] = [];

    // Find Experience section by h2 text
    const allH2s = Array.from(document.querySelectorAll('h2'));
    const expH2 = allH2s.find(h => h.textContent?.trim() === 'Experience');
    if (!expH2) return roles;

    const expSection = expH2.closest('section');
    if (!expSection) return roles;

    // Find all visible leaf elements containing " - Present"
    const allEls = Array.from(expSection.querySelectorAll('*'));
    const presentEls = allEls.filter(el =>
      el.textContent?.includes(' - Present') &&
      el.children.length === 0 &&
      (el as HTMLElement).getBoundingClientRect().width > 0
    );

    for (const presentEl of presentEls) {
      // Walk up to find a container that has a company link
      let container: HTMLElement = presentEl as HTMLElement;
      for (let i = 0; i < 10; i++) {
        if (!container.parentElement) break;
        container = container.parentElement;
        if (container.querySelector('a[href*="/company/"]')) break;
      }

      // Extract company ID from the company link
      const companyLink = container.querySelector('a[href*="/company/"]');
      const companyHref = companyLink?.getAttribute('href') || '';
      const companyIdMatch = companyHref.match(/\/company\/(\d+)/);
      const companyId = companyIdMatch?.[1] || null;

      // Get visible leaf <p> elements — first is position, second is company · mode
      const leafPs = Array.from(container.querySelectorAll('p')).filter(p =>
        p.children.length === 0 &&
        (p as HTMLElement).getBoundingClientRect().width > 0 &&
        p.textContent?.trim()
      );

      if (leafPs.length >= 2) {
        const position = leafPs[0].textContent!.trim().split(' · ')[0];
        const companyAndMode = leafPs[1].textContent!.trim();
        const [company, mode] = companyAndMode.split(' · ').map(s => s.trim());

        roles.push({ position, company, mode: mode || null, companyId });
      }
    }

    return roles;
  });

  debug && console.log(`[${runId}] ${linkedInPresentRoles.length} roles found`);
  human.linkedInPresentRoles = linkedInPresentRoles;
}