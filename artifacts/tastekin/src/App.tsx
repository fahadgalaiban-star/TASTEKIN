import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Bookmark, Check, ChevronRight, CircleUserRound, Compass, Eye,
  Home, LockKeyhole, PlusCircle, Search, Settings2, ShieldCheck, UserRound, X,
} from 'lucide-react';
import './approved.css';

type Language = 'en' | 'ar';
type Role = 'owner' | 'consumer';
type Screen = 'home' | 'explore' | 'add' | 'saved' | 'you' | 'profile' | 'collections' | 'collection' | 'about' | 'match' | 'edit' | 'subscribe';
type Category = 'All' | 'Fashion' | 'Travel' | 'Places' | 'Restaurants' | 'DailyRoutine' | 'PersonalCare' | 'HealthFitness' | 'Decor' | 'Books' | 'Vlogs';

const categories: { id: Category; en: string; ar: string }[] = [
  { id: 'All', en: 'All', ar: 'الكل' },
  { id: 'Fashion', en: 'Fashion & Outfits', ar: 'أزياء وإطلالات' },
  { id: 'Travel', en: 'Travel', ar: 'سفر' },
  { id: 'Places', en: 'Places', ar: 'أماكن' },
  { id: 'Restaurants', en: 'Restaurants', ar: 'مطاعم' },
  { id: 'DailyRoutine', en: 'Daily Routine', ar: 'روتين يومي' },
  { id: 'PersonalCare', en: 'Personal Care', ar: 'عناية شخصية' },
  { id: 'HealthFitness', en: 'Health & Fitness', ar: 'صحة ولياقة' },
  { id: 'Decor', en: 'Decor', ar: 'ديكور' },
  { id: 'Books', en: 'Books', ar: 'كتب' },
  { id: 'Vlogs', en: 'Vlogs', ar: 'فلوقات' },
];

type Edit = { id: string; category: Category; title: string; titleAr: string; caption: string; captionAr: string; image: string; locked?: boolean };
const edits: Edit[] = [
  { id: 'quiet-tailoring', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'أناقة هادئة', caption: 'A soft-structured look for a long city day.', captionAr: 'إطلالة مريحة ومنسّقة ليوم طويل في المدينة.', image: '/tastekin-media/quiet-tailoring.webp' },
  { id: 'black-uniform', category: 'Fashion', title: 'The all-black uniform', titleAr: 'الإطلالة السوداء الكاملة', caption: 'Three pieces I return to when I want less noise.', captionAr: 'ثلاث قطع أعود إليها حين أريد إطلالة أكثر هدوءاً.', image: '/tastekin-media/black-uniform.webp' },
  { id: 'private-hotel', category: 'Travel', title: 'Private hotel weekend', titleAr: 'عطلة فندقية خاصة', caption: 'The stay, the packing list, and where I ate.', captionAr: 'الإقامة، قائمة الحقائب، والأماكن التي تناولت فيها الطعام.', image: '/tastekin-media/private-hotel-source.webp', locked: true },
  { id: 'coastal-notes', category: 'Travel', title: 'Coastal notes', titleAr: 'ملاحظات من الساحل', caption: 'A slow itinerary for wind, coffee, and open horizons.', captionAr: 'برنامج هادئ للهواء والقهوة والأفق.', image: '/tastekin-media/coastal-notes.webp' },
  { id: 'places-returning', category: 'Places', title: 'Places worth returning to', titleAr: 'أماكن تستحق العودة إليها', caption: 'A Kuwaiti table and a London room I keep thinking about.', captionAr: 'مائدة كويتية ومكان في لندن لا يفارق ذاكرتي.', image: '/tastekin-media/places-returning.webp' },
  { id: 'what-i-ordered', category: 'Restaurants', title: 'What I ordered', titleAr: 'ما طلبته', caption: 'A simple lunch worth repeating.', captionAr: 'غداء بسيط يستحق التكرار.', image: '/tastekin-media/what-i-ordered.webp' },
  { id: 'training-week', category: 'HealthFitness', title: 'Training week', titleAr: 'أسبوع التدريب', caption: 'The strength and recovery routine I actually keep.', captionAr: 'روتين القوة والاستشفاء الذي ألتزم به فعلاً.', image: '/tastekin-media/training-week-preview.webp', locked: true },
  { id: 'sunday-reset', category: 'DailyRoutine', title: 'Sunday reset', titleAr: 'استعادة نشاط الأحد', caption: 'A realistic reset for movement, food, and planning.', captionAr: 'ترتيب واقعي للحركة والطعام والتخطيط.', image: '/tastekin-media/sunday-reset.webp' },
  { id: 'morning-ritual', category: 'PersonalCare', title: 'A simple morning ritual', titleAr: 'روتين صباحي بسيط', caption: 'The personal-care steps that help me start well.', captionAr: 'خطوات العناية الشخصية التي تساعدني على بداية أفضل.', image: '/tastekin-media/hotel-breakfast-source.webp' },
  { id: 'home-light', category: 'Decor', title: 'Light at home', titleAr: 'إضاءة المنزل', caption: 'Small changes for a calmer room.', captionAr: 'تغييرات صغيرة لغرفة أكثر هدوءاً.', image: '/tastekin-media/quiet-tailoring.webp' },
  { id: 'weekend-reading', category: 'Books', title: 'Weekend reading', titleAr: 'قراءة نهاية الأسبوع', caption: 'Three books for a slower afternoon.', captionAr: 'ثلاثة كتب لظهيرة أكثر هدوءاً.', image: '/tastekin-media/coastal-notes.webp' },
  { id: 'city-vlog', category: 'Vlogs', title: 'A day around the city', titleAr: 'يوم في المدينة', caption: 'A quiet visual diary of places, food, and movement.', captionAr: 'يوميات مصورة هادئة عن الأماكن والطعام والحركة.', image: '/tastekin-media/places-returning.webp' },
];

