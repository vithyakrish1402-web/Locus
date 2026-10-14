// Specialized campus pedestrian pathways connecting popular SRM buildings,
// plazas, and pedestrian walkways (such as University Building <-> Library <->
// Java Green <-> Tech Park <-> MBA block <-> Hostel alleys).
// When campus paths lack representation in external baseline maps, this curated
// graph connects key campus buildings cleanly along walkable paths.

import { haversineMeters } from '../utils/navGeometry';

export const CAMPUS_PEDESTRIAN_NODES = {
  // Hub nodes
  UB_MAIN: { id: 'UB_MAIN', lat: 12.8234851, lng: 80.042357, name: 'University Building Entrance' },
  LIBRARY_PLAZA: { id: 'LIBRARY_PLAZA', lat: 12.8236146, lng: 80.0424808, name: 'Library Plaza' },
  BEL_WALKWAY: { id: 'BEL_WALKWAY', lat: 12.8236272, lng: 80.0435541, name: 'BEL Walkway' },
  MBA_JUNCTION: { id: 'MBA_JUNCTION', lat: 12.8236698, lng: 80.0440245, name: 'MBA Court' },
  JAVA_PLAZA: { id: 'JAVA_PLAZA', lat: 12.8233553, lng: 80.0444916, name: 'Java Green Plaza' },
  BIOTECH_PATH: { id: 'BIOTECH_PATH', lat: 12.8247144, lng: 80.0439714, name: 'Bio-Tech Alley' },
  TECH_PARK_AVENUE: { id: 'TECH_PARK_AVENUE', lat: 12.8246325, lng: 80.0453585, name: 'Tech Park Concourse' },
  TECH_PARK_2: { id: 'TECH_PARK_2', lat: 12.8247035, lng: 80.0458793, name: 'Tech Park 2 Walkway' },
  AUDITORIUM_PROMENADE: { id: 'AUDITORIUM_PROMENADE', lat: 12.8247646, lng: 80.0466801, name: 'TP Ganesan Promenade' },
  PAARI_ALLEY: { id: 'PAARI_ALLEY', lat: 12.8225133, lng: 80.0436345, name: 'Hostel Spine North' },
  KAARI_ALLEY: { id: 'KAARI_ALLEY', lat: 12.8221538, lng: 80.0436308, name: 'Hostel Spine Mid' },
  ADHIYAMAN_PATH: { id: 'ADHIYAMAN_PATH', lat: 12.8214106, lng: 80.0436669, name: 'Hostel Spine South' },
  ESB_CORRIDOR: { id: 'ESB_CORRIDOR', lat: 12.8199433, lng: 80.039149, name: 'ESB Way' },
  MEB_CORRIDOR: { id: 'MEB_CORRIDOR', lat: 12.8202737, lng: 80.0395859, name: 'MEB Way' },
  HITECH_CORRIDOR: { id: 'HITECH_CORRIDOR', lat: 12.8208516, lng: 80.0391039, name: 'Hi-Tech Avenue' },
  MEDICAL_CONCOURSE: { id: 'MEDICAL_CONCOURSE', lat: 12.8209398, lng: 80.0481385, name: 'Medical Concourse' },
  HOSPITAL_WAY: { id: 'HOSPITAL_WAY', lat: 12.8229964, lng: 80.047993, name: 'Global Hospital Way' },
  DENTAL_WAY: { id: 'DENTAL_WAY', lat: 12.8252261, lng: 80.0476839, name: 'Dental College Way' },
};

