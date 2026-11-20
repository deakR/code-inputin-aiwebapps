/**
 * Content script entry point.
 *
 * The manifest injects this only on supported hosts (and on the local test
 * fixtures). The registry turns the hostname into an adapter; the adapter is a
 * set of hints, and the detector in `./dom` still works without it.
 */
import { getAdapterForPage } from '../sites/registry';
import { start } from './panel';

interface InjectedWindow extends Window {
  __gciStarted?: boolean;
}

const scope = window as InjectedWindow;
const adapter = getAdapterForPage();

if (adapter && !scope.__gciStarted) {
  scope.__gciStarted = true;
  try {
    start(adapter);
  } catch (error) {
    console.error('[gci] failed to start', error);
  }
}
