import React, { useId } from 'react';
import { MapPin } from 'lucide-react';
import { Button, Sheet } from './ui';
import { LOCATION_EXPLAINER } from '../copy/permissions';

// "Allow location": a short sheet over the map before LOCUS first asks Android for location,
// once you are in a group, shown only until location has been allowed (utils/
// locationPermission.js). Continue lets the app ask; Not now (or closing the sheet) leaves
// location off, with the map's "Location is off" card to turn it on later. Until then
// nothing is shared: the group doesn't see you on their map.

/** @param {{ open: boolean, onContinue: () => void, onNotNow: () => void }} props */
export default function LocationExplainer({ open, onContinue, onNotNow }) {
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onNotNow} label={LOCATION_EXPLAINER.title}>
      <div className="px-5 pt-2 flex flex-col gap-4" data-testid="location-explainer" aria-labelledby={titleId}>
        <span className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <MapPin size={26} />
        </span>
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-title">{LOCATION_EXPLAINER.title}</h2>
          <p className="text-body text-text-secondary">{LOCATION_EXPLAINER.body}</p>
        </div>
        <Button block size="large" onClick={onContinue}>{LOCATION_EXPLAINER.continue}</Button>
        <Button variant="plain" block onClick={onNotNow}>{LOCATION_EXPLAINER.notNow}</Button>
      </div>
    </Sheet>
  );
}
