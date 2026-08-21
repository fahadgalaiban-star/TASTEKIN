import { useMemo, useState } from "react";
import {
  Archive,
  Bookmark,
  Check,
  Compass,
  Filter,
  Heart,
  LayoutGrid,
  LockKeyhole,
  MoreHorizontal,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";

type View = "stream" | "saved" | "collections" | "about";
type Lane = "All" | "Style" | "Travel" | "Places" | "Routines";
type Language = "en" | "ar";

type Edit = {
  id: string;
  lane: Exclude<Lane, "All">;
  title: string;
  subtitle: string;
  note: string;
  image: string;
  preview?: string;
  locked?: boolean;
};

const edits: Edit[] = [
  {
    id: "quiet-tailoring",
    lane: "Style",
    title: "Quiet tailoring",
    subtitle: "A softer structure for a long city day.",
    note: "Start with one generous jacket, then keep everything else close to the body. The contrast is what makes the look feel considered.",
    image: "/__mockup/images/tastekin/media/quiet-tailoring.webp",
  },
  {
    id: "private-hotel",
    lane: "Travel",
    title: "Private hotel weekend",
    subtitle: "The stay, the packing list, and where I ate.",
    note: "The best room is the one that lets the morning arrive slowly. I kept this itinerary deliberately small.",
    image: "/__mockup/images/tastekin/media/private-hotel-preview.webp",
    preview: "/__mockup/images/tastekin/media/private-hotel-preview.webp",
    locked: true,
  },
  {
    id: "coastal-notes",
    lane: "Travel",
    title: "Coastal notes",
    subtitle: "Wind, coffee, and open horizons.",
    note: "A three-stop route with enough space between each stop to notice where you are.",
    image: "/__mockup/images/tastekin/media/coastal-notes.webp",
  },
  {
    id: "places-returning",
    lane: "Places",
    title: "Places worth returning to",
    subtitle: "A Kuwaiti table and a London room.",
    note: "Good places leave a texture behind. These are the ones I still think about on ordinary Tuesdays.",
    image: "/__mockup/images/tastekin/media/places-returning.webp",
  },
  {
    id: "hotel-breakfast",
    lane: "Places",
    title: "Hotel breakfast, unhurried",
    subtitle: "My private list for a considered morning.",
    note: "The list is less about the menu and more about the light, the room, and the decision to stay another ten minutes.",
    image: "/__mockup/images/tastekin/media/hotel-breakfast-source.webp",
    preview: "/__mockup/images/tastekin/media/hotel-breakfast-preview.webp",
    locked: true,
  },
  {
    id: "sunday-reset",
    lane: "Routines",
    title: "Sunday reset",
    subtitle: "Movement, food, and a realistic plan.",
    note: "A reset that does not ask you to become a different person by Monday.",
    image: "/__mockup/images/tastekin/media/sunday-reset.webp",
  },
];

const lanes: Lane[] = ["All", "Style", "Travel", "Places", "Routines"];

const collections = [
  {
    name: "Quiet Luxury",
    count: "04 edits",
    copy: "Tailoring, materials, and a quieter way to dress.",
    image: "/__mockup/images/tastekin/media/quiet-tailoring.webp",
    color: "clay",
  },
  {
    name: "The Coastal Edit",
    count: "04 edits",
    copy: "Places, packing, and private travel notes.",
    image: "/__mockup/images/tastekin/media/private-hotel-preview.webp",
    color: "ink",
  },
];

export function TastekinSignalPreview() {
  const [view, setView] = useState<View>("stream");
  const [lane, setLane] = useState<Lane>("All");
  const [language, setLanguage] = useState<Language>("en");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("quiet-tailoring");
  const [saved, setSaved] = useState<string[]>(["places-returning"]);
  const [following, setFollowing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selected = edits.find((edit) => edit.id === selectedId) ?? edits[0];
  const copy = language === "ar"
    ? {
        stream: "خريطة الذوق",
        saved: "المحفوظات",
        collections: "المجموعات",
        about: "عن فهيد",
        eyebrow: "منتقى لفهيد العليبان",
        title: "ذوقك، في حركة.",
        intro: "مساحة هادئة تجمع ما يستحق انتباهك، لا ما يطلبه انتباه الجميع.",
        focus: "اختيار اليوم",
        follow: following ? "تتابعه" : "تابع",
        subscribe: subscribed ? "اشتراكك نشط" : "اشترك · ١٩٫٩٩$",
        save: saved.includes(selected.id) ? "تم الحفظ" : "احفظ الاختيار",
      }
    : {
        stream: "Taste map",
        saved: "Saved",
        collections: "Collections",
        about: "About Fheed",
        eyebrow: "Curated by Fheed Alaiban",
        title: "Your taste, in motion.",
        intro: "A quiet workspace for the things worth your attention — not the things asking for everyone’s.",
        focus: "Today’s focus",
        follow: following ? "Following" : "Follow",
        subscribe: subscribed ? "Subscribed" : "Subscribe · $19.99",
        save: saved.includes(selected.id) ? "Saved to library" : "Save to library",
      };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return edits.filter((edit) => {
      const inView = view === "saved" ? saved.includes(edit.id) : true;
      const inLane = lane === "All" || edit.lane === lane;
      const matches = !needle || `${edit.title} ${edit.subtitle} ${edit.lane}`.toLowerCase().includes(needle);
      return inView && inLane && matches;
    });
  }, [lane, query, saved, view]);

  const toggleSaved = (id: string) => {
    setSaved((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };

  const selectEdit = (id: string) => {
    setSelectedId(id);
    if (window.innerWidth < 980) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="ts-preview" dir={language === "ar" ? "rtl" : "ltr"}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap');
        .ts-preview {
          --ts-ink: #252b29;
          --ts-muted: #737772;
          --ts-paper: #f5f2ec;
          --ts-card: #fbfaf7;
          --ts-line: #ddd9d1;
          --ts-clay: #b55d42;
          --ts-clay-dark: #8b3f2d;
          --ts-sage: #dbe2d3;
          min-height: 100dvh; color: var(--ts-ink); background: var(--ts-paper);
          font-family: 'DM Sans', sans-serif; overflow-x: hidden;
        }
        .ts-preview * { box-sizing: border-box; }
        .ts-preview button, .ts-preview input { font: inherit; }
        .ts-preview button { color: inherit; cursor: pointer; }
        .ts-header { align-items: center; border-bottom: 1px solid var(--ts-line); display: flex; height: 78px; justify-content: space-between; padding: 0 clamp(18px, 4vw, 58px); position: sticky; top: 0; z-index: 5; background: rgba(245,242,236,.93); backdrop-filter: blur(18px); }
        .ts-brand { align-items: center; display: flex; gap: 11px; letter-spacing: .14em; font-size: 12px; font-weight: 700; }
        .ts-brand-mark { align-items: center; background: var(--ts-ink); border-radius: 50%; color: var(--ts-paper); display: flex; font-family: 'Playfair Display', serif; font-size: 18px; height: 31px; justify-content: center; letter-spacing: 0; width: 31px; }
        .ts-header-center { color: var(--ts-muted); font-size: 11px; letter-spacing: .18em; text-transform: uppercase; }
        .ts-header-actions { align-items: center; display: flex; gap: 10px; }
        .ts-search { align-items: center; background: transparent; border: 1px solid var(--ts-line); border-radius: 99px; color: var(--ts-muted); display: flex; gap: 8px; padding: 9px 13px; width: min(220px, 24vw); }
        .ts-search input { background: transparent; border: 0; color: var(--ts-ink); min-width: 0; outline: 0; width: 100%; }
        .ts-search input::placeholder { color: #979a94; }
        .ts-icon-btn { align-items: center; background: transparent; border: 1px solid transparent; border-radius: 50%; display: inline-flex; height: 36px; justify-content: center; transition: background .2s ease, border-color .2s ease; width: 36px; }
        .ts-icon-btn:hover { background: var(--ts-card); border-color: var(--ts-line); }
        .ts-layout { display: grid; gap: clamp(22px, 3vw, 48px); grid-template-columns: 208px minmax(0, 1fr) 318px; margin: 0 auto; max-width: 1480px; padding: 34px clamp(18px, 4vw, 58px) 70px; }
        .ts-rail { align-self: start; position: sticky; top: 112px; }
        .ts-profile-mini { border-bottom: 1px solid var(--ts-line); padding-bottom: 24px; }
        .ts-avatar { border-radius: 50%; height: 50px; object-fit: cover; width: 50px; }
        .ts-mini-row { align-items: center; display: flex; gap: 11px; }
        .ts-mini-name { font-size: 13px; font-weight: 700; margin: 0; }
        .ts-mini-handle { color: var(--ts-muted); font-size: 11px; margin-top: 3px; }
        .ts-verified { align-items: center; background: var(--ts-clay); border-radius: 50%; color: #fff; display: inline-flex; height: 14px; justify-content: center; margin-left: 4px; vertical-align: 1px; width: 14px; }
        .ts-nav { display: grid; gap: 6px; padding: 26px 0; }
        .ts-nav-btn { align-items: center; background: transparent; border: 0; border-radius: 8px; color: var(--ts-muted); display: flex; font-size: 12px; gap: 11px; padding: 11px 10px; text-align: start; transition: color .2s ease, background .2s ease; width: 100%; }
        .ts-nav-btn:hover, .ts-nav-btn.is-active { background: #e9e6df; color: var(--ts-ink); }
        .ts-nav-btn.is-active { font-weight: 700; }
        .ts-rail-note { background: var(--ts-sage); border-radius: 8px; margin-top: 12px; padding: 14px; }
        .ts-rail-note span, .ts-overline, .ts-kicker { color: var(--ts-clay-dark); display: block; font-size: 9px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
        .ts-rail-note p { font-family: 'Playfair Display', serif; font-size: 15px; line-height: 1.25; margin: 9px 0 0; }
        .ts-main { min-width: 0; }
        .ts-intro { display: flex; justify-content: space-between; gap: 28px; margin-bottom: 31px; }
        .ts-intro h1 { font-family: 'Playfair Display', serif; font-size: clamp(37px, 4vw, 62px); font-weight: 600; letter-spacing: -.045em; line-height: .98; margin: 11px 0 15px; max-width: 650px; }
        .ts-intro p { color: var(--ts-muted); font-size: 14px; line-height: 1.6; margin: 0; max-width: 545px; }
        .ts-pulse { align-items: flex-end; display: flex; flex-direction: column; justify-content: flex-end; min-width: 130px; }
        .ts-pulse strong { font-family: 'Playfair Display', serif; font-size: 37px; font-weight: 500; line-height: 1; }
        .ts-pulse span { color: var(--ts-muted); font-size: 10px; letter-spacing: .1em; margin-top: 7px; text-transform: uppercase; }
        .ts-lane-row { align-items: center; border-bottom: 1px solid var(--ts-line); display: flex; gap: 5px; margin-bottom: 22px; overflow-x: auto; padding-bottom: 0; scrollbar-width: none; }
        .ts-lane-row::-webkit-scrollbar { display: none; }
        .ts-lane { background: transparent; border: 0; color: var(--ts-muted); font-size: 11px; padding: 0 15px 13px; position: relative; white-space: nowrap; }
        .ts-lane:first-child { padding-left: 0; }
        .ts-lane.is-active { color: var(--ts-ink); font-weight: 700; }
        .ts-lane.is-active::after { background: var(--ts-clay); bottom: -1px; content: ''; height: 2px; left: 15px; position: absolute; right: 15px; }
        .ts-lane:first-child.is-active::after { left: 0; }
        .ts-grid { display: grid; gap: 13px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ts-card { background: var(--ts-card); border: 1px solid transparent; padding: 0; text-align: start; transition: border-color .2s ease, transform .2s ease; }
        .ts-card:hover, .ts-card.is-selected { border-color: var(--ts-clay); transform: translateY(-2px); }
        .ts-card:nth-child(1) { grid-row: span 2; }
        .ts-art { aspect-ratio: 1.16; overflow: hidden; position: relative; }
        .ts-card:nth-child(1) .ts-art { aspect-ratio: .83; }
        .ts-art::after { background: linear-gradient(180deg, transparent 58%, rgba(31,32,27,.28)); content: ''; inset: 0; pointer-events: none; position: absolute; }
        .ts-art img { height: 100%; object-fit: cover; transition: transform .45s ease; width: 100%; }
        .ts-card:hover .ts-art img { transform: scale(1.035); }
        .ts-chip { align-items: center; background: rgba(250,248,242,.92); border-radius: 99px; bottom: 10px; color: var(--ts-ink); display: inline-flex; font-size: 9px; gap: 5px; left: 10px; letter-spacing: .04em; padding: 7px 9px; position: absolute; z-index: 1; }
        .ts-chip.locked { background: var(--ts-ink); color: var(--ts-paper); }
        .ts-card-copy { padding: 13px 13px 15px; }
        .ts-card-copy strong { display: block; font-family: 'Playfair Display', serif; font-size: 19px; font-weight: 600; }
        .ts-card-copy span { color: var(--ts-muted); display: block; font-size: 11px; line-height: 1.35; margin-top: 5px; }
        .ts-inspector { align-self: start; position: sticky; top: 112px; }
        .ts-inspector-head { align-items: center; display: flex; justify-content: space-between; margin-bottom: 13px; }
        .ts-inspector-head strong { font-size: 11px; letter-spacing: .13em; text-transform: uppercase; }
        .ts-inspector-panel { background: var(--ts-card); border: 1px solid var(--ts-line); }
        .ts-inspector-art { aspect-ratio: 1.08; overflow: hidden; position: relative; }
        .ts-inspector-art img { height: 100%; object-fit: cover; width: 100%; }
        .ts-inspector-art.is-locked img { filter: saturate(.4) blur(1px); }
        .ts-lock { align-items: center; background: rgba(37,43,41,.82); color: var(--ts-paper); display: flex; flex-direction: column; inset: 0; justify-content: center; position: absolute; text-align: center; }
        .ts-lock-icon { align-items: center; border: 1px solid rgba(245,242,236,.55); border-radius: 50%; display: flex; height: 34px; justify-content: center; margin-bottom: 10px; width: 34px; }
        .ts-lock strong { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 500; max-width: 180px; }
        .ts-inspector-copy { padding: 20px; }
        .ts-inspector-copy h2 { font-family: 'Playfair Display', serif; font-size: 28px; line-height: 1.02; margin: 8px 0 9px; }
        .ts-inspector-copy > p { color: var(--ts-muted); font-size: 12px; line-height: 1.55; margin: 0; }
        .ts-note { border-left: 2px solid var(--ts-clay); margin: 20px 0; padding-left: 12px; }
        .ts-note p { font-family: 'Playfair Display', serif; font-size: 15px; line-height: 1.45; margin: 0; }
        .ts-action-row { display: flex; gap: 7px; }
        .ts-button { align-items: center; background: transparent; border: 1px solid var(--ts-line); border-radius: 5px; display: inline-flex; font-size: 11px; font-weight: 700; gap: 7px; justify-content: center; min-height: 38px; padding: 0 13px; transition: background .2s ease, border-color .2s ease, color .2s ease; }
        .ts-button:hover { border-color: var(--ts-ink); }
        .ts-button.primary { background: var(--ts-ink); border-color: var(--ts-ink); color: var(--ts-paper); }
        .ts-button.primary:hover { background: var(--ts-clay-dark); border-color: var(--ts-clay-dark); }
        .ts-button.full { flex: 1; width: 100%; }
        .ts-button.saved { background: var(--ts-sage); border-color: var(--ts-sage); }
        .ts-subscribe { background: #e6d2c3; margin-top: 13px; padding: 17px; }
        .ts-subscribe h3 { font-family: 'Playfair Display', serif; font-size: 19px; font-weight: 600; margin: 0 0 5px; }
        .ts-subscribe p { color: #6b5549; font-size: 11px; line-height: 1.45; margin: 0 0 13px; }
        .ts-subscribe .ts-button { border-color: rgba(88,57,43,.3); }
        .ts-creator { align-items: center; border-bottom: 1px solid var(--ts-line); display: flex; gap: 11px; margin-bottom: 16px; padding-bottom: 16px; }
        .ts-creator-copy { flex: 1; }
        .ts-creator-copy strong { display: block; font-size: 12px; }
        .ts-creator-copy span { color: var(--ts-muted); display: block; font-size: 10px; margin-top: 4px; }
        .ts-follow { background: transparent; border: 1px solid var(--ts-line); border-radius: 99px; font-size: 10px; padding: 7px 10px; }
        .ts-follow.is-active { background: var(--ts-sage); border-color: var(--ts-sage); }
        .ts-section-title { align-items: baseline; display: flex; justify-content: space-between; margin: 32px 0 14px; }
        .ts-section-title h2 { font-family: 'Playfair Display', serif; font-size: 24px; margin: 0; }
        .ts-section-title span { color: var(--ts-muted); font-size: 10px; }
        .ts-panel-line { align-items: flex-start; border-top: 1px solid var(--ts-line); color: var(--ts-muted); display: flex; font-size: 11px; gap: 10px; line-height: 1.45; padding: 12px 0; }
        .ts-stats { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); }
        .ts-stat { background: #ebe8e0; padding: 12px; }
        .ts-stat strong { display: block; font-family: 'Playfair Display', serif; font-size: 23px; }
        .ts-stat span { color: var(--ts-muted); font-size: 9px; letter-spacing: .04em; text-transform: uppercase; }
        .ts-collection-grid { display: grid; gap: 13px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ts-collection { background: var(--ts-card); border: 1px solid var(--ts-line); text-align: start; }
        .ts-collection-art { aspect-ratio: 1.6; overflow: hidden; }
        .ts-collection-art img { height: 100%; object-fit: cover; width: 100%; }
        .ts-collection-copy { padding: 15px; }
        .ts-collection-copy strong { font-family: 'Playfair Display', serif; font-size: 19px; }
        .ts-collection-copy span, .ts-collection-copy p { color: var(--ts-muted); display: block; font-size: 10px; line-height: 1.45; margin: 6px 0 0; }
        .ts-about { background: var(--ts-sage); padding: clamp(24px, 4vw, 52px); }
        .ts-about h2 { font-family: 'Playfair Display', serif; font-size: clamp(34px, 5vw, 62px); line-height: .95; margin: 14px 0 20px; max-width: 530px; }
        .ts-about p { color: #556052; font-size: 14px; line-height: 1.7; max-width: 520px; }
        .ts-about-list { border-top: 1px solid rgba(55,75,58,.23); margin-top: 30px; max-width: 520px; }
        .ts-about-item { align-items: center; border-bottom: 1px solid rgba(55,75,58,.23); display: flex; justify-content: space-between; padding: 13px 0; }
        .ts-about-item span { color: #647061; font-size: 11px; }
        .ts-empty { background: var(--ts-card); border: 1px dashed var(--ts-line); color: var(--ts-muted); font-size: 13px; line-height: 1.5; padding: 45px 20px; text-align: center; }
        .ts-settings { background: rgba(37,43,41,.35); inset: 0; position: fixed; z-index: 20; }
        .ts-settings-card { background: var(--ts-paper); box-shadow: -20px 0 55px rgba(37,43,41,.12); height: 100%; margin-left: auto; max-width: 385px; padding: 27px; width: 100%; }
        .ts-settings-head { align-items: center; display: flex; justify-content: space-between; margin-bottom: 34px; }
        .ts-settings-head h2 { font-family: 'Playfair Display', serif; font-size: 25px; margin: 0; }
        .ts-setting-label { color: var(--ts-muted); display: block; font-size: 10px; letter-spacing: .12em; margin: 22px 0 9px; text-transform: uppercase; }
        .ts-segment { border: 1px solid var(--ts-line); display: grid; grid-template-columns: 1fr 1fr; padding: 3px; }
        .ts-segment button { background: transparent; border: 0; font-size: 11px; padding: 10px; }
        .ts-segment button.is-active { background: var(--ts-ink); color: var(--ts-paper); }
        .ts-mobile-bar { display: none; }
        @media (max-width: 1050px) {
          .ts-layout { grid-template-columns: 180px minmax(0, 1fr); }
          .ts-inspector { grid-column: 2; position: static; }
          .ts-inspector-panel { display: grid; grid-template-columns: minmax(180px, .9fr) 1fr; }
          .ts-inspector-art { aspect-ratio: auto; min-height: 250px; }
        }
        @media (max-width: 720px) {
          .ts-header { height: 63px; padding: 0 16px; }
          .ts-header-center { display: none; }
          .ts-brand { font-size: 10px; }
          .ts-search { width: 36px; }
          .ts-search input { display: none; }
          .ts-layout { display: block; padding: 25px 16px 92px; }
          .ts-rail { position: static; }
          .ts-profile-mini { align-items: center; border: 0; display: flex; justify-content: space-between; padding-bottom: 24px; }
          .ts-nav, .ts-rail-note { display: none; }
          .ts-intro { display: block; margin-bottom: 24px; }
          .ts-intro h1 { font-size: 46px; }
          .ts-pulse { align-items: flex-start; display: block; margin-top: 20px; }
          .ts-pulse strong { font-size: 28px; }
          .ts-grid { gap: 9px; }
          .ts-card:nth-child(1) { grid-row: auto; }
          .ts-card:nth-child(1) .ts-art { aspect-ratio: 1.16; }
          .ts-card-copy { padding: 10px; }
          .ts-card-copy strong { font-size: 16px; }
          .ts-card-copy span { font-size: 10px; }
          .ts-inspector { margin-top: 34px; }
          .ts-inspector-panel { display: block; }
          .ts-inspector-art { aspect-ratio: 1.08; min-height: 0; }
          .ts-collection-grid { grid-template-columns: 1fr; }
          .ts-mobile-bar { background: rgba(245,242,236,.95); border-top: 1px solid var(--ts-line); bottom: 0; display: grid; grid-template-columns: repeat(4, 1fr); left: 0; padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); position: fixed; right: 0; z-index: 10; }
          .ts-mobile-bar button { align-items: center; background: transparent; border: 0; color: var(--ts-muted); display: flex; flex-direction: column; font-size: 9px; gap: 4px; }
          .ts-mobile-bar button.is-active { color: var(--ts-clay-dark); font-weight: 700; }
        }
      `}</style>

      <header className="ts-header">
        <div className="ts-brand"><span className="ts-brand-mark">t</span><span>TASTEKIN</span></div>
        <div className="ts-header-center">{copy.stream} / Fheed Alaiban</div>
        <div className="ts-header-actions">
          <label className="ts-search">
            <Search size={15} />
            <input aria-label="Search taste edits" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the map" />
          </label>
          <button className="ts-icon-btn" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
        </div>
      </header>

      <div className="ts-layout">
        <aside className="ts-rail">
          <div className="ts-profile-mini">
            <div className="ts-mini-row">
              <img className="ts-avatar" src="/__mockup/images/tastekin/media/fheed-profile.webp" alt="Fheed Alaiban" />
              <div><p className="ts-mini-name">Fheed Alaiban <span className="ts-verified"><Check size={9} /></span></p><span className="ts-mini-handle">@fheed · Kuwait City</span></div>
            </div>
            <button className={`ts-follow ${following ? "is-active" : ""}`} type="button" onClick={() => setFollowing(!following)}>{copy.follow}</button>
          </div>
          <nav className="ts-nav" aria-label="Tastekin sections">
            {([
              ["stream", Compass, copy.stream],
              ["saved", Bookmark, copy.saved],
              ["collections", LayoutGrid, copy.collections],
              ["about", Archive, copy.about],
            ] as const).map(([id, Icon, label]) => (
              <button key={id} className={`ts-nav-btn ${view === id ? "is-active" : ""}`} type="button" onClick={() => setView(id)}><Icon size={16} />{label}</button>
            ))}
          </nav>
          <div className="ts-rail-note"><span>Your current signal</span><p>Low noise. Strong texture.</p><Zap size={15} style={{ marginTop: 13 }} /></div>
        </aside>

        <main className="ts-main">
          {view === "stream" && (
            <>
              <section className="ts-intro">
                <div><span className="ts-overline">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.intro}</p></div>
                <div className="ts-pulse"><strong>92%</strong><span>taste match with Fheed</span></div>
              </section>
              <div className="ts-lane-row" aria-label="Taste lanes">
                <Filter size={14} style={{ color: "var(--ts-muted)", marginInlineEnd: 5, marginBottom: 12 }} />
                {lanes.map((item) => <button key={item} className={`ts-lane ${lane === item ? "is-active" : ""}`} type="button" onClick={() => setLane(item)}>{item}</button>)}
              </div>
              <section className="ts-grid" aria-label="Curated edits">
                {filtered.map((edit) => {
                  const isLocked = Boolean(edit.locked && !subscribed);
                  return <button key={edit.id} className={`ts-card ${selected.id === edit.id ? "is-selected" : ""}`} type="button" onClick={() => selectEdit(edit.id)}>
                    <div className="ts-art">
                      <img src={isLocked ? edit.preview : edit.image} alt="" />
                      <span className={`ts-chip ${isLocked ? "locked" : ""}`}>{isLocked ? <><LockKeyhole size={10} />Subscribers</> : edit.lane}</span>
                    </div>
                    <div className="ts-card-copy"><strong>{edit.title}</strong><span>{edit.subtitle}</span></div>
                  </button>;
                })}
                {!filtered.length && <div className="ts-empty" style={{ gridColumn: "1 / -1" }}>No saved signals match this search. Try another lane.</div>}
              </section>
            </>
          )}

          {view === "saved" && (
            <>
              <section className="ts-intro"><div><span className="ts-overline">Your library</span><h1>Keep what stays with you.</h1><p>Saved edits become a smaller, more useful map — ready when you need a little direction.</p></div></section>
              <section className="ts-grid">{filtered.map((edit) => <button key={edit.id} className={`ts-card ${selected.id === edit.id ? "is-selected" : ""}`} type="button" onClick={() => selectEdit(edit.id)}><div className="ts-art"><img src={edit.locked && !subscribed ? edit.preview : edit.image} alt="" /><span className="ts-chip"><Bookmark size={10} fill="currentColor" />Saved</span></div><div className="ts-card-copy"><strong>{edit.title}</strong><span>{edit.subtitle}</span></div></button>)}{!filtered.length && <div className="ts-empty" style={{ gridColumn: "1 / -1" }}>Your library is waiting for its first good idea. Save an edit from the map.</div>}</section>
            </>
          )}

          {view === "collections" && (
            <>
              <section className="ts-intro"><div><span className="ts-overline">The long view</span><h1>Collections with a point of view.</h1><p>Go somewhere deeper than a single post. Each collection is a complete taste world, assembled slowly.</p></div></section>
              <div className="ts-collection-grid">{collections.map((collection) => <button className="ts-collection" key={collection.name} type="button" onClick={() => { const first = edits.find((edit) => edit.image === collection.image) ?? edits[0]; selectEdit(first.id); setView("stream"); }}><div className="ts-collection-art"><img src={collection.image} alt="" /></div><div className="ts-collection-copy"><strong>{collection.name}</strong><span>{collection.count}</span><p>{collection.copy}</p></div></button>)}</div>
            </>
          )}

          {view === "about" && (
            <section className="ts-about"><span className="ts-overline">A creator, not a content machine</span><h2>A more personal way to find what fits.</h2><p>Fheed Alaiban shares considered style, places worth returning to, quiet travel notes, and routines that make ordinary life feel better. Tastekin keeps the context attached — the why behind the choice.</p><div className="ts-about-list"><div className="ts-about-item"><strong>Based in</strong><span>Kuwait City, Kuwait</span></div><div className="ts-about-item"><strong>Signals</strong><span>Style · Travel · Places · Routines</span></div><div className="ts-about-item"><strong>Transparency</strong><span>Partnerships are always labelled</span></div></div></section>
          )}

          {view === "stream" && <section className="ts-stats"><div className="ts-stat"><strong>09</strong><span>edits in orbit</span></div><div className="ts-stat"><strong>02</strong><span>complete worlds</span></div><div className="ts-stat"><strong>04</strong><span>taste lanes</span></div></section>}
        </main>

        <aside className="ts-inspector">
          <div className="ts-inspector-head"><strong>{copy.focus}</strong><button className="ts-icon-btn" type="button" aria-label="More focus options"><MoreHorizontal size={17} /></button></div>
          <div className="ts-creator"><img className="ts-avatar" src="/__mockup/images/tastekin/media/fheed-profile.webp" alt="" /><div className="ts-creator-copy"><strong>Fheed Alaiban</strong><span>Style · Travel · Places</span></div><span className="ts-verified"><Check size={9} /></span></div>
          <div className={`ts-inspector-panel ${selected.locked && !subscribed ? "is-locked" : ""}`}>
            <div className={`ts-inspector-art ${selected.locked && !subscribed ? "is-locked" : ""}`}><img src={selected.locked && !subscribed ? selected.preview : selected.image} alt="" />{selected.locked && !subscribed && <div className="ts-lock"><span className="ts-lock-icon"><LockKeyhole size={15} /></span><strong>There is more to this story.</strong></div>}</div>
            <div className="ts-inspector-copy">
              <span className="ts-kicker">{selected.locked && !subscribed ? "Subscribers only" : selected.lane}</span>
              <h2>{selected.title}</h2>
              <p>{selected.subtitle}</p>
              {selected.locked && !subscribed ? <div className="ts-subscribe"><h3>Unlock the full edit</h3><p>Private notes, exact places, and the details that make the recommendation useful.</p><button className="ts-button primary full" type="button" onClick={() => setSubscribed(true)}>{copy.subscribe}</button></div> : <><div className="ts-note"><p>{selected.note}</p></div><div className="ts-action-row"><button className={`ts-button full ${saved.includes(selected.id) ? "saved" : ""}`} type="button" onClick={() => toggleSaved(selected.id)}><Bookmark size={14} fill={saved.includes(selected.id) ? "currentColor" : "none"} />{copy.save}</button><button className="ts-button" type="button" aria-label="Share edit"><Share2 size={14} /></button><button className="ts-button" type="button" aria-label="Like edit"><Heart size={14} /></button></div></>}
            </div>
          </div>
          <div className="ts-section-title"><h2>Signal notes</h2><span>updated today</span></div>
          <div className="ts-panel-line"><Sparkles size={15} style={{ color: "var(--ts-clay)" }} /><span>Hand-picked for your saved places and neutral palettes.</span></div>
          <div className="ts-panel-line"><Star size={15} style={{ color: "var(--ts-clay)" }} /><span>Trust is part of the recommendation: context stays visible.</span></div>
        </aside>
      </div>

      <nav className="ts-mobile-bar" aria-label="Mobile navigation">
        {([
          ["stream", Compass, copy.stream],
          ["saved", Bookmark, copy.saved],
          ["collections", LayoutGrid, copy.collections],
          ["about", Archive, copy.about],
        ] as const).map(([id, Icon, label]) => <button key={id} className={view === id ? "is-active" : ""} type="button" onClick={() => setView(id)}><Icon size={17} /><span>{label}</span></button>)}
      </nav>

      {settingsOpen && <div className="ts-settings" role="dialog" aria-modal="true" aria-label="Preview settings" onClick={() => setSettingsOpen(false)}>
        <section className="ts-settings-card" onClick={(event) => event.stopPropagation()}>
          <div className="ts-settings-head"><h2>Preview settings</h2><button className="ts-icon-btn" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
          <span className="ts-setting-label">Interface language</span>
          <div className="ts-segment"><button className={language === "en" ? "is-active" : ""} type="button" onClick={() => setLanguage("en")}>English</button><button className={language === "ar" ? "is-active" : ""} type="button" onClick={() => setLanguage("ar")}>العربية</button></div>
          <span className="ts-setting-label">Creator connection</span>
          <button className={`ts-button full ${following ? "saved" : ""}`} type="button" onClick={() => setFollowing(!following)}>{following ? "Following Fheed" : "Follow Fheed"}</button>
          <span className="ts-setting-label">Subscription preview</span>
          <button className={`ts-button full ${subscribed ? "saved" : "primary"}`} type="button" onClick={() => setSubscribed(!subscribed)}>{subscribed ? "Reset test subscription" : "Unlock subscriber view"}</button>
        </section>
      </div>}
    </div>
  );
}