// Standaardinhoud van de site. Wat de eigenaar via de bewerkmodus opslaat,
// komt uit de database en overschrijft deze waarden.
const H = (a, b) => [a * 60, b * 60];

export const DEFAULTS = {
  locations: [
    { id: "haacht", name: "Haacht", address: "Vekestraat 1, 3150 Haacht", phone: "+32470513916", chairs: 1, maps: "https://maps.app.goo.gl/KP83XtzVL5pKkiDQA", login: "haacht" },
    { id: "wilsele", name: "Wilsele", address: "Aarschotsesteenweg 664, 3012 Wilsele", phone: "+32492860437", chairs: 1, maps: "https://maps.app.goo.gl/obsEbNireDGvQCBF6", login: "wilsele" },
  ],

  // 0 = zondag … 6 = zaterdag · [open, sluit] in minuten na middernacht · null = gesloten
  hours: {
    haacht:  { 0: H(9, 18), 1: H(9, 18), 2: H(9, 19), 3: H(9, 19), 4: H(9, 19), 5: H(9, 19), 6: H(9, 18) },
    wilsele: { 0: H(10, 18), 1: H(10, 19), 2: H(10, 19), 3: H(10, 19), 4: H(10, 19), 5: H(10, 19), 6: H(10, 18) },
  },

  settings: { online_fee: 5, slot_min: 30, max_days: 14, min_notice: 30 },

  services: [
    { id: "heren", label: "Heren", sub: "", icon: "✂️", items: [
      { id: "heren-knippen", name: "Knippen", min: 30, price: 20, desc: "Klassieke herensnit met schaar en tondeuse, strak afgewerkt." },
      { id: "heren-wassen-knippen", name: "Wassen & knippen", min: 35, price: 25, desc: "Opfrissende wasbeurt, gevolgd door je knipbeurt." },
      { id: "heren-baard-haar", name: "Baard & haar", min: 45, price: 35, desc: "De volledige behandeling van haar en baard.", featured: true },
      { id: "heren-baard", name: "Baard scheren met/of aflijnen", min: 25, price: 20, desc: "Scheren of strak aflijnen met het mes." },
      { id: "heren-bruid-vip", name: "Bruid VIP", min: 60, price: 50, desc: "De complete VIP-behandeling voor de grote dag." },
    ] },
    { id: "kinderen", label: "Kinderen", sub: "onder 10 jaar", icon: "👦", items: [
      { id: "kinderen-jongens", name: "Jongens", min: 25, price: 15, desc: "Fris en vlot geknipt, met geduld voor de jongste klanten." },
      { id: "kinderen-fade", name: "Fade", min: 30, price: 20, desc: "Een strakke fade voor de kleine heren." },
      { id: "kinderen-meisjes", name: "Meisjes", min: 25, price: 20, desc: "Knippen voor meisjes tot 10 jaar." },
    ] },
    { id: "dames", label: "Dames", sub: "", icon: "👩", items: [
      { id: "dames-knippen", name: "Knippen", min: 35, price: 25, desc: "Knippen op maat." },
      { id: "dames-wassen", name: "Wassen & handdoeken", min: 25, price: 15, desc: "Wassen en verzorgen." },
      { id: "dames-wassen-knippen", name: "Wassen, knippen & handdoeken", min: 50, price: 30, desc: "De complete behandeling." },
    ] },
  ],

  gallery: [
    { src: "img/textured-fringe.jpg", label: "Textured fringe", cap: "Textured fringe met taper", alt: "Textured fringe met taper fade", size: "tall" },
    { src: "img/textured-crop.jpg", label: "Textured crop", cap: "Textured crop", alt: "Textured crop met fade", size: "" },
    { src: "img/skin-fade.jpg", label: "Skin fade", cap: "Skin fade", alt: "Skin fade met strakke lijn", size: "" },
    { src: "img/uithangbord.jpg", label: "Wilsele", cap: "Aarschotsesteenweg 664, Wilsele", alt: "Uithangbord van Classic Barber Shop in Wilsele", size: "tall" },
    { src: "img/fade-baard.jpg", label: "Fade & baard", cap: "Fade met baard", alt: "Fade met strak afgelijnde baard", size: "" },
    { src: "img/curly-cut.jpg", label: "Curly cut", cap: "Curly cut", alt: "Krullen met taper", size: "" },
    { src: "img/gevel.jpg", label: "Wilsele", cap: "Classic Barbershop, Wilsele", alt: "Gevel van Classic Barbershop in Wilsele met barberpaal", size: "wide" },
    { src: "img/haacht-gevel.jpg", label: "Haacht", cap: "Classic Barbershop by Ali, Haacht", alt: "Gevel van Classic Barbershop in Haacht", size: "wide" },
  ],

  // Losse foto's op de pagina (data-img="…"); leeg = de foto uit de HTML
  images: {},
  // Teksten op de pagina (data-edit="…"); leeg = de tekst uit de HTML
  texts: {},
};

export const CONTENT_KEYS = Object.keys(DEFAULTS);
