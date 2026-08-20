import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Compass,
  Eye,
  Globe2,
  Home,
  LockKeyhole,
  MoreHorizontal,
  PlusCircle,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import "./_group.css";

type Role = "owner" | "consumer";
type InterfaceLanguage = "en" | "ar";
type ContentLanguage = "en" | "ar" | "both";
type Screen = "home" | "explore" | "saved" | "you" | "profile" | "collections" | "about" | "match" | "edit" | "subscribe";
type Category = "All" | "Following" | "Style" | "Travel" | "Places" | "Routines";

type Edit = {
  id: string;
  category: Exclude<Category, "All" | "Following"> | "Food";
  access: "public" | "locked";
  art: string;
  title: string;
  titleAr: string;
  caption: string;
  captionAr: string;
};

const edits: Edit[] = [
  { id: "quiet-tailoring", category: "Style", access: "public", art: "tk-art-style", title: "Quiet tailoring", titleAr: "أناقة هادئة", caption: "A soft-structured look for a long city day.", captionAr: "إطلالة مريحة ومنسّقة ليوم طويل في المدينة." },
  { id: "black-uniform", category: "Style", access: "public", art: "tk-art-style", title: "The all-black uniform", titleAr: "الإطلالة السوداء الكاملة", caption: "Three pieces I return to when I want less noise.", captionAr: "ثلاث قطع أعود إليها حين أريد إطلالة أكثر هدوءاً." },
  { id: "private-hotel", category: "Travel", access: "locked", art: "tk-art-travel", title: "Private hotel weekend", titleAr: "عطلة فندقية خاصة", caption: "The stay, the packing list, and where I ate.", captionAr: "الإقامة، قائمة الحقائب، والأماكن التي تناولت فيها الطعام." },
  { id: "coastal-notes", category: "Travel", access: "public", art: "tk-art-travel", title: "Coastal notes", titleAr: "ملاحظات من الساحل", caption: "A slow itinerary for wind, coffee, and open horizons.", captionAr: "برنامج هادئ للهواء والقهوة والأفق المفتوح." },
  { id: "places-returning", category: "Places", access: "public", art: "tk-art-places", title: "Places worth returning to", titleAr: "أماكن تستحق العودة إليها", caption: "A Kuwaiti table and a London room I keep thinking about.", captionAr: "مائدة كويتية ومكان في لندن لا يفارق ذاكرتي." },
  { id: "hotel-breakfast", category: "Places", access: "locked", art: "tk-art-places", title: "Hotel breakfast, unhurried", titleAr: "إفطار فندقي بلا استعجال", caption: "My private list for a considered morning.", captionAr: "قائمتي الخاصة لصباح هادئ ومدروس." },
  { id: "what-i-ordered", category: "Food", access: "public", art: "tk-art-food", title: "What I ordered", titleAr: "ما طلبته", caption: "A simple lunch worth repeating.", captionAr: "غداء بسيط يستحق التكرار." },
  { id: "training-week", category: "Routines", access: "locked", art: "tk-art-routines", title: "Training week", titleAr: "أسبوع التدريب", caption: "The strength and recovery routine I actually keep.", captionAr: "روتين القوة والاستشفاء الذي ألتزم به فعلاً." },
  { id: "sunday-reset", category: "Routines", access: "public", art: "tk-art-routines", title: "Sunday reset", titleAr: "استعادة نشاط الأحد", caption: "A realistic reset for movement, food, and planning.", captionAr: "ترتيب واقعي للحركة والطعام والتخطيط." },
];

const collections = [
  { id: "quiet-luxury", title: "Quiet Luxury", titleAr: "فخامة هادئة", description: "Tailoring, materials, and a quieter way to dress.", descriptionAr: "تفصيل وخامات وطريقة أكثر هدوءاً في ارتداء الملابس.", count: 4, access: "public" as const, art: "" },
  { id: "coastal-edit", title: "The Coastal Edit", titleAr: "اختيارات الساحل", description: "Places, packing and private travel notes.", descriptionAr: "أماكن وحقائب وملاحظات سفر خاصة.", count: 5, access: "locked" as const, art: "coastal" },
];

