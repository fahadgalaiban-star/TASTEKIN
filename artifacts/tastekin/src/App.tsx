import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetFeedQueryKey, getHealthCheckQueryKey, useGetCreator, useGetEdit, useGetFeed, useExplore, useHealthCheck, useListCreators, useUpdateRelationship } from '@workspace/api-client-react';
import type { Collection, Creator, CreatorProfile, Edit, ExploreResults, RelationshipInputType } from '@workspace/api-client-react';
import { BadgeCheck, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Compass, Heart, Home as HomeIcon, Layers3, LockKeyhole, MapPin, Menu, MoreHorizontal, Plus, RefreshCw, Search, Settings, Share2, SlidersHorizontal, Sparkles, UserRound, Users, X } from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();

const fallbackEdits: Edit[] = [
  { id: 'edit-paris', creatorUsername: 'maraeats', creatorName: 'Mara Ellison', creatorAvatar: '', creatorVerified: true, title: 'A slower way through Paris', caption: 'Three places I return to when I want the city to feel small again.', contentType: 'travel', access: 'public', image: '', altText: 'A small table set beside a Parisian street', location: 'Paris, France', tags: ['travel', 'places'], saved: true, publishedAt: '2025-05-18' },
  { id: 'edit-ritual', creatorUsername: 'rowanstudio', creatorName: 'Rowan Hale', creatorAvatar: '', creatorVerified: false, title: 'The 6:40 reset', caption: 'A gentle morning ritual for days that need a little structure.', contentType: 'routine', access: 'subscribers', image: '', altText: 'A quiet morning ritual', location: 'Copenhagen, Denmark', tags: ['routine', 'wellness'], saved: false, publishedAt: '2025-05-15' },
  { id: 'edit-black', creatorUsername: 'noahpark', creatorName: 'Noah Park', creatorAvatar: '', creatorVerified: true, title: 'The reliable black layer', caption: 'One shirt, four dinners, zero overthinking.', contentType: 'style', access: 'public', image: '', altText: 'A black cotton shirt on a chair', location: 'New York, NY', tags: ['style', 'everyday'], saved: false, publishedAt: '2025-05-12' },
  { id: 'edit-table', creatorUsername: 'sanaeats', creatorName: 'Sana Ito', creatorAvatar: '', creatorVerified: true, title: 'What I ordered, exactly', caption: 'A lunch order worth crossing town for.', contentType: 'food', access: 'public', image: '', altText: 'A plate of lunch with crisp fries', location: 'Brooklyn, NY', tags: ['food', 'places'], saved: true, publishedAt: '2025-05-07' },
];

const fallbackCreators: Creator[] = [
  { id: 'fheed-alaiban', username: 'fheed', displayName: 'Fheed Alaiban', avatar: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=85', categories: ['Style', 'Travel', 'Rituals'], city: 'Kuwait City, Kuwait', matchScore: 94, verified: true, bio: 'A considered edit of what I wear, where I go, and what stays.' },
  { id: 'mara', username: 'maraeats', displayName: 'Mara Ellison', categories: ['Travel', 'Places', 'Food'], city: 'Paris, France', matchScore: 92, verified: true, bio: 'Good rooms, long lunches, and the details that make a place stay with you.' },
  { id: 'rowan', username: 'rowanstudio', displayName: 'Rowan Hale', categories: ['Routines', 'Wellness', 'Style'], city: 'Copenhagen, Denmark', matchScore: 87, verified: false, bio: 'Notes on living with less rush and more ritual.' },
  { id: 'noah', username: 'noahpark', displayName: 'Noah Park', categories: ['Style', 'Design'], city: 'New York, NY', matchScore: 81, verified: true, bio: 'A considered wardrobe, edited weekly.' },
];

const fallbackCollections: Collection[] = [
  { id: 'c-1', creatorUsername: 'maraeats', title: 'Cities I would send you to', description: 'A living list of streets, rooms, and tables with a particular point of view.', image: '', itemCount: 14, access: 'public', updatedAt: '2 days ago' },
  { id: 'c-2', creatorUsername: 'rowanstudio', title: 'A softer week', description: 'Small resets for a fuller week.', image: '', itemCount: 8, access: 'mixed', updatedAt: 'May 11' },
];

const categories = ['Style', 'Travel', 'Places', 'Food', 'Routines', 'Design', 'Wellness', 'Books'];
const sampleReasons = ['You both save small, independent places', 'You follow slow travel over checklists', 'Your taste overlaps in warm minimalism'];

type Language = 'en' | 'ar';
type ContentLanguage = 'en' | 'ar' | 'both';
const LanguageContext = createContext<{ language: Language; interfaceLanguage: Language; contentLanguage: ContentLanguage; setLanguage: (language: Language) => void; setInterfaceLanguage: (language: Language) => void; setContentLanguage: (language: ContentLanguage) => void }>({ language: 'en', interfaceLanguage: 'en', contentLanguage: 'en', setLanguage: () => undefined, setInterfaceLanguage: () => undefined, setContentLanguage: () => undefined });
const translations: Record<string, string> = {
  'Home': 'الرئيسية', 'Explore': 'استكشاف', 'Saved': 'المحفوظات', 'You': 'حسابي', 'Taste profile': 'ملف الذوق',
  'Your taste profile': 'ملف ذوقك', 'Select a few to continue': 'اختر بعض الخيارات للمتابعة',
  'That feels like me': 'هذا يشبهني', 'A social taste platform': 'منصة لاكتشاف الذوق',
  'Start your taste profile': 'ابدأ ملف ذوقك', 'Sign in': 'تسجيل الدخول', 'Follow': 'متابعة',
  'Following': 'تتابع', 'Subscribe': 'اشتراك', 'Saved to your archive': 'حُفظ في أرشيفك',
  'Save this edit': 'احفظ هذا التعديل', 'Preferences': 'التفضيلات', 'Your private archive': 'أرشيفك الخاص',
  'Language': 'اللغة', 'English': 'الإنجليزية', 'العربية': 'العربية', 'Both for content': 'كلاهما للمحتوى',
  'Demo subscription': 'اشتراك تجريبي', 'Continue to demo checkout': 'المتابعة إلى الدفع التجريبي',
  'Cancel at period end': 'إلغاء بنهاية الفترة', 'Reset demo access': 'إعادة ضبط الوصول التجريبي',
};

function useLanguage() {
  return useContext(LanguageContext);
}

function tr(text: string, language: Language) {
  return language === 'ar' ? (translations[text] || text) : text;
}

function contentIsArabic(contentLanguage: ContentLanguage, key: string) {
  return contentLanguage === 'ar' || (contentLanguage === 'both' && key.length % 2 === 0);
}

const arabicContent: Record<string, Partial<Edit> & { creatorBio?: string; creatorCity?: string; description?: string }> = {
  'edit-01': { title: 'إطلالة هادئة', caption: 'خمس قطع أعود إليها عندما يحتاج يومي إلى نية أكثر.', contentType: 'إطلالة منسقة', location: 'مدينة الكويت، الكويت' },
  'edit-02': { title: 'صباح أبطأ', caption: 'طقوس صغيرة تجعل يوم الثلاثاء يشبه الأحد.', contentType: 'طقوس يومية', location: 'في المنزل' },
  'edit-03': { title: 'يستحق الجلسة', caption: 'أماكن لغداء طويل بلا جدول.', contentType: 'دليل أماكن', location: 'جدة، السعودية' },
  'edit-04': { title: 'استراحة عشرين دقيقة', caption: 'حركة قصيرة للأيام التي تفلت منك.', contentType: 'تمارين', location: 'دبي، الإمارات' },
  'fheed': { creatorBio: 'اختيارات مدروسة لما أرتديه، وأين أذهب، وما يبقى معي.', creatorCity: 'مدينة الكويت، الكويت' },
  'maraeats': { creatorBio: 'غرف جميلة، غداء طويل، وتفاصيل تجعل المكان يبقى معك.', creatorCity: 'باريس، فرنسا' },
  'collection-01': { title: 'نهاية أسبوع مدروسة', description: 'دليل للملابس والحركة والإقامة الجميلة.' },
};

function localizeEdit(edit: Edit, contentLanguage: ContentLanguage): Edit {
  if (!contentIsArabic(contentLanguage, edit.id)) return edit;
  return { ...edit, ...arabicContent[edit.id] };
}

function localizeCreator(creator: Creator, contentLanguage: ContentLanguage): Creator {
  if (!contentIsArabic(contentLanguage, creator.username)) return creator;
  const localized = arabicContent[creator.username];
  return localized ? { ...creator, bio: localized.creatorBio || creator.bio, city: localized.creatorCity || creator.city } : creator;
}

function readState<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(`tastekin:${key}`);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeState<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(`tastekin:${key}`, JSON.stringify(value));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function hasSubscription(creatorUsername: string) {
  return readState<string[]>('subscriptions', []).includes(creatorUsername);
}

type CurrentUser = { displayName: string; username: string; avatar: string; bio: string; location: string };
const defaultUser: CurrentUser = { displayName: 'Alex Morgan', username: 'alexmorgan', avatar: '', bio: 'A collector of warm rooms, good sentences, and places with a story.', location: 'Kuwait City, Kuwait' };

function avatarLabel(name: string) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  return src ? <img data-testid={`img-avatar-${name}`} src={src} alt="" className={`avatar avatar-${size}`} /> : <span data-testid={`avatar-fallback-${name}`} className={`avatar avatar-${size} avatar-fallback`}>{avatarLabel(name)}</span>;
}

