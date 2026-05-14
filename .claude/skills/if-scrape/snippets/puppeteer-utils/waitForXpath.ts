import { ElementHandle, Page } from 'puppeteer';

export async function puppeteerWaitForXpath(
    page: Page,
    xpath: string,
    timeout = 5000
): Promise<ElementHandle | null> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const elementHandle = (await page.evaluateHandle((xpath) => {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
            return result || null;
        }, xpath)) as ElementHandle<Element>;

        if (elementHandle && (await elementHandle.jsonValue()) !== null) {
            return elementHandle;
        }

        await new Promise((resolve) => setTimeout(resolve, 100)); // Polling interval of 100ms
    }

    console.error(`Element not found for xpath: ${xpath}`);
    return null;
} 