import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronRight,
  CircleUserRound,
  Compass,
  Heart,
  LockKeyhole,
  Menu,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

import "./tastekin-atlas-preview.css";

type Category = "All" | "Style" | "Travel" | "Places" | "Routines";
type Note = {
  id: string;
  category: Exclude<Category, "All">;
  title: string;
  eyebrow: string;
  caption: string;
  image: string;
  locked?: boolean;
  tint: string;
};

const notes: Note[] = [
  {
    id: "quiet-tailoring",
    category: "Style",
    eyebrow: "STYLE / 01",
    title: "Quiet tailoring",
    caption: "A soft-structured look for a long city day.",
    image: "/__mockup/images/tastekin/media/quiet-tailoring.webp",
    tint: "#d9d4c5",
  },
  {
    id: "coastal-notes",
    category: "Travel",
    eyebrow: "TRAVEL / 04",
    title: "Coastal notes",
    caption: "Wind, coffee, and an itinerary with room to drift.",
    image: "/__mockup/images/tastekin/media/coastal-notes.webp",
    tint: "#c5d5d1",
  },
  {
    id: "private-hotel",
    category: "Travel",
    eyebrow: "TRAVEL / 09",
    title: "Private hotel weekend",
    caption: "The stay, the packing list, and where I ate.",
    image: "/__mockup/images/tastekin/media/private-hotel-preview.webp",
    locked: true,
    tint: "#d2c4bc",
  },
  {
    id: "places-returning",
    category: "Places",
    eyebrow: "PLACES / 02",
    title: "Places worth returning to",
    caption: "A Kuwaiti table and a London room I keep thinking about.",
    image: "/__mockup/images/tastekin/media/places-returning.webp",
    tint: "#d7c4b4",
  },
  {
    id: "sunday-reset",
    category: "Routines",
    eyebrow: "ROUTINES / 03",
    title: "Sunday reset",
    caption: "A realistic reset for movement, food, and planning.",
    image: "/__mockup/images/tastekin/media/sunday-reset.webp",
    tint: "#cdd4c1",
  },
];

const routes: Array<{ id: Category; label: string; note: string }> = [
  { id: "All", label: "The whole atlas", note: "09 field notes" },
  { id: "Style", label: "The way it feels", note: "02 notes" },
  { id: "Travel", label: "A slower route", note: "03 notes" },
  { id: "Places", label: "Worth the return", note: "02 notes" },
  { id: "Routines", label: "The daily edit", note: "02 notes" },
];

