import React from 'react';
import { Button, Sheet } from './ui';
import { MEETING_POINT_CONFIRM, RALLY_CLEAR_CONFIRM } from '../copy/place';

// "Set as meeting point" asks first: it moves the meeting point on everyone's map and every
// member gets a notice. Open while `place` is set. With `clearing`, the same sheet asks before
// taking the rally point off everyone's map instead.

/**
 * @param {{ place: {name: string} | null, onConfirm: () => void, onCancel: () => void,
 *   clearing?: boolean }} props
 */
export default function MeetingPointConfirm({ place, onConfirm, onCancel, clearing = false }) {
  const words = clearing ? RALLY_CLEAR_CONFIRM : MEETING_POINT_CONFIRM;
  return (
    <Sheet open={Boolean(place)} onClose={onCancel} title={place ? words.title(place.name) : ''}>
      <div className="px-4 flex flex-col gap-3">
        <p className="text-body text-text-secondary">{words.body}</p>
        <Button block onClick={onConfirm}>{words.confirm}</Button>
        <Button variant="secondary" block onClick={onCancel}>{words.cancel}</Button>
      </div>
    </Sheet>
  );
}