function Wordmark({ dark = false }: { dark?: boolean }) {
  return <img data-testid="img-tastekin-logo" src="/tastekin-logo.svg" alt="TASTEKIN" className={`wordmark ${dark ? 'wordmark-dark' : ''}`} />;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { language } = useLanguage();
  const currentUser = readState<CurrentUser>('current-user', defaultUser);
  const nav = [
    { href: '/home', label: 'Home', icon: HomeIcon },
    { href: '/explore', label: 'Explore', icon: Compass },
    { href: '/saved', label: 'Saved', icon: Bookmark },
    { href: '/you', label: 'You', icon: UserRound },
  ];
  return (
    <div className="app-shell grain">
      <header className="site-header">
        <Link href="/home" className="header-logo" data-testid="link-home-logo"><Wordmark /></Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={location === href ? 'nav-link active' : 'nav-link'} data-testid={`link-nav-${label.toLowerCase()}`}><Icon size={16} /><span>{tr(label, language)}</span></Link>)}
        </nav>
        <div className="header-actions">
          <Link href="/explore" className="icon-button" data-testid="link-header-search" aria-label="Search"><Search size={19} /></Link>
          <Link href="/you" className="header-avatar" data-testid="link-header-profile"><Avatar name={currentUser.displayName} src={currentUser.avatar} /></Link>
          <button className="icon-button menu-button" onClick={() => setMenuOpen((open) => !open)} data-testid="button-open-menu" aria-label="Open menu"><Menu size={20} /></button>
        </div>
      </header>
      {menuOpen && <div className="mobile-menu" data-testid="menu-mobile"><div className="mobile-menu-inner"><span className="eyebrow">{language === 'ar' ? 'مساحتك في تاستكين' : 'YOUR TASTEKIN'}</span><div className="menu-language-toggle"><span>{language === 'ar' ? 'الواجهة' : 'Interface'}</span><button onClick={() => { writeState('interface-language', 'ar'); window.location.reload(); }}>AR</button><button onClick={() => { writeState('interface-language', 'en'); window.location.reload(); }}>EN</button></div>{nav.map(({ href, label }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} data-testid={`menu-link-${label.toLowerCase()}`}>{tr(label, language)}</Link>)}<Link href="/you/taste-profile" onClick={() => setMenuOpen(false)} data-testid="menu-link-taste-profile">{tr('Taste profile', language)}</Link></div></div>}
      <main className="page-enter">{children}</main>
      <nav className="bottom-nav" aria-label="Mobile navigation">
         {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={location === href ? 'bottom-link active' : 'bottom-link'} data-testid={`link-bottom-${label.toLowerCase()}`}><Icon size={21} /><span>{tr(label, language)}</span></Link>)}
      </nav>
    </div>
  );
}

function Topline({ title, back = false, action }: { title: string; back?: boolean; action?: ReactNode }) {
  return <div className="topline">{back ? <button data-testid="button-go-back" className="icon-button" onClick={() => window.history.back()}><ChevronLeft size={21} /></button> : <span className="topline-marker" />}<h1>{title}</h1><div className="topline-action">{action || <MoreHorizontal size={20} />}</div></div>;
}

function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="section-heading">{<div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 className="serif">{title}</h2></div>}{action}</div>;
}

function MatchPill({ score }: { score: number }) {
  return <span className="match-pill" data-testid={`status-match-${score}`}><Sparkles size={13} /> {score}% taste match</span>;
}

function ImagePanel({ image, alt, className = '', locked = false, label }: { image?: string; alt?: string; className?: string; locked?: boolean; label?: string }) {
  return <div className={`image-panel ${className}`} style={image ? { backgroundImage: `url("${image}")` } : undefined} role="img" aria-label={alt || 'Tastekin edit'}>
    {!image && <div className="image-fallback"><span className="fallback-orbit" /><span className="fallback-line" /></div>}
    {label && <span className="image-label">{label}</span>}
    {locked && <span className="lock-mark"><LockKeyhole size={17} /></span>}
  </div>;
}

function EditCard({ edit, compact = false, onSave }: { edit: Edit; compact?: boolean; onSave?: (edit: Edit) => void }) {
  const [saved, setSaved] = useState(() => readState<string[]>('saved-edits', edit.saved ? [edit.id] : []).includes(edit.id));
  const unlocked = edit.access !== 'subscribers' || hasSubscription(edit.creatorUsername);
  const { contentLanguage } = useLanguage();
  const localized = localizeEdit(edit, contentLanguage);
  const update = useUpdateRelationship();
  const handleSave = () => {
    const next = !saved;
    setSaved(next);
    const savedIds = readState<string[]>('saved-edits', []);
    writeState('saved-edits', next ? Array.from(new Set([...savedIds, edit.id])) : savedIds.filter((id) => id !== edit.id));
    update.mutate({ data: { type: 'save', targetId: edit.id, active: next } }, { onError: () => setSaved(!next) });
    onSave?.({ ...edit, saved: next });
  };
  return <article dir={contentIsArabic(contentLanguage, edit.id) ? 'rtl' : 'ltr'} className={`edit-card ${compact ? 'edit-card-compact' : ''}`} data-testid={`card-edit-${edit.id}`}>
     <Link href={`/edits/${edit.id}`} className="edit-card-image-link" data-testid={`link-edit-${edit.id}`}><ImagePanel image={unlocked ? localized.image : undefined} alt={unlocked ? localized.altText : 'Subscribers only edit preview'} locked={!unlocked} label={!unlocked ? 'SUBSCRIBERS ONLY' : undefined} /></Link>
    <div className="edit-card-body">
       <div className="creator-line"><Avatar name={localized.creatorName} src={localized.creatorAvatar} size="sm" /><Link href={`/creators/${edit.creatorUsername}`} data-testid={`link-creator-${edit.creatorUsername}`}>{localized.creatorName}</Link>{edit.creatorVerified && <BadgeCheck className="verified" size={14} />}</div>
       <div className="edit-card-title-row"><Link href={`/edits/${edit.id}`} className="edit-title serif" data-testid={`link-edit-title-${edit.id}`}>{localized.title}</Link><button className={`save-button ${saved ? 'saved' : ''}`} onClick={handleSave} data-testid={`button-save-${edit.id}`} aria-label={saved ? 'Remove from saved' : 'Save edit'}><Bookmark size={17} fill={saved ? 'currentColor' : 'none'} /></button></div>
       {!compact && <><p className="edit-caption">{localized.caption}</p><div className="meta-row">{localized.location && <span><MapPin size={12} /> {localized.location}</span>}<span>{localized.contentType}</span></div></>}
    </div>
  </article>;
}

