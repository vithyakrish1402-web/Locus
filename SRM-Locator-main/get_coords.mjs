import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const places = [
    "Tech Park, SRM Institute of Science and Technology Kattankulathur",
    "University Building, SRM Institute of Science and Technology Kattankulathur",
    "T.P. Ganesan Auditorium, SRM Institute of Science and Technology Kattankulathur",
    "Main Block, Mechanical, SRM Institute of Science and Technology Kattankulathur",
    "Hi-Tech Block, SRM Institute of Science and Technology Kattankulathur",
    "SRM Medical College Hospital Kattankulathur",
    "Java Green, SRM IST Kattankulathur",
    "Bio-Tech Block, SRM IST Kattankulathur"
  ];

  let results = {};

  for (const place of places) {
    try {
        console.log(`Searching for: ${place}`);
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(place)}`);
        
        // Wait for the URL to change to coordinates or wait a bit
        await page.waitForTimeout(3000); 
        
        const currentUrl = page.url();
        console.log(`URL: ${currentUrl}`);
        
        // Regex to extract coordinates from Google Maps URL (e.g., .../@12.823,80.04... )
        const coordsMatch = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        
        if (coordsMatch && coordsMatch.length >= 3) {
            results[place] = [parseFloat(coordsMatch[1]), parseFloat(coordsMatch[2])];
            console.log(`Found coords: ${coordsMatch[1]}, ${coordsMatch[2]}`);
        } else {
             console.log(`Could not extract coords from URL.`);
        }
    } catch (e) {
        console.log(`Error processing ${place}:`, e.message);
    }
  }

  console.log("\n--- EXPORTED DATA ---");
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
})();
