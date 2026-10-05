const S =
  'stroke="#1d5fe0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';

export const IDEA_ICONS: Record<string, string> = {
    cup:'<path d="M112 70h76l-9 84a8 8 0 0 1-8 7h-42a8 8 0 0 1-8-7z" fill="#fff" '+S+'/><rect x="106" y="58" width="88" height="14" rx="5" fill="#e8f0fe" '+S+'/><path d="M117 100h66l-3 30h-60z" fill="#1d5fe0"/><circle cx="150" cy="115" r="7" fill="#fff"/><path d="M136 42c-5-6 5-9 0-16M150 42c-5-6 5-9 0-16M164 42c-5-6 5-9 0-16" fill="none" stroke="#9db9ee" stroke-width="2.5" stroke-linecap="round"/>',
    bottle:'<rect x="136" y="34" width="28" height="12" rx="3" fill="#1d5fe0"/><path d="M139 46h22v20c0 8 15 14 15 30v58a8 8 0 0 1-8 8h-36a8 8 0 0 1-8-8V96c0-16 15-22 15-30z" fill="#fff" '+S+'/><rect x="130" y="100" width="40" height="40" rx="5" fill="#e8f0fe" '+S+'/><path d="M138 114h24M138 124h16" '+S+'/>',
    tshirt:'<path d="M124 56L84 76l14 30 18-9v67h68V97l18 9 14-30-40-20c-4 12-14 18-26 18s-22-6-26-18z" fill="#fff" '+S+'/><circle cx="150" cy="122" r="12" fill="#1d5fe0"/><path d="M144 122h12M150 116v12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
    electronics:'<rect x="112" y="40" width="76" height="136" rx="13" fill="#fff" '+S+'/><rect x="120" y="54" width="60" height="96" rx="5" fill="#e8f0fe"/><path d="M130 76h40M130 92h26M130 108h40M130 124h20" '+S+'/><circle cx="150" cy="163" r="5" fill="none" '+S+'/><path d="M188 70h22v16M188 110h30M112 90H92v20" fill="none" stroke="#9db9ee" stroke-width="2.5" stroke-linecap="round"/><circle cx="210" cy="86" r="4" fill="#1d5fe0"/><circle cx="218" cy="110" r="4" fill="#1d5fe0"/>',
    furniture:'<rect x="114" y="46" width="72" height="60" rx="9" fill="#e8f0fe" '+S+'/><rect x="100" y="106" width="100" height="18" rx="6" fill="#fff" '+S+'/><path d="M114 124l-8 48M186 124l8 48M134 124v48M166 124v48" fill="none" '+S+'/><path d="M128 66h44M128 82h44" '+S+'/>',
    packaging:'<path d="M150 46l54 25v60l-54 27-54-27V71z" fill="#e8f0fe" '+S+'/><path d="M150 98l54-27M150 98L96 71M150 98v60" fill="none" '+S+'/><path d="M123 58l54 26v26l-27-13-27-13z" fill="#1d5fe0" opacity=".9"/>',
    toys:'<rect x="98" y="128" width="52" height="40" rx="6" fill="#1d5fe0"/><rect x="150" y="128" width="52" height="40" rx="6" fill="#fff" '+S+'/><rect x="124" y="88" width="52" height="40" rx="6" fill="#e8f0fe" '+S+'/><path d="M150 40l16 28h-32z" fill="#fff" '+S+'/><circle cx="124" cy="148" r="8" fill="#fff"/><path d="M168 148h20" '+S+'/>',
    beauty:'<rect x="106" y="98" width="88" height="24" rx="8" fill="#1d5fe0"/><rect x="110" y="122" width="80" height="46" rx="10" fill="#fff" '+S+'/><path d="M128 146h44" '+S+'/><path d="M206 44l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#e8f0fe" '+S+'/><path d="M100 66l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" '+S+'/>',
    auto:'<path d="M72 148v-16q0-6 6-8l18-6 18-26q4-6 12-6h52q8 0 14 6l22 26 18 6q6 2 6 8v16z" fill="#fff" '+S+'/><path d="M122 96h30v28h-44zM160 96h18l24 28h-42z" fill="#e8f0fe" '+S+'/><circle cx="112" cy="150" r="17" fill="#1d5fe0" '+S+'/><circle cx="196" cy="150" r="17" fill="#1d5fe0" '+S+'/><circle cx="112" cy="150" r="6" fill="#fff"/><circle cx="196" cy="150" r="6" fill="#fff"/>',
    health:'<rect x="102" y="56" width="96" height="96" rx="20" fill="#fff" '+S+'/><path d="M140 76h20v20h20v20h-20v20h-20v-20h-20V96h20z" fill="#1d5fe0"/><path d="M78 184h36l10-22 14 38 12-26h72" fill="none" '+S+'/>',
    agri:'<ellipse cx="150" cy="172" rx="52" ry="11" fill="#d6e2f7"/><path d="M150 172V96" fill="none" '+S+'/><path d="M150 130c-32 0-48-16-48-42 28 0 48 14 48 42z" fill="#e8f0fe" '+S+'/><path d="M150 108c0-26 16-42 46-42 0 28-16 42-46 42z" fill="#fff" '+S+'/><circle cx="212" cy="54" r="14" fill="#e8f0fe" '+S+'/>',
    energy:'<path d="M98 88h104l17 60H81z" fill="#e8f0fe" '+S+'/><path d="M133 88l-9 60M167 88l9 60M89 118h122" fill="none" '+S+'/><path d="M150 148v26M122 174h56" fill="none" '+S+'/><circle cx="214" cy="52" r="13" fill="#fff" '+S+'/><path d="M214 28v6M214 70v6M190 52h6M232 52h6M197 35l4 4M227 65l4 4M231 35l-4 4M201 65l-4 4" '+S+'/>',
    machine:'<circle cx="138" cy="112" r="46" fill="none" stroke="#1d5fe0" stroke-width="12" stroke-dasharray="12 11.04"/><circle cx="138" cy="112" r="38" fill="#fff" '+S+'/><circle cx="138" cy="112" r="12" fill="#e8f0fe" '+S+'/><circle cx="208" cy="152" r="22" fill="none" stroke="#1d5fe0" stroke-width="9" stroke-dasharray="8 9.27"/><circle cx="208" cy="152" r="17" fill="#e8f0fe" '+S+'/>',
    consumer:'<path d="M114 84h72l-8 92H122z" fill="#fff" '+S+'/><path d="M130 84c0-18 9-30 20-30s20 12 20 30" fill="none" '+S+'/><rect x="136" y="110" width="28" height="28" rx="6" fill="#1d5fe0"/><path d="M144 124h12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
    construction:'<rect x="96" y="86" width="78" height="90" rx="4" fill="#fff" '+S+'/><path d="M110 102h16v14h-16zM134 102h16v14h-16zM110 128h16v14h-16zM134 128h16v14h-16zM122 154h22v22h-22z" fill="#e8f0fe" '+S+'/><path d="M174 64h62M174 64v34" fill="none" '+S+'/><path d="M198 78h28v12h-28z" fill="#1d5fe0"/><path d="M226 64v16" fill="none" '+S+'/>',
    chemicals:'<path d="M126 48h48v20l32 76a16 16 0 0 1-15 22H109a16 16 0 0 1-15-22l32-76V48z" fill="#fff" '+S+'/><rect x="122" y="38" width="56" height="14" rx="4" fill="#1d5fe0"/><path d="M108 132h84c-2 20-14 30-42 30s-40-10-42-30z" fill="#e8f0fe"/><circle cx="138" cy="120" r="5" fill="#1d5fe0"/><circle cx="164" cy="112" r="4" fill="#9db9ee"/>',
    aerospace:'<path d="M36 122h118l62-10c12-2 20 8 16 16l-10 14H148l-18 34h-24l16-34H78L52 160H30l22-38z" fill="#fff" '+S+'/><path d="M108 122l34-34 18 6-30 28z" fill="#e8f0fe" '+S+'/><path d="M64 138l42 26 14-10-38-18z" fill="#1d5fe0"/><circle cx="86" cy="116" r="5" fill="#1d5fe0"/>',
    sports:'<circle cx="150" cy="116" r="54" fill="#fff" '+S+'/><path d="M150 74l12 22h22l-18 14 7 22-23-14-23 14 7-22-18-14h22z" fill="#1d5fe0"/><path d="M112 96l-20 8M188 96l20 8M118 146l-12 18M182 146l12 18" fill="none" '+S+'/>',
    idea:'<circle cx="150" cy="92" r="58" fill="#e8f0fe" opacity=".7"/><path d="M150 36c-30 0-52 22-52 50 0 18 8 28 17 38 6 7 9 12 9 22h52c0-10 3-15 9-22 9-10 17-20 17-38 0-28-22-50-52-50z" fill="#fff" '+S+'/><path d="M124 62c6-10 16-16 28-17" fill="none" stroke="#c9d9f6" stroke-width="4" stroke-linecap="round"/><path d="M141 148V122q0-8 7-13M159 148V122q0-8-7-13" fill="none" '+S+'/><circle cx="150" cy="92" r="15" fill="none" stroke="#1d5fe0" stroke-width="6" stroke-dasharray="5 6"/><circle cx="150" cy="92" r="10" fill="#fff" '+S+'/><circle cx="150" cy="92" r="3.5" fill="#1d5fe0"/><rect x="128" y="146" width="44" height="11" rx="3" fill="#e8f0fe" '+S+'/><rect x="131" y="157" width="38" height="11" rx="3" fill="#fff" '+S+'/><rect x="135" y="168" width="30" height="11" rx="5.5" fill="#1d5fe0"/><g '+S+'><path d="M150 18V6M107 30l-8-9M193 30l8-9M80 62l-11-5M220 62l11-5M72 98H60M228 98h12"/></g><path d="M52 132l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" '+S+'/><path d="M246 128l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#e8f0fe" '+S+'/>'
  };

