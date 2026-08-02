// --- 🗄️ SRM KTR MASTER TACTICAL DATABASE (VERIFIED CENTER POINTS) ---
export const SRM_MASTER_DATABASE = [
  // 🏛️ Academic & Admin Sector
  { id: 1, name: "UNIVERSITY BUILDING", category: "ACADEMIC", lat: 12.8234851, lng: 80.042357, footprint: [[12.8235693,80.0420734],[12.8232416,80.0420216],[12.8231317,80.0426975],[12.8237473,80.0426436],[12.8237354,80.0423487],[12.8235693,80.0420734]], info: "The administrative heart and main library block." },
  { id: 2, name: "TECH PARK", category: "ACADEMIC", lat: 12.8246325, lng: 80.0453585, footprint: [[12.824866,80.0449305],[12.8247568,80.0449368],[12.8244935,80.0449622],[12.8244895,80.0451523],[12.8245588,80.0451713],[12.8245829,80.0454849],[12.8245467,80.0454947],[12.8244395,80.0455099],[12.8245081,80.0455703],[12.8245035,80.0456449],[12.8246301,80.0456408],[12.8247651,80.0456351],[12.8248558,80.0456265],[12.8248586,80.0452589],[12.824866,80.0449305]], info: "Home to CSE & IT departments. 15 floors of innovation." },
  { id: 4, name: "SRM CENTRAL LIBRARY", category: "ACADEMIC", lat: 12.8236146, lng: 80.0424808, info: "Massive library complex." },

  // ⚙️ Engineering Sector
  { id: 5, name: "ELECTRICAL SCIENCES BLOCK (ESB)", category: "ENGINEERING", lat: 12.8199433, lng: 80.039149, footprint: [[12.8199457,80.0387879],[12.8200332,80.0388141],[12.8200918,80.0389909],[12.8199169,80.0396043],[12.8197291,80.039548],[12.8199457,80.0387879]], info: "Electrical and Electronics engineering block." },
  { id: 6, name: "MECHANICAL ENGINEERING BLOCK (MEB)", category: "ENGINEERING", lat: 12.8202737, lng: 80.0395859, footprint: [[12.8205159,80.0396006],[12.8204677,80.0397296],[12.8200189,80.0395738],[12.8200922,80.0394396],[12.8205159,80.0396006]], info: "Mechanical engineering facilities (PG Block)." },
  { id: 7, name: "BASIC ENGINEERING LAB (BEL)", category: "ENGINEERING", lat: 12.8236272, lng: 80.0435541, footprint: [[12.8238778,80.0434389],[12.8238909,80.0437072],[12.8233783,80.043734],[12.8233783,80.043447],[12.8236106,80.0434432],[12.8238778,80.0434389]], info: "Foundational engineering labs for first-year students." },
  { id: 8, name: "SCHOOL OF ARCHITECTURE", category: "ENGINEERING", lat: 12.8242029, lng: 80.0439978, footprint: [[12.8244139,80.0437511],[12.8244192,80.0442178],[12.8239955,80.0442232],[12.8239831,80.0437991],[12.8244139,80.0437511]], info: "Architecture design studios and drafting rooms." },
  { id: 9, name: "HI-TECH BLOCK", category: "ENGINEERING", lat: 12.8208516, lng: 80.0391039, footprint: [[12.8210337,80.0386189],[12.820949,80.038823],[12.8210808,80.038871],[12.8210598,80.0389515],[12.8209239,80.0389032],[12.8208402,80.0391231],[12.8211174,80.0392251],[12.8212952,80.0387262],[12.8210337,80.0386189]], info: "Specialized labs for ECE, EEE & Mechatronics." },
  { id: 10, name: "BIO-TECH BLOCK", category: "ENGINEERING", lat: 12.8249044, lng: 80.0439597, footprint: [[12.8251005,80.0439503],[12.8251005,80.0442722],[12.824703,80.0442722],[12.824703,80.0439289],[12.8247448,80.0438216],[12.824839,80.0437787],[12.824975,80.0438001],[12.8250691,80.0438538],[12.8251005,80.0439503]], info: "Genetic engineering and biotechnology research facility." },
  { id: 11, name: "AEROSPACE BLOCK (HANGAR)", category: "ENGINEERING", lat: 12.8201719, lng: 80.0401625, footprint: [[12.8204322,80.0399707],[12.8202386,80.0404857],[12.8199091,80.0403569],[12.8201079,80.0398366],[12.8204322,80.0399707]], info: "Aerospace and aeronautical engineering labs." },

  // 🏥 Medical Sector
  { id: 12, name: "SRM MEDICAL COLLEGE", category: "MEDICAL", lat: 12.8209398, lng: 80.0481385, info: "Multi-specialty hospital and medical research center." },
  { id: 13, name: "SRM GLOBAL HOSPITALS", category: "MEDICAL", lat: 12.8229964, lng: 80.047993, info: "Advanced healthcare facility." },
  { id: 14, name: "SRM DENTAL COLLEGE", category: "MEDICAL", lat: 12.8252261, lng: 80.0476839, footprint: [[12.8252979,80.0473966],[12.8253097,80.0479679],[12.8251543,80.0479712],[12.8251425,80.0473999],[12.8252979,80.0473966]], info: "Dental hospital and college." },
  { id: 15, name: "SCHOOL OF PUBLIC HEALTH", category: "MEDICAL", lat: 12.8203868, lng: 80.0477722, info: "Public health and administration." },

  // 🏟️ Gathering Hubs & Logistics
  { id: 16, name: "T.P. GANESAN AUDITORIUM", category: "LOGISTICS", lat: 12.8247646, lng: 80.0466801, info: "One of Asia's largest auditoriums." },
  { id: 17, name: "JAVA GREEN (FOOD COURT)", category: "LOGISTICS", lat: 12.8233553, lng: 80.0444916, footprint: [[12.8231521,80.0442832],[12.8231406,80.0446863],[12.8235643,80.0447024],[12.8235643,80.0442947],[12.8231521,80.0442832]], info: "Popular outdoor student hangout and food court." },
  { id: 19, name: "SRM HOTEL", category: "LOGISTICS", lat: 12.8238138, lng: 80.0415846, footprint: [[12.824132,80.0413147],[12.823473,80.0413254],[12.8234834,80.0414219],[12.8235462,80.0414541],[12.8235462,80.0417438],[12.8234939,80.0417331],[12.8235044,80.0418618],[12.8241216,80.0418189],[12.8241425,80.0417223],[12.8240797,80.0417223],[12.8240902,80.0414541],[12.824153,80.0414434],[12.824132,80.0413147]], info: "On-campus hotel and hospitality management." },

  // 🛌 Operative Barracks (Men's Hostels)
  { id: 22, name: "PAARI HOSTEL", category: "RESIDENTIAL", lat: 12.8225133, lng: 80.0436345, footprint: [[12.8226533,80.0433274],[12.8226533,80.0437199],[12.8226124,80.0437174],[12.8226004,80.0438013],[12.8223886,80.0438112],[12.8223447,80.0437418],[12.8223405,80.0433225],[12.8226533,80.0433274]], info: "Men's residential block." },
  { id: 23, name: "KAARI HOSTEL", category: "RESIDENTIAL", lat: 12.8221538, lng: 80.0436308, footprint: [[12.8223148,80.0433093],[12.8223137,80.0437156],[12.8222626,80.0437154],[12.8222625,80.0437837],[12.8220402,80.0437831],[12.8220404,80.0437156],[12.8219974,80.0437154],[12.8219985,80.0433085],[12.8223148,80.0433093]], info: "Men's residential block." },
  { id: 25, name: "ADHIYAMAN HOSTEL", category: "RESIDENTIAL", lat: 12.8214106, lng: 80.0436669, footprint: [[12.8215718,80.0433741],[12.8215707,80.0437951],[12.8215196,80.0437949],[12.8215195,80.0438632],[12.8212972,80.0438626],[12.8212974,80.0437951],[12.8212544,80.0437949],[12.8212531,80.0433611],[12.8214113,80.0433615],[12.8215718,80.0433741]], info: "Men's residential block." },

  // 🛌 Operative Barracks (Women's Hostels)
  { id: 27, name: "MEENAKSHI HOSTEL", category: "RESIDENTIAL", lat: 12.8222759, lng: 80.0423615, footprint: [[12.822617,80.0423453],[12.8221322,80.0423337],[12.8221356,80.0421849],[12.8220327,80.0421824],[12.8220257,80.0424872],[12.8223747,80.0424956],[12.8226134,80.0425014],[12.822617,80.0423453]], info: "Women's residential block." },
  { id: 28, name: "SENBAGAM HOSTEL", category: "RESIDENTIAL", lat: 12.8215, lng: 80.0435, info: "Women's residential block (Unverified sub-block)." },
  { id: 29, name: "KALPANA CHAWLA HOSTEL", category: "RESIDENTIAL", lat: 12.8203606, lng: 80.0454129, footprint: [[12.8205827,80.0451233],[12.8201541,80.0451162],[12.8201316,80.0457105],[12.820574,80.0457016],[12.8205827,80.0451233]], info: "Women's residential block." },
  { id: 30, name: "SISTER NIVEDITA HOSTEL", category: "RESIDENTIAL", lat: 12.8210819, lng: 80.0441384, footprint: [[12.8212817,80.0440384],[12.8212798,80.0442423],[12.8208822,80.0442384],[12.8208841,80.0440345],[12.8212817,80.0440384]], info: "Women's residential block (Unverified sub-block)." }
];