function CreatorCard({ creator }: { creator: Creator }) {
  const [following, setFollowing] = useState(() => readState<string[]>('following', []).includes(creator.id));
  const update = useUpdateRelationship();
  const { contentLanguage, language } = useLanguage();
  const displayCreator = localizeCreator(creator, contentLanguage);
  const toggle = () => {
    const next = !following;
    setFollowing(next);
    const followingIds = readState<string[]>('following', []);
    writeState('following', next ? Array.from(new Set([...followingIds, creator.id])) : followingIds.filter((id) => id !== creator.id));
    update.mutate({ data: { type: 'follow', targetId: creator.id, active: next } }, { onError: () => setFollowing(!next) });
  };
  return <article className="creator-card" data-testid={`card-creator-${creator.username}`}>
     <Link href={`/creators/${creator.username}`} className="creator-card-main" data-testid={`link-creator-card-${creator.username}`}><Avatar name={displayCreator.displayName} src={displayCreator.avatar} size="lg" /><div><h3 className="serif">{displayCreator.displayName} {displayCreator.verified && <BadgeCheck className="verified" size={15} />}</h3><p className="mono" dir="ltr">@{displayCreator.username}</p><p className="creator-city"><MapPin size={12} /> {displayCreator.city}</p></div></Link>
     <div className="creator-card-footer"><MatchPill score={creator.matchScore} /><button className={following ? 'button button-small button-following' : 'button button-small button-outline'} onClick={toggle} data-testid={`button-follow-${creator.username}`}>{following ? <><Check size={14} /> {language === 'ar' ? 'تتابع' : 'Following'}</> : language === 'ar' ? 'متابعة' : 'Follow'}</button></div>
  </article>;
}

function LoadingCards({ count = 3 }: { count?: number }) {
  return <div className="loading-grid" data-testid="status-loading">{Array.from({ length: count }).map((_, index) => <div className="skeleton skeleton-card" key={index} />)}</div>;
}

function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="state-card error-state" data-testid="status-error"><CircleAlert size={24} /><h2 className="serif">That page took a wrong turn.</h2><p>We couldn't bring this taste note through right now.</p>{retry && <button className="button button-dark" onClick={retry} data-testid="button-retry"><RefreshCw size={15} /> Try again</button>}</div>;
}

function EmptyState({ title, text, href, label }: { title: string; text: string; href?: string; label?: string }) {
  return <div className="state-card empty-state" data-testid="status-empty"><span className="empty-mark"><Layers3 size={21} /></span><h2 className="serif">{title}</h2><p>{text}</p>{href && <Link href={href} className="button button-dark" data-testid="link-empty-action">{label || 'Explore the edit'}</Link>}</div>;
}

function Welcome() {
  const health = useHealthCheck({ query: { retry: false, queryKey: getHealthCheckQueryKey() } });
  return <div className="welcome-page grain">
    <header className="welcome-header"><Wordmark /><Link href="/auth/login" className="text-link" data-testid="link-welcome-login">Sign in</Link></header>
    <div className="welcome-hero content-frame">
      <div className="welcome-copy"><span className="eyebrow coral">A social taste platform</span><h1 className="serif">Find your<br /><em>people of taste.</em></h1><p>Discover creators, places, products, and routines through the things you already love — not the things everyone is talking about.</p><div className="welcome-actions"><Link href="/auth/sign-up" className="button button-coral" data-testid="link-welcome-signup">Start your taste profile <ChevronRight size={16} /></Link><span className="quiet-status">{health.isLoading ? 'finding the signal…' : 'a quieter corner of the internet'}</span></div></div>
      <div className="welcome-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-core"><span>TK</span></div><span className="art-note note-one">save what<br />stays with you</span><span className="art-note note-two">92% match</span><span className="art-note note-three">for the curious</span></div>
    </div>
    <section className="welcome-principles content-frame"><div><span className="principle-number">01</span><h2 className="serif">A better signal</h2><p>Popularity is a shortcut. Taste is a conversation.</p></div><div><span className="principle-number">02</span><h2 className="serif">Your point of view</h2><p>Build a personal archive of the things you want to remember.</p></div><div><span className="principle-number">03</span><h2 className="serif">Reasons, not rankings</h2><p>Every match comes with a little context, so discovery feels human.</p></div></section>
    <footer className="welcome-footer"><Wordmark /><span>Made for the particular.</span></footer>
  </div>;
}

function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState('');
  if (submitted) return <div className="auth-page"><Link href="/" className="auth-back" data-testid="link-auth-back"><ChevronLeft size={18} /> Back</Link><div className="auth-card centered"><span className="empty-mark"><Check size={21} /></span><span className="eyebrow coral">You're on the list</span><h1 className="serif">Check your inbox.</h1><p>We sent a quiet little link to <strong>{email || 'your email'}</strong>.</p><Link href="/onboarding/taste" className="button button-dark" data-testid="link-auth-continue">Continue to taste profile <ChevronRight size={16} /></Link></div></div>;
  return <div className="auth-page"><Link href="/" className="auth-back" data-testid="link-auth-back"><ChevronLeft size={18} /> Back</Link><div className="auth-card"><Wordmark /><span className="eyebrow coral">{mode === 'login' ? 'Welcome back' : 'A more particular internet'}</span><h1 className="serif">{mode === 'login' ? 'Come back to your taste.' : 'Start with what stays with you.'}</h1><p>{mode === 'login' ? 'Your saved places, people, and small discoveries are waiting.' : 'Tell us a little about your point of view. It takes about two minutes.'}</p><label className="field-label" htmlFor="email">Email address</label><input id="email" data-testid="input-email" className="field-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /><button className="button button-coral full-width" onClick={() => setSubmitted(true)} data-testid="button-submit-auth">{mode === 'login' ? 'Send me a sign-in link' : 'Create my account'} <ChevronRight size={16} /></button><div className="auth-divider"><span>or</span></div><button className="button button-outline full-width" onClick={() => setSubmitted(true)} data-testid="button-continue-apple">Continue with Apple</button><p className="auth-switch">{mode === 'login' ? "New here?" : 'Already have an account?'} <Link href={mode === 'login' ? '/auth/sign-up' : '/auth/login'} data-testid="link-auth-switch">{mode === 'login' ? 'Create an account' : 'Sign in'}</Link></p></div></div>;
}

