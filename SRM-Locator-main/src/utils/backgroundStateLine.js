import { BACKGROUND_SHARING as COPY } from '../copy/settings';

/** The one line under the switch. */
export function stateLine(status, group) {
  switch (status.state) {
    case 'running': return COPY.sharing(group);
    case 'paused': return COPY.paused;
    case 'starting': return COPY.starting;
    case 'refused': return COPY.refused[status.reason] ?? COPY.refused.other;
    case 'stopped': return COPY.stopped[status.reason] ?? COPY.stopped.other;
    default: return COPY.notSharing;
  }
}
