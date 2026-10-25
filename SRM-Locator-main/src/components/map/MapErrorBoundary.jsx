import React from 'react';
import { Button } from '../ui';
import { MAP_PROBLEM } from '../../copy/map';

// How many times a crashed map is put back on its own before anything else is tried.
export const MAP_AUTO_RETRY_MAX = 1;
// The pause before each automatic retry, so a map that crashes at once does not spin.
export const MAP_ERROR_COOLDOWN_MS = 1500;

/**
 * Catches a crash in the map engines only, so the rest of the app (bottom bar, SOS button,
 * group sheet, notices) keeps working. The app-wide ErrorBoundary is still the last resort for
 * anything else. First crash: the map is put back (remounted) after a short pause. Next crash:
 * the other engine, once, if `onSwitchEngine` can offer one. After that, a Retry button; no
 * more automatic tries.
 * @param {{ onCrash?: (error: Error, failures: number) => void,
 *   onSwitchEngine?: () => boolean, onRemount?: () => void, children: React.ReactNode }} props
 *   onSwitchEngine: switches to the other engine and says whether it could
 *   onRemount: just before the map is put back
 */
export default class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, retrying: false, generation: 0 };
    this.failures = 0;
    this.timer = null;
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error) {
    this.failures += 1;
    this.props.onCrash?.(error, this.failures);
    clearTimeout(this.timer);
    const again = this.failures <= MAP_AUTO_RETRY_MAX
      || (this.failures === MAP_AUTO_RETRY_MAX + 1 && this.props.onSwitchEngine?.() === true);
    this.setState({ retrying: again });
    if (again) this.timer = setTimeout(this.remount, MAP_ERROR_COOLDOWN_MS);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  remount = () => {
    clearTimeout(this.timer);
    this.props.onRemount?.();
    this.setState((s) => ({ crashed: false, retrying: false, generation: s.generation + 1 }));
  };

  render() {
    if (!this.state.crashed) {
      // A new key each time, so a retry is a fresh map, never the one that crashed.
      return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
    }
    return (
      <div data-testid="map-problem" className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div role="alert" className="pointer-events-auto rounded-card glass-panel text-text font-ui p-4 flex flex-col items-center gap-3 shadow-md">
          <p className="text-label">{this.state.retrying ? MAP_PROBLEM.retrying : MAP_PROBLEM.stopped}</p>
          {!this.state.retrying && <Button variant="tonal" onClick={this.remount}>{MAP_PROBLEM.retry}</Button>}
        </div>
      </div>
    );
  }
}