function TasteOnboarding() {
  const [selected, setSelected] = useState<string[]>(() => readState<string[]>('taste-profile', []));
  const { language } = useLanguage();
  const toggle = (category: string) => setSelected((current) => {
    const next = current.includes(category) ? current.filter((item) => item !== category) : [...current, category];
    writeState('taste-profile', next);
    return next;
  });
  return <div className="onboarding-page"><div className="onboarding-progress"><Wordmark /><LanguageSelector /><span className="mono">01 / 02</span></div><div className="onboarding-content content-frame"><span className="eyebrow coral">{tr('Your taste profile', language)}</span><h1 className="serif">{language === 'ar' ? 'ما الذي يجذبك؟' : 'What pulls you in?'}</h1><p className="onboarding-intro">{language === 'ar' ? 'اختر ثلاثة خيارات على الأقل. لا توجد إجابات خاطئة، فقط تفاصيل أكثر عن ذوقك.' : 'Choose at least three. There are no wrong answers — only more specific ones.'}</p><div className="taste-grid">{categories.map((category, index) => <button key={category} className={`taste-choice ${selected.includes(category) ? 'selected' : ''}`} onClick={() => toggle(category)} data-testid={`button-taste-${category.toLowerCase()}`}><span className="taste-index">0{index + 1}</span><span>{language === 'ar' ? ({ Style: 'أسلوب', Travel: 'سفر', Places: 'أماكن', Food: 'طعام', Routines: 'طقوس يومية', Design: 'تصميم', Wellness: 'عافية', Books: 'كتب' }[category] || category) : category}</span>{selected.includes(category) && <Check size={17} />}</button>)}</div><div className="onboarding-footer"><span>{selected.length ? `${selected.length} ${language === 'ar' ? 'مختارة' : 'selected'}` : tr('Select a few to continue', language)}</span><Link href={selected.length >= 3 ? '/onboarding/complete' : '#'} className={`button ${selected.length >= 3 ? 'button-coral' : 'button-disabled'}`} data-testid="link-onboarding-next" onClick={(event) => { if (selected.length < 3) event.preventDefault(); }}>{tr('That feels like me', language)} <ChevronRight size={16} /></Link></div></div></div>;
}

function OnboardingComplete() {
  return <div className="complete-page"><div className="complete-mark"><span>TK</span></div><span className="eyebrow coral">Taste profile ready</span><h1 className="serif">Let's find<br /><em>your kind of rare.</em></h1><p>We'll start with a few people whose point of view might feel familiar.</p><Link href="/home" className="button button-coral" data-testid="link-complete-home">Enter TASTEKIN <ChevronRight size={16} /></Link><span className="mono complete-note">You can always edit your taste profile later.</span></div>;
}

function Home() {
  const feed = useGetFeed({ query: { retry: 1, queryKey: getGetFeedQueryKey() } });
  const { language, contentLanguage } = useLanguage();
  const edits = (feed.data?.length ? feed.data : fallbackEdits).map((edit) => localizeEdit(edit, contentLanguage));
  const arabic = language === 'ar';
  return <AppShell><div className="content-frame app-page"><Topline title={arabic ? 'تعديلاتك' : 'Your edits'} action={<button className="icon-button" data-testid="button-feed-options"><SlidersHorizontal size={18} /></button>} /><div className="home-intro"><div><span className="eyebrow">{arabic ? 'الخميس، ٢٢ مايو' : 'Thursday, 22 May'}</span><h1 className="serif">{arabic ? <>أشياء قليلة<br />تستحق <em>انتباهك.</em></> : <>A few things<br /><em>for your attention.</em></>}</h1></div><span className="home-signal"><Sparkles size={15} /> {arabic ? 'مختارة لك' : 'curated for you'}</span></div><div className="filter-scroll hide-scrollbar">{(arabic ? ['الكل', 'أتابعهم', 'أسلوب', 'سفر', 'أماكن', 'طقوس'] : ['All', 'Following', 'Style', 'Travel', 'Places', 'Routines']).map((filter, index) => <button key={filter} className={index === 0 ? 'filter-chip active' : 'filter-chip'} data-testid={`button-filter-${filter.toLowerCase()}`}>{filter}</button>)}</div>{feed.isLoading ? <LoadingCards /> : feed.isError ? <ErrorState retry={() => feed.refetch()} /> : <div className="edit-grid">{edits.map((edit) => <EditCard key={edit.id} edit={edit} />)}</div>}<section className="home-discovery"><SectionHeading eyebrow={arabic ? 'شخص يستحق المعرفة' : 'A person to know'} title={arabic ? 'ملاحظات قد تشبه ملاحظاتك.' : 'Someone whose notes may be yours.'} action={<Link href="/explore" className="text-link" data-testid="link-home-explore">{arabic ? 'عرض الكل' : 'See all'} <ChevronRight size={15} /></Link>} /> <CreatorCard creator={fallbackCreators[0]} /></section></div></AppShell>;
}

function Explore() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const params = useMemo(() => ({ q: q || undefined, category: category || undefined }), [q, category]);
  const results = useExplore(params);
  const creators = useListCreators(params);
  const { language, contentLanguage } = useLanguage();
  const data: ExploreResults = results.data || { creators: creators.data || fallbackCreators, edits: fallbackEdits.slice(0, 2), collections: fallbackCollections, places: ['Paris, France', 'Copenhagen, Denmark', 'Brooklyn, NY'], products: ['Aesop Resurrection', 'Leuchtturm weekly planner', 'Kinto travel tumbler'] };
  const arabic = language === 'ar';
  return <AppShell><div className="content-frame app-page"><Topline title={arabic ? 'استكشاف' : 'Explore'} action={<button className="icon-button" data-testid="button-explore-filter"><SlidersHorizontal size={18} /></button>} /><div className="search-box"><Search size={19} /><input dir="ltr" type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={arabic ? 'ابحث عن مكان أو شخص أو شعور' : 'Search a place, person, or feeling'} data-testid="input-explore-search" /><kbd>⌘ K</kbd></div><div className="filter-scroll hide-scrollbar">{(arabic ? ['الكل', 'أسلوب', 'سفر', 'أماكن', 'طعام', 'طقوس'] : ['All', ...categories]).map((filter) => <button key={filter} onClick={() => setCategory(filter === 'All' || filter === 'الكل' ? '' : filter)} className={(filter === 'All' && !category) || (filter === 'الكل' && !category) || category === filter ? 'filter-chip active' : 'filter-chip'} data-testid={`button-explore-${filter.toLowerCase()}`}>{filter}</button>)}</div>{results.isLoading ? <LoadingCards count={4} /> : <div className="explore-sections"><section><SectionHeading eyebrow={arabic ? 'أشخاص يشبهون ذوقك' : 'People of taste'} title={arabic ? 'مبدعون يستحقون المتابعة' : 'Creators to follow'} action={<span className="mono result-count">{data.creators.length} {arabic ? 'نتيجة' : 'found'}</span>} /><div className="creator-list">{data.creators.map((creator) => <CreatorCard key={creator.id} creator={creator} />)}</div></section><section><SectionHeading eyebrow={arabic ? 'وجهة نظر جديدة' : 'Fresh perspective'} title={arabic ? 'تعديلات حديثة' : 'Recent edits'} /><div className="edit-grid edit-grid-two">{data.edits.map((edit) => <EditCard key={edit.id} edit={localizeEdit(edit, contentLanguage)} compact />)}</div></section><section><SectionHeading eyebrow={arabic ? 'محفوظ بعناية' : 'Filed away'} title={arabic ? 'مجموعات' : 'Collections'} /><div className="collection-list">{data.collections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}</div></section><div className="explore-tags"><div><span className="eyebrow">{arabic ? 'أماكن' : 'Places'}</span>{data.places.map((place) => <button key={place} dir="ltr" data-testid={`button-place-${place}`}>{place}<ChevronRight size={14} /></button>)}</div><div><span className="eyebrow">{arabic ? 'منتجات' : 'Products'}</span>{data.products.map((product) => <button key={product} dir="ltr" data-testid={`button-product-${product}`}>{product}<ChevronRight size={14} /></button>)}</div></div></div>}</div></AppShell>;
}

