import { Human, connectionRequestSchema, historySchema } from '../types.js';
import { getTodayISODate } from '../helpers/util/getTodayISODate.js';
import { createPage } from './puppeteer-utils/createPage.js';
import { requestConnection } from './requestConnection.js';
import { grabProfileDetails } from './grabProfileDetails.js';
import { getThisWeeksRequestCount } from '../db/request/getThisWeeksRequestCount.js';
import { getTodaysRequestCount } from '../db/request/getTodaysRequestCount.js';
import { parseTags } from '../helpers/util/parseTags.js';
import { deleteRequestFromQueue } from '../db/request/deleteRequestFromQueue.js';
import { addHuman } from '../db/human/addHuman.js';
import { getExistingProfileIds } from '../db/human/getExistingProfileIds.js';
import { getRequestQueue } from '../db/request/getRequestQueue.js';
import { getValidProfilePage } from './getValidProfilePage.js';
import { type Env } from '../types.js';
import { loginIfNecessary } from './puppeteer-utils/loginIfNecessary.js';
import { scrollDownABitAndBack } from './puppeteer-utils/scrollDownABitAndBack.js';
import { wait } from '../helpers/util/wait.js';
import { roughly } from '../helpers/util/roughly.js';
import { createCursor } from 'ghost-cursor';
import { saveCookies } from '../db/user/saveCookies.js';

