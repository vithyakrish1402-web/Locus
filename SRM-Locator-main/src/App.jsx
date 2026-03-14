import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import 'leaflet/dist/leaflet.css';

const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000');

function App() {
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState({});

  // 1. Google Login Handler
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Auth Error:", err);
    }
  };

  // 2. Track Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // 3. Track Location & Socket Updates
  useEffect(() => {
    if (!user) return;

    if (navigator.geolocation) {
      navigator.geolocation.watchPosition((pos) => {
        socket.emit('update-location', {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          name: user.displayName,
          photo: user.photoURL 
        });
      });
    }

    socket.on('users-update', (data) => setUsers(data));
  }, [user]);

  // Create a custom marker icon using the user's Google photo
  const createClusterIcon = (url) => {
    return new L.Icon({
      iconUrl: url,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40],
      className: 'rounded-marker' // We can style this in CSS
    });
  };

  if (!user) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#121212', color: 'white', fontFamily: 'sans-serif' }}>
        <h1 style={{ letterSpacing: '4px' }}>LOCUS</h1>
        <button onClick={handleLogin} style={{ padding: '12px 24px', fontSize: '16px', borderRadius: '30px', border: 'none', backgroundColor: '#4285F4', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', width: '100%' }}>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px', background: 'white', padding: '5px 15px', borderRadius: '25px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
        <img src={user.photoURL} style={{ width: '30px', borderRadius: '50%' }} alt="me" />
        <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{user.displayName}</span>
        <button onClick={() => signOut(auth)} style={{ border: 'none', background: 'none', color: '#ff4444', cursor: 'pointer', fontWeight: 'bold' }}>Logout</button>
      </div>

      <MapContainer center={[20, 0]} zoom={2} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {Object.keys(users).map((id) => (
          <Marker key={id} position={[users[id].latitude, users[id].longitude]} icon={createClusterIcon(users[id].photo)}>
            <Popup>
              <div style={{ textAlign: 'center' }}>
                <img src={users[id].photo} style={{ width: '50px', borderRadius: '50%' }} alt="user" /><br/>
                <b>{users[id].name}</b>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default App;