function CollectionCard({ collection }: { collection: Collection }) {
  const [saved, setSaved] = useState(() => readState<string[]>('saved-collections', []).includes(collection.id));
  const toggle = () => { const next = !saved; setSaved(next); const ids = readState<string[]>('saved-collections', []); writeState('saved-collections', next ? Array.from(new Set([...ids, collection.id])) : ids.filter((id) => id !== collection.id)); };
  return <div className="collection-card"><Link href={`/creators/${collection.creatorUsername}/collections/${collection.id}`} className="collection-card-link" data-testid={`link-collection-${collection.id}`}><ImagePanel image={collection.image} alt={collection.title} /><div><span className="eyebrow">{collection.access === 'mixed' ? 'MIXED ACCESS' : collection.access.toUpperCase()}</span><h3 className="serif">{collection.title}</h3><p>{collection.description}</p><span className="mono">{collection.itemCount} items · updated {collection.updatedAt || 'recently'}</span></div><ChevronRight size={18} /></Link><button className={`collection-save ${saved ? 'saved' : ''}`} onClick={toggle} aria-label={saved ? 'Remove collection from saved' : 'Save collection'}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button></div>;
}

function Saved() {
  const [tab, setTab] = useState('Edits');
  const { language, contentLanguage } = useLanguage();
  const savedIds = readState<string[]>('saved-edits', []);
  const saved = fallbackEdits.filter((edit) => savedIds.includes(edit.id) || edit.saved);
  const followed = fallbackCreators.filter((creator) => readState<string[]>('following', []).includes(creator.id));
  const savedCollections = fallbackCollections.filter((collection) => readState<string[]>('saved-collections', []).includes(collection.id));
  const labels = language === 'ar' ? ['تعديلات', 'مبدعون', 'مجموعات'] : ['Edits', 'Creators', 'Collections'];
  return <AppShell><div className="content-frame app-page"><Topline title={language === 'ar' ? 'المحفوظات' : 'Saved'} action={<button className="icon-button" data-testid="button-saved-options"><MoreHorizontal size={19} /></button>} /><div className="saved-intro"><span className="eyebrow coral">{language === 'ar' ? 'أرشيفك الخاص' : 'Your private archive'}</span><h1 className="serif">{language === 'ar' ? <>احتفظ<br /><em>بالجميل.</em></> : <>Keep the good<br /><em>ones close.</em></>}</h1><p>{language === 'ar' ? 'مكان للروابط والملاحظات والأشخاص الذين تريد العودة إليهم.' : 'A place for the links, notes, and people you want to come back to.'}</p></div><div className="tab-row">{labels.map((item, index) => <button key={item} onClick={() => setTab(['Edits', 'Creators', 'Collections'][index])} className={tab === ['Edits', 'Creators', 'Collections'][index] ? 'tab active' : 'tab'} data-testid={`button-saved-tab-${['edits', 'creators', 'collections'][index]}`}>{item}</button>)}</div>{tab === 'Edits' ? <div className="edit-grid">{saved.map((edit) => <EditCard key={edit.id} edit={localizeEdit(edit, contentLanguage)} />)}</div> : tab === 'Creators' ? (followed.length ? <div className="creator-list">{followed.map((creator) => <CreatorCard key={creator.id} creator={creator} />)}</div> : <EmptyState title={language === 'ar' ? 'لا مبدعون محفوظون بعد.' : 'No saved creators yet.'} text={language === 'ar' ? 'تابع شخصاً يشبهك في وجهة نظره.' : 'Follow someone whose point of view feels like yours.'} href="/explore" label={language === 'ar' ? 'اعثر على مبدعين' : 'Find creators'} />) : (savedCollections.length ? <div className="collection-list">{savedCollections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}</div> : <EmptyState title={language === 'ar' ? 'لا مجموعات محفوظة بعد.' : 'No saved collections yet.'} text={language === 'ar' ? 'احتفظ بمجموعة قريبة عندما تريد العودة إليها.' : 'Keep a collection close when you want to return to it.'} href="/explore" label={language === 'ar' ? 'اعثر على مجموعات' : 'Find collections'} />)}</div></AppShell>;
}

function You() {
  const user = readState<CurrentUser>('current-user', defaultUser);
  const { language } = useLanguage();
  const ar = language === 'ar';
  return <AppShell><div className="content-frame app-page"><Topline title={ar ? 'حسابي' : 'You'} action={<Link href="/you/preferences" className="icon-button" data-testid="link-you-settings"><Settings size={19} /></Link>} /><div className="profile-hero"><Avatar name={user.displayName} src={user.avatar} size="lg" /><div><span className="eyebrow">{ar ? 'ملف ذوقك' : 'Your taste profile'}</span><h1 className="serif">{user.displayName}</h1><p className="mono" dir="ltr">@{user.username}</p></div><Link href="/you/preferences" className="icon-button" data-testid="button-profile-menu"><MoreHorizontal size={20} /></Link></div><div className="profile-bio">{user.bio}</div><div className="profile-stats"><div><strong>{readState<string[]>('saved-edits', []).length}</strong><span>{ar ? 'تعديلات محفوظة' : 'saved edits'}</span></div><div><strong>{readState<string[]>('following', []).length}</strong><span>{ar ? 'مبدعون تتابعهم' : 'people followed'}</span></div><div><strong>06</strong><span>{ar ? 'إشارات ذوق' : 'taste signals'}</span></div></div><div className="profile-menu"><Link href="/you/taste-profile" data-testid="link-you-taste-profile"><Sparkles size={18} /><span><strong>{ar ? 'ملف الذوق' : 'Taste profile'}</strong><small>{ar ? 'اعرف لماذا تشبهك الأشياء' : 'See why things feel like you'}</small></span><ChevronRight size={17} /></Link><Link href="/you/preferences" data-testid="button-you-preferences"><Settings size={18} /><span><strong>{ar ? 'التفضيلات' : 'Preferences'}</strong><small>{ar ? 'اللغة والحساب والخصوصية' : 'Language, account, and privacy'}</small></span><ChevronRight size={17} /></Link><button data-testid="button-you-share"><Share2 size={18} /><span><strong>{ar ? 'شارك ملفك' : 'Share your profile'}</strong><small>{ar ? 'دع الآخرين يتعرفون على وجهة نظرك' : 'Let someone in on your point of view'}</small></span><ChevronRight size={17} /></button></div><div className="profile-footer-note"><span className="mono">TASTEKIN / PHASE 01</span><span>{ar ? 'لمن يلاحظ التفاصيل.' : 'Made for the particular.'}</span></div></div></AppShell>;
}

function LanguageSelector() {
  const { interfaceLanguage, contentLanguage, setInterfaceLanguage, setContentLanguage } = useLanguage();
  return <div className="language-selector" role="group" aria-label="Language"><span className="eyebrow">Interface language / لغة الواجهة</span><div className="language-options">{(['en', 'ar'] as Language[]).map((item) => <button key={item} className={interfaceLanguage === item ? 'language-option active' : 'language-option'} onClick={() => setInterfaceLanguage(item)} data-testid={`button-interface-language-${item}`}>{item === 'en' ? 'English' : 'العربية'}</button>)}</div><span className="eyebrow content-language-label">Content language / لغة المحتوى</span><div className="language-options">{(['en', 'ar', 'both'] as ContentLanguage[]).map((item) => <button key={item} className={contentLanguage === item ? 'language-option active' : 'language-option'} onClick={() => setContentLanguage(item)} data-testid={`button-content-language-${item}`}>{item === 'en' ? 'English' : item === 'ar' ? 'العربية' : 'Both for content'}</button>)}</div></div>;
}

