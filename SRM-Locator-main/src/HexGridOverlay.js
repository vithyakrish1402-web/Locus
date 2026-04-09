/**
 * HexGridOverlay — google.maps.OverlayView subclass
 *
 * Usage:
 *   const overlay = new HexGridOverlay(map, [
 *     new google.maps.LatLng(37.7749, -122.4194),
 *     new google.maps.LatLng(37.7751, -122.4188),
 *     new google.maps.LatLng(37.7746, -122.4186),
 *     new google.maps.LatLng(37.7744, -122.4192),
 *   ]);
 *   // overlay.remove() to tear down cleanly
 */
export default function getHexGridOverlayClass(){
    /**
     * @param {google.maps.Map}      map    - The Maps instance to attach to
     * @param {google.maps.LatLng[]} coords - Polygon vertices defining the tactical zone
     * @param {object}               opts   - Optional overrides
     */

    return class HexGridOverlay extends window.google.maps.OverlayView {
        constructor(map, coords, opts = {}) {
            super();

            this._coords = coords;
            this._opts = {
                hexRadius: opts.hexRadius ?? 16,       // px — inner hex radius
                speed: opts.speed ?? 1.0,       // animation speed multiplier
                chaos: opts.chaos ?? 0.4,       // 0 = pure sine wave, 1 = fully random
                fillColor: opts.fillColor ?? '#ef4444', // solid hex fill
                strokeColor: opts.strokeColor ?? '#ff7878', // hex outline color
                padding: opts.padding ?? 0,         // extra canvas padding (px) beyond bounds
            };

            this._canvas = null;
            this._ctx = null;
            this._raf = null;
            this._t = 0;

            // Bind animation loop so we can reference it in cancelAnimationFrame
            this._loop = this._loop.bind(this);

            this.setMap(map);
        }

        // ─── OverlayView lifecycle ────────────────────────────────────────────────

        onAdd() {
            const canvas = document.createElement('canvas');
            canvas.style.cssText = [
                'position:absolute',
                'pointer-events:none',  // let map interactions pass through
            ].join(';');

            this._canvas = canvas;
            this._ctx = canvas.getContext('2d');

            // overlayLayer is the correct pane: sits above tile imagery, below UI controls
            this.getPanes().overlayLayer.appendChild(canvas);

            // Start animation loop
            this._raf = requestAnimationFrame(this._loop);
        }

        draw() {
            if (!this._canvas || this._coords.length < 3) return;

            const proj = this.getProjection();

            // ── 1. Compute LatLngBounds from the polygon vertices ──────────────────
            const bounds = new google.maps.LatLngBounds();
            this._coords.forEach(ll => bounds.extend(ll));

            // ── 2. Convert SW / NE corners to pixel offsets in the overlay's div ───
            //   fromLatLngToDivPixel returns coordinates in the overall map div's
            //   coordinate space, so we can position our canvas precisely.
            const sw = proj.fromLatLngToDivPixel(bounds.getSouthWest());
            const ne = proj.fromLatLngToDivPixel(bounds.getNorthEast());

            const {padding} = this._opts;

            const left = Math.min(sw.x, ne.x) - padding;
            const top = Math.min(sw.y, ne.y) - padding;
            const width = Math.abs(ne.x - sw.x) + padding * 2;
            const height = Math.abs(ne.y - sw.y) + padding * 2;

            // ── 3. Size and position the canvas ────────────────────────────────────
            const dpr = window.devicePixelRatio || 1;

            this._canvas.style.left = `${left}px`;
            this._canvas.style.top = `${top}px`;
            this._canvas.style.width = `${width}px`;
            this._canvas.style.height = `${height}px`;

            // ── 3.5. Cache the exact polygon pixel coordinates for clipping ──
            this._pixelPolygon = this._coords.map(ll => {
                const pt = proj.fromLatLngToDivPixel(ll);
                return {
                    x: pt.x - left,
                    y: pt.y - top
                };
            });

            // Only resize the backing bitmap when dimensions actually change
            // (avoids clearing the canvas on every Maps redraw)
            if (
                this._canvas.width !== Math.round(width * dpr) ||
                this._canvas.height !== Math.round(height * dpr)
            ) {
                this._canvas.width = Math.round(width * dpr);
                this._canvas.height = Math.round(height * dpr);
                this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                // Cache logical dimensions for the animation loop
                this._logicalW = width;
                this._logicalH = height;
            }
        }

        onRemove() {
            // Cancel animation FIRST to stop any in-flight frame referencing the canvas
            if (this._raf !== null) {
                cancelAnimationFrame(this._raf);
                this._raf = null;
            }

            if (this._canvas && this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }

            this._canvas = null;
            this._ctx = null;
        }

        /** Public helper — detach the overlay and release all references */
        remove() {
            this.setMap(null); // triggers onRemove()
        }

        // ─── Animation loop ───────────────────────────────────────────────────────

        _loop(timestamp) {
            // Guard: don't draw if teardown has already run
            if (!this._canvas || !this._ctx) return;

            this._t = (timestamp / 1000) * this._opts.speed;
            this._drawFrame();

            this._raf = requestAnimationFrame(this._loop);
        }

        _drawFrame() {
            const {hexRadius, chaos, fillColor, strokeColor} = this._opts;
            const ctx = this._ctx;
            const W = this._logicalW ?? this._canvas.width;
            const H = this._logicalH ?? this._canvas.height;

            ctx.clearRect(0, 0, W, H);
            // --- 🔴 THE CLIPPING MASK ---
            ctx.save(); // Lock the canvas state
            if (this._pixelPolygon && this._pixelPolygon.length > 2) {
                ctx.beginPath();
                ctx.moveTo(this._pixelPolygon[0].x, this._pixelPolygon[0].y);
                for (let i = 1; i < this._pixelPolygon.length; i++) {
                    ctx.lineTo(this._pixelPolygon[i].x, this._pixelPolygon[i].y);
                }
                ctx.closePath();
                ctx.clip(); // The magic command: restricts all future drawing to this shape!
            }
            // ----------------------------

            const t = this._t;
            const cx = W / 2;
            const cy = H / 2;
            const maxDist = Math.sqrt(W * W + H * H) / 2;

            // Flat-top hex grid geometry
            const r = hexRadius;
            const dxH = r * Math.sqrt(3);       // horizontal step
            const dyH = r * 1.5;                 // vertical step

            const cols = Math.ceil(W / dxH) + 2;
            const rows = Math.ceil(H / dyH) + 2;

            for (let row = -1; row <= rows; row++) {
                for (let col = -1; col <= cols; col++) {
                    const hx = col * dxH + (row % 2 === 0 ? 0 : dxH / 2);
                    const hy = row * dyH;

                    // Cull hexes clearly outside the canvas
                    if (hx + r < 0 || hx - r > W || hy + r < 0 || hy - r > H) continue;

                    const dist = Math.sqrt((hx - cx) ** 2 + (hy - cy) ** 2);
                    const normDist = dist / maxDist;                // 0 = center, 1 = far edge

                    // ── Probabilistic concentric pulse ────────────────────────────────
                    // Sine wave radiates outward from center (subtract normDist phase)
                    const sineVal = Math.sin(t * Math.PI * 2 - normDist * 5);

                    // Stable per-hex random value from a simple hash
                    const rng = (Math.sin(col * 17.3 + row * 31.7) * 0.5 + 0.5);

                    // Blend deterministic wave with stochastic noise
                    const activation = sineVal * (1 - chaos) + (rng * 2 - 1) * chaos;

                    // ── Render state ─────────────────────────────────────────────────
                    if (activation > 0.4) {
                        // SOLID RED — peak of wave
                        const alpha = Math.min(1, (activation - 0.4) / 0.6);
                        ctx.fillStyle = this._colorWithAlpha(fillColor, 0.55 + alpha * 0.45);
                        ctx.strokeStyle = this._colorWithAlpha(strokeColor, 0.4 + alpha * 0.3);
                        ctx.lineWidth = 0.8;
                        this._hexPath(ctx, hx, hy, r * 0.88);
                        ctx.fill();
                        ctx.stroke();
                    } else if (activation > -0.1) {
                        // HOLLOW — trough of wave (outline only)
                        const frac = (activation + 0.1) / 0.5;
                        ctx.strokeStyle = this._colorWithAlpha(fillColor, 0.2 + frac * 0.4);
                        ctx.lineWidth = 0.7;
                        this._hexPath(ctx, hx, hy, r * 0.88);
                        ctx.stroke();
                    }
                    // else INVISIBLE — nothing drawn
                }
            }
            // --- 🔴 RESTORE THE CANVAS ---
            ctx.restore();
        }

        // ─── Helpers ─────────────────────────────────────────────────────────────

        /** Trace a flat-top hexagon path */
        _hexPath(ctx, cx, cy, r) {
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 6;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
        }

        /**
         * Returns an rgba() string from a #rrggbb hex color + alpha.
         * Result is memoized by (hex, alpha) to avoid per-frame string allocation.
         */
        _colorWithAlpha(hex, alpha) {
            const key = hex + alpha.toFixed(2);
            if (!this._colorCache) this._colorCache = new Map();
            if (this._colorCache.has(key)) return this._colorCache.get(key);

            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const v = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
            this._colorCache.set(key, v);
            return v;
        }
    };
}