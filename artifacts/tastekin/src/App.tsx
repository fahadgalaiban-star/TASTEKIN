import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useGetTasteCatalog, useGetTastePreferences, useSaveTastePreferences, useGetTasteMatch, useExplore, getExploreQueryKey, getGetTasteMatchQueryKey, getGetTastePreferencesQueryKey } from '@workspace/api-client-react';
import { Drawer } from 'vaul';
import { tasteCategoryLabel } from '@workspace/taste-catalog';
import {
  Archive, ArrowLeft, BarChart3, Bookmark, Check, ChevronRight, CircleUserRound, Eye, FileText, Heart, Inbox, LogOut, MessageCircle,
  Home, ImagePlus, Link2, LockKeyhole, MapPin, Pencil, Plus, PlusCircle, Search, Settings2,
  Send, Share2, ShieldCheck, Upload, UserRound, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import tasteSealImage from '@assets/B19A2529-07AA-4327-B95B-1A45527C3EA2_1787320127362.png';
import './approved.css';

declare const __COMMIT_HASH__: string;

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TastekinApp />
    </QueryClientProvider>
  );
}

type Language = 'en' | 'ar';
type Screen = 'home' | 'explore' | 'add' | 'saved' | 'you' | 'profile' | 'profileEdit' | 'verificationApply' | 'collections' | 'collection' | 'about' | 'match' | 'edit' | 'subscribe' | 'composer' | 'creatorPreview' | 'collectionManager' | 'tune-taste' | 'inbox' | 'conversation' | 'insights' | 'adminVerification' | 'settings';

type Category = 'All' | 'Fashion' | 'Travel' | 'Places' | 'Restaurants' | 'DailyRoutine' | 'PersonalCare' | 'HealthFitness' | 'Decor' | 'Books' | 'Vlogs';
type HomeFeedTab = 'for-you' | 'following' | 'subscribed';
type EditStatus = 'draft' | 'published' | 'archived';
type Access = 'public' | 'locked';
type ImageMetadata = { name: string; size: number; contentType: string };

const displayCategory = (category: string, language: Language = 'en') => tasteCategoryLabel(category, language);
type CropAspect = 'square' | 'portrait' | 'story';
type CropMetadata = { aspect: CropAspect; zoom: number; x: number; y: number; rotation: number; sourceWidth: number; sourceHeight: number; outputWidth: number; outputHeight: number };
type PendingCrop = { source: File; crop: File; preview: File; cropMetadata: CropMetadata; cropUrl: string; previewUrl: string };
type OutfitItem = { type: string; brand: string; name: string; link: string };
type CreatorProfile = {
  displayName: string; username: string; bio: string; city: string; country: string; interests: string[];
  avatar: string; avatarObjectPath: string | null; age: number | null; dateOfBirth: string | null; showAge: boolean; verified: boolean; revision: number;
};
type PendingProfilePhoto = { file: File; url: string };

type CreatorEdit = {
  id: string; category: Exclude<Category, 'All'>; title: string; titleAr: string; caption: string; captionAr: string;
  image?: string; sourceImage?: string; previewImage?: string; imageMetadata?: ImageMetadata; crop?: CropMetadata; location: string; locationAr: string; altText: string; access: Access; status: EditStatus; collectionIds: string[]; outfitItems?: OutfitItem[]; showOutfitDetails?: boolean;
  placeName?: string | null; locationLabel?: string | null; mapsUrl?: string | null; tasteRating?: number | null; creatorReview?: string | null;
  creatorUsername?: string; creatorName?: string; creatorVerified?: boolean; creatorAvatar?: string; following?: boolean;
};
type CreatorCollection = { id: string; title: string; titleAr: string; description: string; descriptionAr: string; access: Access; coverEditId: string; editIds: string[] };
type EditForm = Omit<CreatorEdit, 'id' | 'status'>;
type CollectionForm = Omit<CreatorCollection, 'id'>;
type EditEngagement = { editId: string; likeCount: number; commentCount: number; liked: boolean; saved: boolean };
type EditComment = { id: string; editId: string; body: string; authorName: string; createdAt: string; canDelete: boolean };
type ConversationMessage = { id: string; senderUserId: string; body: string; createdAt: string; readAt: string | null };
type ConversationPreview = { id: string; participantName: string; participantAvatar: string | null; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number };
type Conversation = ConversationPreview & { messages: ConversationMessage[] };
type CreatorInsights = { profileViews: number; totalLikes: number; totalSaves: number; totalComments: number; edits: Array<{ editId: string; likes: number; saves: number; comments: number; views: number }> };

