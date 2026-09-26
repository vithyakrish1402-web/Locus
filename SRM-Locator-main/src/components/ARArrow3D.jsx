import React from 'react';
// eslint-disable-next-line no-unused-vars -- used via <motion.div> (see App.jsx's import for why the linter can't see this)
import { motion } from 'framer-motion';

// AR Scan's destination arrow as a solid wedge lying on the ground, drawn with plain CSS 3D
// transforms (no WebGL). Used for the 'efficient' and 'standard' AR_RENDER_MODE settings.
//
// Three nested layers, outermost first:
//   1. perspective wrapper: how strong the 3D depth looks
//   2. the ground plane, tilted back by ARROW_BASE_TILT_DEG
//   3. the arrow, turned within that plane by `rotation` (AR Scan's wraparound-safe angle)
// So the transform is rotateX(tilt) . rotateZ(angle): the arrow turns on a tilted table,
// shortening when it points ahead or back and at full length when it points sideways,
// instead of a flat sticker spinning on the screen. Both the plane and the arrow turn
// about their own centre.

// Fixed viewing angle, degrees back from facing the screen. Shallower reads as flat;
// steeper gets hard to read when pointing straight ahead or back.
export const ARROW_BASE_TILT_DEG = 55;
// CSS perspective distance. Smaller exaggerates the depth, larger flattens it.
export const ARROW_PERSPECTIVE_PX = 300;
// The wedge's thickness: side layers stacked this far below the top face.
export const ARROW_THICKNESS_PX = 9;
const SIDE_LAYERS = 6;

// Pointing up (away from you, once tilted), centred on the box so it turns about its middle.
const TIP = '50,10';
const LEFT_WING = '14,74';
const NOTCH = '50,58';
const RIGHT_WING = '86,74';
const OUTLINE = `${TIP} ${RIGHT_WING} ${NOTCH} ${LEFT_WING}`;

const layer = (z) => ({ transform: `translateZ(${z}px)` });

const ARArrow3D = ({ rotation, transition }) => (
  <div
    data-testid="ar-arrow-3d"
    className="w-40 h-40 flex items-center justify-center pointer-events-none"
    style={{ perspective: `${ARROW_PERSPECTIVE_PX}px` }}
  >
    <div
      data-testid="ar-arrow-plane"
      className="relative w-full h-full"
      style={{ transform: `rotateX(${ARROW_BASE_TILT_DEG}deg)`, transformStyle: 'preserve-3d' }}
    >
      <motion.div
        animate={{ rotate: rotation }}
        transition={transition}
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Side walls: darker copies stacked below the top face, so the edges show as
            thickness from any angle. */}
        {Array.from({ length: SIDE_LAYERS }, (_, i) => (
          <svg
            key={i}
            data-testid="ar-arrow-side"
            viewBox="0 0 100 100"
            className="absolute inset-0 w-full h-full"
            style={layer((i * ARROW_THICKNESS_PX) / SIDE_LAYERS)}
            aria-hidden="true"
          >
            <polygon points={OUTLINE} fill={i === 0 ? '#450A0A' : '#7F1D1D'} />
          </svg>
        ))}
        {/* Top face, two-tone along the ridge like a bevelled wedge. */}
        <svg
          data-testid="ar-arrow-top"
          viewBox="0 0 100 100"
          className="absolute inset-0 w-full h-full"
          style={layer(ARROW_THICKNESS_PX)}
          aria-hidden="true"
        >
          <polygon points={`${TIP} ${NOTCH} ${LEFT_WING}`} fill="#F87171" />
          <polygon points={`${TIP} ${RIGHT_WING} ${NOTCH}`} fill="#DC2626" />
          <polygon points={OUTLINE} fill="none" stroke="#FCA5A5" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </motion.div>
    </div>
  </div>
);

export default ARArrow3D;
