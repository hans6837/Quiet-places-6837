/*
 * The 12 scenes. Each one ties together:
 *  - video search terms (what the camera should show)
 *  - the sound folder in /sounds (what you hear)
 *  (videos only: no photos or painted pictures)
 *
 * A clip is only used when its title/tags satisfy the scene's rules:
 *   need: EVERY one of these patterns must appear (e.g. "beach" AND "waves")
 *   none: NONE of these may appear (things you would not hear in the sound)
 * so a loon video always comes with loon calls, surf on rocks with a rocky
 * coast, and so on. category: Pixabay's own category, to keep results on topic.
 */
(function () {
  "use strict";
  const w = list => new RegExp("\\b(" + list + ")\\b", "i");

  window.QP_SCENES = [
    // -------------------------------------------------------------- Sea
    {
      id: "sunset-beach", name: "Sunset Beach", category: "sea", pixabayCategory: "nature",
      hear: "Waves rolling onto sand",
      terms: ["sunset beach waves", "beach waves sunset", "ocean waves sand sunset", "sea shore sunset"],
      wikiTerms: ["beach waves sunset", "sunset beach"],
      need: [w("beach|sand|sandy|shore|shoreline|seashore"), w("waves?|surf|sea|ocean|tide"), w("sunsets?|sunrise|golden hour|dusk|dawn|evening")],
      none: w("rocks?|rocky|cliffs?|night|moon|storm|snow|ice|lake|river|pool|underwater|palm|city|lights|waterfalls?")
    },
    {
      id: "moonlit-shore", name: "Moonlit Shore", category: "sea", pixabayCategory: "nature",
      hear: "Water lapping on a quiet shore at night",
      terms: ["moon sea night", "moonlight ocean", "moon reflection water", "full moon sea"],
      wikiTerms: ["moon over sea", "moonlight sea"],
      need: [w("moon|moonlight|moonlit|moonrise|full moon"), w("sea|ocean|beach|shore|waves?|water|lake|coast|bay")],
      none: w("city|street|fireworks|storm|lightning|aurora|cartoon|animation|planet|space|rocket|eclipse")
    },
    {
      id: "rocky-coast", name: "Rocky Coast", category: "sea", pixabayCategory: "nature",
      hear: "Surf crashing on rocks",
      terms: ["waves crashing rocks", "rocky coast waves", "sea waves rocks", "surf rocks ocean"],
      wikiTerms: ["waves crashing rocks", "rocky coast surf"],
      need: [w("rocks?|rocky|cliffs?|crags?|boulders?"), w("waves?|surf|sea|ocean|coast|coastline|spray|swell|breakers")],
      none: w("sand|sandy|desert|mountains?|river|stream|creek|waterfall|lake|night|moon|snow|ice")
    },
    {
      id: "lagoon", name: "Tropical Lagoon", category: "sea", pixabayCategory: "nature",
      hear: "Gentle lapping in shallow water",
      terms: ["tropical lagoon", "turquoise water beach", "tropical beach calm", "clear water lagoon"],
      wikiTerms: ["lagoon turquoise", "tropical lagoon"],
      need: [w("lagoon|turquoise|tropical|tropics|caribbean|maldives|atoll|clear water|crystal"), w("water|sea|ocean|beach|waves?|shore|bay|lagoons?")],
      none: w("storm|night|moon|rocks?|cliffs?|underwater|fish|coral|diving|pool|city|snow")
    },
    // -------------------------------------------------------------- Forest
    {
      id: "morning-pines", name: "Morning Pines", category: "forest", pixabayCategory: "nature",
      hear: "Wind in the pines with birdsong",
      terms: ["pine forest morning", "forest sun rays", "misty pine forest", "forest morning light"],
      wikiTerms: ["pine forest morning mist", "sun rays forest"],
      need: [w("pines?|conifers?|spruces?|firs?|forest|woods|woodland|trees"), w("morning|fog|foggy|mist|misty|sun ?rays?|sunbeams?|sunlight|sunrise|dawn|sunshine")],
      none: w("rain|rainy|night|moon|stream|creek|river|waterfall|lake|snow|winter|fire|smoke|city|road")
    },
    {
      id: "forest-stream", name: "Forest Stream", category: "forest", pixabayCategory: "nature",
      hear: "A stream over stones",
      terms: ["forest stream", "creek forest", "mountain stream stones", "brook water stones"],
      wikiTerms: ["forest creek", "woodland stream"],
      need: [w("streams?|creeks?|brooks?|rivulet|rill|small river")],
      none: w("waterfalls?|rain|night|snow|ice|frozen|ocean|sea|beach|city|bridge|lake")
    },
    {
      id: "forest-rain", name: "Forest Rain", category: "forest", pixabayCategory: "nature",
      hear: "Rain falling on leaves",
      terms: ["rain leaves", "rain forest", "raindrops leaves", "rain green plants"],
      wikiTerms: ["rain forest leaves", "rainy forest"],
      need: [w("rain|rainy|raindrops?|drizzle|rainfall|raining"), w("leaves|leaf|forest|woods|trees|plants?|foliage|green|garden|jungle|nature")],
      none: w("window|glass|car|street|city|umbrella|roof|puddle|storm|thunder|lightning|night|snow")
    },
    {
      id: "forest-night", name: "Forest Night", category: "forest", pixabayCategory: "nature",
      hear: "Crickets and an owl at night",
      terms: ["forest night", "fireflies forest", "night forest moon", "trees night stars"],
      wikiTerms: ["forest night moon", "fireflies forest"],
      need: [w("night|moon|moonlight|fireflies|firefly|starry|stars|nocturnal"), w("forest|woods|woodland|trees")],
      none: w("city|street|campfire|fire|snow|winter|aurora|tent|car|road|halloween|horror|scary")
    },
    // -------------------------------------------------------------- Animals
    {
      id: "loons", name: "Loon Lake", category: "animals", pixabayCategory: "animals",
      hear: "Common loons calling across a lake",
      terms: ["loon", "common loon", "loon lake", "loon bird"],
      wikiTerms: ["Gavia immer", "common loon"],
      need: [w("loons?|gavia|great northern divers?|plongeons?|imbrin")],
      // Dutch "loon" means wage; "Quantum Loon" is a computer chip
      none: w("cartoon|toy|duck|goose|swan|loon op|loon voor|gelijk|belening|zand|wages?|salary|quantum|chip|ibm|vlog")
    },
    {
      id: "frog-pond", name: "Frog Pond", category: "animals", pixabayCategory: "animals",
      hear: "Spring peepers and frogs",
      terms: ["frog", "frog pond", "frog croaking", "frog water"],
      wikiTerms: ["frog pond", "tree frog"],
      need: [w("frogs?|toads?|peepers?|tadpoles?|amphibians?|bullfrogs?")],
      none: w("cartoon|toy|pet|terrarium|hand|aquarium|lizard|snake")
    },
    {
      id: "whales", name: "Whale Song", category: "animals", pixabayCategory: "animals",
      hear: "Humpback whale song",
      terms: ["humpback whale", "whale underwater", "whale", "whale ocean"],
      wikiTerms: ["Megaptera novaeangliae", "humpback whale"],
      need: [w("humpbacks?|megaptera|whales?")],
      none: w("shark|dolphins?|orcas?|killer whales?|cartoon|boat|ship|beluga|aquarium|beaked|melon|gr[ae]y whales?|bowhead|blue whales?|sperm|minke|right whales?|pilot whales?|narwhal|watching|tune|nursery|children|kids")
    },
    {
      id: "meadow", name: "Songbird Meadow", category: "animals", pixabayCategory: "animals",
      hear: "Chickadees and white-throated sparrows",
      terms: ["chickadee", "sparrow bird", "songbird branch", "songbird singing"],
      wikiTerms: ["Poecile atricapillus", "Zonotrichia albicollis"],
      need: [w("chickadees?|poecile|sparrows?|zonotrichia|tits?|titmouse|songbirds?")],
      none: w("parrots?|eagles?|hawks?|owls?|ducks?|swans?|goose|geese|gulls?|seagulls?|chickens?|hens?|roosters?|pigeons?|doves?|crows?|ravens?|flamingos?|peacocks?|herons?|storks?|cage|hand|vultures?|ostrich|penguins?|hummingbirds?|kingfisher|woodpecker|cockatoo|budgie")
    }
  ];

  window.QP_CATEGORIES = [
    { id: "all", name: "All" },
    { id: "sea", name: "Sea" },
    { id: "forest", name: "Forest" },
    { id: "animals", name: "Animals" }
  ];
})();
