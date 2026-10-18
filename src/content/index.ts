/**
 * Content script entry point.
 *
 * Runs on gemini.google.com, and on the local test fixtures so the UI can be
 * exercised without an account.
 */
import { start } from './panel';

const hostname = location.hostname;
const isGemini = /(^|\.)gemini\.google\.com$/i.test(hostname);
const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
const isFixture = isLocal && location.pathname.includes('/fixtures/');

interface InjectedWindow extends Window {
  __gciStarted?: boolean;
}

const scope = window as InjectedWindow;

if ((isGemini || isFixture) && !scope.__gciStarted) {
  scope.__gciStarted = true;
  try {
    start();
  } catch (error) {
    console.error('[gemini-code-input] failed to start', error);
  }
}
