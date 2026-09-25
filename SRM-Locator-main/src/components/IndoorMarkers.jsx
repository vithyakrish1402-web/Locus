import { haloFor } from '../utils/indoorView';

// WiFi Arc Stage 7: marker add-ons shared by both map engines. Each engine anchors a
// zero-size box at the point (google-map-react's child wrapper, LeafletReactMarker's
// 0x0 divIcon), so these centre themselves on that anchor exactly as LiveLocationMarker
// does, and render identically in either. Render them BEFORE the LiveLocationMarker they
// accompany: that marker's transform paints it above earlier positioned siblings.

/**
 * The soft disc behind your own dot while the position is WiFi-derived. Bigger and softer
 * at lower confidence - see haloFor.
 */
export function ConfidenceHalo({ confidence, color = '#10B981' }) {
  const { radius, solidStop } = haloFor(confidence);
  return (
    <div
      data-testid="indoor-halo"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -radius,
        top: -radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: '50%',
        pointerEvents: 'none',
        background: `radial-gradient(circle, ${color}59 0%, ${color}40 ${Math.round(solidStop * 100)}%, ${color}00 100%)`,
        border: `1px solid ${color}40`,
        transition: 'width 0.4s ease, height 0.4s ease, left 0.4s ease, top 0.4s ease',
      }}
    />
  );
}

/** The "ALEX · F2" pill under a squadmate who is indoors. Same placement as the ghost label. */
export function FloorTag({ text, color = '#EF4444' }) {
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-dot text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-black/80"
      style={{ top: 16, border: `1px solid ${color}99`, color, pointerEvents: 'none' }}
    >
      {text}
    </div>
  );
}
