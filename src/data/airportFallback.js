// Compact airport-name fallback for bundling into the userscript.
// Seed list is intentionally small; expand from public-domain OurAirports data
// if you want broader coverage without changing the runtime architecture.

const COMPACT_AIRPORT_NAME_BY_CODE = Object.freeze({
  ATL: "Hartsfield-Jackson Atlanta International Airport",
  ORD: "Chicago O'Hare International Airport",
  DFW: "Dallas/Fort Worth International Airport",
  DEN: "Denver International Airport",
  LAX: "Los Angeles International Airport",
  JFK: "John F. Kennedy International Airport",
  SFO: "San Francisco International Airport",
  SEA: "Seattle-Tacoma International Airport",
  MIA: "Miami International Airport",
  LAS: "Harry Reid International Airport",
  PHX: "Phoenix Sky Harbor International Airport",
  BOS: "Boston Logan International Airport",
  IAH: "George Bush Intercontinental Airport",
  CLT: "Charlotte Douglas International Airport",
  MSP: "Minneapolis-Saint Paul International Airport",
  DTW: "Detroit Metropolitan Airport",
  EWR: "Newark Liberty International Airport",
  IAD: "Washington Dulles International Airport",
  DCA: "Ronald Reagan Washington National Airport",
  SAN: "San Diego International Airport",
  BNA: "Nashville International Airport",
  TPA: "Tampa International Airport",
  FLL: "Fort Lauderdale-Hollywood International Airport",
  PHL: "Philadelphia International Airport",
  STL: "St. Louis Lambert International Airport",
  PDX: "Portland International Airport",
  HNL: "Daniel K. Inouye International Airport",
  HOU: "William P. Hobby Airport",
  SJC: "Norman Y. Mineta San Jose International Airport",
  OAK: "Oakland International Airport",
  SMF: "Sacramento International Airport",
  AUS: "Austin-Bergstrom International Airport",
  SAT: "San Antonio International Airport",
  DAL: "Dallas Love Field",
  MDW: "Chicago Midway International Airport",
  LGA: "LaGuardia Airport",
  MCO: "Orlando International Airport",
  RDU: "Raleigh-Durham International Airport",
  SNA: "John Wayne Airport",
  BWI: "Baltimore/Washington International Thurgood Marshall Airport",
  SLC: "Salt Lake City International Airport",
  CVG: "Cincinnati/Northern Kentucky International Airport",
  IND: "Indianapolis International Airport",
  CMH: "John Glenn Columbus International Airport",
  CLE: "Cleveland Hopkins International Airport",
  PIT: "Pittsburgh International Airport",
  BUF: "Buffalo Niagara International Airport",
  ORF: "Norfolk International Airport",
  TUL: "Tulsa International Airport",
  OKC: "Will Rogers World Airport",
  MEM: "Memphis International Airport",
  BHM: "Birmingham-Shuttlesworth International Airport",
  JAX: "Jacksonville International Airport",
  RSW: "Southwest Florida International Airport",
  PBI: "Palm Beach International Airport",
  CHS: "Charleston International Airport",
  SAV: "Savannah/Hilton Head International Airport",
  SDF: "Louisville Muhammad Ali International Airport",
  MKE: "Milwaukee Mitchell International Airport",
  OMA: "Eppley Airfield",
  TUS: "Tucson International Airport",
  ABQ: "Albuquerque International Sunport",
  BOI: "Boise Airport",
  ANC: "Ted Stevens Anchorage International Airport",
  RNO: "Reno-Tahoe International Airport",
  KOA: "Ellison Onizuka Kona International Airport at Keahole",
  LIH: "Lihue Airport",
  OGG: "Kahului Airport",
  HKG: "Hong Kong International Airport",
  NRT: "Narita International Airport",
  HND: "Haneda Airport",
  ICN: "Incheon International Airport",
  SIN: "Singapore Changi Airport",
  DXB: "Dubai International Airport",
  DOH: "Hamad International Airport",
  FRA: "Frankfurt Airport",
  MUC: "Munich Airport",
  CDG: "Charles de Gaulle Airport",
  AMS: "Amsterdam Airport Schiphol",
  LHR: "Heathrow Airport",
  LGW: "London Gatwick Airport",
  MAN: "Manchester Airport",
  DUB: "Dublin Airport",
  ZRH: "Zurich Airport",
  VIE: "Vienna International Airport",
  MAD: "Adolfo Suarez Madrid-Barajas Airport",
  BCN: "Barcelona-El Prat Airport",
  FCO: "Leonardo da Vinci-Fiumicino Airport",
  MXP: "Milan Malpensa Airport",
  ARN: "Stockholm Arlanda Airport",
  CPH: "Copenhagen Airport",
  OSL: "Oslo Airport",
  HEL: "Helsinki Airport",
  IST: "Istanbul Airport",
  DEL: "Indira Gandhi International Airport",
  BOM: "Chhatrapati Shivaji Maharaj International Airport",
  BLR: "Kempegowda International Airport",
  KUL: "Kuala Lumpur International Airport",
  BKK: "Suvarnabhumi Airport",
  SYD: "Sydney Airport",
  MEL: "Melbourne Airport",
  AKL: "Auckland Airport",
  PER: "Perth Airport",
  CPT: "Cape Town International Airport",
  JNB: "O. R. Tambo International Airport",
  GRU: "Sao Paulo/Guarulhos International Airport",
  GIG: "Rio de Janeiro/Galeao International Airport",
  EZE: "Ministro Pistarini International Airport",
  SCL: "Santiago International Airport",
  EGLL: "Heathrow Airport",
  EHAM: "Amsterdam Airport Schiphol",
  LFPG: "Charles de Gaulle Airport",
  EDDF: "Frankfurt Airport",
  EDDM: "Munich Airport",
  LFPO: "Paris Orly Airport",
  LFLL: "Lyon-Saint Exupery Airport",
  EBBR: "Brussels Airport",
  EGKK: "London Gatwick Airport",
  LIRF: "Leonardo da Vinci-Fiumicino Airport",
  LEBL: "Barcelona-El Prat Airport",
  LEMD: "Adolfo Suarez Madrid-Barajas Airport",
  LSZH: "Zurich Airport",
  LOWW: "Vienna International Airport",
  ENGM: "Oslo Airport",
  EFHK: "Helsinki Airport",
  EKCH: "Copenhagen Airport",
  OMDB: "Dubai International Airport",
  VTBS: "Suvarnabhumi Airport",
  WSSS: "Singapore Changi Airport",
  RJAA: "Narita International Airport",
  RJTT: "Haneda Airport",
  RKSI: "Incheon International Airport",
  YSSY: "Sydney Airport",
  YMML: "Melbourne Airport",
  NZAA: "Auckland Airport",
  FAOR: "O. R. Tambo International Airport",
  SBGR: "Sao Paulo/Guarulhos International Airport",
  SBGL: "Rio de Janeiro/Galeao International Airport",
  SAEZ: "Ministro Pistarini International Airport",
  SCEL: "Santiago International Airport",
});