const categories: { id: Category; en: string; ar: string }[] = [
  { id: 'All', en: 'All', ar: 'الكل' }, { id: 'Fashion', en: 'Fashion & Outfits', ar: 'أزياء وإطلالات' },
  { id: 'Travel', en: 'Travel', ar: 'سفر' }, { id: 'Places', en: 'Places', ar: 'أماكن' },
  { id: 'Restaurants', en: 'Restaurants', ar: 'مطاعم' }, { id: 'DailyRoutine', en: 'Daily Routine', ar: 'روتين يومي' },
  { id: 'PersonalCare', en: 'Personal Care', ar: 'عناية شخصية' }, { id: 'HealthFitness', en: 'Health & Fitness', ar: 'صحة ولياقة' },
  { id: 'Decor', en: 'Decor', ar: 'ديكور' }, { id: 'Books', en: 'Books', ar: 'كتب' }, { id: 'Vlogs', en: 'Vlogs', ar: 'فلوقات' },
];
const media = (name: string) => `/tastekin-media/${name}`;
const TASTE_SEAL_IMAGE = tasteSealImage;
const defaultCreatorProfile: CreatorProfile = {
  displayName: 'Fheed Alaiban', username: 'fheed', bio: 'A considered edit of fashion, places, travel, and the rituals that make everyday life feel better.',
  city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel', 'Places'], avatar: media('fheed-profile.webp'),
  avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
};
const discoveryCreatorProfiles: Record<string, CreatorProfile> = {
  'noura.studio': {
    displayName: 'Noura Studio', username: 'noura.studio',
    bio: 'Small tables, beautiful ingredients, and places worth the detour.',
    city: 'Jeddah', country: 'Saudi Arabia', interests: ['Restaurants', 'Places', 'Travel', 'Decor'],
    avatar: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=85',
    avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
  },
};
const seedEdits: CreatorEdit[] = [
  { id: 'quiet-tailoring', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'أناقة هادئة', caption: 'A soft-structured look for a long city day.', captionAr: 'إطلالة مريحة ومنسّقة ليوم طويل في المدينة.', image: media('quiet-tailoring.webp'), location: 'Mayfair, London', locationAr: 'مايفير، لندن', altText: 'Fheed seated outside a London café in a linen polo.', access: 'public', status: 'published', collectionIds: ['quiet-luxury'] },
  { id: 'black-uniform', category: 'Fashion', title: 'The all-black uniform', titleAr: 'الإطلالة السوداء الكاملة', caption: 'Three pieces I return to when I want less noise.', captionAr: 'ثلاث قطع أعود إليها حين أريد إطلالة أكثر هدوءاً.', image: media('black-uniform.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A black evening outfit on Fheed.', access: 'public', status: 'published', collectionIds: ['quiet-luxury'] },
  { id: 'private-hotel', category: 'Travel', title: 'Private hotel weekend', titleAr: 'عطلة فندقية خاصة', caption: 'The stay, the packing list, and where I ate.', captionAr: 'الإقامة، قائمة الحقائب، والأماكن التي تناولت فيها الطعام.', image: media('private-hotel-preview.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A blurred private hotel preview.', access: 'locked', status: 'published', collectionIds: ['coastal-edit'] },
  { id: 'coastal-notes', category: 'Travel', title: 'Coastal notes', titleAr: 'ملاحظات من الساحل', caption: 'A slow itinerary for wind, coffee, and open horizons.', captionAr: 'برنامج هادئ للهواء والقهوة والأفق.', image: media('coastal-notes.webp'), location: 'The Aegean Coast', locationAr: 'ساحل إيجه', altText: 'A calm coastal landscape.', access: 'public', status: 'published', collectionIds: ['coastal-edit'] },
  { id: 'places-returning', category: 'Places', title: 'Places worth returning to', titleAr: 'أماكن تستحق العودة إليها', caption: 'A Kuwaiti table and a London room I keep thinking about.', captionAr: 'مائدة كويتية ومكان في لندن لا يفارق ذاكرتي.', image: media('places-returning.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A table set in a considered restaurant.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'what-i-ordered', category: 'Restaurants', title: 'What I ordered', titleAr: 'ما طلبته', caption: 'A simple lunch worth repeating.', captionAr: 'غداء بسيط يستحق التكرار.', image: media('what-i-ordered.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A plated lunch at a restaurant.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'training-week', category: 'HealthFitness', title: 'Training week', titleAr: 'أسبوع التدريب', caption: 'The strength and recovery routine I actually keep.', captionAr: 'روتين القوة والاستشفاء الذي ألتزم به فعلاً.', image: media('training-week-preview.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A blurred training session preview.', access: 'locked', status: 'published', collectionIds: [] },
  { id: 'sunday-reset', category: 'DailyRoutine', title: 'Sunday reset', titleAr: 'استعادة نشاط الأحد', caption: 'A realistic reset for movement, food, and planning.', captionAr: 'ترتيب واقعي للحركة والطعام والتخطيط.', image: media('sunday-reset.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A quiet Sunday scene.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'morning-ritual', category: 'PersonalCare', title: 'A simple morning ritual', titleAr: 'روتين صباحي بسيط', caption: 'The personal-care steps that help me start well.', captionAr: 'خطوات العناية الشخصية التي تساعدني على بداية أفضل.', image: media('hotel-breakfast-source.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A quiet hotel breakfast table.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'home-light', category: 'Decor', title: 'Light at home', titleAr: 'إضاءة المنزل', caption: 'Small changes for a calmer room.', captionAr: 'تغييرات صغيرة لغرفة أكثر هدوءاً.', image: media('quiet-tailoring.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A calm corner with soft natural light.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'weekend-reading', category: 'Books', title: 'Weekend reading', titleAr: 'قراءة نهاية الأسبوع', caption: 'Three books for a slower afternoon.', captionAr: 'ثلاثة كتب لظهيرة أكثر هدوءاً.', image: media('coastal-notes.webp'), location: 'London, United Kingdom', locationAr: 'لندن، المملكة المتحدة', altText: 'A calm room prepared for reading.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'city-vlog', category: 'Vlogs', title: 'A day around the city', titleAr: 'يوم في المدينة', caption: 'A quiet visual diary of places, food, and movement.', captionAr: 'يوميات مصورة هادئة عن الأماكن والطعام والحركة.', image: media('places-returning.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A city street in Kuwait.', access: 'public', status: 'published', collectionIds: [] },
  { id: 'morning-library', category: 'Books', title: 'A morning at the library', titleAr: 'صباح في المكتبة', caption: 'A reading list and a room to return to.', captionAr: 'قائمة قراءة ومكان أعود إليه دائماً.', image: media('coastal-notes.webp'), location: 'London, United Kingdom', locationAr: 'لندن، المملكة المتحدة', altText: 'A peaceful interior for reading.', access: 'public', status: 'draft', collectionIds: [] },
  { id: 'archive-routine', category: 'PersonalCare', title: 'The old morning ritual', titleAr: 'الروتين الصباحي السابق', caption: 'An earlier routine kept for reference.', captionAr: 'روتين سابق محفوظ للرجوع إليه.', image: media('hotel-breakfast-source.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'A quiet breakfast table.', access: 'public', status: 'archived', collectionIds: [] },
];
const seedCollections: CreatorCollection[] = [
  { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: 'Tailoring, materials, and a quieter way to dress.', descriptionAr: 'تفصيل وخامات وطريقة أكثر هدوءاً في ارتداء الملابس.', access: 'public', coverEditId: 'quiet-tailoring', editIds: ['quiet-tailoring', 'black-uniform'] },
  { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: 'Places, packing and private travel notes.', descriptionAr: 'أماكن وحقائب وملاحظات سفر خاصة.', access: 'locked', coverEditId: 'private-hotel', editIds: ['private-hotel', 'coastal-notes'] },
];

const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(`tastekin:${key}`) || '') as T; } catch { return fallback; } };
const write = (key: string, value: unknown) => localStorage.setItem(`tastekin:${key}`, JSON.stringify(value));
async function describeFailedResponse(response: Response) {
  let detail = '';
  try {
    const payload = await response.json();
    detail = (payload && (payload.error || payload.message)) || JSON.stringify(payload);
  } catch {
    try { detail = await response.text(); } catch { /* no readable body */ }
  }
  return `HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`;
}
const imageSrc = (image?: string) => image?.startsWith('/objects/') ? `/api/storage${image}` : image || '';
const cropAspectRatio = (_aspect?: CropAspect, crop?: CropMetadata) => crop?.outputWidth && crop?.outputHeight ? `${crop.outputWidth} / ${crop.outputHeight}` : _aspect === 'square' ? '1 / 1' : _aspect === 'story' ? '9 / 16' : '4 / 5';
const placeCategories = new Set<CreatorEdit['category']>(['Restaurants', 'Places', 'Travel']);
const isPlaceCategory = (category: CreatorEdit['category']) => placeCategories.has(category);
const placeLocation = (edit: CreatorEdit, ar: boolean) => edit.locationLabel || (ar ? edit.locationAr || edit.location : edit.location || edit.locationAr);
const isSafeMapsUrl = (value?: string | null) => {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'maps.apple.com' || (host === 'apple.com' && url.pathname.startsWith('/maps')) ||
      host === 'maps.google.com' || host === 'maps.app.goo.gl' ||
      ((host === 'www.google.com' || host === 'google.com') && url.pathname.startsWith('/maps'))
    );
  } catch { return false; }
};
const blankEdit = (): EditForm => ({ category: 'Fashion', title: '', titleAr: '', caption: '', captionAr: '', location: '', locationAr: '', altText: '', access: 'public', collectionIds: [], placeName: null, locationLabel: null, mapsUrl: null, tasteRating: null, creatorReview: null });
const publishValidationMessage = (edit: EditForm | CreatorEdit, ar: boolean) => {
  if (edit.mapsUrl?.trim() && !isSafeMapsUrl(edit.mapsUrl)) return ar ? 'استخدم رابطًا صالحًا من خرائط Google أو Apple.' : 'Use a valid Google Maps or Apple Maps link.';
  if (!edit.image && edit.access === 'locked') return ar ? 'توصيات الأماكن بلا صورة يجب أن تكون عامة لأن التعديلات الخاصة تحتاج معاينة محمية.' : 'No-photo place recommendations must be public because subscriber-only edits need protected preview media.';
  if (edit.image) return '';
  if (!isPlaceCategory(edit.category)) return ar ? 'أضف صورة، أو اختر المطاعم أو الأماكن أو السفر لتوصية بلا صورة.' : 'Add a photo, or choose Restaurants, Places, or Travel for a no-photo recommendation.';
  if (!edit.placeName?.trim()) return ar ? 'أضف اسم المكان لنشر توصية بلا صورة.' : 'Add the place name to publish a no-photo recommendation.';
  if (!edit.locationLabel?.trim()) return ar ? 'أضف موقعًا مقروءًا لنشر توصية بلا صورة.' : 'Add a readable location to publish a no-photo recommendation.';
  if (!edit.tasteRating && !edit.creatorReview?.trim()) return ar ? 'أضف تقييم الذوق أو مراجعتك الشخصية للنشر.' : 'Add a Taste Rating or your personal review to publish.';
  return '';
};
const blankCollection = (): CollectionForm => ({ title: '', titleAr: '', description: '', descriptionAr: '', access: 'public', coverEditId: 'quiet-tailoring', editIds: [] });

function Price({ ar, withVerb = true }: { ar: boolean; withVerb?: boolean }) { return ar ? <>{withVerb && 'اشترك · '}<bdi dir="ltr">19.99</bdi> دولار شهريًا</> : <>{withVerb && 'Subscribe · '}$19.99 / month</>; }

type TasteSessionSnapshot = {
  status: 'loading' | 'authenticated' | 'signed-out';
  user: { id: string; email: string | null } | null;
  role: 'creator' | 'consumer';
  creator: { id?: string; handle: string; displayName: string; verified: boolean; ownsWorkspace: boolean } | null;
  isAdmin: boolean;
  revision: number;
};
type TasteSession = TasteSessionSnapshot & { refresh: () => Promise<void> };

const TasteSessionContext = createContext<TasteSession | null>(null);

function useTasteSessionController(): TasteSession {
  const [snapshot, setSnapshot] = useState<TasteSessionSnapshot>({
    status: 'loading', user: null, role: 'consumer', creator: null, isAdmin: false, revision: 0,
  });
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/me', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const payload = response.ok
        ? await response.json() as Omit<TasteSessionSnapshot, 'status' | 'revision'>
        : { user: null, role: 'consumer' as const, creator: null, isAdmin: false };
      setSnapshot((current) => {
        const next = {
          status: payload.user ? 'authenticated' as const : 'signed-out' as const,
          user: payload.user,
          role: payload.role === 'creator' ? 'creator' as const : 'consumer' as const,
          creator: payload.creator ?? null,
          isAdmin: Boolean(payload.isAdmin),
        };
        const unchanged = current.status === next.status
          && current.user?.id === next.user?.id
          && current.user?.email === next.user?.email
          && current.role === next.role
          && current.creator?.ownsWorkspace === next.creator?.ownsWorkspace
          && current.creator?.handle === next.creator?.handle
          && current.isAdmin === next.isAdmin;
        return unchanged ? current : { ...next, revision: current.revision + 1 };
      });
    } catch {
      // A transient Safari/network failure must never downgrade a known valid session to guest state.
      setSnapshot((current) => current.status === 'authenticated'
        ? current
        : current.status === 'signed-out'
          ? current
          : { ...current, status: 'signed-out', revision: current.revision + 1 });
    }
  }, []);
  useEffect(() => {
    const revalidate = () => { void refresh(); };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('pageshow', revalidate);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', revalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);
  return { ...snapshot, refresh };
}

function useTasteSession() {
  const session = useContext(TasteSessionContext);
  if (!session) throw new Error('Taste session is unavailable outside the TASTEKIN app.');
  return session;
}

function TastekinApp() {
  const session = useTasteSessionController();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : read('interface-language', 'en'));
  const [screen, setScreen] = useState<Screen>('home');
  const [exploreCategory, setExploreCategory] = useState<Category>('All');
  const [homeFeedTab, setHomeFeedTab] = useState<HomeFeedTab>('for-you');
  const [saved, setSaved] = useState<string[]>([]);
  const savedHydrationVersion = useRef(0);
  const [following, setFollowing] = useState(false);
  // Real subscription state is introduced with Stripe entitlements in Phase 3.
  const [subscribed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visitorPreview, setVisitorPreview] = useState(false);
  const [profileVisitorMode, setProfileVisitorMode] = useState(false);
  const [creatorEdits, setCreatorEdits] = useState<CreatorEdit[]>(seedEdits);
  const [creatorCollections, setCreatorCollections] = useState<CreatorCollection[]>(seedCollections);
  const [publicFeedEdits, setPublicFeedEdits] = useState<CreatorEdit[]>([]);
  const [featuredCollectionIds, setFeaturedCollectionIds] = useState<string[]>([]);
  const [workspaceRevision, setWorkspaceRevision] = useState(1);
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'ready' | 'syncing' | 'error'>('loading');
  const [workspaceError, setWorkspaceError] = useState('');
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile>(defaultCreatorProfile);
  const [publicCreatorProfile, setPublicCreatorProfile] = useState<CreatorProfile | null>(null);
  const [publicCreatorEdits, setPublicCreatorEdits] = useState<CreatorEdit[]>([]);
  const [publicCreatorCollections, setPublicCreatorCollections] = useState<CreatorCollection[]>([]);
  const [publicFeaturedCollectionIds, setPublicFeaturedCollectionIds] = useState<string[]>([]);
  const [profileForm, setProfileForm] = useState<CreatorProfile>(defaultCreatorProfile);
  const [pendingProfilePhoto, setPendingProfilePhoto] = useState<PendingProfilePhoto | null>(null);
  const [profileSaveState, setProfileSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [profileError, setProfileError] = useState('');
  const [selectedEditId, setSelectedEditId] = useState('quiet-tailoring');
  const [selectedCollectionId, setSelectedCollectionId] = useState('quiet-luxury');
  const [selectedCreatorUsername, setSelectedCreatorUsername] = useState('fheed');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(blankEdit);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  const [pendingMediaPaths, setPendingMediaPaths] = useState<string[]>([]);
  const pendingMediaIsDiscardable = useRef(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [collectionForm, setCollectionForm] = useState<CollectionForm>(blankCollection);
  useEffect(() => {
    const cleanOnExit = () => {
      if (!pendingMediaIsDiscardable.current || !pendingMediaPaths.length) return;
      const body = JSON.stringify({ objectPaths: pendingMediaPaths });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/storage/uploads/cleanup', new Blob([body], { type: 'application/json' }));
      } else {
        void fetch('/api/storage/uploads/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      }
    };
    window.addEventListener('pagehide', cleanOnExit);
    return () => window.removeEventListener('pagehide', cleanOnExit);
  }, [pendingMediaPaths]);
  const loadWorkspace = async () => {
    setWorkspaceState('loading'); setWorkspaceError('');
    try {
      const response = await fetch('/api/creator-workspace', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error('Could not load the shared creator workspace.');
      const workspace = await response.json() as { edits: CreatorEdit[]; collections: CreatorCollection[]; revision: number };
      setCreatorEdits(workspace.edits); setCreatorCollections(workspace.collections); setWorkspaceRevision(workspace.revision); setWorkspaceState('ready');
    } catch {
      setWorkspaceState('error'); setWorkspaceError('Your shared creator workspace could not be loaded. Check your connection and try again.');
    }
  };
  useEffect(() => { void loadWorkspace(); }, [session.revision]);
  const loadProfile = async () => {
    try {
      const response = await fetch('/api/creator-profile', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) return;
      const profile = await response.json() as CreatorProfile;
      setCreatorProfile(profile);
    } catch {
      // Discovery remains usable while a profile refresh is temporarily unavailable.
    }
  };
  useEffect(() => { void loadProfile(); }, [session.revision]);
  useEffect(() => {
    if (session.status !== 'authenticated') { setFeaturedCollectionIds([]); return; }
    void fetch('/api/creator-featured-collections', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ collectionIds: string[] }> : { collectionIds: [] })
      .then((payload) => setFeaturedCollectionIds(payload.collectionIds || [])).catch(() => undefined);
  }, [session.revision, session.status]);
  const loadPublicFeed = useCallback(async () => {
    try {
      const response = await fetch('/api/public-feed', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as { items?: Array<{ creatorUsername: string; creatorName: string; creatorVerified: boolean; creatorAvatar: string; following: boolean; edit: CreatorEdit }> };
      setPublicFeedEdits((payload.items || []).map((item) => ({ ...item.edit, creatorUsername: item.creatorUsername, creatorName: item.creatorName, creatorVerified: item.creatorVerified, creatorAvatar: item.creatorAvatar, following: item.following })));
    } catch { /* Keep the current feed while the network reconnects. */ }
  }, []);
  useEffect(() => { void loadPublicFeed(); }, [loadPublicFeed, session.revision, workspaceRevision]);
  useEffect(() => {
    if (session.creator?.handle) setSelectedCreatorUsername(session.creator.handle);
  }, [session.creator?.handle]);
  useEffect(() => {
    const ownHandle = session.creator?.handle;
    if (selectedCreatorUsername === ownHandle) {
      setPublicCreatorProfile(null); setPublicCreatorEdits([]); setPublicCreatorCollections([]); setPublicFeaturedCollectionIds([]);
      return;
    }
    let active = true;
    void Promise.all([
      fetch(`/api/creators/${encodeURIComponent(selectedCreatorUsername)}/profile`, { credentials: 'include', cache: 'no-store' }),
      fetch(`/api/creators/${encodeURIComponent(selectedCreatorUsername)}/workspace`, { credentials: 'include', cache: 'no-store' }),
      fetch(`/api/creators/${encodeURIComponent(selectedCreatorUsername)}/featured-collections`, { credentials: 'include', cache: 'no-store' }),
    ]).then(async ([profileResponse, workspaceResponse, featuredResponse]) => {
      if (!active) return;
      if (profileResponse.ok) setPublicCreatorProfile(await profileResponse.json() as CreatorProfile);
      else setPublicCreatorProfile(discoveryCreatorProfiles[selectedCreatorUsername] ?? null);
      if (workspaceResponse.ok) {
        const workspace = await workspaceResponse.json() as { edits: CreatorEdit[]; collections: CreatorCollection[] };
        setPublicCreatorEdits(workspace.edits); setPublicCreatorCollections(workspace.collections);
      } else { setPublicCreatorEdits([]); setPublicCreatorCollections([]); }
      if (featuredResponse.ok) {
        const featured = await featuredResponse.json() as { collectionIds?: string[] };
        setPublicFeaturedCollectionIds(featured.collectionIds || []);
      } else setPublicFeaturedCollectionIds([]);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selectedCreatorUsername, session.creator?.handle]);
  useEffect(() => {
    if (session.status !== 'authenticated' || selectedCreatorUsername === session.creator?.handle) { setFollowing(false); return; }
    void fetch(`/api/relationships/follow/${encodeURIComponent(selectedCreatorUsername)}`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ active: boolean }> : { active: false })
      .then((relationship) => setFollowing(Boolean(relationship.active))).catch(() => setFollowing(false));
  }, [selectedCreatorUsername, session.creator?.handle, session.status]);
  useEffect(() => {
    const hydrationVersion = ++savedHydrationVersion.current;
    if (session.status !== 'authenticated') {
      setSaved([]);
      return;
    }
    void fetch('/api/me/saved-edits', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<string[]> : [])
      .then((ids) => {
        if (savedHydrationVersion.current === hydrationVersion) setSaved(Array.isArray(ids) ? ids : []);
      })
      .catch(() => undefined);
  }, [session.status, session.revision]);
  const persistWorkspace = async (edits: CreatorEdit[], collections: CreatorCollection[], cleanupPaths = pendingMediaPaths) => {
    setCreatorEdits(edits); setCreatorCollections(collections); setWorkspaceState('syncing'); setWorkspaceError('');
    pendingMediaIsDiscardable.current = false;
    try {
      const response = await fetch('/api/creator-workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits, collections, expectedRevision: workspaceRevision }) });
      if (response.status === 401) throw new Error('auth');
      if (response.status === 409) throw new Error('conflict');
      if (!response.ok) throw new Error('Could not save the shared creator workspace.');
      const workspace = await response.json() as { edits: CreatorEdit[]; collections: CreatorCollection[]; revision: number };
      setCreatorEdits(workspace.edits); setCreatorCollections(workspace.collections); setWorkspaceRevision(workspace.revision); setPendingMediaPaths([]); setWorkspaceState('ready');
      return true;
    } catch (error) {
      if (cleanupPaths.length) { void cleanupCreatorMedia(cleanupPaths); setPendingMediaPaths([]); }
      setWorkspaceState('error'); setWorkspaceError(error instanceof Error && error.message === 'auth' ? 'Sign in to save changes to your creator workspace.' : error instanceof Error && error.message === 'conflict' ? 'This workspace changed on another device. Reload your workspace before saving again.' : 'Your latest creator change has not been saved. Try again before leaving this screen.');
      return false;
    }
  };
  const cleanupCreatorMedia = async (objectPaths: string[]) => {
    if (!objectPaths.length) return;
    try { await fetch('/api/storage/uploads/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objectPaths }) }); } catch { /* Server logs best-effort cleanup failures. */ }
  };
  const uploadCreatorImage = async (file: File) => {
    if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) throw new Error('Choose a JPG, PNG, HEIC, HEIF, or WebP image up to 15 MB.');
    const request = await fetch('/api/storage/uploads/request-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
    if (request.status === 401) throw new Error('Sign in to securely save this crop to your creator workspace.');
    if (request.status === 403) throw new Error('This account cannot save media in that workspace.');
    if (!request.ok) throw new Error('Could not prepare your image upload.');
    const upload = await request.json() as { uploadURL: string; objectPath: string; metadata: ImageMetadata };
    const transferred = await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!transferred.ok) throw new Error('Could not upload your image.');
    return { image: upload.objectPath, objectPath: upload.objectPath, metadata: upload.metadata };
  };
  const discardPendingCrop = () => {
    if (!pendingCrop) return;
    URL.revokeObjectURL(pendingCrop.cropUrl); URL.revokeObjectURL(pendingCrop.previewUrl);
    setPendingCrop(null);
  };
  const discardPendingProfilePhoto = () => {
    if (!pendingProfilePhoto) return;
    URL.revokeObjectURL(pendingProfilePhoto.url);
    setPendingProfilePhoto(null);
  };
  const ar = language === 'ar';
  const owner = session.status === 'authenticated' && session.creator?.ownsWorkspace === true;
  const viewingOwnProfile = owner && selectedCreatorUsername === session.creator?.handle;
  const publicProfileViewer = !viewingOwnProfile || profileVisitorMode;
  const t = (en: string, arabic: string) => ar ? arabic : en;
  useEffect(() => {
    localStorage.removeItem('tastekin:demo-role');
    queryClient.removeQueries({ queryKey: ['/api/explore'] });
    queryClient.removeQueries({ queryKey: getGetTastePreferencesQueryKey() });
    queryClient.removeQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/taste-match/'),
    });
  }, [queryClient, session.revision]);
  useEffect(() => { void session.refresh(); }, [screen, session.refresh]);
  useEffect(() => {
    document.documentElement.dir = ar ? 'rtl' : 'ltr';
    document.documentElement.lang = ar ? 'ar' : 'en';
  }, [ar]);
  const published = creatorEdits.filter((item) => item.status === 'published');
  const viewedCreatorProfile = viewingOwnProfile ? creatorProfile : publicCreatorProfile ?? discoveryCreatorProfiles[selectedCreatorUsername] ?? creatorProfile;
  const viewedCreatorEdits = viewingOwnProfile ? published : publicCreatorEdits;
  const featuredCollections = useMemo(() => {
    const configured = featuredCollectionIds
      .map((id) => creatorCollections.find((collection) => collection.id === id))
      .filter((collection): collection is CreatorCollection => Boolean(collection));
    return (configured.length ? configured : creatorCollections).slice(0, 3);
  }, [creatorCollections, featuredCollectionIds]);
  const publicFeaturedCollections = useMemo(
    () => {
      const configured = publicFeaturedCollectionIds.map((id) => publicCreatorCollections.find((collection) => collection.id === id)).filter((collection): collection is CreatorCollection => Boolean(collection));
      return (configured.length ? configured : publicCreatorCollections).slice(0, 3);
    },
    [publicCreatorCollections, publicFeaturedCollectionIds],
  );
  const exploreEdits = useMemo(() => {
    const source = publicFeedEdits.length ? publicFeedEdits : published;
    return exploreCategory === 'All' ? source : source.filter((item) => item.category === exploreCategory);
  }, [exploreCategory, publicFeedEdits, published]);
  const homeFeed = useMemo(() => {
    if (homeFeedTab === 'following') return publicFeedEdits.filter((item) => item.following);
    if (homeFeedTab === 'subscribed') return [];
    return publicFeedEdits.length ? publicFeedEdits : published;
  }, [homeFeedTab, publicFeedEdits, published]);
  const selectedEdit = [...creatorEdits, ...publicCreatorEdits, ...publicFeedEdits].find((item) => item.id === selectedEditId) || published[0] || seedEdits[0];
  const selectedCollection = [...creatorCollections, ...publicCreatorCollections].find((item) => item.id === selectedCollectionId) || creatorCollections[0] || seedCollections[0];
  const go = (next: Screen) => {
    if (workspaceState === 'syncing') return;
    const leavingCreatorFlow = (screen === 'composer' || screen === 'creatorPreview') && next !== 'composer' && next !== 'creatorPreview';
    if (leavingCreatorFlow && pendingMediaPaths.length) { pendingMediaIsDiscardable.current = false; void cleanupCreatorMedia(pendingMediaPaths); setPendingMediaPaths([]); }
    if (leavingCreatorFlow) discardPendingCrop();
    if (next !== 'profile' && next !== 'profileEdit') setVisitorPreview(false);
    setScreen(next); setMenuOpen(false);
  };
  const pendingSharedPost = useRef<{ username: string; editId: string } | null>(null);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/posts\/([^/]+)\/([^/]+)\/?$/);
    if (!match) return;
    const username = decodeURIComponent(match[1]);
    const editId = decodeURIComponent(match[2]);
    pendingSharedPost.current = { username, editId };
    setSelectedCreatorUsername(username);
  }, []);
  useEffect(() => {
    const pending = pendingSharedPost.current;
    if (!pending || pending.username !== selectedCreatorUsername) return;
    const pool = pending.username === session.creator?.handle ? creatorEdits : publicCreatorEdits;
    if (!pool.some((item) => item.id === pending.editId)) return;
    pendingSharedPost.current = null;
    setSelectedEditId(pending.editId);
    go('edit');
  }, [selectedCreatorUsername, creatorEdits, publicCreatorEdits, session.creator?.handle]);
  const toggleSaved = async (id: string) => {
    if (session.status !== 'authenticated') { window.location.assign('/api/login?returnTo=/'); return; }
    const wasSaved = saved.includes(id);
    const next = wasSaved ? saved.filter((item) => item !== id) : [...saved, id];
    savedHydrationVersion.current += 1;
    setSaved(next);
    try {
      const response = await fetch(`/api/edits/${encodeURIComponent(id)}/save`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !wasSaved }),
      });
      if (!response.ok) throw new Error(await describeFailedResponse(response));
    } catch (err) {
      setSaved(saved);
      const detail = err instanceof Error ? err.message : String(err);
      window.alert(`${ar ? 'تعذر تحديث الحفظ' : 'Could not update saved'}: ${detail}`);
    }
  };
  const saveFeaturedCollections = (next: string[]) => {
    const normalized = Array.from(new Set(next)).filter((id) => creatorCollections.some((collection) => collection.id === id)).slice(0, 3);
    const previous = featuredCollectionIds;
    setFeaturedCollectionIds(normalized);
    void fetch('/api/creator-featured-collections', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collectionIds: normalized }) })
      .then((response) => { if (!response.ok) setFeaturedCollectionIds(previous); }).catch(() => setFeaturedCollectionIds(previous));
  };
  const toggleFeaturedCollection = (id: string) => {
    saveFeaturedCollections(featuredCollectionIds.includes(id) ? featuredCollectionIds.filter((collectionId) => collectionId !== id) : [...featuredCollectionIds, id]);
  };
  const moveFeaturedCollection = (id: string, direction: 'up' | 'down') => {
    const index = featuredCollectionIds.indexOf(id);
    const destination = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || destination < 0 || destination >= featuredCollectionIds.length) return;
    const next = [...featuredCollectionIds];
    [next[index], next[destination]] = [next[destination], next[index]];
    saveFeaturedCollections(next);
  };
  const openEdit = (item: CreatorEdit) => { if (item.creatorUsername) setSelectedCreatorUsername(item.creatorUsername); setSelectedEditId(item.id); go('edit'); };
  const startMessage = async () => {
    if (session.status !== 'authenticated') { window.location.assign('/api/login?returnTo=/'); return; }
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creatorUsername: selectedCreatorUsername }),
      });
      if (!response.ok) throw new Error();
      const conversation = await response.json() as Conversation;
      setActiveConversationId(conversation.id); go('conversation');
    } catch {
      go('inbox');
    }
  };
  const openProfileEditor = () => {
    discardPendingProfilePhoto();
    setProfileForm({ ...creatorProfile, interests: [...creatorProfile.interests] });
    setProfileError(''); setProfileSaveState('idle'); go('profileEdit');
  };
  const saveProfile = async () => {
    setProfileSaveState('saving'); setProfileError('');
    const oldAvatar = creatorProfile.avatarObjectPath;
    let uploadedPath: string | null = null;
    try {
      let avatarObjectPath = profileForm.avatarObjectPath;
      if (pendingProfilePhoto) {
        const uploaded = await uploadCreatorImage(pendingProfilePhoto.file);
        uploadedPath = uploaded.objectPath; avatarObjectPath = uploaded.objectPath;
        setPendingMediaPaths([uploadedPath]); pendingMediaIsDiscardable.current = true;
      }
      const response = await fetch('/api/creator-profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profileForm.displayName, username: profileForm.username, bio: profileForm.bio, city: profileForm.city,
          country: profileForm.country, interests: profileForm.interests, dateOfBirth: profileForm.dateOfBirth,
          showAge: profileForm.showAge, avatarObjectPath,
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || 'Could not save your profile.');
      }
      const saved = await response.json() as CreatorProfile;
      const current = saved.avatar.startsWith('/api/public-profile-media') ? { ...saved, avatar: `${saved.avatar}?v=${Date.now()}` } : saved;
      pendingMediaIsDiscardable.current = false; setPendingMediaPaths([]);
      setCreatorProfile(current); setProfileForm(current); setWorkspaceRevision(saved.revision); discardPendingProfilePhoto();
      setSelectedCreatorUsername(saved.username);
      await session.refresh();
      if (oldAvatar && oldAvatar !== saved.avatarObjectPath) void cleanupCreatorMedia([oldAvatar]);
      setProfileSaveState('saved');
    } catch (error) {
      if (uploadedPath) { void cleanupCreatorMedia([uploadedPath]); setPendingMediaPaths([]); }
      pendingMediaIsDiscardable.current = false;
      setProfileSaveState('error'); setProfileError(error instanceof Error ? error.message : 'Could not save your profile.');
    }
  };
  const openComposer = (item?: CreatorEdit) => { discardPendingCrop(); setEditingId(item?.id || null); setEditForm(item ? { category: item.category, title: item.title, titleAr: item.titleAr, caption: item.caption, captionAr: item.captionAr, image: item.image, sourceImage: item.sourceImage, previewImage: item.previewImage, imageMetadata: item.imageMetadata, crop: item.crop, location: item.location, locationAr: item.locationAr, altText: item.altText, access: item.access, collectionIds: item.collectionIds, outfitItems: item.outfitItems || [], showOutfitDetails: item.showOutfitDetails || false, placeName: item.placeName || null, locationLabel: item.locationLabel || null, mapsUrl: item.mapsUrl || null, tasteRating: item.tasteRating || null, creatorReview: item.creatorReview || null } : blankEdit()); go('composer'); };
  const commitEdit = async (status: EditStatus) => {
    let formToSave = editForm;
    const uploadedPaths: string[] = [];
    const existingEdit = editingId ? creatorEdits.find((item) => item.id === editingId) : undefined;
    const replacedMediaPaths = existingEdit
      ? [existingEdit.sourceImage, existingEdit.image, existingEdit.previewImage].filter((path): path is string => Boolean(path && /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(path)))
      : [];
    try {
      if (pendingCrop) {
        const uploadRendition = async (file: File) => { const uploaded = await uploadCreatorImage(file); uploadedPaths.push(uploaded.objectPath); return uploaded; };
        const source = await uploadRendition(pendingCrop.source);
        const image = await uploadRendition(pendingCrop.crop);
        const preview = await uploadRendition(pendingCrop.preview);
        formToSave = { ...editForm, sourceImage: source.image, image: image.image, previewImage: preview.image, imageMetadata: source.metadata, crop: pendingCrop.cropMetadata };
        setEditForm(formToSave); setPendingMediaPaths(uploadedPaths); pendingMediaIsDiscardable.current = true;
      }
    } catch (error) {
      if (uploadedPaths.length) void cleanupCreatorMedia(uploadedPaths);
      setWorkspaceState('error');
      setWorkspaceError(error instanceof Error ? error.message : 'Your image could not be saved. Try again before leaving this screen.');
      return false;
    }
    const id = editingId || `edit-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const fallbackTitle = formToSave.placeName?.trim() || formToSave.caption.trim().slice(0, 80);
    const next = { id, ...formToSave, title: formToSave.title.trim() || fallbackTitle, titleAr: formToSave.titleAr.trim() || fallbackTitle, captionAr: formToSave.captionAr || formToSave.caption, status } as CreatorEdit;
    const nextEdits = creatorEdits.some((item) => item.id === id) ? creatorEdits.map((item) => item.id === id ? next : item) : [next, ...creatorEdits];
    const nextCollections = creatorCollections.map((collection) => ({
      ...collection,
      editIds: formToSave.collectionIds.includes(collection.id)
        ? Array.from(new Set([...collection.editIds, id]))
        : collection.editIds.filter((editId) => editId !== id),
    }));
    const saved = await persistWorkspace(nextEdits, nextCollections, uploadedPaths);
    if (saved) {
      const previousPaths = replacedMediaPaths.filter((path) => !uploadedPaths.includes(path));
      if (previousPaths.length) void cleanupCreatorMedia(previousPaths);
      discardPendingCrop(); setSelectedEditId(id); setEditingId(id);
    }
    return saved;
  };
  const archiveEdit = (id: string) => persistWorkspace(creatorEdits.map((item) => item.id === id ? { ...item, status: 'archived' } : item), creatorCollections);
  const unarchiveEdit = (id: string) => persistWorkspace(creatorEdits.map((item) => item.id === id ? { ...item, status: 'draft' } : item), creatorCollections);
  const openCollectionManager = (item?: CreatorCollection) => { setEditingCollectionId(item?.id || null); setCollectionForm(item ? { title: item.title, titleAr: item.titleAr, description: item.description, descriptionAr: item.descriptionAr, access: item.access, coverEditId: item.coverEditId, editIds: item.editIds } : blankCollection()); go('collectionManager'); };
  const saveCollection = () => {
    const id = editingCollectionId || `collection-${Date.now()}`;
    const next = { id, ...collectionForm };
    const nextCollections = creatorCollections.some((item) => item.id === id) ? creatorCollections.map((item) => item.id === id ? next : item) : [next, ...creatorCollections];
    const nextEdits = creatorEdits.map((item) => ({ ...item, collectionIds: item.collectionIds.filter((collectionId) => collectionId !== id).concat(next.editIds.includes(item.id) ? [id] : []) }));
    persistWorkspace(nextEdits, nextCollections);
    setEditingCollectionId(id); setSelectedCollectionId(id); return next;
  };
  const abandonComposer = () => go('add');
  const finishSavedCreatorFlow = () => { pendingMediaIsDiscardable.current = false; setPendingMediaPaths([]); setScreen('add'); setMenuOpen(false); };
  const goBack = () => {
    if (screen === 'composer' || screen === 'creatorPreview') { abandonComposer(); return; }
    go(screen === 'edit' || screen === 'profileEdit' || screen === 'verificationApply' || screen === 'insights' ? 'profile' : screen === 'conversation' ? 'inbox' : screen === 'collection' ? 'collections' : screen === 'collectionManager' ? 'add' : screen === 'settings' ? 'you' : 'home');
  };
  const nav = [{ id: 'home' as const, icon: Home, en: 'Home', ar: 'الرئيسية' }, { id: 'explore' as const, icon: Search, en: 'Explore', ar: 'اكتشف' }, { id: 'add' as const, icon: PlusCircle, en: 'Add', ar: 'إضافة' }, { id: 'saved' as const, icon: Bookmark, en: 'Saved', ar: 'المحفوظات' }, { id: 'you' as const, icon: UserRound, en: 'You', ar: 'أنت' }];
  return <TasteSessionContext.Provider value={session}><div className="approved-app" dir={ar ? 'rtl' : 'ltr'}><main className="approved-shell">
    <header className="approved-topbar">{!['home', 'you', 'add'].includes(screen) ? <button className="approved-icon" onClick={goBack} aria-label={t('Back', 'رجوع')}><ArrowLeft size={21} /></button> : <span className="approved-spacer" />}<img src="/tastekin-logo.svg" className="approved-logo" alt="TASTEKIN" /><div className="approved-topbar-actions">{screen === 'profile' && viewingOwnProfile && !profileVisitorMode && <button className="approved-icon" onClick={() => go('inbox')} aria-label={t('Open inbox', 'فتح الرسائل')}><Inbox size={19} /></button>}<button className="approved-icon" onClick={() => setMenuOpen(true)} aria-label={t('Open menu', 'فتح القائمة')}><Settings2 size={19} /></button></div></header>
    {workspaceState === 'loading' && <div className="workspace-sync">{t('Loading your shared creator workspace…', 'جارٍ تحميل مساحة المبدع المشتركة…')}</div>}
    {workspaceState === 'syncing' && <div className="workspace-sync">{t('Saving your creator changes across devices…', 'جارٍ حفظ تغييرات المبدع على جميع الأجهزة…')}</div>}
    {workspaceState === 'error' && <div className="workspace-notice" role="alert">{workspaceError}<button onClick={() => workspaceError.startsWith('Sign in') ? window.location.assign('/api/login?returnTo=/') : void loadWorkspace()}>{workspaceError.startsWith('Sign in') ? t('Sign in', 'تسجيل الدخول') : t('Try again', 'حاول مجددًا')}</button></div>}
    {screen === 'home' && <><section className="approved-hero"><span className="approved-kicker">{t('Taste-led discovery', 'اكتشاف مبني على الذوق')}</span><h1>{t('Follow the taste, not the numbers.', 'اتبع الذوق، لا الأرقام.')}</h1><p>{t('A considered feed of people, places, and daily routines shaped by what you actually like.', 'تغذية منتقاة من الأشخاص وأماكنهم وروتينهم اليومي، تتشكل بحسب ما تحبه فعلاً.')}</p></section><HomeFeedTabs ar={ar} active={homeFeedTab} onSelect={setHomeFeedTab} /><div className="approved-feed">{homeFeed.map((item) => <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}{homeFeedTab !== 'for-you' && !homeFeed.length && <FeedEmpty ar={ar} tab={homeFeedTab} onExplore={() => go('explore')} />}</div><div style={{ margin: '18px 0 4px', textAlign: 'center', color: 'var(--tk-stone)', fontSize: 9, opacity: 0.5 }}>build: {__COMMIT_HASH__}</div></>}
    {screen === 'explore' && <ExploreScreen ar={ar} category={exploreCategory} setCategory={setExploreCategory} saved={saved} toggleSaved={toggleSaved} edits={exploreEdits.slice(0, 4)} onOpenProfile={(username) => { setSelectedCreatorUsername(username); go('profile'); }} onOpenEdit={openEdit} />}
    {screen === 'tune-taste' && <TuneTasteScreen ar={ar} onBack={() => go('you')} />}
    {screen === 'add' && (owner ? <CreatorDashboard ar={ar} displayName={creatorProfile.displayName} edits={creatorEdits} collections={creatorCollections} busy={workspaceState !== 'ready'} onNew={() => openComposer()} onEdit={openComposer} onArchive={archiveEdit} onUnarchive={unarchiveEdit} onCollections={() => openCollectionManager()} /> : <SimpleScreen kicker={t('Creator tools', 'أدوات المبدع')} title={t('Creator workspace', 'مساحة المبدع')}><p>{t('Sign in to create your profile and publish.', 'سجّل الدخول لإنشاء ملفك والنشر.')}</p></SimpleScreen>)}
    {screen === 'composer' && <EditComposer ar={ar} form={editForm} collections={creatorCollections} busy={workspaceState === 'syncing'} onChange={setEditForm} onCropPrepared={(crop) => { discardPendingCrop(); setPendingCrop(crop); }} onBack={abandonComposer} onDraft={() => commitEdit('draft')} onDraftComplete={finishSavedCreatorFlow} onPreview={() => { const preview = { id: editingId || 'preview', ...editForm, status: 'draft' } as CreatorEdit; setSelectedEditId(preview.id); go('creatorPreview'); }} onPublish={() => { void commitEdit('published').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} />}
    {screen === 'creatorPreview' && <CreatorPreview ar={ar} busy={workspaceState === 'syncing'} edit={{ id: editingId || 'preview', ...editForm, status: 'draft' } as CreatorEdit} onBack={() => go('composer')} onPublish={() => { void commitEdit('published').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} />}
    {screen === 'collectionManager' && <CollectionManager ar={ar} collections={creatorCollections} published={published} form={collectionForm} editing={editingCollectionId} featuredCollectionIds={featuredCollectionIds} onChange={setCollectionForm} onEdit={openCollectionManager} onNew={() => openCollectionManager()} onSave={() => { saveCollection(); openCollectionManager(); }} onToggleFeatured={toggleFeaturedCollection} onMoveFeatured={moveFeaturedCollection} />}
    {screen === 'saved' && <SimpleScreen kicker={t('Your library', 'مكتبتك')} title={t('Saved', 'المحفوظات')}><p>{t('Return to ideas when the moment is right.', 'عد إلى الأفكار عندما يحين وقتها.')}</p><div className="approved-feed">{publicFeedEdits.filter((item) => saved.includes(item.id)).map((item) => <EditCard key={item.id} edit={item} ar={ar} saved onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}{!saved.length && <Empty text={t('Nothing saved yet. Explore creators and keep what speaks to you.', 'لا توجد محفوظات بعد. اكتشف المبدعين واحفظ ما يناسب ذوقك.')} />}</div></SimpleScreen>}
    {screen === 'you' && <SimpleScreen kicker={owner ? t('Creator owner mode', 'وضع مالك الحساب') : t('Your account', 'حسابك')} title={owner ? t('Your profile', 'ملفك الشخصي') : t('Your account', 'حسابك')}><div className="approved-panel identity"><Avatar profile={creatorProfile} /><div><strong>{owner ? creatorProfile.displayName : session.user?.email || t('Guest', 'زائر')}</strong><span>{owner ? [creatorProfile.city, creatorProfile.country].filter(Boolean).join(', ') : session.status === 'authenticated' ? t('Signed in', 'تم تسجيل الدخول') : t('Signed out', 'تم تسجيل الخروج')}</span></div></div><div className="approved-panel"><h3>{t('Taste profile', 'ملف الذوق')}</h3><p>{creatorProfile.interests.map((interest) => displayCategory(interest, ar ? 'ar' : 'en')).join(' · ')}</p></div><button className="approved-button wide" style={{ marginBottom: 12 }} onClick={() => go('tune-taste')}>{t('Tune your taste', 'ضبط ذوقك')}</button>{owner && <button className="approved-button wide" onClick={() => { setSelectedCreatorUsername(session.creator!.handle); go('profile'); }}>{t('View profile', 'عرض الملف')}</button>}<button data-testid="open-settings" className="approved-button wide" onClick={() => go('settings')}><Settings2 size={16} /> {t('Settings', 'الإعدادات')}</button>{session.status === 'authenticated' && <button className="approved-button wide" onClick={() => window.location.assign('/api/logout')}>{t('Sign out', 'تسجيل الخروج')}</button>}</SimpleScreen>}
    {screen === 'settings' && <SettingsScreen ar={ar} owner={owner} creatorProfile={creatorProfile} subscribed={subscribed} onApplyVerification={() => go('verificationApply')} />}
    {screen === 'profile' && <Profile ar={ar} owner={viewingOwnProfile && !profileVisitorMode} visitorPreview={visitorPreview} following={following} subscribed={subscribed} profile={viewedCreatorProfile} edits={viewedCreatorEdits} featuredCollections={viewingOwnProfile ? featuredCollections : publicFeaturedCollections} onViewAsVisitor={() => setVisitorPreview(true)} onExitVisitor={() => setVisitorPreview(false)} onFollow={() => { if (!publicProfileViewer) return; if (session.status !== 'authenticated') { window.location.assign('/api/login?returnTo=/'); return; } const next = !following; setFollowing(next); void fetch('/api/relationships', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'follow', targetId: selectedCreatorUsername, active: next }) }).then((response) => { if (!response.ok) setFollowing(!next); }); }} onSubscribe={() => { if (publicProfileViewer && viewedCreatorProfile.verified) go('subscribe'); }} onEditProfile={openProfileEditor} onApplyVerification={() => go('verificationApply')} onMessage={viewedCreatorProfile.verified ? startMessage : undefined} onInsights={() => go('insights')} onEdit={openEdit} onOpenCollection={(collection) => { setSelectedCollectionId(collection.id); go('collection'); }} onCollections={() => { if (viewingOwnProfile) go('collections'); }} onAbout={() => go('about')} onMatch={() => go('tune-taste')} />}
     {screen === 'profileEdit' && <ProfileEditor ar={ar} form={profileForm} photo={pendingProfilePhoto} busy={profileSaveState === 'saving'} error={profileError} saved={profileSaveState === 'saved'} onChange={setProfileForm} onPhotoPrepared={(photo) => { discardPendingProfilePhoto(); setPendingProfilePhoto(photo); setProfileSaveState('idle'); }} onCancelPhoto={discardPendingProfilePhoto} onSave={() => void saveProfile()} />}
     {screen === 'verificationApply' && <VerificationApplicationScreen ar={ar} onDone={() => go('profile')} />}
     {screen === 'collections' && <SimpleScreen kicker={creatorProfile.displayName} title={t('Collections', 'المجموعات')}><p>{t('Complete taste worlds, not a pile of posts.', 'عوالم ذوق مكتملة، وليست مجرد مجموعة منشورات.')}</p>{creatorCollections.length ? <div className="approved-grid">{creatorCollections.map((item) => <button className="approved-collection" key={item.id} onClick={() => { setSelectedCollectionId(item.id); go('collection'); }}><img src={imageSrc(published.find((edit) => edit.id === item.coverEditId)?.image || media('quiet-tailoring.webp'))} alt="" /><strong>{ar ? item.titleAr : item.title}</strong><span>{item.access === 'locked' ? t('Subscribers only', 'للمشتركين فقط') : t('Public collection', 'مجموعة عامة')}</span></button>)}</div> : <Empty text={t('No Collections yet. This space will hold complete taste worlds as they are published.', 'لا توجد مجموعات بعد. ستضم هذه المساحة عوالم ذوق مكتملة عند نشرها.')} />}</SimpleScreen>}
     {screen === 'collection' && <CollectionDetail ar={ar} collection={selectedCollection} edits={viewedCreatorEdits.filter((item) => selectedCollection.editIds.includes(item.id))} canView={!publicProfileViewer || subscribed} onOpen={openEdit} onSubscribe={() => go('subscribe')} />}
    {screen === 'about' && <SimpleScreen kicker={t(`About ${viewedCreatorProfile.displayName}`, `عن ${viewedCreatorProfile.displayName}`)} title={viewedCreatorProfile.displayName}><p>{viewedCreatorProfile.bio || t('This creator has not added a bio yet.', 'لم يضف هذا المبدع نبذة بعد.')}</p><div className="approved-panel"><h3>{t('Taste pillars', 'ركائز الذوق')}</h3><p>{viewedCreatorProfile.interests.map((interest) => displayCategory(interest, ar ? 'ar' : 'en')).join(' · ') || t('No taste categories selected yet.', 'لم يتم اختيار فئات الذوق بعد.')}</p></div>{publicProfileViewer && viewedCreatorProfile.verified && <button className="approved-button primary wide" onClick={() => go('subscribe')}><Price ar={ar} /></button>}</SimpleScreen>}
    {screen === 'edit' && <EditDetail edit={selectedEdit} creatorUsername={selectedEdit.creatorUsername || (viewingOwnProfile ? creatorProfile.username : selectedCreatorUsername)} ar={ar} subscribed={subscribed} saved={saved.includes(selectedEdit.id)} onSave={() => void toggleSaved(selectedEdit.id)} onSubscribe={() => go('subscribe')} />}
    {screen === 'inbox' && <InboxScreen ar={ar} activeConversationId={activeConversationId} onOpen={(id) => { setActiveConversationId(id); go('conversation'); }} />}
    {screen === 'conversation' && activeConversationId && <ConversationScreen ar={ar} conversationId={activeConversationId} />}
    {screen === 'conversation' && !activeConversationId && <InboxScreen ar={ar} activeConversationId={null} onOpen={(id) => { setActiveConversationId(id); go('conversation'); }} />}
    {screen === 'insights' && <InsightsScreen ar={ar} edits={creatorEdits} />}
    {screen === 'adminVerification' && <AdminVerificationScreen ar={ar} />}
     {screen === 'subscribe' && <SimpleScreen kicker={viewedCreatorProfile.displayName} title={t(`Subscribe to ${viewedCreatorProfile.displayName}`, `اشترك في ${viewedCreatorProfile.displayName}`)}><div className="approved-panel"><h3><Price ar={ar} withVerb={false} /></h3><p>{t('Private travel diaries, training routines, outfit details, and early collections.', 'مذكرات سفر خاصة، برامج تدريب، تفاصيل إطلالات، ومجموعات مبكرة.')}</p></div>{publicProfileViewer && <><button className="approved-button primary wide" disabled><Price ar={ar} /></button><p className="workspace-notice">{t('Secure checkout will open after Stripe entitlements are connected. No payment or access is being simulated.', 'سيتاح الدفع الآمن بعد ربط صلاحيات Stripe. لا يتم حالياً محاكاة أي دفع أو وصول.')}</p></>}</SimpleScreen>}
   </main>{screen !== 'composer' && screen !== 'creatorPreview' && <nav className="approved-bottom" aria-label={t('Primary navigation', 'التنقل الرئيسي')} data-testid="primary-navigation">{nav.map(({ id, icon: Icon, en, ar: labelAr }) => <button key={id} data-testid={`nav-${id}`} className={screen === id ? 'active' : ''} onClick={() => go(id)}><Icon size={21} /><span>{ar ? labelAr : en}</span></button>)}</nav>}
    {menuOpen && <div className="approved-menu" data-testid="identity-language-menu"><div className="approved-menu-head"><h2>{t('Account & language', 'الحساب واللغة')}</h2><button className="approved-icon" onClick={() => setMenuOpen(false)}><X size={19} /></button></div><span className="approved-kicker">{t('Profile view', 'عرض الملف')}</span><div className="approved-segment"><button data-testid="identity-owner" className={owner && !profileVisitorMode ? 'selected' : ''} onClick={() => { if (!owner) { window.location.assign('/api/login?returnTo=/'); return; } setProfileVisitorMode(false); setSelectedCreatorUsername(session.creator!.handle); go('profile'); }}><ShieldCheck size={14} /> {owner ? `${session.creator?.displayName} · ${t('Owner', 'المالك')}` : t('Sign in', 'تسجيل الدخول')}</button><button data-testid="identity-consumer" className={profileVisitorMode ? 'selected' : ''} onClick={() => { setProfileVisitorMode(true); if (session.creator?.handle) { setSelectedCreatorUsername(session.creator.handle); go('profile'); } }}><CircleUserRound size={14} /> {t('View as visitor', 'عرض كزائر')}</button></div><button data-testid="menu-tune-taste" className="approved-button wide" onClick={() => go('tune-taste')}><Settings2 size={16} /> {t('Tune your taste', 'ضبط ذوقك')}</button>{session.isAdmin && <button data-testid="menu-admin-verification" className="approved-button wide" onClick={() => go('adminVerification')}><ShieldCheck size={16} /> {t('Verification review', 'مراجعة التوثيق')}</button>}{session.status === 'authenticated' && <button data-testid="menu-sign-out" className="approved-button wide" onClick={() => window.location.assign('/api/logout')}><LogOut size={16} /> {t('Sign out', 'تسجيل الخروج')}</button>}<span className="approved-kicker">{t('Interface language', 'لغة الواجهة')}</span><div className="approved-segment"><button data-testid="language-en" className={!ar ? 'selected' : ''} onClick={() => { setLanguage('en'); write('interface-language', 'en'); }}>English</button><button data-testid="language-ar" className={ar ? 'selected' : ''} onClick={() => { setLanguage('ar'); write('interface-language', 'ar'); }}>العربية</button></div></div>}
   </div></TasteSessionContext.Provider>;
}

function HomeFeedTabs({ ar, active, onSelect }: { ar: boolean; active: HomeFeedTab; onSelect: (tab: HomeFeedTab) => void }) {
  const tabs: Array<{ id: HomeFeedTab; en: string; ar: string }> = [{ id: 'for-you', en: 'For You', ar: 'لك' }, { id: 'following', en: 'Following', ar: 'تتابعهم' }, { id: 'subscribed', en: 'Subscribed', ar: 'مشترك به' }];
  return <div className="approved-tabs approved-feed-tabs" aria-label={ar ? 'تبويبات التغذية' : 'Feed tabs'}>{tabs.map((tab) => <button key={tab.id} data-testid={`home-tab-${tab.id}`} className={active === tab.id ? 'active' : ''} onClick={() => onSelect(tab.id)}>{ar ? tab.ar : tab.en}</button>)}</div>;
}
function FeedEmpty({ ar, tab, onExplore }: { ar: boolean; tab: Exclude<HomeFeedTab, 'for-you'>; onExplore: () => void }) {
  const copy = tab === 'following'
    ? (ar ? ['لا توجد تعديلات من الحسابات التي تتابعها بعد.', 'اكتشف مبدعين جددًا لتجد ذوقك القادم.'] : ['No edits from people you follow yet.', 'Explore creators to find your next taste.'])
    : (ar ? ['لا توجد تعديلات للمشتركين بعد.', 'اكتشف مبدعين لتجد مساحتك الخاصة التالية.'] : ['No subscriber edits yet.', 'Explore creators to find your next private space.']);
  return <div className="approved-empty"><strong>{copy[0]}</strong><p>{copy[1]}</p><button className="approved-button primary" onClick={onExplore}>{ar ? 'اذهب إلى اكتشف' : 'Explore creators'}</button></div>;
}
function CategoryChips({ ar, active, onSelect, items = categories, testIdPrefix = 'category', ariaLabel, className = '' }: { ar: boolean; active: Category; onSelect: (category: Category) => void; items?: typeof categories; testIdPrefix?: string; ariaLabel?: string; className?: string }) { return <div className={`approved-chips ${className}`} aria-label={ariaLabel || (ar ? 'فلاتر الاكتشاف' : 'Discovery categories')}>{items.map((item) => <button key={item.id} data-testid={`${testIdPrefix}-${item.id}`} className={item.id === active ? 'active' : ''} onClick={() => onSelect(item.id)}>{ar ? item.ar : item.en}</button>)}</div>; }
function Avatar({ profile = defaultCreatorProfile, src }: { profile?: CreatorProfile; src?: string }) { return <div className="approved-avatar"><img src={src || profile.avatar} alt={profile.displayName} /></div>; }
function ExploreScreen({ ar, category, setCategory, saved, toggleSaved, edits, onOpenProfile, onOpenEdit }: { ar: boolean; category: Category; setCategory: (c: Category) => void; saved: string[]; toggleSaved: (id: string) => void; edits: CreatorEdit[]; onOpenProfile: (username: string) => void; onOpenEdit: (edit: CreatorEdit) => void }) {
  const [sort, setSort] = useState<'best' | 'new'>('best');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const session = useTasteSession();
  const exploreParams = { sort, category: category === 'All' ? undefined : category, q: debouncedQuery || undefined };
  const { data, isLoading } = useExplore(exploreParams, {
    query: { queryKey: getExploreQueryKey(exploreParams), enabled: session.status !== 'loading', refetchOnMount: 'always', refetchOnWindowFocus: true, staleTime: 0 },
    request: { credentials: 'include', cache: 'no-store' },
  });
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const creatorResults = Array.isArray(data?.creators) ? data.creators : [{
    id: 'fheed-alaiban',
    username: 'fheed',
    displayName: 'Fheed Alaiban',
    avatar: media('fheed-profile.webp'),
    categories: ['Fashion', 'Travel', 'Places'],
    matchScore: null,
    matchReasons: [],
  }];
  const searchTerm = debouncedQuery.toLowerCase();
  const visibleEdits = searchTerm
    ? edits.filter((item) => `${item.title} ${item.titleAr} ${item.caption} ${item.captionAr} ${item.placeName || ''} ${item.location} ${item.locationAr}`.toLowerCase().includes(searchTerm))
    : edits;

  return (
    <section>
      <span className="approved-kicker">{t('Explore', 'اكتشف')}</span>
      <div className="workspace-head" style={{ alignItems: 'center', marginBottom: 12 }}>
        <h1 className="approved-title">{t('Find your next taste.', 'اكتشف ذوقك القادم.')}</h1>
      </div>

      <label className="approved-search">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search creators, places, and edits', 'ابحث عن المبدعين والأماكن والتعديلات')} aria-label={t('Search', 'بحث')} />
      </label>

      <div className="approved-segment">
        <button className={sort === 'best' ? 'selected' : ''} onClick={() => setSort('best')}>{t('Best Match', 'أفضل تطابق')}</button>
        <button className={sort === 'new' ? 'selected' : ''} onClick={() => setSort('new')}>{t('New', 'الأحدث')}</button>
      </div>

      <CategoryChips ar={ar} active={category} onSelect={setCategory} />

      {isLoading && <div className="approved-empty">{t('Loading...', 'جارٍ التحميل...')}</div>}
      
      {session.status === 'signed-out' && sort === 'best' && (
         <div className="workspace-notice">
            {t('Sign in to see personalized Best Matches.', 'سجل الدخول لرؤية أفضل التطابقات المخصصة لك.')}
            <button onClick={() => window.location.assign('/api/login?returnTo=/')}>{t('Sign in', 'تسجيل الدخول')}</button>
         </div>
      )}

      <div className="approved-feed" style={{ marginTop: 16 }}>
         {creatorResults.map(creator => (
            <div key={creator.id} data-testid={creator.username === 'fheed' ? 'fheed-profile-mini' : `creator-${creator.username}`} className="approved-panel approved-profile-mini" style={{ flexDirection: 'column', alignItems: 'stretch' }} onClick={() => onOpenProfile(creator.username)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar profile={{ avatar: creator.avatar, displayName: creator.displayName, username: creator.username } as any} />
                <div style={{ display: 'grid', gap: 2, flex: '1 1 auto' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                     <strong style={{ margin: 0, padding: 0 }}>{creator.displayName}</strong>
                     {creator.matchScore != null && <span style={{ color: 'var(--tk-wine)', fontWeight: 800 }}>{creator.matchScore}%</span>}
                   </div>
                   <span>{creator.categories?.join(' · ')}</span>
                </div>
                <ChevronRight />
              </div>
              {creator.matchReasons && creator.matchReasons.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#eef7f3', borderRadius: 12, fontSize: 11, color: '#296657' }}>
                  {creator.matchReasons.map((r, i) => <p key={i} style={{ margin: '0 0 4px', lineHeight: 1.4 }}>{r}</p>)}
                </div>
              )}
           </div>
        ))}

        {visibleEdits.map(item => (
          <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => onOpenEdit(item)} />
        ))}
      </div>
      {searchTerm && !creatorResults.length && !visibleEdits.length && !isLoading && <Empty text={t('No results for this search.', 'لا توجد نتائج لهذا البحث.')} />}
    </section>
  );
}

function TuneTasteScreen({ ar, onBack }: { ar: boolean; onBack: () => void }) {
  const { data: catalog, isLoading: catalogLoading } = useGetTasteCatalog();
  const session = useTasteSession();
  const { data: prefs, isLoading: prefsLoading, error: prefsError } = useGetTastePreferences({
    query: { retry: false, queryKey: getGetTastePreferencesQueryKey(), enabled: session.status === 'authenticated', refetchOnMount: 'always', staleTime: 0 },
    request: { credentials: 'include', cache: 'no-store' },
  });
  const savePrefs = useSaveTastePreferences();
  const queryClient = useQueryClient();

  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (prefs && !initialized) {
      setCategories(prefs.categories || []);
      setTags(prefs.tags || []);
      setInitialized(true);
    }
  }, [prefs, initialized]);

  const toggleCategory = (id: string) => setCategories(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  const toggleTag = (id: string) => setTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const handleSave = () => {
    setSaveState('saving');
    savePrefs.mutate({ data: { categories, tags } }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetTastePreferencesQueryKey(), data);
        void queryClient.invalidateQueries({ queryKey: getExploreQueryKey() });
        void queryClient.invalidateQueries({
          predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/taste-match/'),
        });
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 3000);
      },
      onError: () => setSaveState('error')
    });
  };

  if (session.status === 'signed-out' || prefsError) {
    return (
      <SimpleScreen kicker={ar ? 'تطابق الذوق' : 'Taste Match'} title={ar ? 'ضبط ذوقك' : 'Tune your taste'}>
        <div className="workspace-notice" role="alert">
          {ar ? 'سجل الدخول لضبط تفضيلات ذوقك.' : 'Sign in to tune your taste preferences.'}
          <button onClick={() => window.location.assign('/api/login?returnTo=/')}>{ar ? 'تسجيل الدخول' : 'Sign in'}</button>
        </div>
        <button className="approved-button wide" style={{ marginTop: 16 }} onClick={onBack}>{ar ? 'رجوع' : 'Back'}</button>
      </SimpleScreen>
    );
  }

  if (catalogLoading || session.status === 'loading' || prefsLoading) {
    return <SimpleScreen kicker={ar ? 'تطابق الذوق' : 'Taste Match'} title={ar ? 'ضبط ذوقك' : 'Tune your taste'}><div className="approved-empty">{ar ? 'جارٍ التحميل...' : 'Loading...'}</div></SimpleScreen>;
  }

  return (
    <SimpleScreen kicker={ar ? 'تطابق الذوق' : 'Taste Match'} title={ar ? 'ضبط ذوقك' : 'Tune your taste'}>
      <p>{ar ? 'اختر المجالات والسمات التي تعكس ذوقك الفعلي للحصول على تطابقات أدق.' : 'Select the categories and tags that reflect your actual taste for better matches.'}</p>
      
      {catalog?.categories.map(cat => (
        <div key={cat.id} className="approved-panel">
          <div className="age-toggle" style={{ marginTop: 0 }}>
             <input type="checkbox" checked={categories.includes(cat.id)} onChange={() => toggleCategory(cat.id)} />
             <span>
                <strong>{ar ? cat.labelAr : cat.label}</strong>
             </span>
          </div>
          {categories.includes(cat.id) && (
            <div className="profile-interests" style={{ marginTop: 12, marginBottom: 0 }}>
               {catalog.tags.filter(t => t.categoryId === cat.id).map(tag => (
                 <button key={tag.id} className={tags.includes(tag.id) ? 'selected' : ''} onClick={() => toggleTag(tag.id)}>
                   {ar ? tag.labelAr : tag.label}
                 </button>
               ))}
            </div>
          )}
        </div>
      ))}

      {saveState === 'saved' && <div className="profile-save-success" style={{ marginTop: 16 }}>{ar ? 'تم حفظ التفضيلات.' : 'Preferences saved.'}</div>}
      {saveState === 'error' && <div className="workspace-notice" style={{ marginTop: 16 }}>{ar ? 'لم نتمكن من حفظ التفضيلات.' : 'Could not save preferences.'}</div>}

      <button className="approved-button primary wide" style={{ marginTop: 16 }} onClick={handleSave} disabled={saveState === 'saving'}>
        {saveState === 'saving' ? (ar ? 'جارٍ الحفظ...' : 'Saving...') : (ar ? 'حفظ التفضيلات' : 'Save preferences')}
      </button>
      <button className="approved-button wide" style={{ marginTop: 12 }} onClick={onBack}>{ar ? 'العودة إلى الحساب' : 'Back to Account'}</button>
    </SimpleScreen>
  );
}

function SimpleScreen({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) { return <section><span className="approved-kicker">{kicker}</span>{title && <h1 className="approved-title">{title}</h1>}{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="approved-empty">{text}</div>; }
function publicCaptionLine(edit: CreatorEdit, ar: boolean) { return (ar ? edit.captionAr || edit.caption : edit.caption || edit.captionAr || edit.placeName || edit.title).split(/\r?\n/, 1)[0].trim(); }
function profileCaptionLine(edit: CreatorEdit, ar: boolean) {
  const caption = ar ? edit.captionAr || edit.caption : edit.caption || edit.captionAr;
  return caption ? caption.split(/\r?\n/, 1)[0].trim() : '';
}
function TasteRating({ rating, ar, id }: { rating?: number | null; ar: boolean; id?: string }) {
  if (!rating) return null;
  return <span className="taste-rating-wrap" data-testid={id ? `taste-rating-${id}` : undefined}><span className="taste-rating" aria-hidden="true">{[1, 2, 3, 4, 5].map((value) => <Link2 key={value} size={15} className={value <= rating ? 'active' : ''} />)}</span><span className="taste-rating-label" aria-label={ar ? `تقييم TASTEKIN ${rating} من 5` : `TASTEKIN Taste Rating ${rating} out of 5`}>{ar ? `تقييم TASTEKIN · ${rating}/5` : `TASTEKIN Taste Rating · ${rating}/5`}</span></span>;
}
function PlaceDetails({ edit, ar, compact = false, showName = true }: { edit: CreatorEdit; ar: boolean; compact?: boolean; showName?: boolean }) {
  if (!isPlaceCategory(edit.category) || !(edit.placeName || edit.locationLabel || edit.creatorReview || edit.tasteRating || isSafeMapsUrl(edit.mapsUrl))) return null;
  const location = placeLocation(edit, ar);
  return <div className={`place-details ${compact ? 'compact' : ''}`}>
    {showName && edit.placeName && <strong className="place-name">{edit.placeName}</strong>}
    {location && <span className="place-location"><MapPin size={14} />{location}</span>}
    <TasteRating rating={edit.tasteRating} ar={ar} id={edit.id} />
    {edit.creatorReview && <p>{edit.creatorReview}</p>}
    {isSafeMapsUrl(edit.mapsUrl) && <a className="place-map-link" href={edit.mapsUrl!} target="_blank" rel="noreferrer"><MapPin size={14} />{ar ? 'فتح في الخرائط' : 'Open in Maps'}</a>}
  </div>;
}
function SaveButton({ edit, ar, saved, onSave }: { edit: CreatorEdit; ar: boolean; saved: boolean; onSave: () => void }) { return <button className={`approved-save ${saved ? 'saved' : ''}`} data-testid={`save-${edit.id}`} onClick={onSave} aria-label={saved ? (ar ? 'إزالة من المحفوظات' : 'Remove from saved') : (ar ? 'حفظ التعديل' : 'Save Edit')} aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button>; }
function CreatorAttribution({ edit }: { edit: CreatorEdit }) {
  if (!edit.creatorUsername) return null;
  return <div className="feed-creator"><span className="feed-creator-avatar">{edit.creatorAvatar ? <img src={imageSrc(edit.creatorAvatar)} alt="" /> : edit.creatorName?.slice(0, 1)}</span><span><strong>{edit.creatorName || edit.creatorUsername}</strong><small>@{edit.creatorUsername}</small></span>{edit.creatorVerified && <img className="feed-taste-seal" src={TASTE_SEAL_IMAGE} alt="Verified by TASTEKIN" />}</div>;
}
function EditCard({ edit, ar, saved, onSave, onOpen }: { edit: CreatorEdit; ar: boolean; saved: boolean; onSave: () => void; onOpen: () => void }) {
  const caption = publicCaptionLine(edit, ar);
  const noPhoto = !edit.image;
  if (noPhoto) return <article className="approved-card place-card" data-testid={`edit-card-${edit.id}`}><CreatorAttribution edit={edit} /><button className="place-card-main" onClick={onOpen}><span className="place-card-category">{displayCategory(edit.category, ar ? 'ar' : 'en')}</span>{edit.access === 'locked' && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}<PlaceDetails edit={edit} ar={ar} /><span className="place-card-open">{ar ? 'عرض التوصية' : 'View recommendation'} <ChevronRight size={15} /></span></button><div className="approved-caption"><div className="approved-caption-row"><button className="approved-card-title" data-testid={`edit-title-${edit.id}`} onClick={onOpen}>{caption}</button><SaveButton edit={edit} ar={ar} saved={saved} onSave={onSave} /></div></div></article>;
  return <article className="approved-card" data-testid={`edit-card-${edit.id}`}><CreatorAttribution edit={edit} /><button className="approved-art" style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop) }} onClick={onOpen}><img src={imageSrc(edit.image)} alt={edit.altText} />{edit.access === 'locked' && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}</button>{caption && <div className="approved-caption"><div className="approved-caption-row"><button className="approved-card-title" data-testid={`edit-title-${edit.id}`} onClick={onOpen}>{caption}</button><SaveButton edit={edit} ar={ar} saved={saved} onSave={onSave} /></div>{isPlaceCategory(edit.category) && <PlaceDetails edit={edit} ar={ar} compact />}</div>}{!caption && <div className="approved-caption approved-caption-empty"><SaveButton edit={edit} ar={ar} saved={saved} onSave={onSave} /></div>}</article>;
}
function EditDetail({ edit, creatorUsername, ar, subscribed, saved, onSave, onSubscribe }: { edit: CreatorEdit; creatorUsername: string; ar: boolean; subscribed: boolean; saved: boolean; onSave: () => void; onSubscribe: () => void }) {
  const locked = edit.access === 'locked';
  const caption = publicCaptionLine(edit, ar);
  const detailTitle = isPlaceCategory(edit.category) ? edit.placeName || caption : caption;
  const outfitItems = (edit.outfitItems || []).filter((item) => item.type || item.brand || item.name);
  return <SimpleScreen kicker={locked ? (ar ? 'للمشتركين فقط' : 'Subscribers only') : (ar ? 'تعديل عام' : 'Public Edit')} title={detailTitle}>
    {edit.image && <div className={`approved-detail-art ${locked ? 'locked' : ''}`} style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop), height: 'auto' }}><img src={imageSrc(edit.image)} alt={edit.altText} />{locked && <div><LockKeyhole size={26} />{caption && <strong>{caption}</strong>}</div>}</div>}
    {isPlaceCategory(edit.category) && caption && caption !== detailTitle && <p className="edit-detail-caption">{caption}</p>}
    {!edit.image && <div className={`place-detail-panel ${locked ? 'locked' : ''}`}>{locked && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}<PlaceDetails edit={edit} ar={ar} showName={false} /></div>}
    {!edit.placeName && (edit.location || edit.locationAr) && <div className="approved-location"><MapPin size={14} />{placeLocation(edit, ar)}</div>}
    {locked ? <div className="approved-panel"><h3>{ar ? 'هذا التعديل للمشتركين' : 'This edit is for subscribers'}</h3><p>{ar ? 'تظل الوسائط الخاصة محمية إلى أن يتم تأكيد اشتراكك في حسابك.' : 'Private media stays protected until your subscription is confirmed on your account.'}</p><button className="approved-button primary wide" onClick={onSubscribe}>{subscribed ? (ar ? 'بانتظار تأكيد الاشتراك' : 'Subscription pending confirmation') : <Price ar={ar} />}</button></div> : <>
      {isPlaceCategory(edit.category) && edit.image && <PlaceDetails edit={edit} ar={ar} showName={false} />}
      {edit.showOutfitDetails && outfitItems.length > 0 && <div className="outfit-published"><h3>{ar ? 'تفاصيل الإطلالة' : 'Outfit details'}</h3>{outfitItems.map((item, index) => <div key={index}><strong>{item.type || item.name}</strong><span>{[item.brand, item.name].filter(Boolean).join(' · ')}</span>{item.link && <a href={item.link} target="_blank" rel="noreferrer">{ar ? 'عرض المنتج' : 'View item'}</a>}</div>)}</div>}
      <EditEngagementPanel editId={edit.id} creatorUsername={creatorUsername} shareCaption={caption} ar={ar} saved={saved} onSave={onSave} />
      <button className={`approved-button wide ${saved ? 'primary' : ''}`} onClick={onSave}>{saved ? (ar ? 'تم الحفظ' : 'Saved') : (ar ? 'احفظ هذا التعديل' : 'Save this edit')}</button>
    </>}
  </SimpleScreen>;
}

function EditEngagementPanel({ editId, creatorUsername, shareCaption, ar, saved, onSave }: { editId: string; creatorUsername: string; shareCaption?: string; ar: boolean; saved: boolean; onSave: () => void }) {
  const session = useTasteSession();
  const [engagement, setEngagement] = useState<EditEngagement>({ editId, likeCount: 0, commentCount: 0, liked: false, saved });
  const [comments, setComments] = useState<EditComment[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [liking, setLiking] = useState(false);
  const signIn = () => window.location.assign('/api/login?returnTo=/');
  const load = useCallback(async () => {
    try {
      const [engagementResponse, commentsResponse] = await Promise.all([
        fetch(`/api/edits/${encodeURIComponent(editId)}/engagement`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/edits/${encodeURIComponent(editId)}/comments`, { credentials: 'include', cache: 'no-store' }),
      ]);
      if (engagementResponse.ok) setEngagement(await engagementResponse.json() as EditEngagement);
      if (commentsResponse.ok) setComments(await commentsResponse.json() as EditComment[]);
    } catch { setError(ar ? 'تعذر تحميل التفاعل.' : 'Could not load engagement.'); }
  }, [ar, editId]);
  useEffect(() => { void load(); void fetch(`/api/creators/${encodeURIComponent(creatorUsername)}/views`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editId }) }); }, [creatorUsername, editId, load]);
  useEffect(() => setEngagement((current) => ({ ...current, saved })), [saved]);
  const changeLike = async () => {
    if (session.status !== 'authenticated') { signIn(); return; }
    if (liking) return;
    const prior = engagement;
    setLiking(true);
    setEngagement({ ...prior, liked: !prior.liked, likeCount: Math.max(0, prior.likeCount + (prior.liked ? -1 : 1)) });
    try {
      const response = await fetch(`/api/edits/${encodeURIComponent(editId)}/like`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !prior.liked }) });
      if (!response.ok) throw new Error(await describeFailedResponse(response));
      setEngagement(await response.json() as EditEngagement);
    } catch (err) {
      setEngagement(prior);
      const detail = err instanceof Error ? err.message : String(err);
      const message = `${ar ? 'تعذر تحديث الإعجاب' : 'Could not update your like'}: ${detail}`;
      setError(message);
      window.alert(message);
    } finally { setLiking(false); }
  };
  const submitComment = async () => {
    if (session.status !== 'authenticated') { signIn(); return; }
    if (!comment.trim()) return;
    setSending(true); setError('');
    try {
      const response = await fetch(`/api/edits/${encodeURIComponent(editId)}/comments`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: comment.trim() }) });
      if (!response.ok) throw new Error(await describeFailedResponse(response));
      const created = await response.json() as EditComment;
      setComments((current) => [...current, created]); setComment(''); setEngagement((current) => ({ ...current, commentCount: current.commentCount + 1 }));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `${ar ? 'تعذر إرسال تعليقك' : 'Could not post your comment'}: ${detail}`;
      setError(message);
      window.alert(message);
    } finally { setSending(false); }
  };
  const removeComment = async (commentId: string) => {
    const removed = comments.find((item) => item.id === commentId);
    if (!removed) return;
    setComments((current) => current.filter((item) => item.id !== commentId));
    try {
      const response = await fetch(`/api/edits/${encodeURIComponent(editId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error();
      setEngagement((current) => ({ ...current, commentCount: Math.max(0, current.commentCount - 1) }));
    } catch { setComments((current) => [...current, removed]); setError(ar ? 'تعذر حذف التعليق.' : 'Could not delete this comment.'); }
  };
  const [shareNotice, setShareNotice] = useState('');
  const shareNoticeTimeout = useRef<number | null>(null);
  useEffect(() => () => { if (shareNoticeTimeout.current) window.clearTimeout(shareNoticeTimeout.current); }, []);
  const sharePost = async () => {
    const shareUrl = `${window.location.origin}/posts/${encodeURIComponent(creatorUsername)}/${encodeURIComponent(editId)}`;
    const shareData = { title: creatorUsername ? `${creatorUsername} · TASTEKIN` : 'TASTEKIN', text: shareCaption || '', url: shareUrl };
    if (navigator.share) {
      try { await navigator.share(shareData); return; }
      catch (err) { if (err instanceof Error && err.name === 'AbortError') return; }
    }
    if (shareNoticeTimeout.current) { window.clearTimeout(shareNoticeTimeout.current); shareNoticeTimeout.current = null; }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNotice(ar ? 'تم نسخ الرابط' : 'Link copied');
      shareNoticeTimeout.current = window.setTimeout(() => setShareNotice(''), 2500);
    } catch {
      setShareNotice(`${ar ? 'انسخ هذا الرابط' : 'Copy this link'}: ${shareUrl}`);
    }
  };
  return <section className="edit-engagement" aria-label={ar ? 'تفاعل التعديل' : 'Edit engagement'}>
    <div className="edit-reactions">
      <button className={engagement.liked ? 'active' : ''} onClick={() => void changeLike()} aria-pressed={engagement.liked} disabled={liking}><Heart size={18} fill={engagement.liked ? 'currentColor' : 'none'} /> {engagement.likeCount}</button>
      <span><MessageCircle size={18} /> {engagement.commentCount}</span>
      <button className={`save-pill ${saved ? 'active' : ''}`} onClick={onSave} aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /> {ar ? 'حفظ' : 'Save'}</button>
      <button className="share-pill" onClick={() => void sharePost()} aria-label={ar ? 'مشاركة هذا التعديل' : 'Share this edit'}><Share2 size={18} /></button>
    </div>
    <div className="comment-composer">
      <input value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submitComment(); }} placeholder={session.status === 'authenticated' ? (ar ? 'أضف تعليقاً' : 'Add a comment') : (ar ? 'سجّل الدخول للتعليق' : 'Sign in to comment')} onFocus={() => { if (session.status !== 'authenticated') signIn(); }} maxLength={800} />
      <button className="approved-icon" onClick={() => void submitComment()} disabled={sending} aria-label={ar ? 'إرسال تعليق' : 'Post comment'}><Send size={17} /></button>
    </div>
    {error && <div className="engagement-error" role="alert">{error}</div>}
    {shareNotice && <div className="share-notice" role="status">{shareNotice}</div>}
    <div className="comment-list">{comments.map((item) => <article key={item.id}><div><strong>{item.authorName}</strong><time>{new Date(item.createdAt).toLocaleDateString()}</time></div><p>{item.body}</p>{item.canDelete && <button onClick={() => void removeComment(item.id)}>{ar ? 'حذف' : 'Delete'}</button>}</article>)}</div>
  </section>;
}

function InboxScreen({ ar, activeConversationId, onOpen }: { ar: boolean; activeConversationId: string | null; onOpen: (id: string) => void }) {
  const session = useTasteSession();
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    if (session.status !== 'authenticated') { setState('ready'); return; }
    try {
      const response = await fetch('/api/conversations', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error();
      setConversations(await response.json() as ConversationPreview[]); setState('ready');
    } catch { setState('error'); }
  }, [session.status]);
  useEffect(() => { void load(); }, [load, activeConversationId]);
  if (session.status !== 'authenticated') return <SimpleScreen kicker={ar ? 'الرسائل' : 'Messages'} title={ar ? 'صندوق الوارد' : 'Inbox'}><div className="workspace-notice">{ar ? 'سجّل الدخول لرؤية رسائلك.' : 'Sign in to view your messages.'}<button onClick={() => window.location.assign('/api/login?returnTo=/')}>{ar ? 'تسجيل الدخول' : 'Sign in'}</button></div></SimpleScreen>;
  return <SimpleScreen kicker={ar ? 'الرسائل' : 'Messages'} title={ar ? 'صندوق الوارد' : 'Inbox'}>
    {state === 'loading' && <Empty text={ar ? 'جارٍ تحميل رسائلك…' : 'Loading your messages…'} />}
    {state === 'error' && <div className="workspace-notice">{ar ? 'تعذر تحميل الرسائل.' : 'Could not load your messages.'}<button onClick={() => void load()}>{ar ? 'حاول مجدداً' : 'Try again'}</button></div>}
    {state === 'ready' && !conversations.length && <Empty text={ar ? 'لا توجد محادثات بعد. ابدأ من ملف المبدع.' : 'No conversations yet. Start from a creator profile.'} />}
    <div className="inbox-list">{conversations.map((item) => <button key={item.id} className="inbox-row" onClick={() => onOpen(item.id)}>
      <span className="inbox-avatar">{item.participantAvatar ? <img src={item.participantAvatar} alt="" /> : <Inbox size={19} />}</span>
      <span><strong>{item.participantName}</strong><small>{item.lastMessage || (ar ? 'ابدأ المحادثة' : 'Start the conversation')}</small></span>
      {item.unreadCount > 0 && <b>{item.unreadCount}</b>}
    </button>)}</div>
  </SimpleScreen>;
}

function ConversationScreen({ ar, conversationId }: { ar: boolean; conversationId: string }) {
  const session = useTasteSession();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error();
      setConversation(await response.json() as Conversation); setError('');
    } catch { setError(ar ? 'تعذر تحميل المحادثة.' : 'Could not load this conversation.'); }
  }, [ar, conversationId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [conversation?.messages.length]);
  const send = async () => {
    if (!message.trim() || !session.user) return;
    const body = message.trim();
    const pending: ConversationMessage = { id: `pending-${Date.now()}`, senderUserId: session.user.id, body, createdAt: new Date().toISOString(), readAt: null };
    setMessage(''); setSending(true); setError('');
    setConversation((current) => current ? { ...current, messages: [...current.messages, pending] } : current);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      if (!response.ok) throw new Error();
      const sent = await response.json() as ConversationMessage;
      setConversation((current) => current ? { ...current, messages: current.messages.map((item) => item.id === pending.id ? sent : item) } : current);
    } catch {
      setConversation((current) => current ? { ...current, messages: current.messages.filter((item) => item.id !== pending.id) } : current);
      setError(ar ? 'لم يتم إرسال الرسالة. حاول مجدداً.' : 'Message was not sent. Try again.');
    } finally { setSending(false); }
  };
  return <SimpleScreen kicker={ar ? 'الرسائل' : 'Messages'} title={conversation?.participantName || (ar ? 'محادثة' : 'Conversation')}>
    <div className="conversation-thread" ref={scrollRef}>{conversation?.messages.map((item) => <div key={item.id} className={item.senderUserId === session.user?.id ? 'mine' : 'theirs'}><p>{item.body}</p><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>)}</div>
    {error && <div className="engagement-error" role="alert">{error}</div>}
    <div className="message-composer"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={ar ? 'اكتب رسالة…' : 'Write a message…'} maxLength={2000} /><button className="approved-button primary" onClick={() => void send()} disabled={sending || !message.trim()}><Send size={17} />{ar ? 'إرسال' : 'Send'}</button></div>
  </SimpleScreen>;
}

function InsightsScreen({ ar, edits }: { ar: boolean; edits: CreatorEdit[] }) {
  const [insights, setInsights] = useState<CreatorInsights | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch('/api/creator-insights', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error();
      setInsights(await response.json() as CreatorInsights); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const titles = new Map(edits.map((edit) => [edit.id, ar ? edit.titleAr || edit.title : edit.title || edit.titleAr]));
  return <SimpleScreen kicker={ar ? 'أدوات المبدع' : 'Creator tools'} title={ar ? 'الإحصاءات' : 'Insights'}>
    {state === 'loading' && <Empty text={ar ? 'جارٍ تحميل البيانات الفعلية…' : 'Loading real activity…'} />}
    {state === 'error' && <div className="workspace-notice">{ar ? 'الإحصاءات متاحة لمالك حساب المبدع فقط.' : 'Insights are available only to the creator owner.'}<button onClick={() => void load()}>{ar ? 'حاول مجدداً' : 'Try again'}</button></div>}
    {state === 'ready' && insights && <>
      <div className="insights-stats"><Stat value={insights.profileViews} label={ar ? 'زيارات الملف' : 'Profile views'} /><Stat value={insights.totalLikes} label={ar ? 'الإعجابات' : 'Likes'} /><Stat value={insights.totalSaves} label={ar ? 'الحفظ' : 'Saves'} /><Stat value={insights.totalComments} label={ar ? 'التعليقات' : 'Comments'} /></div>
      {!insights.profileViews && !insights.totalLikes && !insights.totalSaves && !insights.totalComments && <Empty text={ar ? 'لا توجد بيانات بعد. ستظهر التفاعلات الحقيقية هنا عند حدوثها.' : 'No activity yet. Real views and engagement will appear here as they happen.'} />}
      <div className="insight-edit-list">{insights.edits.map((item) => <article key={item.editId}><strong>{titles.get(item.editId) || item.editId}</strong><span>{item.views} {ar ? 'مشاهدة' : 'views'} · {item.likes} {ar ? 'إعجاب' : 'likes'} · {item.saves} {ar ? 'حفظ' : 'saves'} · {item.comments} {ar ? 'تعليق' : 'comments'}</span></article>)}</div>
    </>}
  </SimpleScreen>;
}

function SettingsScreen({ ar, owner, creatorProfile, subscribed, onApplyVerification }: { ar: boolean; owner: boolean; creatorProfile: CreatorProfile; subscribed: boolean; onApplyVerification: () => void }) {
  const session = useTasteSession();
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [pushNotifications, setPushNotifications] = useState(() => read('notify-push', true));
  const [emailUpdates, setEmailUpdates] = useState(() => read('notify-email', true));
  const togglePush = () => { const next = !pushNotifications; setPushNotifications(next); write('notify-push', next); };
  const toggleEmail = () => { const next = !emailUpdates; setEmailUpdates(next); write('notify-email', next); };
  return <SimpleScreen kicker={t('Account', 'الحساب')} title={t('Settings', 'الإعدادات')}>
    <div className="settings-section">
      <h3>{t('Account', 'الحساب')}</h3>
      <div className="settings-row"><span>{t('Name', 'الاسم')}</span><strong>{creatorProfile.displayName || (ar ? 'غير محدد' : 'Not set')}</strong></div>
      <div className="settings-row"><span>{t('Email', 'البريد الإلكتروني')}</span><strong>{session.user?.email || (ar ? 'غير متاح' : 'Not available')}</strong></div>
      <div className="settings-row"><span>{t('Password', 'كلمة المرور')}</span><strong>{t('Managed by your sign-in provider', 'تُدار عبر مزود تسجيل الدخول')}</strong></div>
    </div>
    <div className="settings-section">
      <h3>{t('Subscription', 'الاشتراك')}</h3>
      <div className="settings-row"><span>{t('Status', 'الحالة')}</span><strong>{subscribed ? t('Subscribed', 'مشترك') : t('No active subscription', 'لا يوجد اشتراك نشط')}</strong></div>
      <p className="settings-note">{t('Secure billing will open here once Stripe entitlements are connected. No payment or access is being simulated.', 'ستتاح إدارة الفوترة هنا بعد ربط صلاحيات Stripe. لا يتم حالياً محاكاة أي دفع أو وصول.')}</p>
    </div>
    <div className="settings-section">
      <h3>{t('Notifications', 'الإشعارات')}</h3>
      <label className="settings-toggle"><span>{t('Push notifications', 'إشعارات فورية')}</span><input type="checkbox" checked={pushNotifications} onChange={togglePush} /></label>
      <label className="settings-toggle"><span>{t('Email updates', 'تحديثات البريد الإلكتروني')}</span><input type="checkbox" checked={emailUpdates} onChange={toggleEmail} /></label>
    </div>
    {owner && <div className="settings-section">
      <h3>{t('Creator info', 'معلومات المبدع')}</h3>
      <div className="settings-row"><span>{t('Verification', 'التوثيق')}</span><strong>{creatorProfile.verified ? t('Verified', 'موثّق') : t('Not verified', 'غير موثّق')}</strong></div>
      {!creatorProfile.verified && <button className="approved-button wide" onClick={onApplyVerification}>{t('Apply for the Taste Seal', 'قدّم للحصول على ختم الذوق')}</button>}
      <p className="settings-note">{t('Content locking is set per Edit in the composer (Public or Subscribers only) when you create or edit it.', 'يتم تحديد قفل المحتوى لكل تعديل من داخل محرر النشر (عام أو للمشتركين فقط) عند إنشائه أو تعديله.')}</p>
    </div>}
    <div className="settings-section">
      <h3>{t('Help & Support', 'المساعدة والدعم')}</h3>
      <p className="settings-note">{t('Questions or issues? Reach us anytime.', 'لديك سؤال أو مشكلة؟ تواصل معنا في أي وقت.')}</p>
      <a className="approved-button wide" href="mailto:support@tastekin.app">{t('Contact support', 'تواصل مع الدعم')}</a>
    </div>
    {session.status === 'authenticated' && <button className="approved-button wide danger" onClick={() => window.location.assign('/api/logout')}><LogOut size={16} /> {t('Sign out', 'تسجيل الخروج')}</button>}
  </SimpleScreen>;
}

type AdminApplicationRow = {
  creatorId: string;
  profile: { displayName: string; username: string; avatar: string; interests: string[] };
  applicationStatement: string | null;
  applicationLinks: unknown;
  applicationCreatedAt: string | null;
};

function AdminVerificationScreen({ ar }: { ar: boolean }) {
  const [applications, setApplications] = useState<AdminApplicationRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approved' | 'rejected' | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const load = useCallback(async () => {
    setState('loading'); setError('');
    try {
      const response = await fetch('/api/admin/creators?status=pending', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(await describeFailedResponse(response));
      const payload = await response.json() as { creators: AdminApplicationRow[] };
      setApplications(payload.creators); setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setState('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selected = applications.find((item) => item.creatorId === selectedId) || null;
  const act = async (row: AdminApplicationRow, status: 'approved' | 'rejected') => {
    setActing(true); setActionError('');
    try {
      const response = await fetch(`/api/admin/creators/${encodeURIComponent(row.creatorId)}/verification`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await describeFailedResponse(response));
      setApplications((current) => current.filter((item) => item.creatorId !== row.creatorId));
      setSelectedId(null); setConfirmAction(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message); window.alert(message);
    } finally { setActing(false); }
  };
  const appliedAs = (row: AdminApplicationRow) => (row.profile.interests || []).map((id) => displayCategory(id, ar ? 'ar' : 'en'));
  const links = (row: AdminApplicationRow) => Array.isArray(row.applicationLinks) ? row.applicationLinks.filter((item): item is string => typeof item === 'string') : [];
  if (selected) {
    const tags = appliedAs(selected);
    return <SimpleScreen kicker={ar ? 'إدارة تيستكن' : 'TASTEKIN admin'} title={selected.profile.displayName || selected.profile.username}>
      <div className="admin-app-detail">
        <span className="feed-creator-avatar">{selected.profile.avatar ? <img src={imageSrc(selected.profile.avatar)} alt="" /> : (selected.profile.displayName || '?').slice(0, 1)}</span>
        <div><strong>{selected.profile.displayName}</strong><small>@{selected.profile.username}</small></div>
      </div>
      {tags.length > 0 && <div className="admin-tags">{tags.map((label) => <span key={label} className="admin-tag">{label}</span>)}</div>}
      <p className="profile-taste-meta">{ar ? 'تاريخ التقديم' : 'Submitted'}: {selected.applicationCreatedAt ? new Date(selected.applicationCreatedAt).toLocaleDateString() : '—'}</p>
      <div className="approved-panel"><h3>{ar ? 'البيان' : 'Statement'}</h3><p>{selected.applicationStatement}</p></div>
      {links(selected).length > 0 && <div className="approved-panel"><h3>{ar ? 'روابط داعمة' : 'Evidence links'}</h3>{links(selected).map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>)}</div>}
      {actionError && <div className="engagement-error" role="alert">{actionError}</div>}
      {confirmAction ? <div className="approved-panel admin-confirm">
        <p>{confirmAction === 'approved' ? (ar ? 'تأكيد الموافقة على هذا الطلب؟' : 'Confirm approving this application?') : (ar ? 'تأكيد رفض هذا الطلب؟' : 'Confirm rejecting this application?')}</p>
        <div className="admin-confirm-actions">
          <button className="approved-button" onClick={() => setConfirmAction(null)} disabled={acting}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button className="approved-button primary" onClick={() => void act(selected, confirmAction)} disabled={acting}>{acting ? (ar ? 'جارٍ التنفيذ…' : 'Working…') : (ar ? 'تأكيد' : 'Confirm')}</button>
        </div>
      </div> : <div className="admin-detail-actions">
        <button className="approved-button" onClick={() => setSelectedId(null)}>{ar ? 'رجوع' : 'Back'}</button>
        <button className="approved-button" onClick={() => setConfirmAction('rejected')}>{ar ? 'رفض' : 'Reject'}</button>
        <button className="approved-button primary" onClick={() => setConfirmAction('approved')}>{ar ? 'موافقة' : 'Approve'}</button>
      </div>}
    </SimpleScreen>;
  }
  return <SimpleScreen kicker={ar ? 'إدارة تيستكن' : 'TASTEKIN admin'} title={ar ? 'طلبات التوثيق المعلّقة' : 'Pending verification applications'}>
    {state === 'loading' && <Empty text={ar ? 'جارٍ التحميل…' : 'Loading…'} />}
    {state === 'error' && <div className="workspace-notice" role="alert">{error}<button onClick={() => void load()}>{ar ? 'حاول مجددًا' : 'Try again'}</button></div>}
    {state === 'ready' && !applications.length && <Empty text={ar ? 'لا توجد طلبات معلّقة حالياً.' : 'No pending applications right now.'} />}
    {state === 'ready' && applications.length > 0 && <div className="admin-app-list">{applications.map((row) => <button key={row.creatorId} className="admin-app-row" onClick={() => setSelectedId(row.creatorId)}>
      <span className="feed-creator-avatar">{row.profile.avatar ? <img src={imageSrc(row.profile.avatar)} alt="" /> : (row.profile.displayName || '?').slice(0, 1)}</span>
      <span className="admin-app-row-copy">
        <strong>{row.profile.displayName || row.profile.username}</strong>
        <small>@{row.profile.username} · {appliedAs(row).slice(0, 2).join(', ') || (ar ? 'بدون فئة' : 'No category')}</small>
        <small>{row.applicationCreatedAt ? new Date(row.applicationCreatedAt).toLocaleDateString() : ''}</small>
      </span>
      <ChevronRight size={16} />
    </button>)}</div>}
  </SimpleScreen>;
}

function Profile({ ar, owner, visitorPreview, following, subscribed, profile, edits, featuredCollections, onViewAsVisitor, onExitVisitor, onFollow, onSubscribe, onEditProfile, onApplyVerification, onMessage, onInsights, onEdit, onOpenCollection, onCollections, onAbout, onMatch }: { ar: boolean; owner: boolean; visitorPreview: boolean; following: boolean; subscribed: boolean; profile: CreatorProfile; edits: CreatorEdit[]; featuredCollections: CreatorCollection[]; onViewAsVisitor: () => void; onExitVisitor: () => void; onFollow: () => void; onSubscribe: () => void; onEditProfile: () => void; onApplyVerification: () => void; onMessage?: () => void; onInsights: () => void; onEdit: (edit: CreatorEdit) => void; onOpenCollection: (collection: CreatorCollection) => void; onCollections: () => void; onAbout: () => void; onMatch: () => void }) {
  const session = useTasteSession();
  const ownerView = owner && !visitorPreview;
  const [sealOpen, setSealOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<Category>('All');
  const publishedEdits = useMemo(() => edits.filter((edit) => edit.status === 'published'), [edits]);
  const profileCategoryItems = useMemo(() => categories.filter((item) => item.id === 'All' || publishedEdits.some((edit) => edit.category === item.id)), [publishedEdits]);
  const profileFilteredEdits = useMemo(() => editCategory === 'All' ? publishedEdits : publishedEdits.filter((edit) => edit.category === editCategory), [editCategory, publishedEdits]);
  useEffect(() => {
    if (!profileCategoryItems.some((item) => item.id === editCategory)) setEditCategory('All');
  }, [editCategory, profileCategoryItems]);
  useEffect(() => {
    setEditCategory('All');
  }, [profile.username]);
  useEffect(() => {
    if (ownerView) return;
    void fetch(`/api/creators/${encodeURIComponent(profile.username)}/views`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editId: null }) });
  }, [ownerView, profile.username]);

  const profileLocation = [profile.city, profile.country].filter(Boolean).join(', ');
  const tasteSummary = profile.interests.map((interest) => displayCategory(interest, ar ? 'ar' : 'en')).join(' · ');
  const publicAge = profile.age ? (ar ? `العمر ${profile.age}` : `Age ${profile.age}`) : '';
  const { data: matchData } = useGetTasteMatch(profile.username, {
    query: { queryKey: getGetTasteMatchQueryKey(profile.username), enabled: session.status !== 'loading', refetchOnMount: 'always', refetchOnWindowFocus: true, staleTime: 0 },
    request: { credentials: 'include', cache: 'no-store' },
  });
  const score = matchData?.match?.score;

  return <section className="creator-profile">
    <div className="approved-profile-head">
      <Avatar profile={profile} />
      <div className="profile-head-copy">
        <div className="approved-name">
          <h1>{profile.displayName}</h1>
          {profile.verified && <button className="taste-seal" type="button" aria-label="Verified by TASTEKIN" aria-expanded={sealOpen} onClick={() => setSealOpen(!sealOpen)}><img src={TASTE_SEAL_IMAGE} alt="" /></button>}
        </div>
        <span className="profile-handle"><bdi dir="ltr">@{profile.username}</bdi></span>
        {profileLocation && <span className="profile-location"><MapPin size={13} />{profileLocation}</span>}
      </div>
    </div>
    {profile.bio && <p className="profile-bio">{profile.bio}</p>}
    {sealOpen && <div className="taste-seal-popover" role="dialog" aria-label="Taste Seal verification"><p>Verified by TASTEKIN — selected for authentic taste and identity.</p><button className="approved-icon" onClick={() => setSealOpen(false)} aria-label={ar ? 'إغلاق' : 'Close'}><X size={16} /></button></div>}

  {!ownerView ? (
    <Drawer.Root>
      <Drawer.Trigger asChild>
         <button className="approved-match">
            {score != null
              ? (ar ? `تطابق ذوق ${score}٪` : `${score}% Taste Match`)
              : matchData?.match?.state === 'incomplete'
                ? (ar ? 'أكمل ملف ذوقك' : 'Build your taste profile')
                : (ar ? 'سجّل الدخول لاكتشاف تطابق ذوقك' : 'Sign in to discover your Taste Match')}
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="approved-drawer-overlay" />
        <Drawer.Content className="approved-drawer-content">
          <div className="approved-drawer-handle" />
          <h2 className="approved-title" style={{ margin: '0 0 16px', fontSize: 22 }}>{ar ? 'لماذا يتطابق ذوقكما' : 'Why you match'}</h2>
          
          {score != null && (
            <div style={{ marginBottom: 20, textAlign: 'center' }}>
              <strong style={{ fontSize: 42, color: 'var(--tk-wine)' }}>{score}%</strong>
            </div>
          )}

          {matchData?.match?.explanation && (
            <p style={{ color: 'var(--tk-stone)', fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
              {ar ? matchData.match.explanationAr : matchData.match.explanation}
            </p>
          )}

          {matchData?.match?.sharedTastes && matchData.match.sharedTastes.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, marginBottom: 12, color: 'var(--tk-ink)' }}>{ar ? 'اهتمامات مشتركة' : 'Shared tastes'}</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {matchData.match.sharedTastes.map(taste => (
                  <div key={taste.id} className="approved-panel match" style={{ margin: 0 }}>
                    <strong>{ar ? taste.labelAr : taste.label}</strong>
                    <b><Check size={18} /></b>
                  </div>
                ))}
              </div>
            </div>
          )}

           <button className="approved-button wide" onClick={() => matchData?.match?.state === 'signed_out' ? window.location.assign('/api/login?returnTo=/') : onMatch()}>
             {matchData?.match?.state === 'signed_out'
               ? (ar ? 'تسجيل الدخول' : 'Sign in')
               : (ar ? 'ضبط ذوقك' : 'Tune my taste')}
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
   ) : (
     <button className="approved-match" data-testid="profile-tune-taste" onClick={onMatch}>
       {ar ? 'ضبط ذوقك' : 'Tune your taste'}
     </button>
   )}

    {(tasteSummary || publicAge) && <p className="profile-taste-meta">{[tasteSummary, publicAge].filter(Boolean).join(' · ')}</p>}
    {ownerView && !profile.verified && <button className="approved-button wide" type="button" onClick={onApplyVerification}><ShieldCheck size={17} /> {ar ? 'قدّم للحصول على ختم الذوق' : 'Apply for the Taste Seal'}</button>}
    <div className={`approved-actions ${ownerView ? 'profile-owner-actions' : 'profile-visitor-actions'}`}>{ownerView ? <><button className="approved-button primary" onClick={onEditProfile}>{ar ? 'تعديل الملف' : 'Edit profile'}</button><button className="approved-button profile-insights-button" type="button" onClick={onInsights}><BarChart3 size={18} />{ar ? 'الإحصاءات' : 'Insights'}</button><button className="profile-visitor-button" type="button" onClick={onViewAsVisitor} aria-label={ar ? 'عرض كزائر' : 'View as visitor'} title={ar ? 'عرض كزائر' : 'View as visitor'}><Eye size={19} /></button></> : <><button className="approved-button" onClick={onFollow} disabled={visitorPreview}>{following ? (ar ? 'تتابع' : 'Following') : (ar ? 'متابعة' : 'Follow')}</button>{profile.verified && <button className="approved-button primary" onClick={onSubscribe} disabled={visitorPreview}>{subscribed ? (ar ? 'مشترك' : 'Subscribed') : <Price ar={ar} />}</button>}{onMessage && <button className="profile-visitor-button" type="button" onClick={onMessage} disabled={visitorPreview} aria-label={ar ? 'مراسلة' : 'Message'} title={ar ? 'مراسلة' : 'Message'}><MessageCircle size={19} /></button>}</>}</div>
    {visitorPreview && <button className="approved-button wide visitor-exit" onClick={onExitVisitor}>{ar ? 'إنهاء معاينة الزائر' : 'Exit visitor preview'}</button>}
    {featuredCollections.length > 0 && <section className="profile-featured" aria-label={ar ? 'المجموعات المميزة' : 'Featured collections'}>
      <h2>{ar ? 'مجموعات مميزة' : 'Featured collections'}</h2>
      <div className="profile-featured-grid">
        {featuredCollections.map((collection) => {
          const cover = publishedEdits.find((edit) => edit.id === collection.coverEditId)?.image || media('quiet-tailoring.webp');
          return <button key={collection.id} className="profile-featured-card" data-testid={`featured-collection-${collection.id}`} onClick={() => onOpenCollection(collection)}>
            <img src={imageSrc(cover)} alt="" />
            <span>{ar ? collection.titleAr : collection.title}</span>
          </button>;
        })}
      </div>
    </section>}
    <div className="approved-tabs"><button className="active" onClick={() => setEditCategory('All')}>{ar ? 'التعديلات' : 'Edits'}</button><button onClick={onCollections}>{ar ? 'المجموعات' : 'Collections'}</button><button onClick={onAbout}>{ar ? 'حول' : 'About'}</button></div>
    {profileCategoryItems.length > 1 && <CategoryChips ar={ar} active={editCategory} onSelect={setEditCategory} items={profileCategoryItems} testIdPrefix="profile-category" ariaLabel={ar ? 'فلاتر تعديلات المبدع' : 'Creator edit categories'} className="profile-edit-filters" />}
    <div className="approved-grid profile-edits-grid" data-testid="profile-edits-grid" data-active-category={editCategory}>
      {profileFilteredEdits.map((edit) => {
        const caption = profileCaptionLine(edit, ar);
        const location = placeLocation(edit, ar);
        return <button className={`approved-grid-card ${edit.image ? 'photo-grid-card' : 'place-grid-card'}`} key={edit.id} onClick={() => onEdit(edit)}>
          {edit.image ? <>
            <span className="profile-grid-media">
              <img src={imageSrc(edit.image)} alt={edit.altText} />
              {edit.access === 'locked' && <span className="profile-grid-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}
            </span>
            {caption && <span className="profile-grid-caption">{caption}</span>}
          </> : <span className="place-grid-preview">
            <span className="place-grid-eyebrow">{displayCategory(edit.category, ar ? 'ar' : 'en')}</span>
            <strong>{edit.placeName || publicCaptionLine(edit, ar)}</strong>
            {location && <span className="place-grid-location"><MapPin size={14} />{location}</span>}
            <TasteRating rating={edit.tasteRating} ar={ar} />
            {edit.creatorReview && <p>{edit.creatorReview.split(/\r?\n/, 1)[0]}</p>}
          </span>}
        </button>;
      })}
      {!profileFilteredEdits.length && <div className="profile-edits-empty">{publishedEdits.length === 0 ? (ar ? 'لا توجد تعديلات منشورة بعد.' : 'No published Edits yet.') : (ar ? 'لا توجد تعديلات منشورة في هذه الفئة بعد.' : 'No published Edits in this category yet.')}</div>}
    </div>
  </section>;
}
function CreatorDashboard({ ar, displayName, edits, collections, busy, onNew, onEdit, onArchive, onUnarchive, onCollections }: { ar: boolean; displayName: string; edits: CreatorEdit[]; collections: CreatorCollection[]; busy: boolean; onNew: () => void; onEdit: (edit: CreatorEdit) => void; onArchive: (id: string) => void; onUnarchive: (id: string) => void; onCollections: () => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const groups: [EditStatus, string, string][] = [['draft', 'Drafts', 'مسودات'], ['published', 'Published', 'منشور'], ['archived', 'Archived', 'مؤرشف']];
  const internalLabel = (item: CreatorEdit) => {
    const title = (ar ? item.titleAr || item.title : item.title || item.titleAr || '').trim();
    const caption = (ar ? item.captionAr || item.caption : item.caption || item.captionAr || '').split(/\r?\n/, 1)[0].trim();
    return title || caption || t('Photo Edit', 'تعديل صورة');
  };
  const internalMeta = (item: CreatorEdit) => [item.access === 'locked' ? t('Subscribers only', 'للمشتركين فقط') : t('Public', 'عام'), placeLocation(item, ar)].filter(Boolean).join(' · ');
  return <section className="creator-workspace">
    <span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span>
    <div className="workspace-head"><div><h1 className="approved-title">{ar ? `مساء الخير، ${displayName}.` : `Good afternoon, ${displayName}.`}</h1><p>{t('Shape the next thing people save.', 'اصنع ما سيحفظه الناس لاحقاً.')}</p></div><button className="approved-button primary" onClick={onNew} disabled={busy}><Plus size={16} /> {t('New Edit', 'تعديل جديد')}</button></div>
    <div className="creator-stats"><Stat value={edits.filter((item) => item.status === 'published').length} label={t('Published', 'منشور')} /><Stat value={edits.filter((item) => item.status === 'draft').length} label={t('Drafts', 'مسودات')} /><Stat value={collections.length} label={t('Collections', 'مجموعات')} /></div>
    <button className="workspace-collection-link" onClick={onCollections} disabled={busy}><span><FileText size={17} /><strong>{t('Manage collections', 'إدارة المجموعات')}</strong></span><ChevronRight size={17} /></button>
    {groups.map(([status, en, arabic]) => <div className="workspace-section" key={status}><div className="workspace-section-head"><h2>{ar ? arabic : en}</h2><span>{edits.filter((item) => item.status === status).length}</span></div>{edits.filter((item) => item.status === status).map((item) => <div className="workspace-edit" key={item.id}>{item.image ? <img src={imageSrc(item.image)} alt={item.altText} /> : <div className="workspace-place-thumb"><MapPin size={17} /></div>}<div><strong>{internalLabel(item)}</strong><span>{internalMeta(item)}</span></div><div className="workspace-edit-actions">{status === 'archived' ? <button onClick={() => onUnarchive(item.id)} disabled={busy}>{t('Restore', 'استعادة')}</button> : <><button onClick={() => onEdit(item)} aria-label={t('Edit', 'تعديل')} disabled={busy}><Pencil size={15} /></button><button onClick={() => onArchive(item.id)} aria-label={t('Archive', 'أرشفة')} disabled={busy}><Archive size={15} /></button></>}</div></div>)}{!edits.some((item) => item.status === status) && <Empty text={t('Nothing here yet.', 'لا يوجد شيء هنا بعد.')} />}</div>)}
  </section>;
}
function Stat({ value, label }: { value: number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
type PreparedImage = { file: File; url: string; width: number; height: number };

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const canvasBlob = (canvas: HTMLCanvasElement, quality = .88) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare this image.')), 'image/jpeg', quality));
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('This browser could not decode this image. Try opening HEIC/HEIF photos in Safari, then select it again.')); image.src = url; });

async function prepareImage(file: File): Promise<PreparedImage> {
  const lowerName = file.name.toLowerCase();
  const declaredType = file.type || (lowerName.endsWith('.heic') ? 'image/heic' : lowerName.endsWith('.heif') ? 'image/heif' : '');
  if (!allowedImageTypes.has(declaredType)) throw new Error('Choose a JPG, PNG, HEIC, HEIF, or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image up to 15 MB.');
  const inputURL = URL.createObjectURL(file);
  try {
    const image = await loadImage(inputURL);
    const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 2560 / longEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, .9);
    const prepared = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'phone-photo'}.jpg`, { type: 'image/jpeg' });
    return { file: prepared, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(inputURL); }
}

const cropDimensions = (aspect: CropAspect) => aspect === 'square' ? { width: 1080, height: 1080 } : aspect === 'story' ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
const cropCoverScale = (sourceWidth: number, sourceHeight: number, aspect: CropAspect) => {
  const target = cropDimensions(aspect);
  return Math.max(target.width / sourceWidth, target.height / sourceHeight);
};
const clampCrop = (value: CropMetadata, sourceWidth: number, sourceHeight: number): CropMetadata => {
  const target = cropDimensions(value.aspect);
  const scale = Math.max(value.zoom, cropCoverScale(sourceWidth, sourceHeight, value.aspect));
  const quarterTurn = Math.abs(Math.round(value.rotation / 90)) % 2 === 1;
  const renderedWidth = (quarterTurn ? sourceHeight : sourceWidth) * scale;
  const renderedHeight = (quarterTurn ? sourceWidth : sourceHeight) * scale;
  const maxX = Math.max(0, ((renderedWidth - target.width) / 2) / target.width * 100);
  const maxY = Math.max(0, ((renderedHeight - target.height) / 2) / target.height * 100);
  return {
    ...value,
    zoom: scale,
    outputWidth: target.width,
    outputHeight: target.height,
    x: Math.max(-maxX, Math.min(maxX, value.x)),
    y: Math.max(-maxY, Math.min(maxY, value.y)),
  };
};

async function renderCrop(source: PreparedImage, crop: CropMetadata, longEdge = 1920) {
  const image = await loadImage(source.url);
  const target = cropDimensions(crop.aspect);
  const outputScale = Math.min(1, longEdge / Math.max(target.width, target.height));
  const width = Math.round(target.width * outputScale); const height = Math.round(target.height * outputScale);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const normalized = clampCrop(crop, image.naturalWidth, image.naturalHeight);
  const scale = normalized.zoom * outputScale;
  const context = canvas.getContext('2d')!;
  context.save(); context.translate(width / 2 + (normalized.x / 100) * width, height / 2 + (normalized.y / 100) * height); context.rotate((normalized.rotation * Math.PI) / 180); context.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale); context.restore();
  return canvas;
}

