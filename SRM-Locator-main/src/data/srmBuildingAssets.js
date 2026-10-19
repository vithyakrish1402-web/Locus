// --- SRM KTR CAMPUS BUILDING ASSETS & RICH METADATA ---
// Curated for Google/Apple Maps aesthetic.
// Contains verified photos, facilities, operating hours, floor counts, and descriptions.

export const SRM_BUILDING_ASSETS = {
  1: {
    id: 1,
    name: "UNIVERSITY BUILDING",
    categoryDisplay: "Academic & Administration",
    image: "/buildings/university_building.jpg",
    photos: [
      "/buildings/university_building.jpg",
      "/buildings/university_block.jpg",
      "/buildings/old_campus.jpg"
    ],
    hours: "Open • Closes 6:00 PM",
    isOpen: true,
    floors: 15,
    departments: ["Administration", "Registrar Office", "Central Library Wing", "Dean Offices", "Controller of Exams"],
    facilities: ["Wi-Fi", "Central AC", "Elevators", "Main Auditorium", "ATM", "Cafeteria", "Visitor Lounge"],
    description: "The administrative heart and main library block of SRMIST. Features the iconic campus clock tower, university governance offices, and sprawling academic council chambers.",
  },
  2: {
    id: 2,
    name: "TECH PARK",
    categoryDisplay: "Computing & Innovation",
    image: "/buildings/tech_park.jpg",
    photos: [
      "/buildings/tech_park.jpg",
      "/buildings/campus_main.jpg",
      "/buildings/university_block.jpg"
    ],
    hours: "Open • Closes 8:30 PM",
    isOpen: true,
    floors: 15,
    departments: ["Computer Science & Engineering", "Information Technology", "AI & Machine Learning", "Software Engineering"],
    facilities: ["Gigabit Wi-Fi", "Apple iOS Lab", "High-Speed Elevators", "AC Labs", "Cafeteria", "Supercomputing Cluster"],
    description: "Home to CSE & IT departments. 15 floors of high-tech innovation, specialized AI/ML research labs, incubation pods, and state-of-the-art programming centers.",
  },
  31: {
    id: 31,
    name: "TECH PARK 2",
    categoryDisplay: "Advanced Computing Tower",
    image: "/buildings/tech_park.jpg",
    photos: [
      "/buildings/tech_park.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open • Closes 8:00 PM",
    isOpen: true,
    floors: 12,
    departments: ["Data Science & Big Data", "Cyber Security & Cryptography", "Cloud Computing Hub", "IoT Research Center"],
    facilities: ["Wi-Fi", "Smart Classrooms", "Robotics Bay", "Server Rooms", "Conference Suites", "Elevators"],
    description: "Tech Park's second tower, standing adjacent to the original block. Houses specialized graduate computing centers and advanced data analytics research labs.",
  },
  32: {
    id: 32,
    name: "C V RAMAN BLOCK",
    categoryDisplay: "Research Park",
    image: "/buildings/university_block.jpg",
    photos: [
      "/buildings/university_block.jpg",
      "/buildings/tech_park.jpg"
    ],
    hours: "Open • Closes 7:00 PM",
    isOpen: true,
    floors: 6,
    departments: ["Nanotechnology Research", "Advanced Physics & Chemistry", "Interdisciplinary Sciences"],
    facilities: ["Cleanrooms", "Electron Microscopy", "Spectroscopy Lab", "AC Study Halls", "Wi-Fi"],
    description: "Sir C V Raman Research Park, the northern wing of the Bio-Tech complex. Known for world-class nanoscience facilities, research fellowships, and experimental physics.",
  },
  33: {
    id: 33,
    name: "MBA BLOCK",
    categoryDisplay: "School of Management",
    image: "/buildings/old_campus.jpg",
    photos: [
      "/buildings/old_campus.jpg",
      "/buildings/university_building.jpg"
    ],
    hours: "Open • Closes 6:30 PM",
    isOpen: true,
    floors: 5,
    departments: ["Faculty of Management (MBA)", "Finance & Marketing", "Business Analytics", "Entrepreneurship Cell"],
    facilities: ["Tiered Amphitheatres", "AC Boardrooms", "Startup Incubator", "Executive Lounge", "Wi-Fi"],
    description: "Faculty of Management block featuring executive Harvard-style tiered lecture halls, stock trading simulation labs, and startup accelerator workspaces.",
  },
  39: {
    id: 39,
    name: "VALLIAMMAI ENGINEERING COLLEGE",
    categoryDisplay: "Engineering College Campus",
    image: "/buildings/valliammai.jpg",
    photos: [
      "/buildings/valliammai.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open • Closes 5:00 PM",
    isOpen: true,
    floors: 4,
    departments: ["Core Engineering", "Applied Sciences", "Placement Center"],
    facilities: ["Engineering Workshops", "College Library", "Sports Complex", "Cafeteria"],
    description: "SRM Valliammai Engineering College wing, hosting core foundational branches and accredited undergraduate curricula.",
  },
  4: {
    id: 4,
    name: "SRM CENTRAL LIBRARY",
    categoryDisplay: "Academic & Library",
    image: "/buildings/university_block.jpg",
    photos: [
      "/buildings/university_block.jpg",
      "/buildings/university_building.jpg",
      "/buildings/old_campus.jpg"
    ],
    hours: "Open • Closes 10:00 PM",
    isOpen: true,
    floors: 4,
    departments: ["Digital Resources Hub", "Periodicals & Journals", "Reference Wing", "Research Archives"],
    facilities: ["Wi-Fi", "Central AC", "Study Rooms", "Computer Labs", "Quiet Zone", "RFID Kiosks", "Photocopying"],
    description: "Massive 4-storey air-conditioned library complex housing 150,000+ volumes, IEEE digital archives, group discussion pods, and silent thesis study zones.",
  },
  5: {
    id: 5,
    name: "ELECTRICAL SCIENCES BLOCK (ESB)",
    categoryDisplay: "Engineering Sector",
    image: "/buildings/old_campus.jpg",
    photos: [
      "/buildings/old_campus.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open • Closes 6:00 PM",
    isOpen: true,
    floors: 5,
    departments: ["Electrical & Electronics Engineering (EEE)", "Power Systems", "Renewable Energy Research"],
    facilities: ["High Voltage Testing Lab", "Smart Grid Simulator", "AC Lecture Theatres", "Wi-Fi"],
    description: "Electrical and Electronics engineering block featuring high voltage testing apparatus, circuit simulators, and power systems engineering labs.",
  },
  6: {
    id: 6,
    name: "MECHANICAL ENGINEERING BLOCK (MEB)",
    categoryDisplay: "Engineering Sector",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg",
      "/buildings/old_campus.jpg"
    ],
    hours: "Open • Closes 6:00 PM",
    isOpen: true,
    floors: 6,
    departments: ["Mechanical Engineering", "Thermal Systems", "CAD/CAM/CAE Lab", "Automotive Research Wing"],
    facilities: ["CNC Machining Wing", "Automotive Dyno Testing", "3D Printing Facility", "Heavy Machinery Bay"],
    description: "Mechanical engineering complex housing precision CNC workshops, internal combustion test engines, PG research suites, and CAD modeling stations.",
  },
  7: {
    id: 7,
    name: "BASIC ENGINEERING LAB (BEL)",
    categoryDisplay: "Engineering Sector",
    image: "/buildings/old_campus.jpg",
    photos: [
      "/buildings/old_campus.jpg"
    ],
    hours: "Open • Closes 5:30 PM",
    isOpen: true,
    floors: 3,
    departments: ["First-Year Engineering", "Applied Physics", "Applied Chemistry", "Fitting & Carpentry Workshops"],
    facilities: ["Chemistry Wet Labs", "Laser Optics Darkroom", "Mechanical Workshop", "Drawing Halls"],
    description: "Foundational engineering labs for first-year undergraduate scholars, providing hands-on training in core sciences and basic engineering trades.",
  },
  8: {
    id: 8,
    name: "SCHOOL OF ARCHITECTURE",
    categoryDisplay: "Design & Architecture",
    image: "/buildings/university_block.jpg",
    photos: [
      "/buildings/university_block.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open • Closes 7:00 PM",
    isOpen: true,
    floors: 4,
    departments: ["Architecture (B.Arch & M.Arch)", "Interior Design", "Urban Landscape & Planning"],
    facilities: ["Design Studios", "Drafting Halls", "3D Model Workshop", "Exhibition Gallery", "Climatology Lab"],
    description: "Spacious architectural design studios with daylighting orientation, drafting tables, laser-cutting facilities, and permanent student design galleries.",
  },
  9: {
    id: 9,
    name: "HI-TECH BLOCK",
    categoryDisplay: "Electronics & Robotics",
    image: "/buildings/tech_park.jpg",
    photos: [
      "/buildings/tech_park.jpg",
      "/buildings/university_block.jpg"
    ],
    hours: "Open • Closes 7:30 PM",
    isOpen: true,
    floors: 7,
    departments: ["ECE (Electronics & Communication)", "Mechatronics", "Robotics & Automation"],
    facilities: ["Robotics Test Arena", "VLSI Design Lab", "Embedded Systems Hub", "Drone Testing Net", "Wi-Fi"],
    description: "Dedicated to microelectronics, robotics, and cyber-physical systems with automated hardware assembly benches and RF testing chambers.",
  },
  10: {
    id: 10,
    name: "BIO-TECH BLOCK",
    categoryDisplay: "Biotechnology & Genetics",
    image: "/buildings/university_block.jpg",
    photos: [
      "/buildings/university_block.jpg"
    ],
    hours: "Open • Closes 6:30 PM",
    isOpen: true,
    floors: 6,
    departments: ["Biotechnology", "Genetic Engineering", "Biomedical Sciences", "Bioinformatics"],
    facilities: ["Bio-Safety Level 2 Lab", "Gene Sequencer", "Cell Culture Lab", "Cold Storage Bay", "AC"],
    description: "Pioneering genetic engineering and molecular biology research center equipped with sterile bio-cabinets and DNA sequencing infrastructure.",
  },
  11: {
    id: 11,
    name: "AEROSPACE BLOCK (HANGAR)",
    categoryDisplay: "Aerospace & Avionics",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg",
      "/buildings/old_campus.jpg"
    ],
    hours: "Open • Closes 6:00 PM",
    isOpen: true,
    floors: 3,
    departments: ["Aerospace Engineering", "Aeronautical Sciences", "Avionics Engineering"],
    facilities: ["Aircraft Hangar", "Supersonic Wind Tunnel", "Flight Simulator Cockpit", "Propulsion Lab"],
    description: "Features a full-scale aircraft maintenance hangar, twin-engine Cessna airframe, flight navigation simulators, and wind tunnels for aerodynamics research.",
  },
  12: {
    id: 12,
    name: "SRM MEDICAL COLLEGE",
    categoryDisplay: "Healthcare & Medicine",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg",
      "/buildings/university_block.jpg"
    ],
    hours: "Open 24 Hours • Emergency Always Open",
    isOpen: true,
    floors: 8,
    departments: ["General Medicine", "General Surgery", "Pediatrics", "Pathology", "Clinical Research"],
    facilities: ["24/7 Emergency", "Operation Theatres", "Medical Library", "Anatomy Museum", "ICU", "Wi-Fi"],
    description: "1,500-bed multispecialty university teaching hospital offering 24/7 emergency medical care, intensive care units, and clinical research wards.",
  },
  13: {
    id: 13,
    name: "SRM GLOBAL HOSPITALS",
    categoryDisplay: "Super Specialty Hospital",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg"
    ],
    hours: "Open 24 Hours • Trauma Center Open",
    isOpen: true,
    floors: 10,
    departments: ["Cardiology", "Neurology", "Trauma Care", "Oncology", "Radiology"],
    facilities: ["Trauma Unit", "MRI/CT Imaging", "Cardiac Cath Lab", "Ambulance Bay", "24/7 Pharmacy"],
    description: "Super-specialty medical healthcare hub with specialized trauma response units, diagnostic MRI imaging, and tertiary care wards.",
  },
  14: {
    id: 14,
    name: "SRM DENTAL COLLEGE",
    categoryDisplay: "Dental Healthcare",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg"
    ],
    hours: "Open • Closes 5:00 PM",
    isOpen: true,
    floors: 5,
    departments: ["Orthodontics", "Oral & Maxillofacial Surgery", "Periodontics", "Pedodontics"],
    facilities: ["Dental Clinics", "Maxillofacial Surgery OT", "Phantom Head Simulation Lab", "Digital OPG X-Ray"],
    description: "Specialized dental college with outpatient dental clinics, maxillofacial operating theatres, and simulation labs.",
  },
  15: {
    id: 15,
    name: "SCHOOL OF PUBLIC HEALTH",
    categoryDisplay: "Public Health Sciences",
    image: "/buildings/university_block.jpg",
    photos: [
      "/buildings/university_block.jpg"
    ],
    hours: "Open • Closes 5:30 PM",
    isOpen: true,
    floors: 4,
    departments: ["Epidemiology", "Global Health Policy", "Biostatistics", "Environmental Hygiene"],
    facilities: ["Health Analytics Lab", "Seminar Halls", "Resource Library", "Wi-Fi"],
    description: "Center for epidemiology, global public health initiatives, biostatistics, and healthcare administration programs.",
  },
  16: {
    id: 16,
    name: "T.P. GANESAN AUDITORIUM",
    categoryDisplay: "Grand Auditorium & Events",
    image: "/buildings/auditorium.jpg",
    photos: [
      "/buildings/auditorium.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open for Events, Convocations & Shows",
    isOpen: true,
    floors: 4,
    departments: ["University Cultural Affairs", "Event Management", "Convention Bureau"],
    facilities: ["4,000 Seats", "Central AC", "World-Class Acoustics", "VIP Lounges", "Green Rooms", "Spacious Parking"],
    description: "One of Asia's largest auditoriums, boasting a 4,000-seat amphitheatre, international acoustic design, and venues for convocations, concerts, and global summits.",
  },
  17: {
    id: 17,
    name: "JAVA GREEN (FOOD COURT)",
    categoryDisplay: "Dining & Social Hub",
    image: "/buildings/potheri_lake.jpg",
    photos: [
      "/buildings/potheri_lake.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open • Closes 11:00 PM",
    isOpen: true,
    floors: 1,
    departments: ["Student Refreshment", "Campus Dining"],
    facilities: ["Open-Air Seating", "Multi-Cuisine Stalls", "Juice & Coffee Bars", "Wi-Fi", "Digital Payments"],
    description: "Popular open-air student food court beneath green canopies. Offers diverse multi-cuisine food stalls, coffee shops, and late-evening student gathering spaces.",
  },
  19: {
    id: 19,
    name: "SRM HOTEL",
    categoryDisplay: "Hospitality & Stay",
    image: "/buildings/srm_hotel.jpg",
    photos: [
      "/buildings/srm_hotel.jpg",
      "/buildings/campus_main.jpg"
    ],
    hours: "Open 24 Hours",
    isOpen: true,
    floors: 5,
    departments: ["Hotel Management Institute", "Guest Services", "Fine Dining"],
    facilities: ["Deluxe Suites", "Multi-Cuisine Restaurant", "Swimming Pool", "Banquet Hall", "Valet Parking", "Wi-Fi"],
    description: "On-campus 3-star hospitality property offering executive accommodations for guests and parents alongside practical training facilities for hotel management scholars.",
  },
  22: {
    id: 22,
    name: "PAARI HOSTEL",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg",
      "/buildings/old_campus.jpg"
    ],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 8,
    departments: ["Hostel Administration", "Dining Mess", "Student Welfare"],
    facilities: ["High-Speed Wi-Fi", "Dining Mess", "Gym", "Study Rooms", "Recreation Hall", "24/7 Security", "RO Water"],
    description: "Premier multi-storey residential hall for men with attached multi-cuisine dining, fitness gym, reading lounges, and high-speed campus fiber internet.",
  },
  23: {
    id: 23,
    name: "KAARI HOSTEL",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 8,
    departments: ["Men's Residential Housing"],
    facilities: ["Wi-Fi", "Mess Hall", "Badminton Court", "Laundry", "24/7 Security"],
    description: "Modern men's residential block situated close to academic avenues with spacious double and triple sharing accommodation.",
  },
  25: {
    id: 25,
    name: "ADHIYAMAN HOSTEL",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 8,
    departments: ["Men's Housing"],
    facilities: ["Wi-Fi", "Dining Hall", "Study Lounge", "Table Tennis", "24/7 Power Backup"],
    description: "Men's residential block offering quiet environment, student reading common rooms, and prompt maintenance support.",
  },
  34: {
    id: 34,
    name: "OORI HOSTEL",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 8,
    departments: ["Men's Housing"],
    facilities: ["Wi-Fi", "Dining Hall", "Sports Grounds", "Security"],
    description: "Well-established men's residential hostel with immediate access to university sports grounds and cafeteria.",
  },
  35: {
    id: 35,
    name: "NELSON MANDELA HOSTEL",
    categoryDisplay: "International Student Residence",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7",
    isOpen: true,
    floors: 8,
    departments: ["International Student Wing"],
    facilities: ["Central AC Rooms", "International Cuisine Mess", "Gym", "High-Speed Wi-Fi", "Laundry"],
    description: "Air-conditioned international student accommodation block offering global dining options and private study suites.",
  },
  36: {
    id: 36,
    name: "AGASTHAYAR HOSTEL",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 8,
    departments: ["Men's Housing"],
    facilities: ["Wi-Fi", "Mess", "Study Rooms", "Security"],
    description: "Quiet residential block with green surroundings and peaceful study atmosphere.",
  },
  37: {
    id: 37,
    name: "SANNASI C BLOCK",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 8,
    departments: ["Men's Housing"],
    facilities: ["Wi-Fi", "Dining Facility", "Gym Access", "Security"],
    description: "Multi-storey hostel complex located in the Sannasi residential enclave.",
  },
  38: {
    id: 38,
    name: "N BLOCK",
    categoryDisplay: "Men's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 9:00 PM",
    isOpen: true,
    floors: 7,
    departments: ["Men's Housing"],
    facilities: ["Wi-Fi", "Mess", "Common Hall", "Security"],
    description: "Senior undergraduate residential block with recreational facilities.",
  },
  27: {
    id: 27,
    name: "MEENAKSHI HOSTEL",
    categoryDisplay: "Women's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: [
      "/buildings/campus_main.jpg",
      "/buildings/old_campus.jpg"
    ],
    hours: "Open 24/7 • Entry Curfew 8:30 PM",
    isOpen: true,
    floors: 8,
    departments: ["Women's Housing Administration"],
    facilities: ["24/7 Female Security", "Wi-Fi", "Hygienic Mess", "Fitness Gym", "Study Rooms", "Convenience Store"],
    description: "Primary women's residential hall with biometric access, around-the-clock security, courtyard, gymnasium, and indoor badminton court.",
  },
  29: {
    id: 29,
    name: "KALPANA CHAWLA HOSTEL",
    categoryDisplay: "Women's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 8:30 PM",
    isOpen: true,
    floors: 8,
    departments: ["Women's Housing"],
    facilities: ["Wi-Fi", "Dining Hall", "Reading Rooms", "24/7 Security", "Indoor Games"],
    description: "Modern women's hostel named after astronaut Kalpana Chawla, offering serene living spaces and dedicated reading rooms.",
  },
  30: {
    id: 30,
    name: "SISTER NIVEDITA HOSTEL",
    categoryDisplay: "Women's Residential Block",
    image: "/buildings/campus_main.jpg",
    photos: ["/buildings/campus_main.jpg"],
    hours: "Open 24/7 • Entry Curfew 8:30 PM",
    isOpen: true,
    floors: 7,
    departments: ["Women's Housing"],
    facilities: ["Wi-Fi", "Mess", "Study Lounge", "24/7 Security", "RO Water"],
    description: "Comfortable women's residential facility with scenic garden surroundings and 24-hour campus security vigilance.",
  }
};