export const IDEA_LABELS: Record<string, string> = {cup:'Drinkware',bottle:'Food & beverage',tshirt:'Apparel & textiles',electronics:'Electronics',furniture:'Furniture',packaging:'Packaging',toys:'Toys & games',beauty:'Beauty & personal care',auto:'Automotive',health:'Healthcare',agri:'Agriculture',energy:'Renewable energy',machine:'Industrial',consumer:'Consumer products',construction:'Construction',chemicals:'Chemicals & plastics',aerospace:'Aerospace & defence',sports:'Sports & outdoor',idea:'Your idea'};

export const IDEA_RULES: Array<[string, RegExp]> = [
    ['cup',/\b(cup|mug|coffee|tea|caf[eé]|tumbler|glass)/],
    ['tshirt',/\b(shirt|cloth|apparel|garment|fabric|textile|dress|saree|hoodie|uniform|wear|fashion|jeans|towel)/],
    ['electronics',/\b(phone|electronic|gadget|device|charger|sensor|iot|led|circuit|battery|speaker|smart|watch|laptop|camera)/],
    ['furniture',/\b(chair|table|furniture|sofa|desk|bed|shelf|cabinet|wood|decor)/],
    ['toys',/\b(toy|game|puzzle|kids|children|doll|block)/],
    ['beauty',/\b(cosmetic|beauty|skin|cream|soap|shampoo|perfume|lipstick|hair|jar)/],
    ['auto',/\b(car|bike|vehicle|automotive|auto|scooter|tyre|tire|bicycle|ev)\b/],
    ['health',/\b(medical|health|medicine|pharma|hospital|mask|syringe|surgical|therapy)/],
    ['agri',/\b(agri|farm|plant|seed|fertili|crop|organic|garden|fruit|vegetable)/],
    ['energy',/\b(solar|energy|wind|renewable|power|panel)/],
    ['packaging',/\b(box|packag|carton|bag|pouch|container|wrap|label)/],
    ['bottle',/\b(bottle|juice|drink|beverage|water|sauce|oil|jam|milk|snack|food|bakery|chocolate|spice|plastic)/],
    ['machine',/\b(machine|tool|industrial|equipment|parts|metal|steel|construction|chemical)/]
  ];