async function createCropRenditions(source: PreparedImage, crop: CropMetadata) {
  const canvas = await renderCrop(source, crop);
  const cropBlob = await canvasBlob(canvas, .9);
  const ratio = canvas.width / canvas.height;
  const preview = document.createElement('canvas'); const previewWidth = Math.min(640, canvas.width); const previewHeight = Math.round(previewWidth / ratio); preview.width = previewWidth; preview.height = previewHeight;
  const previewContext = preview.getContext('2d')!; previewContext.filter = 'blur(18px) saturate(.72)'; previewContext.drawImage(canvas, -10, -10, previewWidth + 20, previewHeight + 20); previewContext.filter = 'none';
  const previewBlob = await canvasBlob(preview, .7);
  return { crop: new File([cropBlob], 'tastekin-crop.jpg', { type: 'image/jpeg' }), preview: new File([previewBlob], 'tastekin-private-preview.jpg', { type: 'image/jpeg' }) };
}

function CropEditor({ ar, source, initialCrop, error, busy, onCancel, onConfirm }: { ar: boolean; source: PreparedImage; initialCrop?: CropMetadata; error: string; busy: boolean; onCancel: () => void; onConfirm: (crop: CropMetadata) => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const withDimensions = (value: CropMetadata) => clampCrop(value, source.width, source.height);
  const defaultCrop = (): CropMetadata => withDimensions({ aspect: 'portrait', zoom: cropCoverScale(source.width, source.height, 'portrait'), x: 0, y: 0, rotation: 0, sourceWidth: source.width, sourceHeight: source.height, outputWidth: 1080, outputHeight: 1350 });
  const [crop, setCrop] = useState<CropMetadata>(initialCrop ? withDimensions(initialCrop) : defaultCrop());
  const [previewUrl, setPreviewUrl] = useState('');
  const dragRef = useRef<{ x: number; y: number; cropX: number; cropY: number } | null>(null);
  useEffect(() => {
    let active = true; let url = '';
    void (async () => {
      const canvas = await renderCrop(source, crop, 720);
      const blob = await canvasBlob(canvas, .84);
      url = URL.createObjectURL(blob);
      if (active) setPreviewUrl(url); else URL.revokeObjectURL(url);
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [source, crop]);
  const aspect = cropAspectRatio(crop.aspect, crop);
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, cropX: crop.x, cropY: crop.y }; };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { const drag = dragRef.current; if (!drag) return; const bounds = event.currentTarget.getBoundingClientRect(); setCrop((value) => withDimensions({ ...value, x: drag.cropX + ((event.clientX - drag.x) / bounds.width) * 100, y: drag.cropY + ((event.clientY - drag.y) / bounds.height) * 100 })); };
  const reset = () => setCrop(defaultCrop());
  const formats = [{ id: 'portrait' as const, en: 'Post Portrait', ar: 'منشور عمودي', ratio: '4:5', pixels: '1080 × 1350' }, { id: 'square' as const, en: 'Post Square', ar: 'منشور مربع', ratio: '1:1', pixels: '1080 × 1080' }, { id: 'story' as const, en: 'Story / Reel', ar: 'قصة / ريلز', ratio: '9:16', pixels: '1080 × 1920' }];
  return <section className="crop-editor" aria-label={t('Crop image', 'اقتصاص الصورة')}><div className="composer-title"><div><span className="approved-kicker">{t('Image editor', 'محرر الصورة')}</span><h1 className="approved-title">{t('Frame your Edit', 'ضع تعديلك في الإطار')}</h1></div><button className="approved-icon" onClick={onCancel} aria-label={t('Cancel crop', 'إلغاء الاقتصاص')} disabled={busy}><X size={20} /></button></div><p className="crop-help">{t('Choose a format, drag to position, then zoom if needed.', 'اختر التنسيق واسحب للتموضع ثم كبّر عند الحاجة.')}</p><div className="crop-stage" style={{ aspectRatio: aspect }} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }}>{previewUrl && <img src={previewUrl} alt="" draggable={false} />}</div><div className="crop-aspects crop-aspects-three" aria-label={t('Crop format', 'تنسيق الاقتصاص')}>{formats.map((item) => <button key={item.id} className={crop.aspect === item.id ? 'selected' : ''} onClick={() => setCrop((value) => withDimensions({ ...value, aspect: item.id }))} disabled={busy}><strong>{ar ? item.ar : item.en}</strong><span dir="ltr">{item.ratio} · {item.pixels}</span></button>)}</div><div className="crop-slider"><span><ZoomOut size={16} /> {t('Zoom', 'تكبير')}</span><input aria-label={t('Zoom image', 'تكبير الصورة')} type="range" min={cropCoverScale(source.width, source.height, crop.aspect)} max={Math.max(cropCoverScale(source.width, source.height, crop.aspect) * 3, cropCoverScale(source.width, source.height, crop.aspect) + .01)} step=".01" value={crop.zoom} onChange={(event) => setCrop((value) => withDimensions({ ...value, zoom: Number(event.target.value) }))} disabled={busy} /><ZoomIn size={16} /></div><div className="crop-tool-row"><button onClick={reset} disabled={busy}>{t('Reset', 'إعادة ضبط')}</button></div>{error && <p className="workspace-notice" role="alert">{error}</p>}<div className="crop-actions"><button className="approved-button" onClick={onCancel} disabled={busy}>{t('Cancel', 'إلغاء')}</button><button className="approved-button primary" onClick={() => onConfirm(crop)} disabled={busy}>{busy ? t('Rendering…', 'جارٍ التجهيز…') : t('Done', 'تم')}</button></div></section>;
}

