// Campus buildings for the location tag. A snapshot of the id/name/category fields of
// SRM_MASTER_DATABASE in SRM-Locator-main/src/srmDatabase.js, taken 2026-09-21.
// Copied rather than imported so this tool never builds against LOCUS source. Names are
// kept exactly as spelled there, so Stage 3 can join the CSV's building column to
// that database's coordinates and footprints.
export const CAMPUS_BUILDINGS = [
  { id: 1, name: "UNIVERSITY BUILDING", category: "ACADEMIC" },
  { id: 2, name: "TECH PARK", category: "ACADEMIC" },
  { id: 4, name: "SRM CENTRAL LIBRARY", category: "ACADEMIC" },
  { id: 5, name: "ELECTRICAL SCIENCES BLOCK (ESB)", category: "ENGINEERING" },
  { id: 6, name: "MECHANICAL ENGINEERING BLOCK (MEB)", category: "ENGINEERING" },
  { id: 7, name: "BASIC ENGINEERING LAB (BEL)", category: "ENGINEERING" },
  { id: 8, name: "SCHOOL OF ARCHITECTURE", category: "ENGINEERING" },
  { id: 9, name: "HI-TECH BLOCK", category: "ENGINEERING" },
  { id: 10, name: "BIO-TECH BLOCK", category: "ENGINEERING" },
  { id: 11, name: "AEROSPACE BLOCK (HANGAR)", category: "ENGINEERING" },
  { id: 12, name: "SRM MEDICAL COLLEGE", category: "MEDICAL" },
  { id: 13, name: "SRM GLOBAL HOSPITALS", category: "MEDICAL" },
  { id: 14, name: "SRM DENTAL COLLEGE", category: "MEDICAL" },
  { id: 15, name: "SCHOOL OF PUBLIC HEALTH", category: "MEDICAL" },
  { id: 16, name: "T.P. GANESAN AUDITORIUM", category: "LOGISTICS" },
  { id: 17, name: "JAVA GREEN (FOOD COURT)", category: "LOGISTICS" },
  { id: 19, name: "SRM HOTEL", category: "LOGISTICS" },
  { id: 22, name: "PAARI HOSTEL", category: "RESIDENTIAL" },
  { id: 23, name: "KAARI HOSTEL", category: "RESIDENTIAL" },
  { id: 25, name: "ADHIYAMAN HOSTEL", category: "RESIDENTIAL" },
  { id: 27, name: "MEENAKSHI HOSTEL", category: "RESIDENTIAL" },
  { id: 28, name: "SENBAGAM HOSTEL", category: "RESIDENTIAL" },
  { id: 29, name: "KALPANA CHAWLA HOSTEL", category: "RESIDENTIAL" },
  { id: 30, name: "SISTER NIVEDITA HOSTEL", category: "RESIDENTIAL" },
];