export async function useRemainingRequests({
  runId,
  env,
  testMode,
  debug,
  qty,
}: {
  runId: string,
  env: Env,
  testMode: boolean,
  debug: boolean,
  qty?: number,
}) {

  console.log(`[${runId}] ========== requestConnections ============`);

  // List of existing profile IDs (current and old) from the database
  const existingProfileIds = await getExistingProfileIds({ runId });

  // Figure out how many requests to make today, if any
  // LinkedIn limits: 20 per day, 100 per week (assuming Sales Navigator)
  let requestsToMakeNow = 0;
  const dailyLimit = 20;
  const weeklyLimit = 100;

  const thisWeeksRequestsCount = await getThisWeeksRequestCount({ runId });
  const todaysRequestsCount = await getTodaysRequestCount({ runId });

  // Check if weekly limit already reached
  if (thisWeeksRequestsCount >= weeklyLimit) {
    console.log(`[${runId}] Weekly limit already reached (${thisWeeksRequestsCount}/${weeklyLimit})`);
    return 0;
  }

  // Check if daily limit already reached
  if (todaysRequestsCount >= dailyLimit) {
    console.log(`[${runId}] Daily limit already reached (${todaysRequestsCount}/${dailyLimit})`);
    return 0;
  }

  // Calculate how many requests we will make now
  // Take the minimum of: remaining daily, remaining weekly, and environment limit
  const remainingDaily = dailyLimit - todaysRequestsCount;
  const remainingWeekly = weeklyLimit - thisWeeksRequestsCount;
  requestsToMakeNow = Math.min(remainingDaily, remainingWeekly, env.LINKEDIN_MAX_DAILY_REQUESTS, ...(qty ? [qty] : []));

  console.log(`[${runId}] Today: ${todaysRequestsCount}/${dailyLimit} | Week: ${thisWeeksRequestsCount}/${weeklyLimit} | Env limit: ${env.LINKEDIN_MAX_DAILY_REQUESTS} | Will make: ${requestsToMakeNow}`);

  // Get pending requests from queue, ordered by urgency
  const pendingRequests = await getRequestQueue({ runId });
  if (pendingRequests.length === 0) {
    throw new Error(`[${runId}] ACTION_SEND_SMS: No pending requests in queue`);
  } else {
    console.log(`[${runId}] ${pendingRequests.length} pending requests in queue`);
  }

  debug && console.log(`[${runId}] env: ${JSON.stringify(env)}`);

  debug && console.log(`[${runId}] Creating page`);

  const { page, browser } = await createPage({ cookies: env.LINKEDIN_COOKIES || [], isCloud: env.IS_CLOUD, runId, debug });

  debug && console.log(`[${runId}] Page created`);

  try {

    // Counters
    let processedRequests = 0;
    let successfulRequests = 0;

    // Check if we need to login, do that if necessary
    debug && console.log(`[${runId}] Logging in if necessary`);
    await loginIfNecessary({ page, runId, debug, testMode, env });
    debug && console.log(`[${runId}] Logged in if necessary`);

    // Use ghost cursor to move the "mouse" around a bit once we load the page
    debug && console.log(`[${runId}] Creating cursor`);
    const cursor = createCursor(page as any, undefined, true);
    debug && console.log(`[${runId}] Cursor created`);


    for (const request of pendingRequests) {

      processedRequests++;

      // Stop if we've reached the daily limit
      if (successfulRequests >= requestsToMakeNow) {
        console.log(`[${runId}] `);
        console.log(`[${runId}] Reached our limit, stopping`);
        break;
      }

      console.log(`[${runId}] -------------- Starting #${processedRequests} --------------`);
      console.log(`[${runId}] Processing request: ${request.profileId}`);

      // If the profile is already in the database, skip it and delete from queue
      if (existingProfileIds.has(request.profileId)) {
        console.log(`[${runId}] Already in database`);
        await deleteRequestFromQueue({ profileId: request.profileId, testMode, runId, debug });     // Delete from queue
        continue;
      }

      // Create a human to store the profile details etc
      let human: Partial<Human> = { linkedInProfileId: request.profileId };
      human.test = testMode;

      const profilePageLoaded = await getValidProfilePage({ page, profileId: request.profileId, testMode, runId, debug });
      if (!profilePageLoaded) continue; // 404 or network error <- soft fail, just skip this one

      debug && console.log(`[${runId}] Profile Page Loaded`);

      // Move the cursor twice, hopefully in main content area
      await cursor.moveTo({ x: roughly(350, 0.50), y: roughly(350, 0.50) });
      await wait(roughly(1000, 0.75));
      await cursor.moveTo({ x: roughly(780, 0.25), y: roughly(550, 0.25) });

      // Scroll down a bit and back
      await wait(roughly(2000, 0.75));
      await scrollDownABitAndBack({ page, pixels: roughly(500, 0.75) });

      // Grab the profile details from the current page
      await grabProfileDetails({ human, page, runId, debug, env, cursor });

      // Already connected, just ignore it for now - one day we'll figure out how to handle this
      if (human.linkedInDistance === "1st") {
        console.log(`[${runId}] Already connected, skipping`);
        await deleteRequestFromQueue({ profileId: request.profileId, testMode, runId, debug });
        continue;
      }

      // Pending connection request, just ignore it for now - one day we'll figure out how to handle this
      if (human.linkedInPendingConnectionRequest) {
        console.log(`[${runId}] Pending connection request, skipping`);
        await deleteRequestFromQueue({ profileId: request.profileId, testMode, runId, debug });
        continue;
      }

      // Try to send a connection request
      try {

        debug && console.log(`[${runId}] Requesting connection`);

        const requestSent = await requestConnection({ human, page, requestText: request.requestText, testMode, runId, cursor, debug });

        if (!requestSent) continue; // Email wall detected, deleted from queue automatically

      } catch (error) {

        throw new Error(`[${runId}] ACTION_SEND_SMS: ${request.profileId} : Failed to send connection request - ${error instanceof Error ? error.message : String(error)}`);

      }

      console.log(`[${runId}] Request ${testMode ? 'simulated' : 'sent'}`);

      // Record the connection request
      const connectionRequest = connectionRequestSchema.parse({
        requestText: request.requestText
      });
      human.linkedInConnectionRequests = [connectionRequest];

      // Add tags from the request, merging with any existing tags
      if (request.tags) {
        const newTags = parseTags(request.tags);
        human.tags = Array.from(new Set([...(human.tags || []), ...newTags]));
      }

      // Set firstContactDate to today
      human.firstContactDate = getTodayISODate();

      // Set linkedInPendingConnectionRequest to true
      human.linkedInPendingConnectionRequest = true;

      // Write Human to database
      await addHuman({ human, runId });
      existingProfileIds.add(human.linkedInProfileId || '');


      // Delete request from queue
      await deleteRequestFromQueue({ profileId: request.profileId, testMode, runId, debug });

      // Increment the counter after successful processing
      successfulRequests++;

    }

    console.log(`[${runId}] `);
    console.log(`[${runId}] RETURNING TO SCRIPT/HTTPFUNCTION`);

    return 0;

  } catch (error) {

    console.log(`[${runId}] ACTION_SEND_SMS: Unexpected issue: ${error instanceof Error ? error.message : String(error)}`);

  } finally {

    // Close the browser
    saveCookies(env, page, runId, debug, testMode);
    console.log(`[${runId}] CLOSING BROWSER`);
    await browser.close();
  }
}
