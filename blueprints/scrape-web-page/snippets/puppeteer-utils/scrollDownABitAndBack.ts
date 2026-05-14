// Use puppeteer to verticlaly scrollBy supplied pixels.

import { Page } from 'puppeteer';

export async function scrollDownABitAndBack({
    page,
    pixels,
    containerSelector
}: {
    page: Page,
    pixels: number,
    containerSelector?: string
}) {
    const stepPixels = 25;
    const stepDelay = 10;

    await page.evaluate(async ({ pixels, stepPixels, stepDelay, containerSelector }) => {
        const container = containerSelector
            ? document.querySelector(containerSelector)
            : document.documentElement;

        if (!container) return;

        for (let scrolled = 0; scrolled < pixels; scrolled += stepPixels) {
            if (containerSelector) {
                container.scrollTop += stepPixels;
            } else {
                window.scrollBy(0, stepPixels);
            }
            await new Promise(resolve => setTimeout(resolve, stepDelay));
        }

        await new Promise(resolve => setTimeout(resolve, 750 + Math.random() * 500));

        for (let scrolled = pixels; scrolled > 0; scrolled -= stepPixels) {
            if (containerSelector) {
                container.scrollTop -= stepPixels;
            } else {
                window.scrollBy(0, -stepPixels);
            }
            await new Promise(resolve => setTimeout(resolve, stepDelay));
        }
    }, { pixels, stepPixels, stepDelay, containerSelector });
}