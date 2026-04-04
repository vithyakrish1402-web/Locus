import React, { useState, useEffect, useRef } from 'react';
import { Polygon } from '@react-google-maps/api';

// Example: Rough rectangular coordinates for Tech Park
const TECH_PARK_BOUNDARIES = [
  { lat: 12.8258, lng: 80.0448 }, // Top Left
  { lat: 12.8258, lng: 80.0465 }, // Top Right
  { lat: 12.8242, lng: 80.0465 }, // Bottom Right
  { lat: 12.8242, lng: 80.0448 }  // Bottom Left
];

const TacticalZone = ({ 
  paths = TECH_PARK_BOUNDARIES, 
  color = "#ff3b3b", // LOCUS Danger Red
  zoneName = "TECH_PARK" 
}) => {
  const [pulseOpacity, setPulseOpacity] = useState(0.15);
  const direction = useRef(1); // 1 for fading in, -1 for fading out

  // The Pulse Animation Engine
  useEffect(() => {
    const pulseInterval = setInterval(() => {
      setPulseOpacity((prev) => {
        if (prev >= 0.35) direction.current = -1; // Max glow
        if (prev <= 0.10) direction.current = 1;  // Min glow
        return prev + (0.01 * direction.current);
      });
    }, 50); // Runs 20 frames per second for smooth pulsing

    return () => clearInterval(pulseInterval);
  }, []);

  return (
    <Polygon
      paths={paths}
      options={{
        fillColor: color,
        fillOpacity: pulseOpacity, // Dynamic glowing opacity
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 2, // Sharp tactical border
        clickable: true,
      }}
      onClick={() => console.log(`SYS_ORACLE: Interrogating ${zoneName} data.`)}
    />
  );
};

export default TacticalZone;