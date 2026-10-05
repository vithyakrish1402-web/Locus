import React from 'react';
import { Button, Sheet } from './ui';
import { MEETING_POINT_CONFIRM } from '../copy/place';

// "Set as meeting point" asks first: it moves the meeting point on everyone's map and every
// member gets a notice. Open while `place` is set.

/**
 * @param {{ place: {name: string} | null, onConfirm: () => void, onCancel: () => void }} props
 */
export default function MeetingPointConfirm({ place, onConfirm, onCancel }) {
  return (
    <Sheet open={Boolean(place)} onClose={onCancel} title={place ? MEETING_POINT_CONFIRM.title(place.name) : ''}>
      <div className="px-4 flex flex-col gap-3">
        <p className="text-body text-text-secondary">{MEETING_POINT_CONFIRM.body}</p>
        <Button block onClick={onConfirm}>{MEETING_POINT_CONFIRM.confirm}</Button>
        <Button variant="secondary" block onClick={onCancel}>{MEETING_POINT_CONFIRM.cancel}</Button>
      </div>
    </Sheet>
  );
}
