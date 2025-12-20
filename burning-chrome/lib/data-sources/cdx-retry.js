// CDX retry and error handling utilities

import { storage } from '../storage.js';
import { MAX_RETRIES, CDX_TIMEOUT_MS } from './cdx-constants.js';
import { addDebug, getDebugLog } from './cdx-debug.js';

/**
 * Handle rate limit response with exponential backoff
 * @param {Function} retryFn - Function to call for retry
 * @param {number} retryCount - Current retry attempt
 * @param {number} status - HTTP status code
 */
export async function handleRateLimit(retryFn, retryCount, status) {
  if (retryCount < MAX_RETRIES) {
    const backoff = Math.pow(2, retryCount) * 10000;
    addDebug(`Rate limited (${status}), waiting ${backoff}ms...`);
    await cancellableSleep(backoff);
    return retryFn(retryCount + 1);
  }
  const err = new Error(`Rate limited after ${MAX_RETRIES} retries`);
  err.debugLog = getDebugLog();
  throw err;
}

/**
 * Handle fetch errors with retry logic
 * @param {Error} error - The error that occurred
 * @param {Function} retryFn - Function to call for retry
 * @param {number} retryCount - Current retry attempt
 * @param {number} elapsed - Time elapsed in ms
 * @param {boolean} wasCancelled - Whether user cancelled
 */
export async function handleFetchError(error, retryFn, retryCount, elapsed, wasCancelled) {
  if (error.name === 'AbortError') {
    if (wasCancelled) {
      addDebug(`Cancelled by user after ${elapsed}ms`);
      const err = new Error('Cancelled by user');
      err.cancelled = true;
      err.debugLog = getDebugLog();
      throw err;
    }

    addDebug(`TIMEOUT after ${elapsed}ms (limit: ${CDX_TIMEOUT_MS}ms)`);
    if (retryCount < MAX_RETRIES) {
      const backoff = Math.pow(2, retryCount) * 5000;
      addDebug(`Will retry in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await cancellableSleep(backoff);
      return retryFn(retryCount + 1);
    }
    addDebug(`FAILED - exhausted all ${MAX_RETRIES} retries`);
    const err = new Error(`Request timed out after ${MAX_RETRIES} retries (${CDX_TIMEOUT_MS / 1000}s timeout each)`);
    err.debugLog = getDebugLog();
    throw err;
  }

  if (retryCount < MAX_RETRIES && error.name === 'TypeError') {
    addDebug(`Network error after ${elapsed}ms: ${error.message}`);
    const backoff = Math.pow(2, retryCount) * 5000;
    addDebug(`Will retry in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    await cancellableSleep(backoff);
    return retryFn(retryCount + 1);
  }

  addDebug(`ERROR: ${error.name}: ${error.message}`);
  addDebug(`Elapsed: ${elapsed}ms`);
  error.debugLog = error.debugLog || getDebugLog();
  throw error;
}

/**
 * Sleep that checks for user cancellation during wait
 * @param {number} ms - Milliseconds to sleep
 */
export async function cancellableSleep(ms) {
  const checkInterval = 250;
  const iterations = Math.ceil(ms / checkInterval);
  for (let i = 0; i < iterations; i++) {
    await new Promise(resolve => setTimeout(resolve, Math.min(checkInterval, ms - i * checkInterval)));
    const data = await storage.get('timemapData');
    if (data?.cancelled) {
      addDebug('Cancelled during backoff wait');
      const err = new Error('Cancelled by user');
      err.cancelled = true;
      err.debugLog = getDebugLog();
      throw err;
    }
  }
}

