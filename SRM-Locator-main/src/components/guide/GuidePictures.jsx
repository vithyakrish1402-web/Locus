import React from 'react';
import { Flag } from 'lucide-react';
import { Avatar } from '../ui';
import { GUIDE } from '../../copy/guide';

// The guide's five pictures (redesign P11), drawn from the app's own parts and tokens so they
// follow the theme. Pictures only: everything in them is aria-hidden, and the step's title
// and sentence say what they show.

const P = GUIDE.picture;

/** Step 1: you and two others, and a group code. */
export function GroupPicture() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center">
        <Avatar name="Meera Iyer" className="w-16 h-16 text-title bg-surface" />
        <span className="-mx-3 z-10 inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent text-accent-on text-label border-2 border-surface">{P.you}</span>
        <Avatar name="Aarav Shah" className="w-16 h-16 text-title bg-surface" />
      </div>
      <div className="flex gap-2">
        {P.code.split('').map((c, i) => (
          <span key={i} className="inline-flex items-center justify-center w-10 h-12 rounded-input bg-raised shadow-[var(--shadow-1)] text-title">{c}</span>
        ))}
      </div>
    </div>
  );
}

/** Step 2: a small map with you, two members, one paused, a meeting point and your route. */
export function MapPicture() {
  return (
    <svg viewBox="0 0 350 340" className="w-full h-full" role="presentation">
      <rect width="350" height="340" fill="var(--map-land)" />
      <rect x="165" y="95" width="120" height="80" rx="14" fill="var(--map-green)" />
      <path d="M0 225 L350 205" stroke="var(--map-road)" strokeWidth="16" />
      <path d="M135 0 L135 340" stroke="var(--map-road)" strokeWidth="16" />
      <path d="M30 0 L30 340" stroke="var(--map-road)" strokeWidth="12" />
      <rect x="160" y="250" width="70" height="40" rx="6" fill="var(--map-block)" />
      <rect x="250" y="250" width="70" height="40" rx="6" fill="var(--map-block)" />
      <rect x="55" y="40" width="60" height="45" rx="6" fill="var(--map-block)" />
      {/* Your route to the meeting point. */}
      <path d="M135 205 L135 72 L245 10" fill="none" stroke="var(--map-casing)" strokeWidth="9" strokeLinejoin="round" />
      <path d="M135 205 L135 72 L245 10" fill="none" stroke="var(--color-accent)" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="135" cy="205" r="32" fill="var(--color-accent-halo)" />
      <circle cx="135" cy="205" r="11" fill="var(--color-accent)" stroke="var(--map-casing)" strokeWidth="3" />
      <foreignObject x="0" y="0" width="350" height="340">
        <div className="relative w-full h-full font-ui">
          <span className="absolute" style={{ left: 197, top: 100 }}>
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--map-meeting)] text-bg"><Flag size={16} /></span>
          </span>
          <span className="absolute flex flex-col items-center gap-1" style={{ left: 60, top: 92 }}>
            <Avatar name="Meera Iyer" size="map" />
          </span>
          <span className="absolute flex flex-col items-center gap-1" style={{ left: 280, top: 60 }}>
            <Avatar name="Aarav Shah" size="map" />
          </span>
          <span className="absolute flex flex-col items-center gap-1" style={{ left: 60, top: 250 }}>
            <Avatar name="Rohan Das" size="map" dashed />
          </span>
          <span className="absolute rounded-full bg-[var(--map-plate)] px-2 py-0.5 text-caption text-text shadow-[var(--shadow-1)]" style={{ left: 150, top: 145 }}>{P.meetingPoint}</span>
        </div>
      </foreignObject>
    </svg>
  );
}

/** Step 3: an AR Scan label and the arrow toward it. */
export function ArPicture() {
  return (
    <div className="flex flex-col items-center gap-10">
      <span className="inline-flex items-center gap-3 rounded-input bg-raised border-2 border-accent px-4 py-2 shadow-[var(--shadow-2)]">
        <span className="w-6 h-6 rounded-full bg-accent" />
        <span className="flex flex-col leading-tight">
          <span className="text-label text-text">{P.place}</span>
          <span className="text-secondary text-text-secondary">{P.placeDistance}</span>
        </span>
      </span>
      <svg viewBox="0 0 100 80" className="w-28" role="presentation">
        <polygon points="50,6 92,60 64,52 50,76 36,52 8,60" fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth="4" strokeLinejoin="round" transform="rotate(30 50 45)" />
      </svg>
    </div>
  );
}

/** Step 4: Live, Paused and Hidden, with Live chosen, and the sharing chip. */
export function SharingPicture() {
  return (
    <div className="flex flex-col items-center gap-4 w-full px-4">
      <span className="flex w-full max-w-xs p-1 rounded-full bg-surface shadow-[var(--shadow-1)]">
        {P.modes.map((mode, i) => (
          <span key={mode} className={`flex-1 text-center rounded-full py-2 text-label ${i === 0 ? 'bg-accent text-accent-on' : 'text-text-secondary'}`}>{mode}</span>
        ))}
      </span>
      <span className="inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-label text-text shadow-[var(--shadow-1)]">
        <span className="w-2.5 h-2.5 rounded-full bg-success" />
        {P.sharing}
      </span>
    </div>
  );
}

/** Step 5: the SOS button part-way through its hold, and the two holds. */
export function EmergencyPicture() {
  // The ring as it fills during a hold: 70 % round.
  const r = 52;
  const around = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-6">
      <span className="relative inline-flex items-center justify-center w-32 h-32">
        <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" role="presentation">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-danger-soft)" strokeWidth="6" />
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-danger)" strokeWidth="6" strokeDasharray={`${around * 0.7} ${around}`} strokeLinecap="round" />
        </svg>
        <span className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-danger text-danger-on text-title">{P.sos}</span>
      </span>
      <span className="flex flex-col gap-2 text-label">
        {P.sosSteps.map((s, i) => (
          <span key={s} className={i < 2 ? 'text-text' : 'text-text-secondary font-normal'}>{s}</span>
        ))}
      </span>
    </div>
  );
}
