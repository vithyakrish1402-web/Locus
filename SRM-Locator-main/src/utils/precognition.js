/**
 * Precognition Engine (1D-Kalman Filter for GPS telemetry).
 * Fuses noisy raw mobile GPS coordinate streams into smoothed, drift-resistant position vectors.
 */
export class PrecognitionFilter {
  constructor(q = 0.0001, r = 0.001) {
    this.q = q; // Trajectory Variance (How fast the target can actually change direction)
    this.r = r; // Sensor Distrust (How messy we assume the phone's GPS is)
    this.latEstimate = null;
    this.lngEstimate = null;
    this.latError = 1;
    this.lngError = 1;
  }

  filter(lat, lng) {
    if (lat === null || lat === undefined || lng === null || lng === undefined) {
      return { lat: this.latEstimate, lng: this.lngEstimate };
    }

    if (this.latEstimate === null || this.lngEstimate === null) {
      this.latEstimate = lat;
      this.lngEstimate = lng;
      return { lat, lng };
    }

    // 1. Predict next state
    const pLat = this.latError + this.q;
    const pLng = this.lngError + this.q;

    // 2. Calculate Precognition Gain (How much do we trust the new GPS point?)
    const kLat = pLat / (pLat + this.r);
    const kLng = pLng / (pLng + this.r);

    // 3. Calculate final smoothed coordinates
    this.latEstimate = this.latEstimate + kLat * (lat - this.latEstimate);
    this.lngEstimate = this.lngEstimate + kLng * (lng - this.lngEstimate);

    // 4. Update error margin for the next calculation
    this.latError = (1 - kLat) * pLat;
    this.lngError = (1 - kLng) * pLng;

    return { lat: this.latEstimate, lng: this.lngEstimate };
  }

  reset() {
    this.latEstimate = null;
    this.lngEstimate = null;
    this.latError = 1;
    this.lngError = 1;
  }
}