const collections = [
  { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: 'Tailoring, materials, and a quieter way to dress.', descriptionAr: 'تفصيل وخامات وطريقة أكثر هدوءاً في ارتداء الملابس.', cover: edits[0] },
  { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: 'Places, packing and private travel notes.', descriptionAr: 'أماكن وحقائب وملاحظات سفر خاصة.', cover: edits[2], locked: true },
];

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(`tastekin:${key}`) || '') as T; } catch { return fallback; }
};
const write = (key: string, value: unknown) => localStorage.setItem(`tastekin:${key}`, JSON.stringify(value));

function Price({ ar, withVerb = true }: { ar: boolean; withVerb?: boolean }) {
  return ar ? <>{withVerb && 'اشترك · '}<bdi dir="ltr">19.99</bdi> دولار شهريًا</> : <>{withVerb && 'Subscribe · '}$19.99 / month</>;
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : read('interface-language', 'en'));
  const [role, setRole] = useState<Role>(() => read('demo-role', 'owner'));
  const [screen, setScreen] = useState<Screen>('home');
  const [category, setCategory] = useState<Category>('All');
  const [saved, setSaved] = useState<string[]>(() => read('saved-edits', []));
  const [following, setFollowing] = useState(() => read('following-fheed', false));
  const [subscribed, setSubscribed] = useState(() => read('subscribed-fheed', false));
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedEdit, setSelectedEdit] = useState(edits[0]);
  const [selectedCollection, setSelectedCollection] = useState(collections[0]);
  const ar = language === 'ar';
  const owner = role === 'owner';
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const filtered = useMemo(() => category === 'All' ? edits : edits.filter((item) => item.category === category), [category]);
  const go = (next: Screen) => { setScreen(next); setMenuOpen(false); };
  const toggleSaved = (id: string) => { const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id]; setSaved(next); write('saved-edits', next); };
  const nav = [
    { id: 'home' as const, icon: Home, en: 'Home', ar: 'الرئيسية' },
    { id: 'explore' as const, icon: Search, en: 'Explore', ar: 'اكتشف' },
    { id: 'add' as const, icon: PlusCircle, en: 'Add', ar: 'إضافة' },
    { id: 'saved' as const, icon: Bookmark, en: 'Saved', ar: 'المحفوظات' },
    { id: 'you' as const, icon: UserRound, en: 'You', ar: 'أنت' },
  ];
  const openEdit = (item: Edit) => { setSelectedEdit(item); go('edit'); };
  return <div className="approved-app" dir={ar ? 'rtl' : 'ltr'}>
    <main className="approved-shell">
      <header className="approved-topbar">
        {screen !== 'home' && screen !== 'you' ? <button className="approved-icon" onClick={() => go(screen === 'edit' ? 'profile' : screen === 'collection' ? 'collections' : 'home')} aria-label={t('Back', 'رجوع')}><ArrowLeft size={21} /></button> : <span className="approved-spacer" />}
        <img src="/tastekin-logo.svg" className="approved-logo" alt="TASTEKIN" />
        <button className="approved-icon" onClick={() => setMenuOpen(true)} aria-label={t('Open menu', 'فتح القائمة')}><Settings2 size={19} /></button>
      </header>
      {screen === 'home' && <><section className="approved-hero"><span className="approved-kicker">{t('Taste-led discovery', 'اكتشاف مبني على الذوق')}</span><h1>{t('Follow the taste, not the numbers.', 'اتبع الذوق، لا الأرقام.')}</h1><p>{t('A considered feed of people, places, and daily routines shaped by what you actually like.', 'تغذية منتقاة من الأشخاص وأماكنهم وروتينهم اليومي، تتشكل بحسب ما تحبه فعلاً.')}</p></section><CategoryChips ar={ar} active={category} onSelect={setCategory} /><div className="approved-feed">{filtered.map((item) => <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}</div></>}
      {screen === 'explore' && <section><span className="approved-kicker">{t('Explore', 'اكتشف')}</span><h1 className="approved-title">{t('Find your next taste.', 'اكتشف ذوقك القادم.')}</h1><div className="approved-search"><Search size={18} /><span>{t('Search creators, places, and edits', 'ابحث عن المبدعين والأماكن والتعديلات')}</span></div><CategoryChips ar={ar} active={category} onSelect={setCategory} /><div className="approved-panel approved-profile-mini" onClick={() => go('profile')}><Avatar /><div><strong>{t('Fheed Alaiban', 'فهيد العيبان')}</strong><span>{t('Fashion & Outfits · Travel · Places', 'أزياء وإطلالات · سفر · أماكن')}</span></div><ChevronRight /></div><div className="approved-feed">{filtered.slice(0, 4).map((item) => <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}</div></section>}
      {screen === 'add' && <SimpleScreen kicker={t('Creator tools', 'أدوات المبدع')} title={t('Add an edit', 'أضف تعديلاً')}><p>{owner ? t('Start a new public or subscriber-only recommendation from your creator workspace.', 'ابدأ توصية جديدة عامة أو خاصة بالمشتركين من مساحة المبدع.') : t('Publishing is available to the verified creator profile.', 'النشر متاح لملف المبدع الموثق.')}</p><div className="approved-panel"><h3>{owner ? t('New edit draft', 'مسودة تعديل جديد') : t('Switch to owner preview', 'التبديل إلى معاينة المالك')}</h3><p>{owner ? t('Choose an image, add your notes, then decide whether the Edit is public or subscriber-only.', 'اختر صورة، وأضف ملاحظاتك، ثم حدد إن كان التعديل عاماً أو للمشتركين فقط.') : t('Use the settings icon to switch into Fheed’s owner mode.', 'استخدم أيقونة الإعدادات للتبديل إلى وضع مالك فهيد.')}</p></div><button className="approved-button primary wide" onClick={() => go('profile')}>{t('Continue to your edits', 'تابع إلى تعديلاتك')}</button></SimpleScreen>}
      {screen === 'saved' && <SimpleScreen kicker={t('Your library', 'مكتبتك')} title={t('Saved', 'المحفوظات')}><p>{t('Return to ideas when the moment is right.', 'عد إلى الأفكار عندما يحين وقتها.')}</p><div className="approved-feed">{edits.filter((item) => saved.includes(item.id)).map((item) => <EditCard key={item.id} edit={item} ar={ar} saved onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}{!saved.length && <Empty text={t('Nothing saved yet. Explore Fheed’s edits and keep what speaks to you.', 'لا توجد محفوظات بعد. اكتشف تعديلات فهيد واحفظ ما يناسب ذوقك.')} />}</div></SimpleScreen>}
      {screen === 'you' && <SimpleScreen kicker={owner ? t('Creator owner mode', 'وضع مالك الحساب') : t('Your account', 'حسابك')} title={owner ? t('Your profile', 'ملفك الشخصي') : t('Alex Morgan', 'أليكس مورغان')}><div className="approved-panel identity"><Avatar /><div><strong>{owner ? t('Fheed Alaiban', 'فهيد العيبان') : t('Alex Morgan', 'أليكس مورغان')}</strong><span>{owner ? 'Kuwait City, Kuwait' : '@alexmorgan'}</span></div></div><div className="approved-panel"><h3>{t('Taste profile', 'ملف الذوق')}</h3><p>{t('Fashion & outfits, travel, places, restaurants, and daily routines.', 'أزياء وإطلالات، سفر، أماكن، مطاعم، وروتين يومي.')}</p></div>{owner && <button className="approved-button wide" onClick={() => go('profile')}>{t('View profile', 'عرض الملف')}</button>}</SimpleScreen>}
      {screen === 'profile' && <Profile ar={ar} owner={owner} following={following} subscribed={subscribed} onFollow={() => { setFollowing(!following); write('following-fheed', !following); }} onSubscribe={() => go('subscribe')} onEdit={openEdit} onCollections={() => go('collections')} onAbout={() => go('about')} onMatch={() => go('match')} />}
      {screen === 'collections' && <SimpleScreen kicker={t('Fheed Alaiban', 'فهيد العيبان')} title={t('Collections', 'المجموعات')}><p>{t('Complete taste worlds, not a pile of posts.', 'عوالم ذوق مكتملة، وليست مجرد مجموعة منشورات.')}</p><div className="approved-grid">{collections.map((item) => <button className="approved-collection" key={item.id} onClick={() => { setSelectedCollection(item); go('collection'); }}><img src={item.cover.image} alt="" /><strong>{ar ? item.titleAr : item.title}</strong><span>{item.locked ? t('Subscribers only', 'للمشتركين فقط') : t('Public collection', 'مجموعة عامة')}</span></button>)}</div></SimpleScreen>}
      {screen === 'collection' && <SimpleScreen kicker={t('Collection', 'مجموعة')} title={ar ? selectedCollection.titleAr : selectedCollection.title}><img className="approved-collection-hero" src={selectedCollection.cover.image} alt="" /><p>{ar ? selectedCollection.descriptionAr : selectedCollection.description}</p><h3 className="approved-kicker">{t('Included edits', 'التعديلات المضمنة')}</h3><div className="approved-list">{edits.slice(0, 4).map((item) => <button key={item.id} onClick={() => openEdit(item)}><span>{ar ? item.titleAr : item.title}</span><ChevronRight size={17} /></button>)}</div></SimpleScreen>}
      {screen === 'about' && <SimpleScreen kicker={t('About Fheed', 'عن فهيد')} title={t('Fheed Alaiban', 'فهيد العيبان')}><p>{t('Kuwait City, Kuwait. I share Fashion & Outfits, places worth returning to, quiet travel notes, and daily routines that make everyday life feel better.', 'مدينة الكويت، الكويت. أشارك أزياء وإطلالات مدروسة، وأماكن تستحق العودة إليها، وملاحظات سفر هادئة، وروتيناً يومياً يجعل الحياة أفضل.')}</p><div className="approved-panel"><h3>{t('Taste pillars', 'ركائز الذوق')}</h3><p>{t('Fashion & Outfits · Travel · Health & Fitness · Places · Restaurants', 'أزياء وإطلالات · سفر · صحة ولياقة · أماكن · مطاعم')}</p></div><button className="approved-button primary wide" onClick={() => go('subscribe')}><Price ar={ar} /></button></SimpleScreen>}
      {screen === 'match' && <SimpleScreen kicker={t('Taste Match', 'تطابق الذوق')} title={t('Why you match', 'لماذا يتطابق ذوقكما')}><p>{t('A transparent score based on your selected taste preferences and saves.', 'درجة شفافة مبنية على تفضيلات ذوقك والمحتوى الذي حفظته.')}</p>{[['Fashion & Outfits', 'أزياء وإطلالات', '96%'], ['Travel', 'سفر', '91%'], ['Places', 'أماكن', '94%']].map(([en, arabic, score]) => <div className="approved-panel match" key={en}><strong>{ar ? arabic : en}</strong><b>{score}</b><p>{t('Your taste overlaps in thoughtful choices.', 'يتقاطع ذوقكما في اختيارات مدروسة.')}</p></div>)}</SimpleScreen>}
      {screen === 'edit' && <EditDetail edit={selectedEdit} ar={ar} subscribed={subscribed} saved={saved.includes(selectedEdit.id)} onSave={() => toggleSaved(selectedEdit.id)} onSubscribe={() => go('subscribe')} />}
      {screen === 'subscribe' && <SimpleScreen kicker={t('Fheed Alaiban', 'فهيد العيبان')} title={subscribed ? t('You’re subscribed', 'اشتراكك نشط') : t('Subscribe to Fheed', 'اشترك في فهيد')}><div className="approved-panel"><h3><Price ar={ar} withVerb={false} /></h3><p>{t('Private travel diaries, training routines, outfit details, and early collections.', 'مذكرات سفر خاصة، برامج تدريب، تفاصيل إطلالات، ومجموعات مبكرة.')}</p></div>{!owner && <button className="approved-button primary wide" onClick={() => { setSubscribed(!subscribed); write('subscribed-fheed', !subscribed); }}><Price ar={ar} /></button>}</SimpleScreen>}
    </main>
    <nav className="approved-bottom">{nav.map(({ id, icon: Icon, en, ar: labelAr }) => <button key={id} className={screen === id || (id === 'you' && screen === 'profile') ? 'active' : ''} onClick={() => go(id)}><Icon size={21} /><span>{ar ? labelAr : en}</span></button>)}</nav>
    {menuOpen && <div className="approved-menu"><div className="approved-menu-head"><h2>{t('Preview identity & language', 'هوية ولغة المعاينة')}</h2><button className="approved-icon" onClick={() => setMenuOpen(false)}><X size={19} /></button></div><span className="approved-kicker">{t('Demo identity', 'هوية العرض')}</span><div className="approved-segment"><button className={owner ? 'selected' : ''} onClick={() => { setRole('owner'); write('demo-role', 'owner'); go('you'); }}><ShieldCheck size={14} /> {t('Fheed · Owner', 'فهيد · المالك')}</button><button className={!owner ? 'selected' : ''} onClick={() => { setRole('consumer'); write('demo-role', 'consumer'); go('you'); }}><CircleUserRound size={14} /> {t('Alex · Visitor', 'أليكس · زائر')}</button></div><span className="approved-kicker">{t('Interface language', 'لغة الواجهة')}</span><div className="approved-segment"><button className={!ar ? 'selected' : ''} onClick={() => { setLanguage('en'); write('interface-language', 'en'); }}>English</button><button className={ar ? 'selected' : ''} onClick={() => { setLanguage('ar'); write('interface-language', 'ar'); }}>العربية</button></div></div>}
  </div>;
}

function CategoryChips({ ar, active, onSelect }: { ar: boolean; active: Category; onSelect: (category: Category) => void }) {
  return <div className="approved-chips" aria-label={ar ? 'فلاتر الاكتشاف' : 'Discovery categories'}>{categories.map((item) => <button key={item.id} className={item.id === active ? 'active' : ''} onClick={() => onSelect(item.id)}>{ar ? item.ar : item.en}</button>)}</div>;
}
function Avatar() { return <div className="approved-avatar"><img src="/tastekin-media/fheed-profile.webp" alt="Fheed Alaiban" /></div>; }
function SimpleScreen({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) { return <section><span className="approved-kicker">{kicker}</span><h1 className="approved-title">{title}</h1>{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="approved-empty">{text}</div>; }
function EditCard({ edit, ar, saved, onSave, onOpen }: { edit: Edit; ar: boolean; saved: boolean; onSave: () => void; onOpen: () => void }) {
  return <article className="approved-card"><button className="approved-art" onClick={onOpen}><img src={edit.image} alt="" />{edit.locked && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}</button><div className="approved-caption"><div className="approved-caption-row"><button className="approved-card-title" onClick={onOpen}>{ar ? edit.titleAr : edit.title}</button><button className={`approved-save ${saved ? 'saved' : ''}`} onClick={onSave} aria-label="Save"><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button></div><span>{ar ? edit.captionAr : edit.caption}</span></div></article>;
}
function EditDetail({ edit, ar, subscribed, saved, onSave, onSubscribe }: { edit: Edit; ar: boolean; subscribed: boolean; saved: boolean; onSave: () => void; onSubscribe: () => void }) {
  const locked = edit.locked && !subscribed;
  return <SimpleScreen kicker={locked ? (ar ? 'للمشتركين فقط' : 'Subscribers only') : (ar ? 'تعديل عام' : 'Public Edit')} title={ar ? edit.titleAr : edit.title}><div className={`approved-detail-art ${locked ? 'locked' : ''}`}><img src={edit.image} alt="" />{locked && <div><LockKeyhole size={26} /><strong>{ar ? edit.titleAr : edit.title}</strong></div>}</div>{locked ? <div className="approved-panel"><h3>{ar ? 'هذا التعديل للمشتركين' : 'This edit is for subscribers'}</h3><p>{ar ? 'افتح ملاحظات فهيد الكاملة.' : 'Unlock Fheed’s complete notes and original media.'}</p><button className="approved-button primary wide" onClick={onSubscribe}><Price ar={ar} /></button></div> : <><p>{ar ? edit.captionAr : edit.caption}</p><button className={`approved-button wide ${saved ? 'primary' : ''}`} onClick={onSave}>{saved ? (ar ? 'تم الحفظ' : 'Saved') : (ar ? 'احفظ هذا التعديل' : 'Save this edit')}</button></>}</SimpleScreen>;
}
function Profile({ ar, owner, following, subscribed, onFollow, onSubscribe, onEdit, onCollections, onAbout, onMatch }: { ar: boolean; owner: boolean; following: boolean; subscribed: boolean; onFollow: () => void; onSubscribe: () => void; onEdit: (edit: Edit) => void; onCollections: () => void; onAbout: () => void; onMatch: () => void }) {
  return <section><div className="approved-profile-head"><Avatar /><div><div className="approved-name"><h1>{ar ? 'فهيد العيبان' : 'Fheed Alaiban'}</h1><Check size={15} /></div><span><bdi dir="ltr">@fheed</bdi></span><p>{ar ? 'مدينة الكويت، الكويت · أزياء وإطلالات · سفر · أماكن' : 'Kuwait City, Kuwait · Fashion & Outfits · Travel · Places'}</p></div></div><button className="approved-match" onClick={onMatch}>{ar ? 'تطابق ذوق ٩٢٪' : '92% Taste Match'}</button><div className="approved-actions">{owner ? <button className="approved-button primary" onClick={() => onEdit(edits[0])}>{ar ? 'تعديل الملف' : 'Edit profile'}</button> : <><button className="approved-button" onClick={onFollow}>{following ? (ar ? 'تتابع' : 'Following') : (ar ? 'متابعة' : 'Follow')}</button><button className="approved-button primary" onClick={onSubscribe}>{subscribed ? (ar ? 'مشترك' : 'Subscribed') : <Price ar={ar} />}</button></>}</div><div className="approved-tabs"><button className="active" onClick={() => onEdit(edits[0])}>{ar ? 'التعديلات' : 'Edits'}</button><button onClick={onCollections}>{ar ? 'المجموعات' : 'Collections'}</button><button onClick={onAbout}>{ar ? 'حول' : 'About'}</button></div><div className="approved-grid">{edits.slice(0, 6).map((edit) => <button className="approved-grid-card" key={edit.id} onClick={() => onEdit(edit)}><img src={edit.image} alt="" /><strong>{ar ? edit.titleAr : edit.title}</strong></button>)}</div></section>;
}