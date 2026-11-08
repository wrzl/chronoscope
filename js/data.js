/* ------------------------------------------------------------------
   Chart geometry — measured from the source image (1500 × 1500).
   All coordinates are in "world units": 1 unit = 1px of the chart at
   1500 × 1500. Any square scan of the same poster lines up (the imgur
   copy is 5000px, the original scan 13,500px).
------------------------------------------------------------------- */
window.CHART = {
  size: 1500,
  frame: { x0: 27, x1: 1472, y0: 43, y1: 1457 },
  // Linear time axis: x = X0 + (year - Y0) * PX_PER_YEAR
  axis: { X0: 44.65, Y0: -3100, PX_PER_YEAR: 0.27888, min: -3163, max: 2020 },
  source: {
    // 'tiles':  the pre-built 13,500px pyramid in assets/ (default). On GitHub
    //           Pages it is served by GitHub together with the site.
    // 'remote': one big image on an image host, tiled in the browser (imgur, 5000px)
    mode: 'tiles',
    remote: {
      full: 'https://i.imgur.com/dWN87KK.jpeg',     // 5000 × 5000 (imgur downscales uploads)
      size: 5000,
      preview: 'https://i.imgur.com/dWN87KKh.jpeg', // imgur 1024px thumbnail, shown instantly
      previewSize: 1024,
      thumb: 'https://i.imgur.com/dWN87KKm.jpeg',   // imgur 320px thumbnail, minimap
    },
    tiles: {
      // Folder holding base.webp, timeline-thumb.jpg and tiles/. Override with
      // window.CHRONO_TILE_ROOT (e.g. a jsDelivr URL) to serve them from elsewhere.
      root: 'assets/',
      base: { path: 'base.webp', size: 2048 },
      thumb: 'timeline-thumb.jpg',
      levels: [
        { size: 3375, n: 4 },
        { size: 6750, n: 7 },
        { size: 13500, n: 14 },
      ],
      path: (size, c, r) => `tiles/${size}/${c}_${r}.webp`,
    },
  },
};

window.yearToX = (y) => CHART.axis.X0 + (y - CHART.axis.Y0) * CHART.axis.PX_PER_YEAR;
window.xToYear = (x) => CHART.axis.Y0 + (x - CHART.axis.X0) / CHART.axis.PX_PER_YEAR;

window.fmtYear = (v, long = false) => {
  const y = Math.round(v);
  if (y === 0) return long ? '1 BCE / 1 CE' : '1 BCE';
  if (y < 0) return `${(-y).toLocaleString('en-US')} BCE`;
  return `${y} CE`;
};

/* Twelve regional bands, top to bottom */
window.REGIONS = [
  { id: 'saf',  name: 'Southern Africa',              short: 'S. Africa',   y0: 43,   y1: 211,  hue: 38 },
  { id: 'naf',  name: 'Northern Africa',              short: 'N. Africa',   y0: 211,  y1: 467,  hue: 28 },
  { id: 'eur',  name: 'Europe',                       short: 'Europe',      y0: 467,  y1: 656,  hue: 210 },
  { id: 'mesa', name: 'Middle East & South Asia',     short: 'M. East',     y0: 656,  y1: 819,  hue: 175 },
  { id: 'nca',  name: 'Northern & Central Asia',      short: 'C. Asia',     y0: 819,  y1: 905,  hue: 0 },
  { id: 'eas',  name: 'East Asia',                    short: 'E. Asia',     y0: 905,  y1: 985,  hue: 285 },
  { id: 'sea',  name: 'Southeast Asia',               short: 'SE Asia',     y0: 985,  y1: 1060, hue: 330 },
  { id: 'nna',  name: 'Northern North America',       short: 'N. N. Am.',   y0: 1060, y1: 1121, hue: 195 },
  { id: 'sna',  name: 'Southern North America',       short: 'S. N. Am.',   y0: 1121, y1: 1215, hue: 140 },
  { id: 'nsa',  name: 'Northern South America',       short: 'N. S. Am.',   y0: 1215, y1: 1331, hue: 90 },
  { id: 'sco',  name: 'Southern Cone',                short: 'S. Cone',     y0: 1331, y1: 1380, hue: 60 },
  { id: 'aus',  name: 'Australasia',                  short: 'Austral.',    y0: 1380, y1: 1443, hue: 15 },
];

/* Broad, conventional global eras for the era strip */
window.ERAS = [
  { name: 'Early Bronze Age',       from: -3163, to: -2000 },
  { name: 'Middle & Late Bronze Age', from: -2000, to: -1200 },
  { name: 'Iron Age',               from: -1200, to: -500 },
  { name: 'Classical Antiquity',    from: -500,  to: 500 },
  { name: 'Post-Classical',         from: 500,   to: 1500 },
  { name: 'Early Modern',           from: 1500,  to: 1800 },
  { name: 'Modern',                 from: 1800,  to: 2020 },
];