export function ideaFrame(icon: string): string {
  return '<svg viewBox="0 0 300 240" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="240" rx="14" fill="#f5f9ff"/><circle cx="262" cy="34" r="56" fill="#e8f0fe" opacity=".8"/><circle cx="22" cy="222" r="46" fill="#e8f0fe" opacity=".8"/><ellipse cx="150" cy="204" rx="78" ry="9" fill="#d6e2f7"/><g transform="translate(0 8)">' +
    icon +
    '</g><path d="M246 168l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="#fff" ' +
    S +
    "/></svg>";
}

export function matchIdeaIcon(text: string): string | null {
  const sourceText = text.toLowerCase();
  for (const [key, pattern] of IDEA_RULES) {
    if (pattern.test(sourceText)) return key;
  }
  return null;
}

/** Each industry option maps to the drawing used on the idea step. */
const SECTOR_ICONS: Record<string, string> = {
  "Food & Beverage": "bottle",
  "Consumer Products": "consumer",
  Electronics: "electronics",
  "Textiles & Apparel": "tshirt",
  Automotive: "auto",
  Packaging: "packaging",
  "Furniture & Home": "furniture",
  "Healthcare & Medical Devices": "health",
  "Construction & Building Materials": "construction",
  "Agriculture & Agri-tech": "agri",
  "Machinery & Industrial Equipment": "machine",
  "Chemicals & Plastics": "chemicals",
  "Toys & Games": "toys",
  "Beauty & Personal Care": "beauty",
  "Renewable Energy": "energy",
  "Aerospace & Defence": "aerospace",
  "Sports & Outdoor": "sports",
};

/**
 * A clicked sector shows that sector's picture.
 * With no sector selected, the lightbulb stays.
 */
export function resolveIdeaIcon(input: {
  project: string;
  product: string;
  idea: string;
  sectors: string[];
}): string {
  const sector = input.sectors[input.sectors.length - 1];
  if (!sector) return "idea";

  const mapped = SECTOR_ICONS[sector];
  if (mapped && IDEA_ICONS[mapped]) return mapped;
  return matchIdeaIcon(sector) || "idea";
}
