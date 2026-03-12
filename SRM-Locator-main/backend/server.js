import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

let locations = [
  { id: 1, name: "Library", lat: 12.8231, lng: 80.0445 },
  { id: 2, name: "Hostel", lat: 12.8245, lng: 80.0459 },
  { id: 3, name: "Academic Block", lat: 12.8255, lng: 80.0463 }
];

app.get("/locations", (req, res) => {
  res.json(locations);
});

app.post("/update-location", (req, res) => {
  const { id, name, lat, lng } = req.body;

  const existing = locations.find(user => user.id === id);

  if (existing) {
    existing.lat = lat;
    existing.lng = lng;
  } else {
    locations.push({ id, name, lat, lng });
  }

  res.json({ message: "Location updated" });
});

app.get("/", (req, res) => {
  res.send("LOCUS backend running 🚀");
});

app.listen(5000, () => {
  console.log("Backend running on http://localhost:5000");
});