function normalizeAirportCode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized === "" ? null : normalized;
}

function pickAirportNameFromCode(code, airportNameByCode) {
  if (!code) {
    return null;
  }

  if (airportNameByCode[code]) {
    return airportNameByCode[code];
  }

  if (code.length === 4 && code.startsWith("K")) {
    const suffix = code.slice(1);
    if (airportNameByCode[suffix]) {
      return airportNameByCode[suffix];
    }
  }

  return null;
}

function cleanLabel(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

export function createAirportResolver(extraCodeMap = {}) {
  const airportNameByCode = {
    ...COMPACT_AIRPORT_NAME_BY_CODE,
  };

  for (const [key, value] of Object.entries(extraCodeMap || {})) {
    const normalizedKey = normalizeAirportCode(key);
    if (normalizedKey && typeof value === "string") {
      airportNameByCode[normalizedKey] = value;
    }
  }

  return function resolveAirportReference(airport, role = "") {
    if (!airport && !role) {
      return null;
    }

    const iataCode = normalizeAirportCode(
      airport && typeof airport === "object"
        ? airport.iataCode || airport.iata_code || airport.iata
        : airport
    );
    const icaoCode = normalizeAirportCode(
      airport && typeof airport === "object"
        ? airport.icaoCode || airport.icao_code || airport.icao
        : null
    );
    const code = iataCode || icaoCode;
    const suppliedName = airport && typeof airport === "object" ? airport.name : null;
    const suppliedMunicipality = airport && typeof airport === "object" ? airport.municipality : null;
    const airportName = cleanLabel(suppliedName);
    const municipality = cleanLabel(suppliedMunicipality);
    const mappedName = pickAirportNameFromCode(code || icaoCode, airportNameByCode);
    const resolvedName = airportName || mappedName;

    if (!code && !resolvedName && !municipality) {
      return null;
    }

    const displayName = resolvedName || municipality || role || code || null;
    const label = displayName && code ? `${displayName} (${code})` : displayName || code || null;

    return {
      code,
      iataCode,
      icaoCode,
      name: resolvedName || null,
      municipality,
      displayName: resolvedName || municipality || null,
      label,
      source: airportName ? "input" : (mappedName ? "mapped" : "input"),
      role: role || null,
    };
  };
}

export const AIRPORT_NAME_BY_CODE = Object.freeze({
  ...COMPACT_AIRPORT_NAME_BY_CODE,
});

const DEFAULT_AIRPORT_RESOLVER = createAirportResolver();

export function resolveAirportReference(airport, role = "") {
  return DEFAULT_AIRPORT_RESOLVER(airport, role);
}

export function resolveAirportName(code, airportNameByCode = AIRPORT_NAME_BY_CODE) {
  const normalizedCode = normalizeAirportCode(code);
  if (!normalizedCode) {
    return null;
  }

  return pickAirportNameFromCode(normalizedCode, airportNameByCode);
}

export function formatAirportLabel(airport, role = "") {
  const resolved = typeof airport === "string"
    ? DEFAULT_AIRPORT_RESOLVER({ iataCode: airport }, role)
    : DEFAULT_AIRPORT_RESOLVER(airport, role);

  if (!resolved) {
    return null;
  }

  return resolved.label || resolved.displayName || resolved.code || null;
}