function ProfilePhotoCropper({ ar, source, onCancel, onConfirm }: { ar: boolean; source: PreparedImage; onCancel: () => void; onConfirm: (photo: PendingProfilePhoto) => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const initial = (): CropMetadata => clampCrop({ aspect: 'square', zoom: cropCoverScale(source.width, source.height, 'square'), x: 0, y: 0, rotation: 0, sourceWidth: source.width, sourceHeight: source.height, outputWidth: 1080, outputHeight: 1080 }, source.width, source.height);
  const [crop, setCrop] = useState<CropMetadata>(initial);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number; cropX: number; cropY: number } | null>(null);
  useEffect(() => {
    let active = true; let url = '';
    void (async () => {
      const canvas = await renderCrop(source, crop, 720);
      const blob = await canvasBlob(canvas, .86);
      url = URL.createObjectURL(blob);
      if (active) setPreviewUrl(url); else URL.revokeObjectURL(url);
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [source, crop]);
  const updateCrop = (next: CropMetadata) => setCrop(clampCrop(next, source.width, source.height));
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, cropX: crop.x, cropY: crop.y }; };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { const drag = dragRef.current; if (!drag) return; const bounds = event.currentTarget.getBoundingClientRect(); updateCrop({ ...crop, x: drag.cropX + ((event.clientX - drag.x) / bounds.width) * 100, y: drag.cropY + ((event.clientY - drag.y) / bounds.height) * 100 }); };
  const confirm = async () => {
    setBusy(true);
    try {
      const canvas = await renderCrop(source, crop, 1080);
      const blob = await canvasBlob(canvas, .9);
      onConfirm({ file: new File([blob], 'tastekin-profile-photo.jpg', { type: 'image/jpeg' }), url: URL.createObjectURL(blob) });
    } finally { setBusy(false); }
  };
  return <section className="profile-photo-crop" aria-label={t('Crop profile photo', 'اقتصاص صورة الملف')}><div className="composer-title"><div><span className="approved-kicker">{t('Profile photo', 'صورة الملف')}</span><h1 className="approved-title">{t('Frame your portrait', 'اضبط صورة ملفك')}</h1></div><button className="approved-icon" onClick={onCancel} aria-label={t('Cancel crop', 'إلغاء الاقتصاص')} disabled={busy}><X size={20} /></button></div><p className="crop-help">{t('Drag to position your photo, then zoom if needed.', 'اسحب لتحديد موضع الصورة ثم كبّر عند الحاجة.')}</p><div className="profile-crop-stage" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }}>{previewUrl && <img src={previewUrl} alt="" draggable={false} />}</div><div className="crop-slider"><span><ZoomOut size={16} /> {t('Zoom', 'تكبير')}</span><input aria-label={t('Zoom profile photo', 'تكبير صورة الملف')} type="range" min={cropCoverScale(source.width, source.height, 'square')} max={Math.max(cropCoverScale(source.width, source.height, 'square') * 3, cropCoverScale(source.width, source.height, 'square') + .01)} step=".01" value={crop.zoom} onChange={(event) => updateCrop({ ...crop, zoom: Number(event.target.value) })} disabled={busy} /><ZoomIn size={16} /></div><div className="crop-actions"><button className="approved-button" onClick={onCancel} disabled={busy}>{t('Cancel', 'إلغاء')}</button><button className="approved-button primary" onClick={() => void confirm()} disabled={busy}>{busy ? t('Preparing…', 'جارٍ التجهيز…') : t('Use photo', 'استخدم الصورة')}</button></div></section>;
}