function Preferences() {
  const [user, setUser] = useState<CurrentUser>(() => readState('current-user', defaultUser));
  const [saved, setSaved] = useState(false);
  const { language } = useLanguage();
  const update = (key: keyof CurrentUser, value: string) => setUser((current) => ({ ...current, [key]: value }));
  const save = () => { writeState('current-user', user); setSaved(true); window.setTimeout(() => setSaved(false), 1800); };
  return <AppShell><div className="content-frame app-page narrow-page"><Topline title={language === 'ar' ? 'التفضيلات' : 'Preferences'} back /><section className="preferences-section"><span className="eyebrow coral">{language === 'ar' ? 'حسابك' : 'Your account'}</span><h1 className="serif preferences-title">{language === 'ar' ? 'اجعلها مساحتك.' : 'Make it yours.'}</h1><div className="profile-form"><label className="field-label" htmlFor="profile-name">{language === 'ar' ? 'الاسم الظاهر' : 'Display name'}</label><input id="profile-name" className="field-input" value={user.displayName} onChange={(event) => update('displayName', event.target.value)} /><label className="field-label" htmlFor="profile-username">{language === 'ar' ? 'اسم المستخدم' : 'Username'}</label><input id="profile-username" className="field-input" value={user.username} onChange={(event) => update('username', event.target.value.replace(/\s/g, ''))} /><label className="field-label" htmlFor="profile-avatar">{language === 'ar' ? 'رابط الصورة الشخصية' : 'Avatar image URL'}</label><input id="profile-avatar" className="field-input" value={user.avatar} onChange={(event) => update('avatar', event.target.value)} placeholder="https://…" /><label className="field-label" htmlFor="profile-bio">{language === 'ar' ? 'نبذة' : 'Bio'}</label><textarea id="profile-bio" className="field-input field-textarea" value={user.bio} onChange={(event) => update('bio', event.target.value)} /><label className="field-label" htmlFor="profile-location">{language === 'ar' ? 'الموقع' : 'Location'}</label><input id="profile-location" className="field-input" value={user.location} onChange={(event) => update('location', event.target.value)} /><button className="button button-coral full-width" onClick={save} data-testid="button-save-profile">{saved ? (language === 'ar' ? 'تم الحفظ' : 'Saved') : (language === 'ar' ? 'حفظ الملف' : 'Save profile')} <Check size={16} /></button></div></section><section className="preferences-section"><LanguageSelector /><p className="preference-note">{language === 'ar' ? 'العربية تغيّر الواجهة بالكامل إلى اتجاه من اليمين إلى اليسار. خيار كلاهما يبقي الواجهة الإنجليزية مع السماح بالمحتوى ثنائي اللغة.' : 'Arabic switches the interface to right-to-left. “Both” keeps the interface in English while allowing bilingual content.'}</p></section><section className="preferences-section demo-reset"><span className="eyebrow">{language === 'ar' ? 'أدوات العرض التجريبي' : 'Demo controls'}</span><button className="button button-outline full-width" onClick={() => { localStorage.removeItem('tastekin:subscriptions'); window.location.reload(); }}>{language === 'ar' ? 'إعادة ضبط الوصول' : 'Reset demo access'}</button></section></div></AppShell>;
}

function SubscribePage() {
  const { creatorId = 'fheed-alaiban' } = useParams<{ creatorId: string }>();
  const creator = fallbackCreators.find((item) => item.id === creatorId || item.username === creatorId) || fallbackCreators[0];
  const [active, setActive] = useState(() => hasSubscription(creator.username));
  const [cancelled, setCancelled] = useState(false);
  const { language } = useLanguage();
  const activate = () => { const subscriptions = readState<string[]>('subscriptions', []); writeState('subscriptions', Array.from(new Set([...subscriptions, creator.username]))); setActive(true); setCancelled(false); };
  const cancel = () => { writeState('subscriptions', readState<string[]>('subscriptions', []).filter((item) => item !== creator.username)); setActive(false); setCancelled(true); };
  const reset = () => { writeState('subscriptions', []); setActive(false); setCancelled(false); };
  const ar = language === 'ar';
  return <AppShell><div className="content-frame app-page narrow-page subscribe-page"><Topline title={ar ? 'اشتراك' : 'Subscribe'} back /><div className="subscribe-hero"><Avatar name={creator.displayName} src={creator.avatar} size="lg" /><span className="eyebrow coral">{ar ? 'اشتراك تجريبي' : 'Demo subscription'}</span><h1 className="serif">{ar ? `نظرة أقرب على ${creator.displayName}.` : `A closer look at ${creator.displayName}.`}</h1><p>{ar ? 'احصل على التعديلات الكاملة والوسائط الأصلية والتفاصيل الهادئة خلف كل توصية.' : 'Get the full edit, original media, and the quieter details behind each recommendation.'}</p></div><div className="subscription-price"><strong>$19.99</strong><span>/ {ar ? 'شهرياً' : 'month'}</span></div><ul className="benefits-list"><li><Check size={16} /> {ar ? 'تعديلات المشتركين والوسائط الأصلية' : 'Subscribers Only Edits and original media'}</li><li><Check size={16} /> {ar ? 'وصول مبكر إلى المجموعات الجديدة' : 'Early access to new collections'}</li><li><Check size={16} /> {ar ? 'ملاحظة مدروسة كل أسبوع' : 'A considered note every week'}</li></ul>{active ? <div className="access-confirmation"><Check size={20} /><strong>{ar ? 'الوصول التجريبي فعال' : 'Demo access is active'}</strong><span>{ar ? 'التعديلات المحمية مفتوحة الآن على هذا الجهاز.' : 'Protected edits are now unlocked on this device.'}</span><button className="button button-outline full-width" onClick={cancel}>{ar ? 'إلغاء بنهاية الفترة' : 'Cancel at period end'}</button></div> : <div className="checkout-card"><span className="eyebrow">{ar ? 'لا يوجد دفع حقيقي' : 'No real payment'}</span><p>{ar ? 'هذه عملية دفع تجريبية واضحة. لن يتم تحصيل أي مبلغ.' : 'This is a clearly labelled demo checkout. Nothing will be charged.'}</p><button className="button button-coral full-width" onClick={activate} data-testid="button-demo-checkout">{ar ? 'المتابعة إلى الدفع التجريبي' : 'Continue to demo checkout'} · $19.99</button></div>}<button className="text-link reset-demo-link" onClick={reset}>{ar ? 'إعادة ضبط الوصول التجريبي' : 'Reset demo access'}</button>{cancelled && <p className="preference-note">{ar ? 'تم إلغاء الوصول التجريبي. يمكنك تفعيله مجدداً.' : 'Demo access cancelled. You can activate it again any time.'}</p>}</div></AppShell>;
}

function TasteProfile() {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const signals = ar ? ['سفر بطيء', 'أماكن مستقلة', 'بساطة دافئة', 'غداء طويل', 'طقوس يومية', 'خامات جميلة'] : ['Slow travel', 'Independent places', 'Warm minimalism', 'Long lunches', 'Daily rituals', 'Good materials'];
  return <AppShell><div className="content-frame app-page narrow-page"><Topline title={ar ? 'ملف الذوق' : 'Taste profile'} back /><div className="taste-profile-head"><span className="eyebrow coral">{ar ? 'الأشياء التي تلاحظها' : 'The things you notice'}</span><h1 className="serif">{ar ? <>وجهة<br /><em>نظرك.</em></> : <>Your point<br /><em>of view.</em></>}</h1><p>{ar ? 'هذا هو شكل ذوقك الآن. يتحسن مع كل حفظ ومتابعة وتجربة جديدة.' : 'This is the shape of your taste right now. It gets better as you save, follow, and wander.'}</p></div><section className="taste-meter"><div className="meter-label"><span>{ar ? 'الخصوصية' : 'Specificity'}</span><span className="mono">72 / 100</span></div><div className="meter-track"><span /></div><p>{ar ? 'اختياراتك مدروسة ودافئة وتميل إلى الأماكن الأقل ازدحاماً.' : 'Your choices lean considered, warm, and a little out of the way.'}</p></section><section className="signal-section"><SectionHeading eyebrow={ar ? 'إشاراتك' : 'Your signals'} title={ar ? 'ما الذي يجذبك' : 'What pulls you in'} action={<button className="text-link" data-testid="button-edit-taste">{ar ? 'تعديل' : 'Edit'} <ChevronRight size={14} /></button>} /><div className="signal-cloud">{signals.map((signal, index) => <span key={signal} className={`signal-tag signal-${index % 3}`}>{signal}</span>)}</div></section><section className="why-section"><SectionHeading eyebrow={ar ? 'كيف يعمل هذا' : 'How this works'} title={ar ? 'الذوق ليس نتيجة.' : 'Taste is not a score.'} /><p>{ar ? 'نبحث عن الأنماط بين ما تحفظه وما يصنعه المبدع. التطابق بداية، أما الأسباب فهي ما يجعل الاكتشاف ممتعاً.' : 'We look for patterns between what you save and what a creator makes. Your match is a starting point — the reasons are where it gets interesting.'}</p><Link href="/explore" className="button button-dark" data-testid="link-taste-explore">{ar ? 'استكشف تطابقاتك' : 'Explore your matches'} <ChevronRight size={16} /></Link></section></div></AppShell>;
}