// Bidirectional pedestrian edges
export const CAMPUS_PEDESTRIAN_EDGES = [
  ['UB_MAIN', 'LIBRARY_PLAZA'],
  ['LIBRARY_PLAZA', 'BEL_WALKWAY'],
  ['BEL_WALKWAY', 'MBA_JUNCTION'],
  ['MBA_JUNCTION', 'JAVA_PLAZA'],
  ['MBA_JUNCTION', 'BIOTECH_PATH'],
  ['BIOTECH_PATH', 'TECH_PARK_AVENUE'],
  ['JAVA_PLAZA', 'TECH_PARK_AVENUE'],
  ['TECH_PARK_AVENUE', 'TECH_PARK_2'],
  ['TECH_PARK_2', 'AUDITORIUM_PROMENADE'],
  ['AUDITORIUM_PROMENADE', 'DENTAL_WAY'],
  ['AUDITORIUM_PROMENADE', 'HOSPITAL_WAY'],
  ['HOSPITAL_WAY', 'MEDICAL_CONCOURSE'],
  ['BEL_WALKWAY', 'PAARI_ALLEY'],
  ['PAARI_ALLEY', 'KAARI_ALLEY'],
  ['KAARI_ALLEY', 'ADHIYAMAN_PATH'],
  ['UB_MAIN', 'HITECH_CORRIDOR'],
  ['HITECH_CORRIDOR', 'MEB_CORRIDOR'],
  ['MEB_CORRIDOR', 'ESB_CORRIDOR'],
];

/**
 * Connects arbitrary origin & destination to the nearest walkable campus nodes
 * if they are within campus bounds, returning a Dijkstra route if external routing
 * is offline or inaccurate.
 */
export function findCampusPedestrianRoute(origin, destination) {
  if (!origin || !destination) return null;

  const nodeKeys = Object.keys(CAMPUS_PEDESTRIAN_NODES);
  let closestOriginNode = null;
  let minOriginDist = Infinity;
  let closestDestNode = null;
  let minDestDist = Infinity;

  nodeKeys.forEach((key) => {
    const node = CAMPUS_PEDESTRIAN_NODES[key];
    const dOrig = haversineMeters(origin, node);
    if (dOrig < minOriginDist) {
      minOriginDist = dOrig;
      closestOriginNode = key;
    }
    const dDest = haversineMeters(destination, node);
    if (dDest < minDestDist) {
      minDestDist = dDest;
      closestDestNode = key;
    }
  });

  // If points are within reasonable campus walking proximity (within 600m of campus nodes)
  if (minOriginDist > 800 || minDestDist > 800) {
    return null; // Outside campus perimeter
  }

  // Build adjacency graph
  const adj = {};
  nodeKeys.forEach((k) => { adj[k] = []; });
  CAMPUS_PEDESTRIAN_EDGES.forEach(([u, v]) => {
    if (adj[u] && adj[v]) {
      const weight = haversineMeters(CAMPUS_PEDESTRIAN_NODES[u], CAMPUS_PEDESTRIAN_NODES[v]);
      adj[u].push({ node: v, weight });
      adj[v].push({ node: u, weight });
    }
  });

  // Dijkstra
  const distances = {};
  const prev = {};
  const unvisited = new Set(nodeKeys);

  nodeKeys.forEach((k) => { distances[k] = Infinity; });
  distances[closestOriginNode] = 0;

  while (unvisited.size > 0) {
    let curr = null;
    let minD = Infinity;
    unvisited.forEach((node) => {
      if (distances[node] < minD) {
        minD = distances[node];
        curr = node;
      }
    });

    if (curr === null || distances[curr] === Infinity || curr === closestDestNode) {
      break;
    }

    unvisited.delete(curr);

    adj[curr].forEach(({ node: neighbor, weight }) => {
      if (unvisited.has(neighbor)) {
        const alt = distances[curr] + weight;
        if (alt < distances[neighbor]) {
          distances[neighbor] = alt;
          prev[neighbor] = curr;
        }
      }
    });
  }

  if (distances[closestDestNode] === Infinity && closestOriginNode !== closestDestNode) {
    return null;
  }

  // Reconstruct path
  const pathKeys = [];
  let step = closestDestNode;
  while (step) {
    pathKeys.unshift(step);
    if (step === closestOriginNode) break;
    step = prev[step];
  }

  const nodesPath = pathKeys.map((k) => CAMPUS_PEDESTRIAN_NODES[k]);
  const fullPath = [
    { lat: origin.lat, lng: origin.lng },
    ...nodesPath.map((n) => ({ lat: n.lat, lng: n.lng })),
    { lat: destination.lat, lng: destination.lng },
  ];

  return fullPath;
}
