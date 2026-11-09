/*
 * The 12 scenes. Each one ties together:
 *  - photo search terms (what the camera should show)
 *  - the sound folder in /sounds (what you hear)
 *  - a painted fallback (used when no photo can be loaded)
 *
 * Photo terms are chosen to match exactly what the recordings contain, so a
 * loon photo always comes with loon calls, surf on rocks with a rocky coast…
 *
 * mustMatch (optional): for animal scenes, the photo's title/description
 * must mention the animal, so a "loon swimming" search can't show a duck.
 */
window.QP_SCENES = [
  // ---------------------------------------------------------------- Sea
  {
    id: "sunset-beach", name: "Sunset Beach", category: "sea",
    hear: "Waves rolling onto sand",
    terms: ["sunset beach waves", "ocean shore golden hour", "sunset sea waves sand", "beach waves evening light"],
    wikiTerms: ["sunset beach waves", "beach sunset sea"],
    paint: "sunsetBeach"
  },
  {
    id: "moonlit-shore", name: "Moonlit Shore", category: "sea",
    hear: "Water lapping on a quiet shore at night",
    terms: ["moonlight ocean night", "moon over sea", "moonlit beach", "full moon sea reflection"],
    wikiTerms: ["moon over sea", "moonlight sea"],
    paint: "moonlitShore"
  },
  {
    id: "rocky-coast", name: "Rocky Coast", category: "sea",
    hear: "Surf crashing on rocks",
    terms: ["waves crashing rocks", "rocky coastline surf", "sea waves rocks spray", "rugged coast waves"],
    wikiTerms: ["waves crashing rocks", "rocky coast surf"],
    paint: "rockyCoast"
  },
  {
    id: "lagoon", name: "Tropical Lagoon", category: "sea",
    hear: "Gentle lapping in shallow water",
    terms: ["calm tropical lagoon", "turquoise shallow water beach", "clear lagoon water", "tropical beach calm sea"],
    wikiTerms: ["lagoon turquoise", "tropical lagoon"],
    paint: "lagoon"
  },
  // ---------------------------------------------------------------- Forest
  {
    id: "morning-pines", name: "Morning Pines", category: "forest",
    hear: "Wind in the pines with birdsong",
    terms: ["misty pine forest morning", "sun rays forest", "pine forest sunlight", "foggy conifer forest"],
    wikiTerms: ["pine forest morning mist", "sun rays forest"],
    paint: "morningPines"
  },
  {
    id: "forest-stream", name: "Forest Stream", category: "forest",
    hear: "A stream over stones",
    terms: ["forest creek stones", "woodland stream", "mossy stream forest", "brook in forest"],
    wikiTerms: ["forest creek", "woodland stream"],
    paint: "forestStream"
  },
  {
    id: "forest-rain", name: "Forest Rain", category: "forest",
    hear: "Rain falling on leaves",
    terms: ["rain forest leaves", "rainy woods", "raindrops green leaves", "rain in the forest"],
    wikiTerms: ["rain forest leaves", "rainy forest"],
    paint: "forestRain"
  },
  {
    id: "forest-night", name: "Forest Night", category: "forest",
    hear: "Crickets and an owl at night",
    terms: ["forest at night moon", "fireflies forest", "night forest stars", "moonlit woods"],
    wikiTerms: ["forest night moon", "fireflies forest"],
    paint: "forestNight"
  },
  // ---------------------------------------------------------------- Animals
  {
    id: "loons", name: "Loon Lake", category: "animals",
    hear: "Common loons calling across a lake",
    terms: ["common loon lake", "loon swimming", "common loon", "loon bird water"],
    wikiTerms: ["Gavia immer", "common loon"],
    mustMatch: /\b(loons?|gavia|great northern diver|diver)\b/i,
    paint: "loons"
  },
  {
    id: "frog-pond", name: "Frog Pond", category: "animals",
    hear: "Spring peepers and frogs",
    terms: ["frog lily pad pond", "pond at dusk", "frog in pond", "lily pond evening"],
    wikiTerms: ["frog pond", "tree frog"],
    mustMatch: /\b(frogs?|toads?|peepers?|ponds?|lily|lilies|water ?lil\w*|amphibians?|hyla|pseudacris|lithobates|rana)\b/i,
    paint: "frogPond"
  },
  {
    id: "whales", name: "Whale Song", category: "animals",
    hear: "Humpback whale song",
    terms: ["humpback whale underwater", "whale ocean", "humpback whale", "whale tail ocean"],
    wikiTerms: ["Megaptera novaeangliae", "humpback whale"],
    mustMatch: /\b(whales?|humpback|megaptera|cetaceans?)\b/i,
    paint: "whales"
  },
  {
    id: "meadow", name: "Songbird Meadow", category: "animals",
    hear: "Chickadees and white-throated sparrows",
    terms: ["chickadee branch", "songbird meadow", "wildflower meadow", "white-throated sparrow", "chickadee"],
    wikiTerms: ["Poecile atricapillus", "Zonotrichia albicollis", "wildflower meadow"],
    mustMatch: /\b(chickadees?|poecile|sparrows?|zonotrichia|songbirds?|birds?|meadows?|wildflowers?|flowers?)\b/i,
    paint: "meadow"
  }
];

window.QP_CATEGORIES = [
  { id: "all", name: "All" },
  { id: "sea", name: "Sea" },
  { id: "forest", name: "Forest" },
  { id: "animals", name: "Animals" }
];