type VerificationApplication = {
  statement: string;
  evidenceLinks: string[];
  status: 'pending' | 'approved' | 'rejected';
  reviewNote?: string | null;
};

function VerificationApplicationScreen({ ar, onDone }: { ar: boolean; onDone: () => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [statement, setStatement] = useState('');
  const [links, setLinks] = useState('');
  const [application, setApplication] = useState<VerificationApplication | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/verification-application', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ application: VerificationApplication | null }> : { application: null })
      .then(({ application: current }) => {
        if (!active) return;
        setApplication(current);
        setStatement(current?.statement || '');
        setLinks((current?.evidenceLinks || []).join('\n'));
        setState('idle');
      }).catch(() => { if (active) { setState('error'); setError(t('Could not load your application.', 'تعذر تحميل طلبك.')); } });
    return () => { active = false; };
  }, [ar]);
  const submit = async () => {
    setState('saving'); setError('');
    try {
      const evidenceLinks = links.split(/\s+/).map((item) => item.trim()).filter(Boolean);
      const response = await fetch('/api/verification-application', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement, evidenceLinks }),
      });
      const payload = await response.json().catch(() => null) as { application?: VerificationApplication; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || t('Could not submit your application.', 'تعذر إرسال طلبك.'));
      setApplication(payload?.application || null); setState('saved');
    } catch (cause) {
      setState('error'); setError(cause instanceof Error ? cause.message : t('Could not submit your application.', 'تعذر إرسال طلبك.'));
    }
  };
  const statusCopy = application?.status === 'pending'
    ? t('Your application is under review. You may update it while you wait.', 'طلبك قيد المراجعة. يمكنك تحديثه أثناء الانتظار.')
    : application?.status === 'rejected'
      ? t('Your previous application was not approved. Improve the details and submit again.', 'لم تتم الموافقة على طلبك السابق. حسّن التفاصيل وقدّم مرة أخرى.')
      : application?.status === 'approved'
        ? t('Your Taste Seal has been approved.', 'تمت الموافقة على ختم الذوق الخاص بك.')
        : '';
  return <SimpleScreen kicker={t('TASTEKIN verification', 'توثيق تيستكن')} title={t('Apply for the Taste Seal', 'قدّم للحصول على ختم الذوق')}>
    <p>{t('TASTEKIN reviews identity, originality, and the quality of a creator’s public profile. Verification is never automatic or purchased.', 'تراجع تيستكن الهوية والأصالة وجودة الملف العام للمبدع. التوثيق لا يُشترى ولا يتم تلقائياً.')}</p>
    {statusCopy && <div className="approved-panel"><strong>{statusCopy}</strong>{application?.reviewNote && <p>{application.reviewNote}</p>}</div>}
    <label className="form-field"><span>{t('Why should this profile be verified?', 'لماذا يستحق هذا الملف التوثيق؟')}</span><textarea value={statement} maxLength={1500} onChange={(event) => setStatement(event.target.value)} placeholder={t('Describe your identity, original taste, and the content you create (minimum 40 characters).', 'اشرح هويتك وذوقك الأصلي والمحتوى الذي تقدمه (40 حرفاً على الأقل).')} disabled={state === 'saving' || state === 'loading'} /></label>
    <label className="form-field"><span>{t('Evidence links (optional, one per line)', 'روابط إثبات اختيارية (رابط في كل سطر)')}</span><textarea value={links} onChange={(event) => setLinks(event.target.value)} placeholder="https://…" disabled={state === 'saving' || state === 'loading'} /></label>
    {error && <p className="workspace-notice" role="alert">{error}</p>}
    {state === 'saved' && <p className="profile-save-success" role="status">{t('Application submitted securely.', 'تم إرسال الطلب بأمان.')}</p>}
    <button className="approved-button primary wide" type="button" onClick={() => void submit()} disabled={state === 'saving' || state === 'loading' || statement.trim().length < 40}>{state === 'saving' ? t('Submitting…', 'جارٍ الإرسال…') : application ? t('Update application', 'تحديث الطلب') : t('Submit for review', 'إرسال للمراجعة')}</button>
    <button className="approved-button wide" type="button" onClick={onDone}>{t('Back to profile', 'العودة إلى الملف')}</button>
  </SimpleScreen>;
}