export function TastekinAtlasPreview() {
  const [activeRoute, setActiveRoute] = useState<Category>("All");
  const [activeTab, setActiveTab] = useState<"atlas" | "saved" | "profile">("atlas");
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const visibleNotes = useMemo(
    () => notes.filter((note) => activeRoute === "All" || note.category === activeRoute),
    [activeRoute],
  );
  const toggleSaved = (id: string) => {
    setSaved((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  };

  const openNote = (note: Note) => setSelected(note);

  return (
    <div className="atlas-preview">
      <div className="atlas-noise" />
      <main className="atlas-shell">
        <header className="atlas-header">
          <button className="atlas-square-button" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu size={18} />
          </button>
          <img src="/__mockup/images/tastekin/TASTEKIN_logo_horizontal.svg" className="atlas-logo" alt="TASTEKIN" />
          <button className="atlas-square-button" type="button" aria-label="Search" onClick={() => setSearchOpen(!searchOpen)}>
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
        </header>

        {searchOpen && (
          <div className="atlas-search">
            <Search size={16} />
            <input autoFocus placeholder="Search the atlas" aria-label="Search the atlas" />
            <span>⌘ K</span>
          </div>
        )}

        {activeTab === "atlas" && (
          <>
            <section className="atlas-intro">
              <div className="atlas-overline"><span className="atlas-dot" /> Fheed Alaiban / Kuwait City</div>
              <h1>Follow the<br /><em>feeling.</em></h1>
              <p>A personal index of places, pieces, and small rituals worth carrying with you.</p>
              <div className="atlas-intro-meta">
                <span><strong>09</strong> field notes</span>
                <span><strong>04</strong> taste routes</span>
                <span><strong>01</strong> point of view</span>
              </div>
            </section>

            <section className="atlas-route-panel" aria-label="Taste routes">
              <div className="atlas-section-heading">
                <div>
                  <span className="atlas-overline">Choose a route</span>
                  <h2>Where do you want to go?</h2>
                </div>
                <SlidersHorizontal size={17} />
              </div>
              <div className="atlas-routes">
                {routes.map((route) => (
                  <button
                    key={route.id}
                    className={`atlas-route ${activeRoute === route.id ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setActiveRoute(route.id)}
                  >
                    <span className="atlas-route-index">{String(routes.indexOf(route) + 1).padStart(2, "0")}</span>
                    <span className="atlas-route-copy"><strong>{route.label}</strong><small>{route.note}</small></span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
            </section>

            <section className="atlas-feature">
              <div className="atlas-feature-copy">
                <span className="atlas-overline">The latest signal</span>
                <h2>Less noise.<br /><em>More knowing.</em></h2>
                <p>Start with the note that keeps resurfacing in my own life.</p>
                <button className="atlas-text-button" type="button" onClick={() => openNote(notes[0])}>
                  Open field note <ArrowLeft size={15} />
                </button>
              </div>
              <button className="atlas-feature-image-wrap" type="button" onClick={() => openNote(notes[0])} aria-label="Open Quiet tailoring">
                <img src={notes[0].image} alt="" className="atlas-feature-image" />
                <span className="atlas-image-stamp">01 / 09</span>
              </button>
            </section>

            <section className="atlas-notes">
              <div className="atlas-section-heading">
                <div><span className="atlas-overline">Field notes</span><h2>{activeRoute === "All" ? "A considered collection" : routes.find((route) => route.id === activeRoute)?.label}</h2></div>
                <span className="atlas-count">{visibleNotes.length} shown</span>
              </div>
              <div className="atlas-note-list">
                {visibleNotes.map((note, index) => (
                  <article className="atlas-note-row" key={note.id}>
                    <button className="atlas-note-main" type="button" onClick={() => openNote(note)}>
                      <div className="atlas-note-number">{String(index + 1).padStart(2, "0")}</div>
                      <div className="atlas-thumb" style={{ backgroundColor: note.tint }}>
                        <img src={note.image} alt="" />
                        {note.locked && <span className="atlas-thumb-lock"><LockKeyhole size={12} /></span>}
                      </div>
                      <div className="atlas-note-copy"><span className="atlas-overline">{note.eyebrow}</span><strong>{note.title}</strong><p>{note.caption}</p></div>
                    </button>
                    <button className={`atlas-save ${saved.includes(note.id) ? "is-saved" : ""}`} type="button" aria-label={saved.includes(note.id) ? "Remove from saved" : "Save field note"} onClick={() => toggleSaved(note.id)}>
                      {saved.includes(note.id) ? <Heart size={16} fill="currentColor" /> : <Bookmark size={16} />}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === "saved" && (
          <section className="atlas-page">
            <span className="atlas-overline">Your shelf</span>
            <h1>Keep what<br /><em>stays with you.</em></h1>
            <p className="atlas-lede">A private shelf for the places and ideas you want to come back to.</p>
            {saved.length ? (
              <div className="atlas-note-list atlas-saved-list">
                {notes.filter((note) => saved.includes(note.id)).map((note) => (
                  <article className="atlas-note-row" key={note.id}>
                    <button className="atlas-note-main" type="button" onClick={() => openNote(note)}>
                      <div className="atlas-thumb" style={{ backgroundColor: note.tint }}><img src={note.image} alt="" /></div>
                      <div className="atlas-note-copy"><span className="atlas-overline">{note.eyebrow}</span><strong>{note.title}</strong><p>{note.caption}</p></div>
                    </button>
                    <button className="atlas-save is-saved" type="button" onClick={() => toggleSaved(note.id)} aria-label="Remove saved note"><Heart size={16} fill="currentColor" /></button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="atlas-empty"><Bookmark size={20} /><strong>Your shelf is quiet.</strong><span>Tap the bookmark on any field note to keep it close.</span><button className="atlas-text-button" type="button" onClick={() => setActiveTab("atlas")}>Return to the atlas <ArrowLeft size={15} /></button></div>
            )}
          </section>
        )}

        {activeTab === "profile" && (
          <section className="atlas-page">
            <span className="atlas-overline">A point of view</span>
            <div className="atlas-profile-top"><img src="/__mockup/images/tastekin/media/fheed-profile.webp" alt="Fheed Alaiban" /><div><h1>Fheed<br /><em>Alaiban</em></h1><span>@fheed · Kuwait City</span></div></div>
            <p className="atlas-lede">I share considered style, places worth returning to, quiet travel notes, and routines that make everyday life feel better.</p>
            <div className="atlas-profile-stat"><span><strong>92%</strong><small>taste match</small></span><span><strong>09</strong><small>field notes</small></span><span><strong>02</strong><small>collections</small></span></div>
            <div className="atlas-member-card"><div><Sparkles size={17} /><strong>Go a little deeper.</strong><p>Private notes, complete routines, and early collections from Fheed.</p></div><button type="button" onClick={() => setSubscribed(!subscribed)}>{subscribed ? "Member" : "Join · $19.99"} <ChevronRight size={15} /></button></div>
          </section>
        )}

        <nav className="atlas-bottom-nav" aria-label="Main navigation">
          <button className={activeTab === "atlas" ? "is-active" : ""} type="button" onClick={() => setActiveTab("atlas")}><Compass size={18} /><span>Atlas</span></button>
          <button className={activeTab === "saved" ? "is-active" : ""} type="button" onClick={() => setActiveTab("saved")}><Bookmark size={18} /><span>My shelf{saved.length ? ` · ${saved.length}` : ""}</span></button>
          <button className={activeTab === "profile" ? "is-active" : ""} type="button" onClick={() => setActiveTab("profile")}><CircleUserRound size={18} /><span>Fheed</span></button>
        </nav>
      </main>

      {menuOpen && (
        <div className="atlas-menu-backdrop" role="presentation" onClick={() => setMenuOpen(false)}>
          <aside className="atlas-menu" role="dialog" aria-label="About Tastekin" onClick={(event) => event.stopPropagation()}>
            <button className="atlas-menu-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
            <span className="atlas-overline">Tastekin / 01</span>
            <h2>Good taste is<br /><em>personal.</em></h2>
            <p>Tastekin is a quieter way to discover people whose point of view feels like yours. No popularity contests. Just a trail worth following.</p>
            <div className="atlas-menu-rule" />
            <span className="atlas-overline">Currently viewing</span>
            <div className="atlas-menu-person"><img src="/__mockup/images/tastekin/media/fheed-profile.webp" alt="" /><span><strong>Fheed Alaiban</strong><small>Creator / Kuwait City</small></span><Check size={15} /></div>
          </aside>
        </div>
      )}

      {selected && (
        <div className="atlas-detail-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section className="atlas-detail" role="dialog" aria-label={selected.title} onClick={(event) => event.stopPropagation()}>
            <button className="atlas-detail-close" type="button" onClick={() => setSelected(null)} aria-label="Close field note"><X size={18} /></button>
            <div className="atlas-detail-art"><img src={selected.image} alt="" />{selected.locked && !subscribed && <div className="atlas-detail-lock"><LockKeyhole size={20} /><strong>For members</strong><span>Unlock the complete note, places, and packing list.</span><button type="button" onClick={() => setSubscribed(true)}>Join Fheed · $19.99/month</button></div>}</div>
            <div className="atlas-detail-body"><span className="atlas-overline">{selected.eyebrow}</span><h2>{selected.title}</h2><p>{selected.caption}</p>{(!selected.locked || subscribed) && <><div className="atlas-detail-note"><span className="atlas-overline">Fheed's note</span><p>A thoughtful detail worth saving for later. Product and place links are always disclosed, so you can follow the idea without guessing what shaped it.</p></div><button className={`atlas-text-button ${saved.includes(selected.id) ? "is-saved-text" : ""}`} type="button" onClick={() => toggleSaved(selected.id)}>{saved.includes(selected.id) ? "Saved to your shelf" : "Save this field note"} {saved.includes(selected.id) ? <Check size={15} /> : <Bookmark size={15} />}</button></>}</div>
          </section>
        </div>
      )}
    </div>
  );
}