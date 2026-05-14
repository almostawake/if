// Scroll to the bottom of a page or container multiple times to handle infinite scroll

import { Page } from 'puppeteer';
import { roughly } from '../../helpers/util/roughly.js';
import { wait } from '../../helpers/util/wait.js';

export async function scrollToBottom({
    page,
    times = 1,
    containerSelector,
    runId,
    debug
}: {
    page: Page,
    times?: number,
    containerSelector?: string,
    runId: string,
    debug: boolean
}): Promise<void> {
    // Ensure times is at least 1
    const scrollTimes = Math.max(1, times);

    for (let i = 0; i < scrollTimes; i++) {
        // Scroll to the bottom     
        debug && console.log(`[${runId}] Scrolling to the bottom of the page ${i + 1} of ${scrollTimes}`);
        await page.evaluate(async (containerSelector) => {
            const container = containerSelector
                ? document.querySelector(containerSelector)
                : document.documentElement;

            if (!container) return;

            // Smooth scroll to bottom in small increments to mimic human behavior
            const scrollHeight = containerSelector
                ? (container as Element).scrollHeight
                : document.body.scrollHeight;

            const viewportHeight = containerSelector
                ? (container as Element).clientHeight
                : window.innerHeight;

            let lastScrollTop = containerSelector
                ? (container as Element).scrollTop
                : window.scrollY;

            // Scroll in small increments
            const stepPixels = 100;
            const stepDelay = 30;

            for (let scrolled = 0; scrolled < scrollHeight; scrolled += stepPixels) {
                if (containerSelector) {
                    container.scrollTop += stepPixels;
                } else {
                    window.scrollBy(0, stepPixels);
                }

                await new Promise(resolve => setTimeout(resolve, stepDelay));

                // Check if we've reached the bottom
                const currentScrollTop = containerSelector
                    ? (container as Element).scrollTop
                    : window.scrollY;

                // If we haven't moved or we're at the bottom, stop scrolling
                if (currentScrollTop === lastScrollTop ||
                    currentScrollTop + viewportHeight >= scrollHeight - 10) {
                    break;
                }

                lastScrollTop = currentScrollTop;
            }
        }, containerSelector);

        // Wait for content to load if we're doing multiple scrolls
        if (scrollTimes > 1 && i < scrollTimes - 1) {
            await wait(roughly(3000, 0.15));
        }
    }
} 