const stored = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => stored(key, fallback));
  const save = (next: T | ((previous: T) => T)) => {
    setValue((previous) => {
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
      window.localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };
  return [value, save] as const;
}

export function TastekinPreview() {
  const [role, setRole] = useStored<Role>("tastekin-demo-role", "owner");
  const [interfaceLanguage, setInterfaceLanguage] = useStored<InterfaceLanguage>("tastekin-interface-language", "en");
  const [contentLanguage, setContentLanguage] = useStored<ContentLanguage>("tastekin-content-language", "both");
  const [following, setFollowing] = useStored("tastekin-following-fheed", false);
  const [subscribed, setSubscribed] = useStored("tastekin-subscribed-fheed", false);
  const [saved, setSaved] = useStored<string[]>("tastekin-saved-edits", []);
  const [consumer, setConsumer] = useStored("tastekin-consumer-identity", { name: "Alex Morgan", username: "alexmorgan", demo: true });
  const [screen, setScreen] = useState<Screen>("home");
  const [category, setCategory] = useState<Category>("All");
  const [profileTab, setProfileTab] = useState<"edits" | "collections" | "about">("edits");
  const [selectedEdit, setSelectedEdit] = useState<Edit>(edits[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newIdentity, setNewIdentity] = useState({ name: "", username: "" });

  const ar = interfaceLanguage === "ar";
  const isOwner = role === "owner";
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const content = (edit: Edit, field: "title" | "caption") => {
    if (contentLanguage === "ar") return field === "title" ? edit.titleAr : edit.captionAr;
    if (contentLanguage === "en") return field === "title" ? edit.title : edit.caption;
    return edit.id.length % 2 === 0 ? (field === "title" ? edit.titleAr : edit.captionAr) : (field === "title" ? edit.title : edit.caption);
  };
  const collectionText = (item: (typeof collections)[number], field: "title" | "description") =>
    contentLanguage === "ar" || (contentLanguage === "both" && item.id === "coastal-edit")
      ? field === "title" ? item.titleAr : item.descriptionAr
      : field === "title" ? item.title : item.description;

  const filteredEdits = useMemo(() => {
    if (category === "All") return edits;
    if (category === "Following") return following || isOwner ? edits : [];
    return edits.filter((edit) => edit.category === category);
  }, [category, following, isOwner]);

  const showEdit = (edit: Edit) => {
    setSelectedEdit(edit);
    setScreen("edit");
  };

  const toggleSave = (id: string) => setSaved((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);

  const openVisitorProfile = () => {
    setRole("consumer");
    setScreen("profile");
    setProfileTab("edits");
  };

  const navItems: Array<{ id: Screen; icon: typeof Home; label: string }> = [
    { id: "home", icon: Home, label: text("Home", "الرئيسية") },
    { id: "explore", icon: Search, label: text("Explore", "اكتشف") },
    { id: "profile", icon: PlusCircle, label: text("Add", "إضافة") },
    { id: "saved", icon: Bookmark, label: text("Saved", "المحفوظات") },
    { id: "you", icon: UserRound, label: text("You", "أنت") },
  ];

  const backTo = (target: Screen) => (
    <button className="tk-icon" type="button" aria-label={text("Back", "رجوع")} onClick={() => setScreen(target)}><ArrowLeft size={22} /></button>
  );

  return (
    <div className="tastekin-preview tk-rtl-fix" dir={ar ? "rtl" : "ltr"}>
      <main className="tk-shell">
        <header className="tk-topbar">
          {screen !== "home" && screen !== "you" ? backTo(screen === "edit" ? "profile" : "home") : <span style={{ width: 44 }} />}
          <img className="tk-brand" src="/__mockup/images/tastekin/TASTEKIN_logo_horizontal.svg" alt="TASTEKIN" />
          <button className="tk-icon" type="button" onClick={() => setMenuOpen(true)} aria-label={text("Open main menu", "فتح القائمة الرئيسية")}><Settings2 size={20} /></button>
        </header>

        {screen === "home" && (
          <>
            <section className="tk-hero">
              <span className="tk-kicker">{text("Taste-led discovery", "اكتشاف مبني على الذوق")}</span>
              <h1>{text("Follow the taste, not the numbers.", "اتبع الذوق، لا الأرقام.")}</h1>
              <p>{text("A considered feed of people, places, and routines shaped by what you actually like.", "تغذية منتقاة من الأشخاص والأماكن والعادات، تتشكل بحسب ما تحبه فعلاً.")}</p>
            </section>
            <div className="tk-pill-row" aria-label={text("Feed filters", "فلاتر التغذية")}>
              {(["All", "Following", "Style", "Travel", "Places", "Routines"] as Category[]).map((item) => (
                <button key={item} className={`tk-pill ${category === item ? "is-active" : ""}`} type="button" onClick={() => setCategory(item)}>
                  {text(item, ({ All: "الكل", Following: "أتابعهم", Style: "الأناقة", Travel: "السفر", Places: "أماكن", Routines: "العادات" } as Record<Category, string>)[item])}
                </button>
              ))}
            </div>
            <div className="tk-feed">
              {filteredEdits.length ? filteredEdits.map((edit) => <EditCard key={edit.id} edit={edit} title={content(edit, "title")} caption={content(edit, "caption")} onClick={() => showEdit(edit)} />) : (
                <div className="tk-empty">{text("Nothing here yet. Follow Fheed or choose another taste filter.", "لا يوجد محتوى هنا بعد. تابع فهيد أو اختر فلتر ذوق مختلف.")}</div>
              )}
            </div>
          </>
        )}

        {screen === "profile" && (
          <Profile
            isOwner={isOwner}
            subscribed={subscribed}
            following={following}
            profileTab={profileTab}
            onTabChange={setProfileTab}
            onFollow={() => setFollowing(!following)}
            onSubscribe={() => setScreen("subscribe")}
            onViewVisitor={openVisitorProfile}
            onEdit={showEdit}
            onCollection={() => setScreen("collections")}
            text={text}
            content={content}
          />
        )}

        {screen === "you" && (
          <YouScreen
            isOwner={isOwner}
            consumer={consumer}
            subscribed={subscribed}
            onViewVisitor={openVisitorProfile}
            onProfile={() => setScreen("profile")}
            text={text}
          />
        )}

        {screen === "collections" && (
          <section>
            <span className="tk-kicker">{text("Fheed Alaiban", "فهيد العليبان")}</span>
            <h1 className="tk-page-title">{text("Collections", "المجموعات")}</h1>
            <p className="tk-page-copy">{text("Complete taste worlds, not a pile of posts.", "عوالم ذوق مكتملة، وليست مجرد مجموعة منشورات.")}</p>
            <div className="tk-grid">
              {collections.map((collection) => (
                <button className="tk-collection" key={collection.id} type="button" onClick={() => setScreen("edit")}>
                  <div className={`tk-collection-art ${collection.art}`}>
                    {collection.access === "locked" && <span className="tk-access is-locked"><LockKeyhole size={11} /> {text("Subscribers", "للمشتركين")}</span>}
                    <strong>{collectionText(collection, "title")}</strong>
                  </div>
                  <div className="tk-collection-body">{collection.count} {text("ordered edits", "تعديل مرتب")} · {collectionText(collection, "description")}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === "about" && <AboutScreen onSubscribe={() => setScreen("subscribe")} text={text} />}

        {screen === "match" && (
          <section>
            <span className="tk-kicker">{text("Taste Match", "تطابق الذوق")}</span>
            <h1 className="tk-page-title">{text("Why you match", "لماذا يتطابق ذوقكما")}</h1>
            <p className="tk-page-copy">{text("A transparent score based on your selected taste preferences and saves.", "درجة شفافة مبنية على تفضيلات ذوقك والمحتوى الذي حفظته.")}</p>
            {[
              [text("Style", "الأناقة"), "96%", text("Quiet tailoring and neutral palettes.", "تفصيل هادئ ولوحات ألوان حيادية.")],
              [text("Travel", "السفر"), "91%", text("Boutique stays and slow itineraries.", "إقامات بوتيك وخطط سفر هادئة.")],
              [text("Places", "الأماكن"), "94%", text("Coffee, restaurants, and spaces with intention.", "قهوة ومطاعم وأماكن ذات معنى.")],
            ].map(([label, score, copy]) => <div className="tk-panel" key={label}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><h3>{label}</h3><strong style={{ color: "#4b1f2a" }}>{score}</strong></div><p>{copy}</p></div>)}
          </section>
        )}

        {screen === "edit" && (
          <section>
            <span className="tk-kicker">{selectedEdit.access === "locked" ? text("Subscribers only", "للمشتركين فقط") : text("Public Edit", "تعديل عام")}</span>
            <div className={`tk-detail-art ${selectedEdit.art} ${selectedEdit.access === "locked" && !subscribed ? "tk-art-lock" : ""}`}>
              {selectedEdit.access === "locked" && !subscribed ? <><div className="tk-lock-mark"><LockKeyhole /></div><h1>{content(selectedEdit, "title")}</h1></> : <><span className="tk-access">{subscribed && selectedEdit.access === "locked" ? text("Unlocked · subscriber", "مفتوح · مشترك") : text("Fheed Alaiban", "فهيد العليبان")}</span><h1>{content(selectedEdit, "title")}</h1></>}
            </div>
            {selectedEdit.access === "locked" && !subscribed ? (
              <div className="tk-panel"><h3>{text("This edit is for subscribers", "هذا التعديل للمشتركين")}</h3><p>{text("Unlock Fheed’s complete notes, places, and routines.", "افتح ملاحظات فهيد الكاملة وأماكنه وعاداته.")}</p><button className="tk-button primary full" type="button" onClick={() => setScreen("subscribe")}>{text("Subscribe · $19.99/month", "اشترك · ١٩٫٩٩ دولار شهرياً")}</button></div>
            ) : (
              <><h1 className="tk-page-title">{content(selectedEdit, "title")}</h1><p className="tk-page-copy">{content(selectedEdit, "caption")}</p><div className="tk-panel"><span className="tk-kicker">{text("Fheed’s notes", "ملاحظات فهيد")}</span><p>{text("A thoughtful detail worth saving for later. Product and place links are always clearly disclosed.", "تفصيل مدروس يستحق الحفظ لاحقاً. روابط المنتجات والأماكن موضحة دائماً بشفافية.")}</p></div><button className={`tk-button full ${saved.includes(selectedEdit.id) ? "primary" : ""}`} type="button" onClick={() => toggleSave(selectedEdit.id)}>{saved.includes(selectedEdit.id) ? text("Saved", "تم الحفظ") : text("Save this edit", "احفظ هذا التعديل")}</button></>
            )}
          </section>
        )}

        {screen === "subscribe" && (
          <section>
            <span className="tk-kicker">{text("Fheed Alaiban", "فهيد العليبان")}</span>
            <h1 className="tk-page-title">{subscribed ? text("You’re subscribed", "اشتراكك نشط") : text("Subscribe to Fheed", "اشترك في فهيد")}</h1>
            <div className="tk-panel"><h3>$19.99 <span style={{ color: "#766e66", fontSize: 13, fontWeight: 500 }}>{text("/ month", "/ شهرياً")}</span></h3><p>{text("Private travel diaries, training routines, outfit details, and early collections.", "مذكرات سفر خاصة، برامج تدريب، تفاصيل إطلالات، ومجموعات مبكرة.")}</p></div>
            <div className="tk-item-list">
              {[text("Private edits", "تعديلات خاصة"), text("Collections", "المجموعات"), text("Early access", "وصول مبكر")].map((item) => <div className="tk-list-item" key={item}><strong>{item}</strong><span>{subscribed ? text("Active", "نشط") : text("Included", "مشمول")}</span></div>)}
            </div>
            {!isOwner && <button className="tk-button primary full" type="button" onClick={() => setSubscribed(!subscribed)}>{subscribed ? text("Reset test subscription", "إعادة ضبط الاشتراك التجريبي") : text("Continue to mock checkout", "المتابعة إلى الدفع التجريبي")}</button>}
            {isOwner && <div className="tk-empty">{text("You own this profile. Subscribers see the benefits above; you do not subscribe to yourself.", "أنت مالك هذا الملف. يرى المشتركون المزايا أعلاه؛ ولا تشترك في ملفك الشخصي.")}</div>}
          </section>
        )}

        {screen === "saved" && (
          <section>
            <span className="tk-kicker">{text("Your library", "مكتبتك")}</span>
            <h1 className="tk-page-title">{text("Saved", "المحفوظات")}</h1>
            <p className="tk-page-copy">{text("Return to ideas when the moment is right.", "عد إلى الأفكار عندما يحين وقتها.")}</p>
            <div className="tk-feed">
              {edits.filter((item) => saved.includes(item.id)).map((edit) => <EditCard key={edit.id} edit={edit} title={content(edit, "title")} caption={content(edit, "caption")} onClick={() => showEdit(edit)} />)}
              {!saved.length && <div className="tk-empty">{text("Nothing saved yet. Explore Fheed’s edits and keep what speaks to you.", "لا توجد محفوظات بعد. اكتشف تعديلات فهيد واحفظ ما يناسب ذوقك.")}</div>}
            </div>
          </section>
        )}

        {screen === "explore" && (
          <section>
            <span className="tk-kicker">{text("Explore", "اكتشف")}</span>
            <h1 className="tk-page-title">{text("Find your next taste.", "اكتشف ذوقك القادم.")}</h1>
            <div className="tk-panel"><Search size={18} style={{ verticalAlign: "middle", marginInlineEnd: 8 }} /><span>{text("Search creators, places, and edits", "ابحث عن المبدعين والأماكن والتعديلات")}</span></div>
            <Profile isOwner={false} subscribed={subscribed} following={following} profileTab="edits" onTabChange={setProfileTab} onFollow={() => setFollowing(!following)} onSubscribe={() => setScreen("subscribe")} onViewVisitor={openVisitorProfile} onEdit={showEdit} onCollection={() => setScreen("collections")} text={text} content={content} compact />
          </section>
        )}

        {menuOpen && (
          <div className="tk-menu" role="dialog" aria-label={text("Preview settings", "إعدادات المعاينة")}>
            <div className="tk-menu-head"><h2>{text("Preview identity & language", "هوية ولغة المعاينة")}</h2><button className="tk-icon" type="button" onClick={() => setMenuOpen(false)}><X size={19} /></button></div>
            <span className="tk-kicker">{text("Demo identity", "هوية العرض")}</span>
            <div className="tk-segment">
              <button className={role === "owner" ? "is-selected" : ""} type="button" onClick={() => { setRole("owner"); setScreen("you"); }}><ShieldCheck size={14} /> {text("Fheed · Owner", "فهيد · المالك")}</button>
              <button className={role === "consumer" ? "is-selected" : ""} type="button" onClick={() => { setRole("consumer"); setScreen("you"); }}><CircleUserRound size={14} /> {text("Alex · Visitor", "أليكس · زائر")}</button>
            </div>
            <span className="tk-kicker">{text("Interface language", "لغة الواجهة")}</span>
            <div className="tk-segment"><button className={!ar ? "is-selected" : ""} type="button" onClick={() => setInterfaceLanguage("en")}>English</button><button className={ar ? "is-selected" : ""} type="button" onClick={() => setInterfaceLanguage("ar")}>العربية</button></div>
            <span className="tk-kicker">{text("Content language", "لغة المحتوى")}</span>
            <div className="tk-segment">
              {(["en", "ar", "both"] as ContentLanguage[]).map((language) => <button className={contentLanguage === language ? "is-selected" : ""} key={language} type="button" onClick={() => setContentLanguage(language)}>{language === "en" ? "English" : language === "ar" ? "العربية" : text("Both", "كلاهما")}</button>)}
            </div>
            <span className="tk-kicker">{text("New account preview", "معاينة حساب جديد")}</span>
            <p className="tk-language-notice">{text("New sign-ups never inherit Alex Morgan. Save your own display name and username.", "الحسابات الجديدة لا ترث هوية أليكس مورغان. احفظ اسمك واسم المستخدم الخاص بك.")}</p>
            <div className="tk-form-row"><input className="tk-field" value={newIdentity.name} onChange={(event) => setNewIdentity({ ...newIdentity, name: event.target.value })} placeholder={text("Display name", "الاسم المعروض")} /><input className="tk-field" value={newIdentity.username} onChange={(event) => setNewIdentity({ ...newIdentity, username: event.target.value.replace(/\s/g, "") })} placeholder={text("Username", "اسم المستخدم")} /></div>
            <button className="tk-button primary full" type="button" onClick={() => { if (newIdentity.name && newIdentity.username) { setConsumer({ name: newIdentity.name, username: newIdentity.username, demo: false }); setRole("consumer"); setScreen("you"); setMenuOpen(false); } }}>{text("Save new identity", "حفظ الهوية الجديدة")}</button>
          </div>
        )}
      </main>

      <nav className="tk-bottom-nav" aria-label={text("Main navigation", "التنقل الرئيسي")}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.id === "profile" ? screen === "profile" || screen === "collections" || screen === "about" || screen === "match" || screen === "edit" : screen === item.id;
          return <button key={item.label} className={`tk-nav-item ${active ? "is-active" : ""}`} type="button" onClick={() => item.id === "profile" ? setScreen(isOwner ? "you" : "profile") : setScreen(item.id)}><Icon size={21} /><span>{item.label}</span></button>;
        })}
      </nav>
    </div>
  );
}

function EditCard({ edit, title, caption, onClick }: { edit: Edit; title: string; caption: string; onClick: () => void }) {
  return <button className="tk-card" type="button" onClick={onClick}>
    <div className={`tk-card-art ${edit.art} ${edit.access === "locked" ? "tk-art-lock" : ""}`}>
      <span className={`tk-access ${edit.access === "locked" ? "is-locked" : ""}`}>{edit.access === "locked" ? <><LockKeyhole size={11} /> Subscribers only</> : "Public edit"}</span>
      <strong className="tk-card-title">{title}</strong>
    </div>
    <div className="tk-card-caption">{caption}</div>
  </button>;
}

function Profile({ isOwner, subscribed, following, profileTab, onTabChange, onFollow, onSubscribe, onViewVisitor, onEdit, onCollection, text, content, compact = false }: {
  isOwner: boolean; subscribed: boolean; following: boolean; profileTab: "edits" | "collections" | "about"; onTabChange: (tab: "edits" | "collections" | "about") => void; onFollow: () => void; onSubscribe: () => void; onViewVisitor: () => void; onEdit: (edit: Edit) => void; onCollection: () => void; text: (en: string, ar: string) => string; content: (edit: Edit, field: "title" | "caption") => string; compact?: boolean;
}) {
  if (compact) return <button className="tk-panel" type="button" onClick={onViewVisitor} style={{ textAlign: "start", width: "100%" }}><div className="tk-identity"><div className="tk-avatar">F</div><div><div className="tk-name-row"><h2 className="tk-name" dir="ltr">Fheed Alaiban</h2><span className="tk-verified"><Check size={11} /></span></div><p className="tk-meta">{text("Style · Travel · Places", "أناقة · سفر · أماكن")}</p></div><ChevronRight /></div></button>;
  return <section>
    <div className="tk-profile-head">
      <div className="tk-identity">
        <div className="tk-avatar">F</div>
        <div><div className="tk-name-row"><h1 className="tk-name" dir="ltr">Fheed Alaiban</h1><span className="tk-verified" aria-label={text("Verified", "موثق")}><Check size={11} /></span></div><div className="tk-handle" dir="ltr">@fheed</div><div className="tk-meta">{text("Kuwait City, Kuwait · Style · Travel · Places", "مدينة الكويت، الكويت · أناقة · سفر · أماكن")}</div></div>
      </div>
      <button className="tk-match" type="button" onClick={() => onTabChange("edits")}><Compass size={14} /> {text("92% Taste Match", "تطابق ذوق ٩٢٪")}</button>
      {isOwner ? <div className="tk-actions"><button className="tk-button primary" type="button">{text("Edit profile", "تعديل الملف")}</button><button className="tk-button" type="button" onClick={onViewVisitor}><Eye size={14} /> {text("View as visitor", "عرض كزائر")}</button></div> : <div className="tk-actions"><button className="tk-button" type="button" onClick={onFollow}>{following ? text("Following", "تتابعه") : text("Follow", "تابع")}</button><button className="tk-button primary" type="button" onClick={onSubscribe}>{subscribed ? text("Subscribed", "مشترك") : text("Subscribe · $19.99", "اشترك · ١٩٫٩٩$")}</button></div>}
    </div>
    <div className="tk-tab-row">
      {(["edits", "collections", "about"] as const).map((tab) => <button className={`tk-tab ${profileTab === tab ? "is-active" : ""}`} type="button" key={tab} onClick={() => onTabChange(tab)}>{text(tab === "edits" ? "Edits" : tab === "collections" ? "Collections" : "About", tab === "edits" ? "التعديلات" : tab === "collections" ? "المجموعات" : "حول")}</button>)}
    </div>
    {profileTab === "edits" && <div className="tk-grid">{edits.slice(0, 6).map((edit) => <EditCard key={edit.id} edit={edit} title={content(edit, "title")} caption="" onClick={() => onEdit(edit)} />)}</div>}
    {profileTab === "collections" && <div className="tk-grid">{collections.map((collection) => <button type="button" className="tk-collection" key={collection.id} onClick={onCollection}><div className={`tk-collection-art ${collection.art}`}>{collection.access === "locked" && <span className="tk-access is-locked"><LockKeyhole size={11} /> {text("Subscribers", "للمشتركين")}</span>}<strong>{text(collection.title, collection.titleAr)}</strong></div><div className="tk-collection-body">{collection.count} {text("ordered edits", "تعديل مرتب")} · {text(collection.description, collection.descriptionAr)}</div></button>)}</div>}
    {profileTab === "about" && <AboutScreen onSubscribe={onSubscribe} text={text} />}
  </section>;
}

function AboutScreen({ onSubscribe, text }: { onSubscribe: () => void; text: (en: string, ar: string) => string }) {
  return <section>
    <span className="tk-kicker">{text("About Fheed", "عن فهيد")}</span>
    <h1 className="tk-page-title" dir="ltr">Fheed Alaiban</h1>
    <p className="tk-page-copy">{text("Kuwait City, Kuwait. I share considered style, places worth returning to, quiet travel notes, and routines that make everyday life feel better.", "مدينة الكويت، الكويت. أشارك أناقة مدروسة، وأماكن تستحق العودة إليها، وملاحظات سفر هادئة، وعادات تجعل الحياة اليومية أفضل.")}</p>
    <div className="tk-panel"><span className="tk-kicker">{text("Taste pillars", "ركائز الذوق")}</span><p>{text("Style · Travel · Fitness · Places · Food", "الأناقة · السفر · اللياقة · الأماكن · الطعام")}</p></div>
    <div className="tk-panel"><span className="tk-kicker">{text("What subscribers get", "ما يحصل عليه المشتركون")}</span><p>{text("Private travel diaries, complete training notes, product details and early access to new collections.", "مذكرات سفر خاصة، ملاحظات تدريب كاملة، تفاصيل منتجات، ووصول مبكر إلى المجموعات الجديدة.")}</p></div>
    <button className="tk-button primary full" type="button" onClick={onSubscribe}>{text("Subscribe · $19.99/month", "اشترك · ١٩٫٩٩ دولار شهرياً")}</button>
    <p className="tk-page-copy" style={{ marginTop: 18 }}>{text("Transparency: paid partnerships and affiliate links are always labelled clearly.", "الشفافية: تُعرض الشراكات المدفوعة وروابط الأفلييت بوضوح دائماً.")}</p>
  </section>;
}

function YouScreen({ isOwner, consumer, subscribed, onViewVisitor, onProfile, text }: { isOwner: boolean; consumer: { name: string; username: string; demo: boolean }; subscribed: boolean; onViewVisitor: () => void; onProfile: () => void; text: (en: string, ar: string) => string }) {
  if (isOwner) return <section>
    <span className="tk-kicker">{text("Creator owner mode", "وضع مالك الحساب")}</span>
    <h1 className="tk-page-title">{text("Your profile", "ملفك الشخصي")}</h1>
    <div className="tk-panel"><div className="tk-identity"><div className="tk-avatar">F</div><div><div className="tk-name-row"><h2 className="tk-name" dir="ltr">Fheed Alaiban</h2><span className="tk-verified"><Check size={11} /></span></div><div className="tk-handle" dir="ltr">@fheed</div><div className="tk-meta">{text("Kuwait City, Kuwait", "مدينة الكويت، الكويت")}</div></div></div></div>
    <div className="tk-actions"><button className="tk-button primary" type="button">{text("Edit profile", "تعديل الملف")}</button><button className="tk-button" type="button" onClick={onViewVisitor}>{text("View as visitor", "عرض كزائر")}</button></div>
    <div className="tk-panel"><h3>{text("Your taste", "ذوقك")}</h3><p>{text("Considered style, places, travel notes, and routines with less noise.", "أناقة مدروسة، أماكن، ملاحظات سفر، وعادات أقل ضوضاء.")}</p></div>
    <div className="tk-item-list"><button className="tk-list-item" type="button" onClick={onProfile}><strong>{text("Edits", "التعديلات")}</strong><span>9 <ChevronRight size={15} /></span></button><button className="tk-list-item" type="button" onClick={onProfile}><strong>{text("Collections", "المجموعات")}</strong><span>2 <ChevronRight size={15} /></span></button><button className="tk-list-item" type="button" onClick={onProfile}><strong>{text("About & subscription", "حول والاشتراك")}</strong><span><ChevronRight size={15} /></span></button></div>
  </section>;
  return <section>
    <span className="tk-kicker">{consumer.demo ? text("Demo consumer", "مستهلك تجريبي") : text("Your account", "حسابك")}</span>
    <h1 className="tk-page-title">{consumer.name}</h1>
    <p className="tk-page-copy" dir="ltr">@{consumer.username} · {consumer.demo ? text("Demo consumer", "مستهلك تجريبي") : text("Newly created identity", "هوية تم إنشاؤها حديثاً")}</p>
    <div className="tk-panel"><h3>{text("Taste profile", "ملف الذوق")}</h3><p>{text("Style, travel, places, food, and routines. You can refine this anytime.", "الأناقة والسفر والأماكن والطعام والعادات. يمكنك تعديلها في أي وقت.")}</p></div>
    <div className="tk-panel"><h3>{text("Subscription", "الاشتراك")}</h3><p>{subscribed ? text("Active with Fheed Alaiban.", "نشط مع فهيد العليبان.") : text("No active subscriptions. Open Fheed’s profile to unlock private edits.", "لا توجد اشتراكات نشطة. افتح ملف فهيد لفتح التعديلات الخاصة.")}</p></div>
    <button className="tk-button primary full" type="button" onClick={onViewVisitor}>{text("Visit Fheed’s profile", "زيارة ملف فهيد")}</button>
  </section>;
}