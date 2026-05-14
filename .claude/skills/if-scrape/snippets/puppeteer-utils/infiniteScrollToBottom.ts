import { Env } from '../../types.js';
import { Page } from 'puppeteer';
import { roughly } from '../../helpers/util/roughly.js';
import { wait } from '../../helpers/util/wait.js';
import { GhostCursor } from "ghost-cursor";

// Ghost cursor is a CommonJS module, so we need to import it like this
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCursor } = require("ghost-cursor");

export async function infiniteScrollToBottom({
    loadableItemSelector,
    startingCursorCoordinates,
    page,
    cursor,
    env,
    runId,
    testMode,
    debug
}: {
    loadableItemSelector: string,
    startingCursorCoordinates?: { x: number, y: number },
    page: Page,
    cursor: GhostCursor,
    env: Env,
    runId: string,
    testMode: boolean,
    debug: boolean
}): Promise<number | void> {

    const maxScrollAttempts = 50;
    let scrollAttempts = 0;
    let previousCount = 0;
    let currentCount = 0;



    debug && console.log(`[${runId}] Starting infinite scroll to bottom for selector: ${loadableItemSelector}`);

    do {
        previousCount = currentCount;
        const elements = await page.$$(loadableItemSelector);
        currentCount = elements.length;

        if (startingCursorCoordinates) {
            const randomizedX = roughly(startingCursorCoordinates.x, 0.2);
            const randomizedY = roughly(startingCursorCoordinates.y, 0.2);
            debug && console.log(`[${runId}] Moving cursor to randomized coordinates: ${randomizedX}, ${randomizedY}`);
            await cursor.moveTo({ x: randomizedX, y: randomizedY });
        }

        debug && console.log(`[${runId}] Scroll attempt ${scrollAttempts + 1}: Found ${currentCount} items before scrolling`);

        await cursor.scrollTo("bottom", { scrollSpeed: 25 });
        await wait(roughly(1000, 0.25));
        await cursor.scrollTo("bottom", { scrollSpeed: 25 });
        await wait(roughly(1000, 0.25));
        await cursor.scrollTo("bottom", { scrollSpeed: 25 });

        scrollAttempts++;

        if (scrollAttempts >= maxScrollAttempts) {
            console.log(`[${runId}] Reached maximum scroll attempts (${maxScrollAttempts}), stopping infinite scroll`);
            break;
        }

    } while (currentCount > previousCount);

    debug && console.log(`[${runId}] Infinite scroll completed after ${scrollAttempts} attempts. Final count: ${currentCount}`);

    if (debug) {
        return currentCount;
    }
} 