function CreatorPage({ matchOnly = false, collectionId }: { matchOnly?: boolean; collectionId?: string }) {
  const { username = 'maraeats' } = useParams<{ username: string }>();
  const creatorQuery = useGetCreator(username, { query: { queryKey: [`/api/creators/${username}`], retry: 1 } });
  const fallback = fallbackCreators.find((creator) => creator.username === username) || fallbackCreators[0];
  const profile: CreatorProfile = creatorQuery.data || { ...fallback, editCount: 18, collectionCount: 4, reasons: sampleReasons, edits: fallbackEdits, collections: fallbackCollections.filter((item) => item.creatorUsername === fallback.username) };
  const { language, contentLanguage } = useLanguage();
  const arabicContentActive = contentIsArabic(contentLanguage, profile.username);
  const displayProfile: CreatorProfile = { ...profile, bio: arabicContentActive ? (arabicContent[profile.username]?.creatorBio || profile.bio) : profile.bio, city: arabicContentActive ? (arabicContent[profile.username]?.creatorCity || profile.city) : profile.city, edits: profile.edits.map((edit) => localizeEdit(edit, contentLanguage)) };
  const [following, setFollowing] = useState(() => readState<string[]>('following', []).includes(profile.id));
  const update = useUpdateRelationship();
  const toggleFollow = () => { const next = !following; setFollowing(next); update.mutate({ data: { type: 'follow', targetId: profile.id, active: next } }, { onError: () => setFollowing(!next) }); };
  if (collectionId) {
     const collection = profile.collections.find((item) => item.id === collectionId) || fallbackCollections[0];
    return <AppShell><div className="content-frame app-page narrow-page"><Topline title="Collection" back /><div className="collection-detail"><ImagePanel image={collection.image} alt={collection.title} /><span className="eyebrow coral">{collection.access.toUpperCase()} COLLECTION</span><h1 className="serif">{collection.title}</h1><p>{collection.description}</p><div className="meta-row"><span><Layers3 size={13} /> {collection.itemCount} items</span><span>Updated {collection.updatedAt || 'recently'}</span></div><div className="collection-note"><Sparkles size={17} /><span>Collected by @{collection.creatorUsername} for people who notice the same details.</span></div><div className="edit-grid">{profile.edits.slice(0, 3).map((edit) => <EditCard key={edit.id} edit={edit} compact />)}</div></div></div></AppShell>;
  }
   if (matchOnly) return <AppShell><div className="content-frame app-page narrow-page"><Topline title={language === 'ar' ? 'لماذا تتطابقان' : 'Why you match'} back /><div className="match-hero"><MatchPill score={displayProfile.matchScore} /><h1 className="serif">{language === 'ar' ? <>طريقة مألوفة<br />لرؤية العالم.</> : <>A familiar<br /><em>way of noticing.</em></>}</h1><p>{language === 'ar' ? 'تلتقي تعديلات فهيد مع ذوقك في مدينة الكويت والسفر والأسلوب الهادئ.' : `${displayProfile.displayName}'s edits tend to land where your taste already has a little gravity.`}</p></div><div className="reason-list">{(displayProfile.reasons.length ? displayProfile.reasons : sampleReasons).map((reason, index) => <div className="reason-item" key={reason}><span>0{index + 1}</span><p dir={language === 'ar' ? 'rtl' : 'ltr'}>{language === 'ar' ? ['تلتقي اختياراتكما في الأسلوب اليومي الهادئ', 'يتقاطع ذوقكما في مدينة الكويت والسفر', 'تميلان إلى الدرجات الدافئة والأشياء المدروسة'][index] || reason : reason}</p><Check size={17} /></div>)}</div><Link href={`/creators/${displayProfile.username}`} className="button button-dark full-width" data-testid="link-match-profile">{language === 'ar' ? `العودة إلى ${displayProfile.displayName}` : `Back to ${displayProfile.displayName}'s profile`}</Link></div></AppShell>;
   return <AppShell><div className="content-frame app-page"><Topline title={language === 'ar' ? 'المبدع' : 'Creator'} back action={<button className="icon-button" data-testid="button-creator-options"><MoreHorizontal size={19} /></button>} />{creatorQuery.isLoading ? <LoadingCards count={2} /> : creatorQuery.isError ? <ErrorState retry={() => creatorQuery.refetch()} /> : <><div className="creator-profile-head"><Avatar name={displayProfile.displayName} src={displayProfile.avatar} size="lg" /><div className="creator-profile-copy"><h1 className="serif">{displayProfile.displayName} {displayProfile.verified && <BadgeCheck className="verified" size={19} />}</h1><p className="mono" dir="ltr">@{displayProfile.username}</p><div className="creator-categories">{displayProfile.categories.map((cat) => <span key={cat}>{language === 'ar' ? ({ Style: 'أسلوب', Travel: 'سفر', Rituals: 'طقوس' }[cat] || cat) : cat}</span>)}</div><p className="creator-city"><MapPin size={13} /> {displayProfile.city}</p></div></div><p className="creator-bio">{displayProfile.bio}</p><div className="creator-match-row"><MatchPill score={displayProfile.matchScore} /><Link href={`/creators/${displayProfile.username}/match`} className="text-link" data-testid="link-creator-match">{language === 'ar' ? 'لماذا تتطابقان' : 'Why you match'} <ChevronRight size={14} /></Link></div><div className="creator-actions"><button className={following ? 'button button-following' : 'button button-outline'} onClick={toggleFollow} data-testid="button-creator-follow">{following ? <><Check size={15} /> {language === 'ar' ? 'تتابع' : 'Following'}</> : language === 'ar' ? 'متابعة' : 'Follow'}</button><Link href={`/subscribe/${displayProfile.id}`} className="button button-dark" data-testid="button-creator-subscribe"><LockKeyhole size={15} /> {language === 'ar' ? 'اشتراك · $19.99 / شهر' : 'Subscribe · $19.99 / month'}</Link></div><div className="profile-tabs"><button className="active" data-testid="button-creator-edits">{language === 'ar' ? 'تعديلات' : 'Edits'} <span>{displayProfile.editCount}</span></button><Link href={`/creators/${displayProfile.username}/collections`} data-testid="link-creator-collections">{language === 'ar' ? 'مجموعات' : 'Collections'} <span>{displayProfile.collectionCount}</span></Link><button data-testid="button-creator-about">{language === 'ar' ? 'نبذة' : 'About'}</button></div><div className="edit-grid">{displayProfile.edits.map((edit) => <EditCard key={edit.id} edit={edit} />)}</div></>}</div></AppShell>;
}

