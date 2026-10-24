import React from 'react';

// The ring round a group member's marker while they are the one being looked for (App.jsx's
// focusMember: a tapped member card, or an SOS sender): a solid accent ring and a slow pulse
// outside it. Still, without the pulse, when the device asks for reduced motion.
export default function FocusRing() {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute -inset-2 rounded-full border-2 border-accent animate-ping motion-reduce:animate-none opacity-70 pointer-events-none"
      />
      <span
        aria-hidden="true"
        className="absolute -inset-1.5 rounded-full border-[3px] border-accent shadow-[0_0_12px_var(--color-accent-halo)] pointer-events-none"
      />
    </>
  );
}