function ProfileEditor({ ar, form, photo, busy, error, saved, onChange, onPhotoPrepared, onCancelPhoto, onSave }: { ar: boolean; form: CreatorProfile; photo: PendingProfilePhoto | null; busy: boolean; error: string; saved: boolean; onChange: (profile: CreatorProfile) => void; onPhotoPrepared: (photo: PendingProfilePhoto) => void; onCancelPhoto: () => void; onSave: () => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [processing, setProcessing] = useState(false);
  const [imageError, setImageError] = useState('');
  const [source, setSource] = useState<PreparedImage | null>(null);
  const update = <K extends keyof CreatorProfile>(key: K, value: CreatorProfile[K]) => onChange({ ...form, [key]: value });
  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setProcessing(true); setImageError('');
    try { setSource(await prepareImage(file)); } catch (cause) { setImageError(cause instanceof Error ? cause.message : t('Could not prepare your photo.', 'تعذر تجهيز صورتك.')); event.target.value = ''; } finally { setProcessing(false); }
  };
  if (source) return <ProfilePhotoCropper ar={ar} source={source} onCancel={() => { URL.revokeObjectURL(source.url); setSource(null); }} onConfirm={(next) => { URL.revokeObjectURL(source.url); setSource(null); onPhotoPrepared(next); }} />;
  return <section className="profile-editor"><span className="approved-kicker">{t('Creator profile', 'ملف المبدع')}</span><h1 className="approved-title">{t('Edit profile', 'تعديل الملف')}</h1><p className="profile-editor-intro">{t('Shape the identity visitors see. Verification and audience numbers remain managed by TASTEKIN.', 'حدّد الهوية التي يراها الزوار. تبقى حالة التوثيق وأرقام الجمهور تحت إدارة تيستكن.')}</p><label className="profile-photo-picker"><Avatar profile={form} src={photo?.url || form.avatar} /><span><ImagePlus size={16} /> {processing ? t('Preparing…', 'جارٍ التجهيز…') : t('Change photo', 'تغيير الصورة')}</span><input aria-label={t('Change profile photo', 'تغيير صورة الملف')} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif" onChange={selectPhoto} disabled={processing || busy} /></label>{imageError && <p className="workspace-notice" role="alert">{imageError}</p>}<Field label={t('Display name', 'الاسم الظاهر')} value={form.displayName} onChange={(value) => update('displayName', value)} placeholder={t('Your name', 'اسمك')} /><Field label={t('Username', 'اسم المستخدم')} value={form.username} onChange={(value) => update('username', value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="yourname" /><Field label={t('Bio', 'النبذة')} value={form.bio} onChange={(value) => update('bio', value)} placeholder={t('A few words about your taste…', 'بضع كلمات عن ذوقك…')} multiline /><div className="form-two"><Field label={t('City', 'المدينة')} value={form.city} onChange={(value) => update('city', value)} placeholder={t('Your city', 'مدينتك')} /><Field label={t('Country', 'الدولة')} value={form.country} onChange={(value) => update('country', value)} placeholder={t('Your country', 'دولتك')} /></div><span className="form-label">{t('Taste categories', 'فئات الذوق')}</span><div className="profile-interests">{categories.filter((category) => category.id !== 'All').map((category) => <button key={category.id} type="button" className={form.interests.includes(category.id) ? 'selected' : ''} onClick={() => update('interests', form.interests.includes(category.id) ? form.interests.filter((id) => id !== category.id) : [...form.interests, category.id])} disabled={busy}>{form.interests.includes(category.id) && <Check size={13} />}{ar ? category.ar : category.en}</button>)}</div><div className="profile-privacy"><Field label={t('Date of birth', 'تاريخ الميلاد')} value={form.dateOfBirth || ''} onChange={(value) => update('dateOfBirth', value || null)} placeholder="YYYY-MM-DD" type="date" /><label className="age-toggle"><input type="checkbox" checked={form.showAge} onChange={(event) => update('showAge', event.target.checked)} disabled={busy} /><span><strong>{t('Show my age on my profile', 'أظهر عمري في ملفي')}</strong><small>{t('Your date of birth stays private.', 'يبقى تاريخ ميلادك خاصاً.')}</small></span></label></div>{error && <p className="workspace-notice" role="alert">{error}</p>}{saved && <p className="profile-save-success" role="status">{t('Profile saved. Your public profile is up to date.', 'تم حفظ الملف. ملفك العام محدّث الآن.')}</p>}<button className="approved-button primary wide" onClick={onSave} disabled={busy || processing}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save profile', 'حفظ الملف')}</button>{photo && <button className="profile-remove-photo" type="button" onClick={onCancelPhoto}>{t('Discard new photo', 'تجاهل الصورة الجديدة')}</button>}</section>;
}

