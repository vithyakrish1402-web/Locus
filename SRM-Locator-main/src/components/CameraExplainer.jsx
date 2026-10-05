import React, { useId } from 'react';
import { Camera } from 'lucide-react';
import { Button, Sheet } from './ui';
import { CAMERA_EXPLAINER } from '../copy/permissions';

// "Allow the camera for AR Scan": a short sheet over the map, before AR Scan opens, shown only
// until the camera has been allowed (utils/cameraPermission.js). Continue goes on to AR Scan,
// whose own start screen asks Android; Not now (or closing the sheet) doesn't open AR Scan.

/** @param {{ open: boolean, onContinue: () => void, onNotNow: () => void }} props */
export default function CameraExplainer({ open, onContinue, onNotNow }) {
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onNotNow} label={CAMERA_EXPLAINER.title}>
      <div className="px-5 pt-2 flex flex-col gap-4" data-testid="camera-explainer" aria-labelledby={titleId}>
        <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <Camera size={26} />
        </span>
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-title">{CAMERA_EXPLAINER.title}</h2>
          <p className="text-body text-text-secondary">{CAMERA_EXPLAINER.body}</p>
        </div>
        <Button block size="large" onClick={onContinue}>{CAMERA_EXPLAINER.continue}</Button>
        <Button variant="plain" block onClick={onNotNow}>{CAMERA_EXPLAINER.notNow}</Button>
      </div>
    </Sheet>
  );
}
