import React, { useEffect, useState } from 'react';
import { Button, Sheet } from './ui';
import { MEETING_POINT_CONFIRM, RALLY_CLEAR_CONFIRM } from '../copy/place';

// "Set as meeting point" asks first: it moves the meeting point on everyone's map and every
// member gets a notice. Open while `place` is set. With `clearing`, the same sheet asks before
// taking the rally point off everyone's map instead.

/**
 * @param {{ place: {name: string, description?: string} | null, onConfirm: (description: string) => void, onCancel: () => void,
 *   clearing?: boolean }} props
 */
export default function MeetingPointConfirm({ place, onConfirm, onCancel, clearing = false }) {
  const [description, setDescription] = useState('');
  useEffect(() => setDescription(place?.description || ''), [place]);
  const words = clearing ? RALLY_CLEAR_CONFIRM : MEETING_POINT_CONFIRM;
  return (
    <Sheet open={Boolean(place)} onClose={onCancel} title={place ? words.title(place.name) : ''}>
      <div className="px-4 flex flex-col gap-3">
        <p className="text-body text-text-secondary">{words.body}</p>
        {!clearing && <label className="flex flex-col gap-2 text-body">Rally point description
          <textarea aria-label="Rally point description" maxLength={160} rows={3} value={description}
            onChange={e => setDescription(e.target.value)} placeholder="e.g. Meet by the main entrance at 4 pm"
            className="rounded-xl border border-border bg-surface p-3 text-text" />
          <span className="text-caption text-text-secondary">{description.length}/160 · visible to your group</span>
        </label>}
        <Button block onClick={() => onConfirm(description.trim())}>{words.confirm}</Button>
        <Button variant="secondary" block onClick={onCancel}>{words.cancel}</Button>
      </div>
    </Sheet>
  );
}