function EditComposer({ ar, form, collections, busy, onChange, onCropPrepared, onBack, onDraft, onDraftComplete, onPreview, onPublish }: { ar: boolean; form: EditForm; collections: CreatorCollection[]; busy: boolean; onChange: (form: EditForm) => void; onCropPrepared: (crop: PendingCrop) => void; onBack: () => void; onDraft: () => Promise<boolean>; onDraftComplete: () => void; onPreview: () => void; onPublish: () => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [imageError, setImageError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [pendingImage, setPendingImage] = useState<PreparedImage | null>(null);
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const update = <K extends keyof EditForm>(key: K, value: EditForm[K]) => onChange({ ...form, [key]: value });
  const placeCategory = isPlaceCategory(form.category);
  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setProcessing(true); setImageError('');
    try { setPendingImage(await prepareImage(file)); } catch (error) { setImageError(error instanceof Error ? error.message : t('Could not prepare your image.', 'تعذر تجهيز صورتك.')); event.target.value = ''; } finally { setProcessing(false); }
  };
  const confirmCrop = async (crop: CropMetadata) => {
    if (!pendingImage) return;
    setProcessing(true); setImageError('');
    try {
      const renditions = await createCropRenditions(pendingImage, crop);
      const cropUrl = URL.createObjectURL(renditions.crop); const previewUrl = URL.createObjectURL(renditions.preview);
      onChange({ ...form, image: cropUrl, crop });
      onCropPrepared({ source: pendingImage.file, crop: renditions.crop, preview: renditions.preview, cropMetadata: crop, cropUrl, previewUrl });
      URL.revokeObjectURL(pendingImage.url); setPendingImage(null);
    } catch (error) { setImageError(error instanceof Error ? error.message : t('Could not apply your crop.', 'تعذر تطبيق الاقتصاص.')); } finally { setProcessing(false); }
  };
  const tryPublish = () => { const error = publishValidationMessage(form, ar); if (error) { setPublishError(error); return; } setPublishError(''); onPublish(); };
  const outfitItems = form.outfitItems || [];
  const updateOutfit = (index: number, key: keyof OutfitItem, value: string) => update('outfitItems', outfitItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const changeCategory = (value: Exclude<Category, 'All'>) => onChange(isPlaceCategory(value) ? { ...form, category: value } : { ...form, category: value, placeName: null, locationLabel: null, mapsUrl: null, tasteRating: null, creatorReview: null });
  const updatePlaceLocation = (value: string) => onChange({ ...form, locationLabel: value || null, location: value, locationAr: value });
  const saveDraft = async () => {
    if (processing || busy || draftState !== 'idle') return;
    setDraftState('saving');
    const saved = await onDraft();
    if (!saved) { setDraftState('idle'); return; }
    setDraftState('saved');
    window.setTimeout(onDraftComplete, 650);
  };
  if (pendingImage) return <CropEditor ar={ar} source={pendingImage} initialCrop={form.crop} error={imageError} busy={processing} onCancel={() => { URL.revokeObjectURL(pendingImage.url); setPendingImage(null); }} onConfirm={confirmCrop} />;
  return <section className="creator-composer">
    <span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span>
    <div className="composer-title"><h1 className="approved-title">{t('Create an Edit', 'أنشئ تعديلاً')}</h1><button className="approved-icon" onClick={onBack} aria-label={t('Close editor', 'إغلاق المحرر')} disabled={busy}><X size={20} /></button></div>
    {form.image ? <label className="image-uploader" style={{ aspectRatio: cropAspectRatio(form.crop?.aspect, form.crop) }}><img src={imageSrc(form.image)} alt={form.altText || ''} /><span><ImagePlus size={18} /> {processing ? t('Preparing…', 'جارٍ التجهيز…') : t('Edit crop', 'تعديل الاقتصاص')}</span><input aria-label={t('Change photo', 'تغيير الصورة')} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif" onChange={selectImage} disabled={processing || busy} /></label> : <label className="no-photo-uploader"><ImagePlus size={22} /><span><strong>{processing ? t('Preparing…', 'جارٍ التجهيز…') : t('Add a photo', 'أضف صورة')}</strong><small>{placeCategory ? t('Optional for this place recommendation', 'اختيارية لتوصية المكان هذه') : t('Required to publish this Edit', 'مطلوبة لنشر هذا التعديل')}</small></span><input aria-label={t('Add photo', 'أضف صورة')} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif" onChange={selectImage} disabled={processing || busy} /></label>}
    {imageError && <p className="workspace-notice" role="alert">{imageError}</p>}
    <Field label={t('Caption (optional)', 'الوصف (اختياري)')} value={form.caption} onChange={(value) => onChange({ ...form, caption: value, captionAr: value })} multiline placeholder={t('Share a thought, in any language…', 'شارك فكرة بأي لغة…')} />
    <span className="form-label">{t('Visibility', 'الوصول')}</span><div className="access-toggle"><button className={form.access === 'public' ? 'selected' : ''} onClick={() => update('access', 'public')} disabled={busy}><Eye size={16} />{t('Public', 'عام')}</button><button className={form.access === 'locked' ? 'selected' : ''} onClick={() => update('access', 'locked')} disabled={busy}><LockKeyhole size={16} />{t('Subscribers Only', 'للمشتركين فقط')}</button></div>
    <details className="composer-details" open={placeCategory}><summary>{t('Add details', 'أضف تفاصيل')}</summary><div className="details-body">
      <div className={`form-two ${placeCategory ? 'place-category-row' : ''}`}><SelectField label={t('Category', 'الفئة')} value={form.category} onChange={(value) => changeCategory(value as Exclude<Category, 'All'>)} options={categories.filter((item) => item.id !== 'All').map((item) => ({ value: item.id, label: ar ? item.ar : item.en }))} />{!placeCategory && <Field label={t('Location', 'الموقع')} value={ar ? form.locationAr : form.location} onChange={(value) => update(ar ? 'locationAr' : 'location', value)} placeholder="Kuwait City" />}</div>
      {placeCategory && <div className="place-authoring" data-testid="place-edit-fields"><h2>{t('Place recommendation', 'توصية مكان')}</h2><p>{t('A photo is optional. A no-photo recommendation needs a place name, readable location, and a rating or review.', 'الصورة اختيارية. التوصية بلا صورة تحتاج اسم المكان والموقع وتقييماً أو مراجعة.')}</p><Field label={t('Place name', 'اسم المكان')} value={form.placeName || ''} onChange={(value) => update('placeName', value || null)} placeholder={t('e.g. The Lighthouse', 'مثال: ذا لايتهاوس')} /><Field label={t('Readable location', 'الموقع المقروء')} value={form.locationLabel || ''} onChange={updatePlaceLocation} placeholder={t('Kuwait City, Kuwait', 'مدينة الكويت، الكويت')} /><Field label={t('Google Maps or Apple Maps link (optional)', 'رابط خرائط Google أو Apple (اختياري)')} value={form.mapsUrl || ''} onChange={(value) => update('mapsUrl', value || null)} placeholder="https://maps.apple.com/…" /><span className="form-label">{t('Taste Rating (optional)', 'تقييم الذوق (اختياري)')}</span><div className="taste-rating-input" aria-label={t('Taste Rating', 'تقييم الذوق')}>{[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} className={rating <= (form.tasteRating || 0) ? 'selected' : ''} onClick={() => update('tasteRating', form.tasteRating === rating ? null : rating)} aria-label={ar ? `${rating} من 5` : `${rating} out of 5`} aria-pressed={form.tasteRating === rating}><Link2 size={18} /></button>)}</div><Field label={t('Your review (optional)', 'مراجعتك الشخصية (اختيارية)')} value={form.creatorReview || ''} onChange={(value) => update('creatorReview', value || null)} multiline placeholder={t('What made it worth returning to?', 'ما الذي جعله يستحق العودة؟')} /></div>}
      <span className="form-label">{t('Collection', 'المجموعة')}</span><div className="collection-checks">{collections.map((collection) => <button key={collection.id} className={form.collectionIds.includes(collection.id) ? 'selected' : ''} onClick={() => update('collectionIds', form.collectionIds.includes(collection.id) ? form.collectionIds.filter((id) => id !== collection.id) : [...form.collectionIds, collection.id])} disabled={busy}>{form.collectionIds.includes(collection.id) && <Check size={14} />}{ar ? collection.titleAr : collection.title}</button>)}</div>
      <details className="nested-details"><summary>{t('Add outfit or product details', 'أضف تفاصيل الإطلالة أو المنتج')}</summary><div className="details-body"><label className="outfit-switch"><input type="checkbox" checked={Boolean(form.showOutfitDetails)} onChange={(event) => update('showOutfitDetails', event.target.checked)} /> {t('Show outfit details under this Edit', 'اعرض تفاصيل الإطلالة أسفل هذا التعديل')}</label>{outfitItems.map((item, index) => <div className="outfit-row" key={index}><input value={item.type} onChange={(event) => updateOutfit(index, 'type', event.target.value)} placeholder={t('Item type', 'نوع القطعة')} /><input value={item.brand} onChange={(event) => updateOutfit(index, 'brand', event.target.value)} placeholder={t('Brand or store', 'العلامة أو المتجر')} /><input value={item.name} onChange={(event) => updateOutfit(index, 'name', event.target.value)} placeholder={t('Product name', 'اسم المنتج')} /><input value={item.link} onChange={(event) => updateOutfit(index, 'link', event.target.value)} placeholder={t('Product link', 'رابط المنتج')} /></div>)}<button className="approved-button" type="button" onClick={() => update('outfitItems', [...outfitItems, { type: '', brand: '', name: '', link: '' }])}>{t('Add another item', 'أضف قطعة أخرى')}</button></div></details>
    </div></details>
    <details className="composer-details"><summary>{t('Accessibility & advanced', 'إمكانية الوصول والمتقدم')}</summary><div className="details-body"><Field label={t('Alt text', 'النص البديل')} value={form.altText} onChange={(value) => update('altText', value)} placeholder={t('Describe the image for everyone.', 'صف الصورة للجميع.')} /></div></details>
    {publishError && <p className="workspace-notice" role="alert">{publishError}</p>}
    <div className="composer-actions"><button className={`approved-button ${draftState !== 'idle' ? 'primary' : ''}`} onClick={() => { void saveDraft(); }} disabled={processing || busy || draftState !== 'idle'}>{draftState === 'saving' ? t('Saving…', 'جارٍ الحفظ…') : draftState === 'saved' ? t('Draft saved ✓', 'تم حفظ المسودة ✓') : t('Save draft', 'حفظ كمسودة')}</button><button className="approved-button" onClick={onPreview} disabled={processing || busy || draftState !== 'idle'}>{t('Preview', 'معاينة')}</button><button className="approved-button primary" onClick={tryPublish} disabled={processing || busy || draftState !== 'idle'}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Publish', 'نشر')}</button></div>
  </section>;
}
function Field({ label, value, onChange, placeholder, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean; type?: string }) { return <label className="form-field"><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function CreatorPreview({ ar, busy, edit, onBack, onPublish }: { ar: boolean; busy: boolean; edit: CreatorEdit; onBack: () => void; onPublish: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const [publishError, setPublishError] = useState(''); const tryPublish = () => { const error = publishValidationMessage(edit, ar); if (error) { setPublishError(error); return; } setPublishError(''); onPublish(); }; return <SimpleScreen kicker={t('Consumer preview', 'معاينة للمستهلك')} title={t('This is how it will appear.', 'هكذا سيظهر.') }><p>{edit.image ? t('Your wording, access label, and image appear exactly as they will in the consumer feed.', 'ستظهر كتابتك وعلامة الوصول والصورة كما ستظهر في تغذية المستهلك.') : t('Your place recommendation appears as an intentional no-photo card.', 'ستظهر توصية المكان كبطاقة مقصودة بلا صورة.')}</p><EditCard edit={edit} ar={ar} saved={false} onSave={() => undefined} onOpen={() => undefined} />{publishError && <p className="workspace-notice" role="alert">{publishError}</p>}<div className="composer-actions"><button className="approved-button" onClick={onBack} disabled={busy}>{t('Keep editing', 'متابعة التعديل')}</button><button className="approved-button primary" onClick={tryPublish} disabled={busy}>{t('Publish Edit', 'نشر التعديل')}</button></div></SimpleScreen>; }
function CollectionManager({ ar, collections, published, form, editing, featuredCollectionIds, onChange, onEdit, onNew, onSave, onToggleFeatured, onMoveFeatured }: { ar: boolean; collections: CreatorCollection[]; published: CreatorEdit[]; form: CollectionForm; editing: string | null; featuredCollectionIds: string[]; onChange: (form: CollectionForm) => void; onEdit: (item?: CreatorCollection) => void; onNew: () => void; onSave: () => void; onToggleFeatured: (id: string) => void; onMoveFeatured: (id: string, direction: 'up' | 'down') => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const update = <K extends keyof CollectionForm>(key: K, value: CollectionForm[K]) => onChange({ ...form, [key]: value });
  return <section className="creator-composer">
    <span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span>
    <div className="workspace-head"><div><h1 className="approved-title">{t('Collections', 'المجموعات')}</h1><p>{t('Group recommendations into a complete taste world.', 'اجمع التوصيات في عالم ذوق متكامل.')}</p></div><button className="approved-button" onClick={onNew}><Plus size={15} /> {t('New', 'جديد')}</button></div>
    <div className="manager-list">
      {collections.map((item) => {
        const featuredIndex = featuredCollectionIds.indexOf(item.id);
        const isFeatured = featuredIndex >= 0;
        const featureLimitReached = !isFeatured && featuredCollectionIds.length >= 3;
        return <div className="manager-collection-row" key={item.id}>
          <button className="workspace-collection-link" onClick={() => onEdit(item)}><span><img src={imageSrc(published.find((edit) => edit.id === item.coverEditId)?.image || media('quiet-tailoring.webp'))} alt="" /><strong>{ar ? item.titleAr : item.title}</strong></span><Pencil size={16} /></button>
          <div className="manager-feature-actions">
            <button type="button" className={isFeatured ? 'selected' : ''} onClick={() => onToggleFeatured(item.id)} disabled={featureLimitReached}>{isFeatured ? t('Unfeature', 'إلغاء التمييز') : t('Feature', 'تمييز')}</button>
            {isFeatured && <div className="manager-feature-order">
              <button type="button" onClick={() => onMoveFeatured(item.id, 'up')} disabled={featuredIndex === 0} aria-label={t('Move featured collection earlier', 'نقل المجموعة المميزة للأعلى')}>↑</button>
              <button type="button" onClick={() => onMoveFeatured(item.id, 'down')} disabled={featuredIndex === featuredCollectionIds.length - 1} aria-label={t('Move featured collection later', 'نقل المجموعة المميزة للأسفل')}>↓</button>
            </div>}
          </div>
        </div>;
      })}
    </div>
    <div className="manager-form"><h2>{editing ? t('Edit collection', 'تعديل المجموعة') : t('New collection', 'مجموعة جديدة')}</h2><Field label={t('Title', 'العنوان')} value={form.title} onChange={(value) => update('title', value)} placeholder="Collection title" /><Field label={t('Arabic title', 'العنوان بالعربية')} value={form.titleAr} onChange={(value) => update('titleAr', value)} placeholder="عنوان المجموعة" /><Field label={t('Description', 'الوصف')} value={form.description} onChange={(value) => update('description', value)} multiline placeholder="What holds it together?" /><Field label={t('Arabic description', 'الوصف بالعربية')} value={form.descriptionAr} onChange={(value) => update('descriptionAr', value)} multiline placeholder="ما الذي يجمعها؟" /><SelectField label={t('Cover Edit', 'تعديل الغلاف')} value={form.coverEditId} onChange={(value) => update('coverEditId', value)} options={published.map((item) => ({ value: item.id, label: ar ? item.titleAr : item.title }))} /><span className="form-label">{t('Visibility', 'الوصول')}</span><div className="access-toggle"><button className={form.access === 'public' ? 'selected' : ''} onClick={() => update('access', 'public')}>{t('Public', 'عام')}</button><button className={form.access === 'locked' ? 'selected' : ''} onClick={() => update('access', 'locked')}>{t('Subscribers Only', 'للمشتركين فقط')}</button></div><span className="form-label">{t('Included published Edits', 'التعديلات المنشورة المضمنة')}</span><div className="collection-checks">{published.map((item) => <button key={item.id} className={form.editIds.includes(item.id) ? 'selected' : ''} onClick={() => update('editIds', form.editIds.includes(item.id) ? form.editIds.filter((id) => id !== item.id) : [...form.editIds, item.id])}>{form.editIds.includes(item.id) && <Check size={14} />}{ar ? item.titleAr : item.title}</button>)}</div><button className="approved-button primary wide" onClick={onSave}>{editing ? t('Save changes', 'حفظ التغييرات') : t('Create collection', 'إنشاء المجموعة')}</button></div>
  </section>;
}
function CollectionDetail({ ar, collection, edits, canView, onOpen, onSubscribe }: { ar: boolean; collection: CreatorCollection; edits: CreatorEdit[]; canView: boolean; onOpen: (edit: CreatorEdit) => void; onSubscribe: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; if (!canView && collection.access === 'locked') return <SimpleScreen kicker={t('Subscribers only', 'للمشتركين فقط')} title={ar ? collection.titleAr : collection.title}><div className="approved-panel collection-gate"><LockKeyhole size={25} /><h3>{t('A private creator collection.', 'مجموعة خاصة من المبدع.')}</h3><p>{t('Subscribe to unlock the complete collection and its field notes.', 'اشترك لفتح المجموعة الكاملة وملاحظاتها.')}</p><button className="approved-button primary wide" onClick={onSubscribe}><Price ar={ar} /></button></div></SimpleScreen>; return <SimpleScreen kicker={ar ? 'مجموعة' : 'Collection'} title={ar ? collection.titleAr : collection.title}><img className="approved-collection-hero" src={imageSrc(edits[0]?.image || media('quiet-tailoring.webp'))} alt="" /><p>{ar ? collection.descriptionAr : collection.description}</p><h3 className="approved-kicker">{ar ? 'التعديلات المضمنة' : 'Included edits'}</h3><div className="approved-list">{edits.map((item) => { const caption = publicCaptionLine(item, ar); return <button key={item.id} onClick={() => onOpen(item)}><span>{caption}</span><ChevronRight size={17} /></button>; })}</div></SimpleScreen>; }
