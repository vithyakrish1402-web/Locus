import React, { useState } from 'react';
import { useFloor7Trail } from '../../hooks/useFloor7Trail.js';
import { startWalk } from '../../utils/floor7Guided.js';
import { recorder } from '../../utils/floor7Recorder.js';
import PreviousRecordings from './PreviousRecordings';
import ReadyCheck from './ReadyCheck';
import ResultsScreen from './ResultsScreen';
import WalkingScreen from './WalkingScreen';

/**
 * The guided Floor 7 walk test: A ready check, B walking, C results (and the list of earlier
 * walks). The recorder underneath is the one that was already there; this only drives it.
 * If a recording is running when it opens (the screen was closed mid-walk), it goes back to B.
 */
export default function WalkTest({ rec = recorder, inGroup, lastCycle, onBack }) {
  const trail = useFloor7Trail();
  const [view, setView] = useState('ready');
  const [walk, setWalk] = useState(null);
  const [result, setResult] = useState(null); // { id, report }
  const running = rec.recording && walk;

  const stop = async () => {
    const out = await rec.stop();
    setResult(out && { id: out.id, report: out.report });
    setView('results');
  };
  const begin = (doors) => {
    rec.start();
    setWalk(startWalk(doors));
    setView('walking');
  };

  if (running || view === 'walking') {
    return walk ? <WalkingScreen rec={rec} walk={walk} setWalk={setWalk} trail={trail} onStop={stop} /> : null;
  }
  if (view === 'results' && result) {
    return (
      <ResultsScreen
        id={result.id}
        report={result.report}
        trail={trail}
        onShare={() => rec.share(result.id)}
        onDownloads={() => rec.saveToDownloads(result.id)}
        onAnother={() => { setResult(null); setWalk(null); setView('ready'); }}
        onPrevious={() => setView('previous')}
        onBack={onBack}
        backLabel="Close"
      />
    );
  }
  if (view === 'previous') return <PreviousRecordings rec={rec} trail={trail} onBack={() => setView(result ? 'results' : 'ready')} />;
  return <ReadyCheck inGroup={inGroup} lastCycle={lastCycle} trail={trail} onStart={begin} onBack={onBack} onPrevious={() => setView('previous')} />;
}