function CreatorCollections() {
  const { username = 'maraeats' } = useParams<{ username: string }>();
  const query = useGetCreator(username, { query: { queryKey: [`/api/creators/${username}`], retry: 1 } });
  const fallback = fallbackCreators.find((item) => item.username === username) || fallbackCreators[0];
  const profile = query.data || { ...fallback, editCount: 18, collectionCount: 4, reasons: sampleReasons, edits: fallbackEdits, collections: fallbackCollections };
  return <AppShell><div className="content-frame app-page"><Topline title="Collections" back /><div className="collections-intro"><span className="eyebrow coral">Filed with care</span><h1 className="serif">The things<br /><em>worth returning to.</em></h1><p>Collections by {profile.displayName}, made for a particular kind of curious.</p></div><div className="collection-list">{profile.collections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}</div></div></AppShell>;
}

function CreatorMatchRoute() {
  return <CreatorPage matchOnly />;
}

function CreatorCollectionDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <CreatorPage collectionId={id} />;
}

function EditDetail() {
  const { id = 'edit-paris' } = useParams<{ id: string }>();
  const query = useGetEdit(id, { query: { queryKey: [`/api/edits/${id}`], retry: 1 } });
  const edit = query.data || fallbackEdits.find((item) => item.id === id) || fallbackEdits[0];
  const [saved, setSaved] = useState(() => readState<string[]>('saved-edits', edit.saved ? [edit.id] : []).includes(edit.id));
  const update = useUpdateRelationship();
  const save = () => { const next = !saved; setSaved(next); const savedIds = readState<string[]>('saved-edits', []); writeState('saved-edits', next ? Array.from(new Set([...savedIds, edit.id])) : savedIds.filter((id) => id !== edit.id)); update.mutate({ data: { type: 'save', targetId: edit.id, active: next } }, { onError: () => setSaved(!next) }); };
  const unlocked = edit.access !== 'subscribers' || hasSubscription(edit.creatorUsername);
  return <AppShell><div className="content-frame app-page narrow-page"><Topline title="Edit" back action={<button className="icon-button" data-testid="button-edit-share"><Share2 size={18} /></button>} />{query.isLoading ? <LoadingCards count={1} /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : <article className="edit-detail"><ImagePanel image={unlocked ? edit.image : undefined} alt={unlocked ? edit.altText : 'Subscribers only edit preview'} className="detail-image" locked={!unlocked} label={!unlocked ? 'SUBSCRIBERS ONLY' : undefined} /><div className="detail-content"><div className="creator-line"><Avatar name={edit.creatorName} src={edit.creatorAvatar} /><Link href={`/creators/${edit.creatorUsername}`} data-testid="link-detail-creator">{edit.creatorName}</Link>{edit.creatorVerified && <BadgeCheck className="verified" size={15} />}</div><h1 className="serif">{edit.title}</h1><p className="detail-caption">{unlocked ? edit.caption : 'This Edit is reserved for subscribers. Subscribe to unlock the full note and its original media.'}</p>{!unlocked && <Link href={`/subscribe/${edit.creatorUsername}`} className="button button-coral full-width" data-testid="link-edit-subscribe"><LockKeyhole size={16} /> Subscribe · $19.99 / month</Link>}<div className="detail-meta"><span>{edit.location && <><MapPin size={14} /> {edit.location}</>}</span><span>{edit.publishedAt || 'Recently'}</span></div><div className="tag-row">{edit.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><button className={saved ? 'button button-coral full-width' : 'button button-dark full-width'} onClick={save} data-testid="button-detail-save"><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved to your archive' : 'Save this edit'}</button>{edit.sponsored && <p className="sponsored-note">Partner note · This edit includes a sponsored recommendation.</p>}</div></article>}</div></AppShell>;
}

function ErrorPage({ unavailable = false }: { unavailable?: boolean }) {
  return <div className="full-state-page"><Wordmark /><div className="state-card"><span className="empty-mark">{unavailable ? <LockKeyhole size={21} /> : <CircleAlert size={21} />}</span><span className="eyebrow coral">{unavailable ? 'Temporarily private' : '404 / not found'}</span><h1 className="serif">{unavailable ? 'This note is for a smaller room.' : 'Nothing here, for now.'}</h1><p>{unavailable ? 'The creator has kept this edit for subscribers or close friends.' : 'The page you were looking for may have moved — or never existed.'}</p><Link href="/home" className="button button-dark" data-testid="link-error-home">Back to your edits <ChevronRight size={16} /></Link></div></div>;
}

function TypographyPreview() {
  return <div className="full-state-page typography-preview"><Wordmark /><div className="content-frame narrow-page"><span className="eyebrow coral">Type study / 01</span><h1 className="serif">A quieter way to read.</h1><p className="type-intro">Manrope keeps TASTEKIN editorial, but gives every screen more room to breathe.</p><div className="type-specimen"><section className="type-specimen-card"><span className="eyebrow">English / Manrope</span><h2 className="serif">People of particular taste.</h2><p>Manrope carries the daily interface with a clear, contemporary rhythm. Weight, spacing, and color create the distinction without decorative display type.</p></section><section className="type-specimen-card arabic" lang="ar" dir="rtl"><span className="eyebrow">العربية / IBM Plex Sans Arabic</span><h2>مساحة أهدأ لاكتشاف ذوقك</h2><p>واجهة هادئة وواضحة تساعدك على اكتشاف الأشخاص والأماكن والأفكار التي تشبهك، بإيقاع مريح وقراءة يومية سهلة.</p></section></div></div></div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={Welcome} />
    <Route path="/auth/login"><AuthPage mode="login" /></Route>
    <Route path="/auth/sign-up"><AuthPage mode="signup" /></Route>
    <Route path="/onboarding/taste" component={TasteOnboarding} />
    <Route path="/onboarding/complete" component={OnboardingComplete} />
    <Route path="/home" component={Home} />
    <Route path="/explore" component={Explore} />
    <Route path="/saved" component={Saved} />
    <Route path="/you" component={You} />
    <Route path="/you/taste-profile" component={TasteProfile} />
    <Route path="/you/preferences" component={Preferences} />
    <Route path="/subscribe/:creatorId" component={SubscribePage} />
    <Route path="/typography" component={TypographyPreview} />
    <Route path="/creators/:username/collections/:id" component={CreatorCollectionDetailRoute} />
    <Route path="/creators/:username/collections" component={CreatorCollections} />
    <Route path="/creators/:username/match" component={CreatorMatchRoute} />
    <Route path="/creators/:username"><CreatorPage /></Route>
    <Route path="/edits/:id" component={EditDetail} />
    <Route path="/error"><ErrorPage /></Route>
    <Route path="/unavailable"><ErrorPage unavailable /></Route>
    <Route component={() => <ErrorPage />} />
  </Switch></ErrorBoundary>;
}

function App() {
  const [language, setLanguageState] = useState<Language>(() => new URLSearchParams(window.location.search).get('lang') === 'ar' ? 'ar' : readState<Language>('interface-language', 'en'));
  const [contentLanguage, setContentLanguageState] = useState<ContentLanguage>(() => {
    const requested = new URLSearchParams(window.location.search).get('content');
    return requested === 'ar' || requested === 'both' ? requested : readState<ContentLanguage>('content-language', 'en');
  });
  const setLanguage = (next: Language) => { writeState('interface-language', next); setLanguageState(next); };
  const setContentLanguage = (next: ContentLanguage) => { writeState('content-language', next); setContentLanguageState(next); };
  useEffect(() => {
    const rtl = language === 'ar';
    document.documentElement.lang = rtl ? 'ar' : 'en';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.body.classList.toggle('rtl-mode', rtl);
  }, [language]);
  return <LanguageContext.Provider value={{ language, interfaceLanguage: language, contentLanguage, setLanguage, setInterfaceLanguage: setLanguage, setContentLanguage }}><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></LanguageContext.Provider>;
}

export default App;