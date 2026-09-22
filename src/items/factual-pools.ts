/**
 * Parametrized fact pools for the factual knowledge category.
 *
 * Why these are large: a pool of ~15 entries is small enough that a model could
 * memorise every answer, which is precisely the contamination risk the spec's
 * contamination-resistance section is meant to avoid. Rotation is only meaningful
 * if the pool has real variety, so each pool below is sized in the dozens.
 *
 * Every entry is a single unambiguous fact. Contested items are deliberately
 * excluded: capitals where the constitutional and administrative seats differ are
 * included only for countries where they coincide or where one is unambiguously
 * the capital in ordinary use; language-family assignments that are actively
 * debated (Korean, Japanese, Basque, Ainu) are omitted entirely.
 */

export interface FactPair {
  readonly key: string;
  readonly answer: string;
  /** Extra surface forms accepted as correct. */
  readonly accept?: readonly string[];
}

// ---------------------------------------------------------------------------
// Chemical formulas
// ---------------------------------------------------------------------------

export const CHEMICAL_FORMULAS: readonly FactPair[] = [
  { key: "water", answer: "H2O" },
  { key: "carbon dioxide", answer: "CO2" },
  { key: "carbon monoxide", answer: "CO" },
  { key: "methane", answer: "CH4" },
  { key: "ethane", answer: "C2H6" },
  { key: "propane", answer: "C3H8" },
  { key: "butane", answer: "C4H10" },
  { key: "ammonia", answer: "NH3" },
  { key: "glucose", answer: "C6H12O6" },
  { key: "fructose", answer: "C6H12O6" },
  { key: "sucrose", answer: "C12H22O11" },
  { key: "sulphuric acid", answer: "H2SO4", accept: ["sulfuric acid"] },
  { key: "nitric acid", answer: "HNO3" },
  { key: "hydrochloric acid", answer: "HCl" },
  { key: "phosphoric acid", answer: "H3PO4" },
  { key: "acetic acid", answer: "CH3COOH", accept: ["C2H4O2"] },
  { key: "citric acid", answer: "C6H8O7" },
  { key: "hydrogen peroxide", answer: "H2O2" },
  { key: "ethanol", answer: "C2H5OH", accept: ["C2H6O"] },
  { key: "methanol", answer: "CH3OH", accept: ["CH4O"] },
  { key: "acetone", answer: "C3H6O", accept: ["CH3COCH3"] },
  { key: "ozone", answer: "O3" },
  { key: "hydrogen chloride", answer: "HCl" },
  { key: "nitrous oxide", answer: "N2O" },
  { key: "nitrogen dioxide", answer: "NO2" },
  { key: "sulphur dioxide", answer: "SO2", accept: ["sulfur dioxide"] },
  { key: "sodium chloride", answer: "NaCl" },
  { key: "sodium bicarbonate", answer: "NaHCO3" },
  { key: "sodium carbonate", answer: "Na2CO3" },
  { key: "sodium hydroxide", answer: "NaOH" },
  { key: "potassium permanganate", answer: "KMnO4" },
  { key: "potassium chloride", answer: "KCl" },
  { key: "calcium carbonate", answer: "CaCO3" },
  { key: "calcium hydroxide", answer: "Ca(OH)2" },
  { key: "calcium oxide", answer: "CaO" },
  { key: "magnesium sulphate", answer: "MgSO4", accept: ["magnesium sulfate", "Epsom salt"] },
  { key: "copper sulphate", answer: "CuSO4", accept: ["copper sulfate"] },
  { key: "silver nitrate", answer: "AgNO3" },
  { key: "ammonium nitrate", answer: "NH4NO3" },
  { key: "barium sulphate", answer: "BaSO4", accept: ["barium sulfate"] },
  { key: "iron(III) oxide", answer: "Fe2O3", accept: ["iron oxide", "rust"] },
  { key: "aluminium oxide", answer: "Al2O3", accept: ["aluminum oxide"] },
  { key: "silicon dioxide", answer: "SiO2", accept: ["silica"] },
  { key: "titanium dioxide", answer: "TiO2" },
  { key: "benzene", answer: "C6H6" },
  { key: "toluene", answer: "C7H8" },
  { key: "ethylene glycol", answer: "C2H6O2" },
  { key: "urea", answer: "CH4N2O", accept: ["CO(NH2)2"] },
];

// ---------------------------------------------------------------------------
// Dated historical events
// ---------------------------------------------------------------------------

export const HISTORICAL_YEARS: readonly FactPair[] = [
  { key: "the sealing of Magna Carta", answer: "1215" },
  { key: "the fall of Constantinople to the Ottomans", answer: "1453" },
  { key: "Columbus's first landing in the Americas", answer: "1492" },
  { key: "the publication of Copernicus's De revolutionibus", answer: "1543" },
  { key: "the defeat of the Spanish Armada", answer: "1588" },
  { key: "the signing of the Treaty of Westphalia", answer: "1648" },
  { key: "the publication of Newton's Principia", answer: "1687" },
  { key: "the adoption of the US Declaration of Independence", answer: "1776" },
  { key: "the storming of the Bastille", answer: "1789" },
  { key: "the completion of the first transcontinental railroad in the United States", answer: "1869" },
  { key: "the opening of the Suez Canal", answer: "1869" },
  { key: "the publication of Darwin's On the Origin of Species", answer: "1859" },
  { key: "the unification of Germany", answer: "1871" },
  { key: "the first powered flight by the Wright brothers", answer: "1903" },
  { key: "the sinking of the Titanic", answer: "1912" },
  { key: "the outbreak of the First World War", answer: "1914" },
  { key: "the signing of the Treaty of Versailles", answer: "1919" },
  { key: "the Wall Street Crash", answer: "1929" },
  { key: "the end of the Second World War", answer: "1945" },
  { key: "the founding of the United Nations", answer: "1945" },
  { key: "the partition of India", answer: "1947" },
  { key: "the founding of the People's Republic of China", answer: "1949" },
  { key: "the first successful ascent of Mount Everest", answer: "1953" },
  { key: "the launch of Sputnik 1", answer: "1957" },
  { key: "the first human spaceflight", answer: "1961" },
  { key: "the Cuban Missile Crisis", answer: "1962" },
  { key: "the assassination of John F. Kennedy", answer: "1963" },
  { key: "the first crewed Moon landing", answer: "1969" },
  { key: "the resignation of Richard Nixon", answer: "1974" },
  { key: "the accident at Three Mile Island", answer: "1979" },
  { key: "the accident at Chernobyl", answer: "1986" },
  { key: "the fall of the Berlin Wall", answer: "1989" },
  { key: "the dissolution of the Soviet Union", answer: "1991" },
  { key: "the signing of the Maastricht Treaty", answer: "1992" },
  { key: "the adoption of the Kyoto Protocol", answer: "1997" },
  { key: "the launch of the first module of the International Space Station", answer: "1998" },
  { key: "the adoption of the Paris Agreement", answer: "2015" },
  { key: "the first direct image of a black hole", answer: "2019" },
  { key: "the sinking of the Titanic", answer: "1912" },
  { key: "the Wright brothers' first flight", answer: "1903", accept: ["first powered flight"] },
];