/* Guided tour stops. `y` / `h` = vertical centre / height of the focus box. */
window.STOPS = [
  {
    id: 'key', title: 'How to read the chart', region: 'Color key',
    rect: { x0: 95, x1: 432, y0: 117, y1: 284 }, years: 'Legend',
    text: 'Time runs left to right, decade by decade, from about 3100 BCE to the present. The world is cut into twelve regional bands, top to bottom. Each colored bar is a state or culture — colors group civilizations by language family (this key). Grey and pale bands are peoples without states: hunter-gatherers, farmers and nomads.',
  },
  {
    id: 'egypt-ok', title: 'Egyptian Old Kingdom', region: 'Northern Africa',
    from: -2686, to: -2181, y: 455, h: 18,
    text: 'The age of the pyramids. A centralized monarchy ruling from Memphis built the Step Pyramid of Djoser and the pyramids of Giza before fragmenting into the First Intermediate Period.',
  },
  {
    id: 'indus', title: 'Indus Valley Civilization', region: 'Middle East & South Asia',
    from: -2600, to: -1900, y: 771, h: 22,
    text: 'Planned cities such as Mohenjo-daro and Harappa — grid streets, covered drains, standardized weights — flourished along the Indus. Their script has never been deciphered.',
  },
  {
    id: 'egypt-nk', title: 'Egyptian New Kingdom', region: 'Northern Africa',
    from: -1550, to: -1070, y: 455, h: 18,
    text: 'Egypt at its imperial peak: Thutmose III, Akhenaten, Tutankhamun and Ramesses II, with power reaching into the Levant and deep into Nubia.',
  },
  {
    id: 'achaemenid', title: 'Achaemenid Empire', region: 'Middle East & South Asia',
    from: -550, to: -330, y: 720, h: 110,
    text: 'Founded by Cyrus the Great, Persia became the largest empire the world had yet seen — from the Aegean to the Indus — until Alexander the Great conquered it.',
  },
  {
    id: 'rome', title: 'Roman Empire', region: 'Europe',
    from: -27, to: 476, y: 628, h: 50,
    text: 'From Augustus to the fall of the last western emperor in 476, Rome ruled the Mediterranean world. Its eastern half lived on as the Byzantine Empire until 1453.',
  },
  {
    id: 'han', title: 'Han Dynasty', region: 'East Asia',
    from: -206, to: 220, y: 953, h: 26,
    text: 'The Western and Eastern Han unified China for four centuries, opened the Silk Road to the west and gave the Han Chinese their name.',
  },
  {
    id: 'maya', title: 'Classic Maya', region: 'Southern North America',
    from: 250, to: 900, y: 1182, h: 18,
    text: 'City-states such as Tikal, Calakmul and Palenque raised monumental pyramids and recorded their history in the Americas’ most complete writing system.',
  },
  {
    id: 'abbasid', title: 'Abbasid Caliphate', region: 'Middle East & South Asia',
    from: 750, to: 1258, y: 712, h: 70,
    text: 'Ruling from Baghdad, the Abbasids presided over the Islamic Golden Age of science and scholarship until the Mongols sacked the city in 1258.',
  },
  {
    id: 'horde', title: 'Golden Horde', region: 'Europe',
    from: 1242, to: 1502, y: 540, h: 34,
    text: 'A western successor state of the Mongol Empire, the Golden Horde dominated the Pontic steppe and held the Rus’ principalities in tribute for more than two centuries.',
  },
  {
    id: 'yuan-ming', title: 'Yuan & Ming China', region: 'East Asia',
    from: 1271, to: 1644, y: 942, h: 40,
    text: 'Kublai Khan’s Yuan dynasty put all of China under Mongol rule. The Ming dynasty that replaced it in 1368 built the Forbidden City and sent Zheng He’s treasure fleets across the Indian Ocean.',
  },
  {
    id: 'ottoman', title: 'Ottoman Empire', region: 'Middle East · Europe · N. Africa',
    from: 1299, to: 1922, y: 690, h: 44,
    text: 'From a small Anatolian principality to a power spanning three continents: the Ottomans took Constantinople in 1453 and endured until 1922.',
  },
  {
    id: 'mughal', title: 'Mughal Empire', region: 'Middle East & South Asia',
    from: 1526, to: 1857, y: 784, h: 30,
    text: 'Founded by Babur, the Mughals came to rule most of the Indian subcontinent. Akbar’s reforms and Shah Jahan’s Taj Mahal mark its height.',
  },
  {
    id: 'new-spain', title: 'New Spain', region: 'Southern North America',
    from: 1521, to: 1821, y: 1190, h: 34,
    text: 'After the fall of the Aztec capital Tenochtitlan in 1521, the Viceroyalty of New Spain ruled Mexico and much of Central America until independence in 1821.',
  },
  {
    id: 'qing', title: 'Qing Dynasty', region: 'East Asia',
    from: 1644, to: 1912, y: 942, h: 30,
    text: 'China’s last imperial dynasty, founded by the Manchus, roughly doubled the empire’s territory before falling to the 1911 revolution.',
  },
  {
    id: 'russia', title: 'Russian Empire → Soviet Union', region: 'Europe · Northern Asia',
    from: 1721, to: 1991, y: 535, h: 40,
    text: 'Proclaimed by Peter the Great in 1721, the Russian Empire spanned Eurasia. After the 1917 revolutions the Soviet Union took its place until it dissolved in 1991.',
  },
  {
    id: 'now', title: 'The world today', region: 'All regions',
    from: 1880, to: 2020, y: 750, h: 1400,
    text: 'The far right edge compresses colonial empires, two world wars, decolonization and today’s nation-states into a few columns — a reminder of how short the modern era is against five thousand years.',
  },
];