/**
 * Returns rich building assets for a building, with intelligent defaults.
 * @param {object} building
 */
export function getBuildingAsset(building) {
  if (!building) return null;
  const asset = SRM_BUILDING_ASSETS[building.id] || {};
  
  // Clean fallback category display
  const categoryMap = {
    ACADEMIC: "Academic Block",
    ENGINEERING: "Engineering Wing",
    MEDICAL: "Healthcare & Medicine",
    RESIDENTIAL: "Residential Hall",
    LOGISTICS: "Campus Hub & Dining",
    GROUNDS: "Campus Ground"
  };

  const defaultCategory = categoryMap[building.category] || "Campus Facility";

  // Open ground has no floors, lift or opening time to show; the building defaults below
  // would invent all three.
  if (building.category === 'GROUNDS') {
    const image = asset.image || "/buildings/campus_main.jpg";
    return {
      id: building.id,
      name: building.name,
      categoryDisplay: asset.categoryDisplay || defaultCategory,
      image,
      photos: asset.photos && asset.photos.length > 0 ? asset.photos : [image],
      hours: asset.hours || "Open • Campus Hours",
      isOpen: asset.isOpen !== false,
      floors: null,
      departments: [],
      facilities: asset.facilities || [],
      description: asset.description || building.info || "Open ground at SRMIST Kattankulathur."
    };
  }

  return {
    id: building.id,
    name: building.name,
    categoryDisplay: asset.categoryDisplay || defaultCategory,
    image: asset.image || "/buildings/campus_main.jpg",
    photos: asset.photos && asset.photos.length > 0
      ? asset.photos
      : [asset.image || "/buildings/campus_main.jpg"],
    hours: asset.hours || "Open • Closes 6:00 PM",
    isOpen: asset.isOpen !== false,
    floors: asset.floors || (building.category === 'ACADEMIC' ? 6 : 4),
    departments: asset.departments || [defaultCategory],
    facilities: asset.facilities || ["Wi-Fi", "Air Conditioning", "Elevator", "Restrooms", "Drinking Water"],
    description: asset.description || building.info || "Campus building located at SRMIST Kattankulathur."
  };
}
