import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useGetTasteCatalog, useGetTastePreferences, useSaveTastePreferences, useGetTasteMatch, useExplore, getExploreQueryKey, getGetTastePreferencesQueryKey } from '@workspace/api-client-react';
import { Drawer } from 'vaul';
import { tasteCategoryLabel } from '@workspace/taste-catalog';
import {
  Archive, ArrowLeft, Bookmark, Check, ChevronRight, CircleUserRound, Eye, FileText,
  Home, ImagePlus, Link2, LockKeyhole, MapPin, Pencil, Plus, PlusCircle, Search, Settings2,
  ShieldCheck, Upload, UserRound, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import tasteSealImage from '@assets/B19A2529-07AA-4327-B95B-1A45527C3EA2_1787320127362.png';
import './approved.css';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TastekinApp />
    </QueryClientProvider>
  );
}

type Language = 'en' | 'ar';
type Role = 'owner' | 'consumer';
type Screen = 'home' | 'explore' | 'add' | 'saved' | 'you' | 'profile' | 'profileEdit' | 'collections' | 'collection' | 'about' | 'match' | 'edit' | 'subscribe' | 'composer' | 'creatorPreview' | 'collectionManager' | 'tune-taste';

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
};
type CreatorCollection = { id: string; title: string; titleAr: string; description: string; descriptionAr: string; access: Access; coverEditId: string; editIds: string[] };
type EditForm = Omit<CreatorEdit, 'id' | 'status'>;
type CollectionForm = Omit<CreatorCollection, 'id'>;

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

function useTasteSession() {
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'signed-out'>('loading');
  useEffect(() => {
    let active = true;
    void fetch('/api/me')
      .then(async (response) => response.ok ? response.json() as Promise<{ user: { id: string } | null }> : { user: null })
      .then((session) => { if (active) setStatus(session.user ? 'authenticated' : 'signed-out'); })
      .catch(() => { if (active) setStatus('signed-out'); });
    return () => { active = false; };
  }, []);
  return status;
}

function TastekinApp() {
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : read('interface-language', 'en'));
  const [role, setRole] = useState<Role>(() => read('demo-role', 'owner'));
  const [screen, setScreen] = useState<Screen>('home');
  const [exploreCategory, setExploreCategory] = useState<Category>('All');
  const [homeFeedTab, setHomeFeedTab] = useState<HomeFeedTab>('for-you');
  const [saved, setSaved] = useState<string[]>(() => read('saved-edits', []));
  const [following, setFollowing] = useState(() => read('following-fheed', false));
  const [subscribed, setSubscribed] = useState(() => read('subscribed-fheed', false));
  const [menuOpen, setMenuOpen] = useState(false);
  const [visitorPreview, setVisitorPreview] = useState(false);
  const [creatorEdits, setCreatorEdits] = useState<CreatorEdit[]>(seedEdits);
  const [creatorCollections, setCreatorCollections] = useState<CreatorCollection[]>(seedCollections);
  const [workspaceRevision, setWorkspaceRevision] = useState(1);
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'ready' | 'syncing' | 'error'>('loading');
  const [workspaceError, setWorkspaceError] = useState('');
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile>(defaultCreatorProfile);
  const [profileForm, setProfileForm] = useState<CreatorProfile>(defaultCreatorProfile);
  const [pendingProfilePhoto, setPendingProfilePhoto] = useState<PendingProfilePhoto | null>(null);
  const [profileSaveState, setProfileSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [profileError, setProfileError] = useState('');
  const [selectedEditId, setSelectedEditId] = useState('quiet-tailoring');
  const [selectedCollectionId, setSelectedCollectionId] = useState('quiet-luxury');
  const [selectedCreatorUsername, setSelectedCreatorUsername] = useState('fheed');
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
      const response = await fetch('/api/creator-workspace');
      if (!response.ok) throw new Error('Could not load the shared creator workspace.');
      const workspace = await response.json() as { edits: CreatorEdit[]; collections: CreatorCollection[]; revision: number };
      setCreatorEdits(workspace.edits); setCreatorCollections(workspace.collections); setWorkspaceRevision(workspace.revision); setWorkspaceState('ready');
    } catch {
      setWorkspaceState('error'); setWorkspaceError('Your shared creator workspace could not be loaded. Check your connection and try again.');
    }
  };
  useEffect(() => { void loadWorkspace(); }, []);
  const loadProfile = async () => {
    try {
      const response = await fetch('/api/creator-profile');
      if (!response.ok) return;
      const profile = await response.json() as CreatorProfile;
      setCreatorProfile(profile);
    } catch {
      // Discovery remains usable while a profile refresh is temporarily unavailable.
    }
  };
  useEffect(() => { void loadProfile(); }, []);
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
      setWorkspaceState('error'); setWorkspaceError(error instanceof Error && error.message === 'auth' ? 'Sign in to save changes to Fheed’s shared creator workspace.' : error instanceof Error && error.message === 'conflict' ? 'This workspace changed on another device. Reload the shared workspace before saving again.' : 'Your latest creator change has not been saved to the shared workspace. Try again before leaving this screen.');
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
    if (request.status === 403) throw new Error('Only the verified creator can save media in this workspace.');
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
  const ar = language === 'ar'; const owner = role === 'owner'; const t = (en: string, arabic: string) => ar ? arabic : en;
  useEffect(() => {
    document.documentElement.dir = ar ? 'rtl' : 'ltr';
    document.documentElement.lang = ar ? 'ar' : 'en';
  }, [ar]);
  const published = creatorEdits.filter((item) => item.status === 'published');
  const viewedCreatorProfile = selectedCreatorUsername === 'fheed'
    ? creatorProfile
    : discoveryCreatorProfiles[selectedCreatorUsername] ?? creatorProfile;
  const viewedCreatorEdits = selectedCreatorUsername === 'fheed' ? published : [];
  const exploreEdits = useMemo(() => (exploreCategory === 'All' ? published : published.filter((item) => item.category === exploreCategory)), [exploreCategory, published]);
  const homeFeed = useMemo(() => {
    if (homeFeedTab === 'following') return following ? published : [];
    if (homeFeedTab === 'subscribed') return subscribed ? published : [];
    return published;
  }, [following, homeFeedTab, published, subscribed]);
  const selectedEdit = creatorEdits.find((item) => item.id === selectedEditId) || published[0] || seedEdits[0];
  const selectedCollection = creatorCollections.find((item) => item.id === selectedCollectionId) || creatorCollections[0] || seedCollections[0];
  const go = (next: Screen) => {
    if (workspaceState === 'syncing') return;
    const leavingCreatorFlow = (screen === 'composer' || screen === 'creatorPreview') && next !== 'composer' && next !== 'creatorPreview';
    if (leavingCreatorFlow && pendingMediaPaths.length) { pendingMediaIsDiscardable.current = false; void cleanupCreatorMedia(pendingMediaPaths); setPendingMediaPaths([]); }
    if (leavingCreatorFlow) discardPendingCrop();
    if (next !== 'profile' && next !== 'profileEdit') setVisitorPreview(false);
    setScreen(next); setMenuOpen(false);
  };
  const toggleSaved = (id: string) => { const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id]; setSaved(next); write('saved-edits', next); };
  const openEdit = (item: CreatorEdit) => { setSelectedEditId(item.id); go('edit'); };
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
      const current = saved.avatar === '/api/public-profile-media' ? { ...saved, avatar: `${saved.avatar}?v=${Date.now()}` } : saved;
      pendingMediaIsDiscardable.current = false; setPendingMediaPaths([]);
      setCreatorProfile(current); setProfileForm(current); setWorkspaceRevision(saved.revision); discardPendingProfilePhoto();
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
    const id = editingId || `edit-${Date.now()}`;
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
  const goBack = () => { if (screen === 'composer' || screen === 'creatorPreview') { abandonComposer(); return; } go(screen === 'edit' || screen === 'profileEdit' ? 'profile' : screen === 'collection' ? 'collections' : screen === 'collectionManager' ? 'add' : 'home'); };
  const nav = [{ id: 'home' as const, icon: Home, en: 'Home', ar: 'الرئيسية' }, { id: 'explore' as const, icon: Search, en: 'Explore', ar: 'اكتشف' }, { id: 'add' as const, icon: PlusCircle, en: 'Add', ar: 'إضافة' }, { id: 'saved' as const, icon: Bookmark, en: 'Saved', ar: 'المحفوظات' }, { id: 'you' as const, icon: UserRound, en: 'You', ar: 'أنت' }];
  return <div className="approved-app" dir={ar ? 'rtl' : 'ltr'}><main className="approved-shell">
    <header className="approved-topbar">{!['home', 'you', 'add'].includes(screen) ? <button className="approved-icon" onClick={goBack} aria-label={t('Back', 'رجوع')}><ArrowLeft size={21} /></button> : <span className="approved-spacer" />}<img src="/tastekin-logo.svg" className="approved-logo" alt="TASTEKIN" /><button className="approved-icon" onClick={() => setMenuOpen(true)} aria-label={t('Open menu', 'فتح القائمة')}><Settings2 size={19} /></button></header>
    {workspaceState === 'loading' && <div className="workspace-sync">{t('Loading your shared creator workspace…', 'جارٍ تحميل مساحة المبدع المشتركة…')}</div>}
    {workspaceState === 'syncing' && <div className="workspace-sync">{t('Saving your creator changes across devices…', 'جارٍ حفظ تغييرات المبدع على جميع الأجهزة…')}</div>}
    {workspaceState === 'error' && <div className="workspace-notice" role="alert">{workspaceError}<button onClick={() => workspaceError.startsWith('Sign in') ? window.location.assign('/api/login?returnTo=/') : void loadWorkspace()}>{workspaceError.startsWith('Sign in') ? t('Sign in', 'تسجيل الدخول') : t('Try again', 'حاول مجددًا')}</button></div>}
    {screen === 'home' && <><section className="approved-hero"><span className="approved-kicker">{t('Taste-led discovery', 'اكتشاف مبني على الذوق')}</span><h1>{t('Follow the taste, not the numbers.', 'اتبع الذوق، لا الأرقام.')}</h1><p>{t('A considered feed of people, places, and daily routines shaped by what you actually like.', 'تغذية منتقاة من الأشخاص وأماكنهم وروتينهم اليومي، تتشكل بحسب ما تحبه فعلاً.')}</p></section><HomeFeedTabs ar={ar} active={homeFeedTab} onSelect={setHomeFeedTab} /><div className="approved-feed">{homeFeed.map((item) => <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}{homeFeedTab !== 'for-you' && !homeFeed.length && <FeedEmpty ar={ar} tab={homeFeedTab} onExplore={() => go('explore')} />}</div></>}
    {screen === 'explore' && <ExploreScreen ar={ar} category={exploreCategory} setCategory={setExploreCategory} saved={saved} toggleSaved={toggleSaved} edits={exploreEdits.slice(0, 4)} onOpenProfile={(username) => { setSelectedCreatorUsername(username); go('profile'); }} onOpenEdit={openEdit} />}
    {screen === 'tune-taste' && <TuneTasteScreen ar={ar} onBack={() => go('you')} />}
    {screen === 'add' && (owner ? <CreatorDashboard ar={ar} edits={creatorEdits} collections={creatorCollections} busy={workspaceState !== 'ready'} onNew={() => openComposer()} onEdit={openComposer} onArchive={archiveEdit} onUnarchive={unarchiveEdit} onCollections={() => openCollectionManager()} /> : <SimpleScreen kicker={t('Creator tools', 'أدوات المبدع')} title={t('Creator workspace', 'مساحة المبدع')}><p>{t('Publishing belongs to a verified creator profile. Switch to Fheed owner preview to create and manage edits.', 'النشر متاح لملف المبدع الموثق. انتقل إلى وضع مالك فهيد لإنشاء وإدارة التعديلات.')}</p><div className="approved-panel"><h3>{t('Visitor preview', 'معاينة الزائر')}</h3><p>{t('You can still follow, save, and subscribe to the demo creator experience.', 'ما زال بإمكانك المتابعة والحفظ والاشتراك في تجربة المبدع.')}</p></div></SimpleScreen>)}
    {screen === 'composer' && <EditComposer ar={ar} form={editForm} collections={creatorCollections} busy={workspaceState === 'syncing'} onChange={setEditForm} onCropPrepared={(crop) => { discardPendingCrop(); setPendingCrop(crop); }} onBack={abandonComposer} onDraft={() => { void commitEdit('draft').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} onPreview={() => { const preview = { id: editingId || 'preview', ...editForm, status: 'draft' } as CreatorEdit; setSelectedEditId(preview.id); go('creatorPreview'); }} onPublish={() => { void commitEdit('published').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} />}
    {screen === 'creatorPreview' && <CreatorPreview ar={ar} busy={workspaceState === 'syncing'} edit={{ id: editingId || 'preview', ...editForm, status: 'draft' } as CreatorEdit} onBack={() => go('composer')} onPublish={() => { void commitEdit('published').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} />}
    {screen === 'collectionManager' && <CollectionManager ar={ar} collections={creatorCollections} published={published} form={collectionForm} editing={editingCollectionId} onChange={setCollectionForm} onEdit={openCollectionManager} onNew={() => openCollectionManager()} onSave={() => { saveCollection(); openCollectionManager(); }} />}
    {screen === 'saved' && <SimpleScreen kicker={t('Your library', 'مكتبتك')} title={t('Saved', 'المحفوظات')}><p>{t('Return to ideas when the moment is right.', 'عد إلى الأفكار عندما يحين وقتها.')}</p><div className="approved-feed">{published.filter((item) => saved.includes(item.id)).map((item) => <EditCard key={item.id} edit={item} ar={ar} saved onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}{!saved.length && <Empty text={t('Nothing saved yet. Explore Fheed’s edits and keep what speaks to you.', 'لا توجد محفوظات بعد. اكتشف تعديلات فهيد واحفظ ما يناسب ذوقك.')} />}</div></SimpleScreen>}
    {screen === 'you' && <SimpleScreen kicker={owner ? t('Creator owner mode', 'وضع مالك الحساب') : t('Your account', 'حسابك')} title={owner ? t('Your profile', 'ملفك الشخصي') : t('Alex Morgan', 'أليكس مورغان')}><div className="approved-panel identity"><Avatar profile={creatorProfile} /><div><strong>{owner ? creatorProfile.displayName : t('Alex Morgan', 'أليكس مورغان')}</strong><span>{owner ? `${creatorProfile.city}, ${creatorProfile.country}` : '@alexmorgan'}</span></div></div><div className="approved-panel"><h3>{t('Taste profile', 'ملف الذوق')}</h3><p>{creatorProfile.interests.map((interest) => displayCategory(interest, ar ? 'ar' : 'en')).join(' · ')}</p></div><button className="approved-button wide" style={{ marginBottom: 12 }} onClick={() => go('tune-taste')}>{t('Tune your taste', 'ضبط ذوقك')}</button>{owner && <button className="approved-button wide" onClick={() => go('profile')}>{t('View profile', 'عرض الملف')}</button>}</SimpleScreen>}
      {screen === 'profile' && <Profile ar={ar} owner={owner && selectedCreatorUsername === 'fheed'} visitorPreview={visitorPreview} following={following} subscribed={subscribed} profile={viewedCreatorProfile} edits={viewedCreatorEdits} onViewAsVisitor={() => setVisitorPreview(true)} onExitVisitor={() => setVisitorPreview(false)} onFollow={() => { if (!owner) { setFollowing(!following); write('following-fheed', !following); } }} onSubscribe={() => { if (!owner) go('subscribe'); }} onEditProfile={openProfileEditor} onEdit={openEdit} onCollections={() => { if (selectedCreatorUsername === 'fheed') go('collections'); }} onAbout={() => go('about')} onMatch={() => go('tune-taste')} />}
     {screen === 'profileEdit' && <ProfileEditor ar={ar} form={profileForm} photo={pendingProfilePhoto} busy={profileSaveState === 'saving'} error={profileError} saved={profileSaveState === 'saved'} onChange={setProfileForm} onPhotoPrepared={(photo) => { discardPendingProfilePhoto(); setPendingProfilePhoto(photo); setProfileSaveState('idle'); }} onCancelPhoto={discardPendingProfilePhoto} onSave={() => void saveProfile()} />}
    {screen === 'collections' && <SimpleScreen kicker={t('Fheed Alaiban', 'فهيد العيبان')} title={t('Collections', 'المجموعات')}><p>{t('Complete taste worlds, not a pile of posts.', 'عوالم ذوق مكتملة، وليست مجرد مجموعة منشورات.')}</p><div className="approved-grid">{creatorCollections.map((item) => <button className="approved-collection" key={item.id} onClick={() => { setSelectedCollectionId(item.id); go('collection'); }}><img src={imageSrc(published.find((edit) => edit.id === item.coverEditId)?.image || media('quiet-tailoring.webp'))} alt="" /><strong>{ar ? item.titleAr : item.title}</strong><span>{item.access === 'locked' ? t('Subscribers only', 'للمشتركين فقط') : t('Public collection', 'مجموعة عامة')}</span></button>)}</div></SimpleScreen>}
    {screen === 'collection' && <CollectionDetail ar={ar} collection={selectedCollection} edits={published.filter((item) => selectedCollection.editIds.includes(item.id))} canView={owner || subscribed} onOpen={openEdit} onSubscribe={() => go('subscribe')} />}
    {screen === 'about' && <SimpleScreen kicker={t('About Fheed', 'عن فهيد')} title={t('Fheed Alaiban', 'فهيد العيبان')}><p>{t('Kuwait City, Kuwait. I share Fashion & Outfits, places worth returning to, quiet travel notes, and daily routines that make everyday life feel better.', 'مدينة الكويت، الكويت. أشارك أزياء وإطلالات مدروسة، وأماكن تستحق العودة إليها، وملاحظات سفر هادئة، وروتيناً يومياً يجعل الحياة أفضل.')}</p><div className="approved-panel"><h3>{t('Taste pillars', 'ركائز الذوق')}</h3><p>{t('Fashion & Outfits · Travel · Health & Fitness · Places · Restaurants', 'أزياء وإطلالات · سفر · صحة ولياقة · أماكن · مطاعم')}</p></div><button className="approved-button primary wide" onClick={() => go('subscribe')}><Price ar={ar} /></button></SimpleScreen>}
    {screen === 'edit' && <EditDetail edit={selectedEdit} ar={ar} subscribed={subscribed} saved={saved.includes(selectedEdit.id)} onSave={() => toggleSaved(selectedEdit.id)} onSubscribe={() => go('subscribe')} />}
    {screen === 'subscribe' && <SimpleScreen kicker={t('Fheed Alaiban', 'فهيد العيبان')} title={subscribed ? t('You’re subscribed', 'اشتراكك نشط') : t('Subscribe to Fheed', 'اشترك في فهيد')}><div className="approved-panel"><h3><Price ar={ar} withVerb={false} /></h3><p>{t('Private travel diaries, training routines, outfit details, and early collections.', 'مذكرات سفر خاصة، برامج تدريب، تفاصيل إطلالات، ومجموعات مبكرة.')}</p></div>{!owner && <button className="approved-button primary wide" onClick={() => { setSubscribed(!subscribed); write('subscribed-fheed', !subscribed); }}><Price ar={ar} /></button>}</SimpleScreen>}
  </main>{screen !== 'composer' && screen !== 'creatorPreview' && <nav className="approved-bottom" aria-label={t('Primary navigation', 'التنقل الرئيسي')} data-testid="primary-navigation">{nav.map(({ id, icon: Icon, en, ar: labelAr }) => <button key={id} data-testid={`nav-${id}`} className={screen === id ? 'active' : ''} onClick={() => go(id)}><Icon size={21} /><span>{ar ? labelAr : en}</span></button>)}</nav>}
   {menuOpen && <div className="approved-menu" data-testid="identity-language-menu"><div className="approved-menu-head"><h2>{t('Preview identity & language', 'هوية ولغة المعاينة')}</h2><button className="approved-icon" onClick={() => setMenuOpen(false)}><X size={19} /></button></div><span className="approved-kicker">{t('Demo identity', 'هوية العرض')}</span><div className="approved-segment"><button data-testid="identity-owner" className={owner ? 'selected' : ''} onClick={() => { setRole('owner'); setSelectedCreatorUsername('fheed'); write('demo-role', 'owner'); go('you'); }}><ShieldCheck size={14} /> {t('Fheed · Owner', 'فهيد · المالك')}</button><button data-testid="identity-consumer" className={!owner ? 'selected' : ''} onClick={() => { setRole('consumer'); write('demo-role', 'consumer'); go('you'); }}><CircleUserRound size={14} /> {t('Alex · Visitor', 'أليكس · زائر')}</button></div><button data-testid="menu-tune-taste" className="approved-button wide" onClick={() => go('tune-taste')}><Settings2 size={16} /> {t('Tune your taste', 'ضبط ذوقك')}</button><span className="approved-kicker">{t('Interface language', 'لغة الواجهة')}</span><div className="approved-segment"><button data-testid="language-en" className={!ar ? 'selected' : ''} onClick={() => { setLanguage('en'); write('interface-language', 'en'); }}>English</button><button data-testid="language-ar" className={ar ? 'selected' : ''} onClick={() => { setLanguage('ar'); write('interface-language', 'ar'); }}>العربية</button></div></div>}
  </div>;
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
  const { data, isLoading } = useExplore({ sort, category: category === 'All' ? undefined : category });
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

  return (
    <section>
      <span className="approved-kicker">{t('Explore', 'اكتشف')}</span>
      <div className="workspace-head" style={{ alignItems: 'center', marginBottom: 12 }}>
        <h1 className="approved-title">{t('Find your next taste.', 'اكتشف ذوقك القادم.')}</h1>
      </div>
      
      <div className="approved-search">
        <Search size={18} />
        <span>{t('Search creators, places, and edits', 'ابحث عن المبدعين والأماكن والتعديلات')}</span>
      </div>

      <div className="approved-segment">
        <button className={sort === 'best' ? 'selected' : ''} onClick={() => setSort('best')}>{t('Best Match', 'أفضل تطابق')}</button>
        <button className={sort === 'new' ? 'selected' : ''} onClick={() => setSort('new')}>{t('New', 'الأحدث')}</button>
      </div>

      <CategoryChips ar={ar} active={category} onSelect={setCategory} />

      {isLoading && <div className="approved-empty">{t('Loading...', 'جارٍ التحميل...')}</div>}
      
      {data?.authenticated === false && sort === 'best' && (
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

        {edits.map(item => (
          <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => onOpenEdit(item)} />
        ))}
      </div>
    </section>
  );
}

function TuneTasteScreen({ ar, onBack }: { ar: boolean; onBack: () => void }) {
  const { data: catalog, isLoading: catalogLoading } = useGetTasteCatalog();
  const session = useTasteSession();
  const { data: prefs, isLoading: prefsLoading, error: prefsError } = useGetTastePreferences({
    query: { retry: false, queryKey: getGetTastePreferencesQueryKey(), enabled: session === 'authenticated' },
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

  if (session === 'signed-out' || prefsError) {
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

  if (catalogLoading || session === 'loading' || prefsLoading) {
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
function TasteRating({ rating, ar, id }: { rating?: number | null; ar: boolean; id?: string }) {
  if (!rating) return null;
  return <span className="taste-rating-wrap" data-testid={id ? `taste-rating-${id}` : undefined}><span className="taste-rating" aria-hidden="true">{[1, 2, 3, 4, 5].map((value) => <Link2 key={value} size={15} className={value <= rating ? 'active' : ''} />)}</span><span className="taste-rating-label" aria-label={ar ? `تقييم ذوق فهيد ${rating} من 5` : `Fheed's Taste Rating ${rating} out of 5`}>{ar ? `تقييم ذوق فهيد · ${rating}/5` : `Fheed’s Taste Rating · ${rating}/5`}</span></span>;
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
function EditCard({ edit, ar, saved, onSave, onOpen }: { edit: CreatorEdit; ar: boolean; saved: boolean; onSave: () => void; onOpen: () => void }) {
  const caption = publicCaptionLine(edit, ar);
  const noPhoto = !edit.image;
  if (noPhoto) return <article className="approved-card place-card" data-testid={`edit-card-${edit.id}`}><button className="place-card-main" onClick={onOpen}><span className="place-card-category">{displayCategory(edit.category, ar ? 'ar' : 'en')}</span>{edit.access === 'locked' && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}<PlaceDetails edit={edit} ar={ar} /><span className="place-card-open">{ar ? 'عرض التوصية' : 'View recommendation'} <ChevronRight size={15} /></span></button><div className="approved-caption"><div className="approved-caption-row"><button className="approved-card-title" data-testid={`edit-title-${edit.id}`} onClick={onOpen}>{caption}</button><SaveButton edit={edit} ar={ar} saved={saved} onSave={onSave} /></div></div></article>;
  return <article className="approved-card" data-testid={`edit-card-${edit.id}`}><button className="approved-art" style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop) }} onClick={onOpen}><img src={imageSrc(edit.image)} alt={edit.altText} />{edit.access === 'locked' && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}</button>{caption && <div className="approved-caption"><div className="approved-caption-row"><button className="approved-card-title" data-testid={`edit-title-${edit.id}`} onClick={onOpen}>{caption}</button><SaveButton edit={edit} ar={ar} saved={saved} onSave={onSave} /></div>{isPlaceCategory(edit.category) && <PlaceDetails edit={edit} ar={ar} compact />}</div>}{!caption && <div className="approved-caption approved-caption-empty"><SaveButton edit={edit} ar={ar} saved={saved} onSave={onSave} /></div>}</article>;
}
function EditDetail({ edit, ar, subscribed, saved, onSave, onSubscribe }: { edit: CreatorEdit; ar: boolean; subscribed: boolean; saved: boolean; onSave: () => void; onSubscribe: () => void }) { const locked = edit.access === 'locked'; const caption = publicCaptionLine(edit, ar); const detailTitle = isPlaceCategory(edit.category) ? edit.placeName || caption : caption; const outfitItems = (edit.outfitItems || []).filter((item) => item.type || item.brand || item.name); return <SimpleScreen kicker={locked ? (ar ? 'للمشتركين فقط' : 'Subscribers only') : (ar ? 'تعديل عام' : 'Public Edit')} title={detailTitle}>{edit.image && <div className={`approved-detail-art ${locked ? 'locked' : ''}`} style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop), height: 'auto' }}><img src={imageSrc(edit.image)} alt={edit.altText} />{locked && <div><LockKeyhole size={26} />{caption && <strong>{caption}</strong>}</div>}</div>}{isPlaceCategory(edit.category) && caption && caption !== detailTitle && <p className="edit-detail-caption">{caption}</p>}{!edit.image && <div className={`place-detail-panel ${locked ? 'locked' : ''}`}>{locked && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}<PlaceDetails edit={edit} ar={ar} showName={false} /></div>}{!edit.placeName && (edit.location || edit.locationAr) && <div className="approved-location"><MapPin size={14} />{placeLocation(edit, ar)}</div>}{locked ? <div className="approved-panel"><h3>{ar ? 'هذا التعديل للمشتركين' : 'This edit is for subscribers'}</h3><p>{ar ? 'تظل الوسائط الخاصة محمية إلى أن يتم تأكيد اشتراكك في حسابك.' : 'Private media stays protected until your subscription is confirmed on your account.'}</p><button className="approved-button primary wide" onClick={onSubscribe}>{subscribed ? (ar ? 'بانتظار تأكيد الاشتراك' : 'Subscription pending confirmation') : <Price ar={ar} />}</button></div> : <>{isPlaceCategory(edit.category) && edit.image && <PlaceDetails edit={edit} ar={ar} showName={false} />}{edit.showOutfitDetails && outfitItems.length > 0 && <div className="outfit-published"><h3>{ar ? 'تفاصيل الإطلالة' : 'Outfit details'}</h3>{outfitItems.map((item, index) => <div key={index}><strong>{item.type || item.name}</strong><span>{[item.brand, item.name].filter(Boolean).join(' · ')}</span>{item.link && <a href={item.link} target="_blank" rel="noreferrer">{ar ? 'عرض المنتج' : 'View item'}</a>}</div>)}</div>}<button className={`approved-button wide ${saved ? 'primary' : ''}`} onClick={onSave}>{saved ? (ar ? 'تم الحفظ' : 'Saved') : (ar ? 'احفظ هذا التعديل' : 'Save this edit')}</button></>}</SimpleScreen>; }
function Profile({ ar, owner, visitorPreview, following, subscribed, profile, edits, onViewAsVisitor, onExitVisitor, onFollow, onSubscribe, onEditProfile, onEdit, onCollections, onAbout, onMatch }: { ar: boolean; owner: boolean; visitorPreview: boolean; following: boolean; subscribed: boolean; profile: CreatorProfile; edits: CreatorEdit[]; onViewAsVisitor: () => void; onExitVisitor: () => void; onFollow: () => void; onSubscribe: () => void; onEditProfile: () => void; onEdit: (edit: CreatorEdit) => void; onCollections: () => void; onAbout: () => void; onMatch: () => void }) {
  const ownerView = owner && !visitorPreview;
  const [sealOpen, setSealOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<Category>('All');
  const profileCategoryItems = useMemo(() => categories.filter((item) => item.id === 'All' || edits.some((edit) => edit.category === item.id)), [edits]);
  const profileFilteredEdits = useMemo(() => editCategory === 'All' ? edits : edits.filter((edit) => edit.category === editCategory), [editCategory, edits]);
  useEffect(() => {
    if (!profileCategoryItems.some((item) => item.id === editCategory)) setEditCategory('All');
  }, [editCategory, profileCategoryItems]);
  const locationAndInterests = [`${profile.city}, ${profile.country}`, profile.interests.map((interest) => displayCategory(interest, ar ? 'ar' : 'en')).join(' · '), profile.age ? (ar ? `العمر ${profile.age}` : `Age ${profile.age}`) : ''].filter(Boolean).join(' · ');
  
  const { data: matchData } = useGetTasteMatch(profile.username);
  const score = matchData?.match?.score;

  return <section><div className="approved-profile-head"><Avatar profile={profile} /><div><div className="approved-name"><h1>{profile.displayName}</h1>{profile.verified && <button className="taste-seal" type="button" aria-label="Verified by TASTEKIN" aria-expanded={sealOpen} onClick={() => setSealOpen(!sealOpen)}><img src={TASTE_SEAL_IMAGE} alt="" /></button>}</div><span><bdi dir="ltr">@{profile.username}</bdi></span><p>{locationAndInterests}</p></div></div>{sealOpen && <div className="taste-seal-popover" role="dialog" aria-label="Taste Seal verification"><p>Verified by TASTEKIN — selected for authentic taste and identity.</p><button className="approved-icon" onClick={() => setSealOpen(false)} aria-label={ar ? 'إغلاق' : 'Close'}><X size={16} /></button></div>}
  
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

   <div className="approved-actions">{ownerView ? <><button className="approved-button primary" onClick={onEditProfile}>{ar ? 'تعديل الملف' : 'Edit profile'}</button><button className="approved-button" onClick={onViewAsVisitor}>{ar ? 'عرض كزائر' : 'View as visitor'}</button></> : <><button className="approved-button" onClick={onFollow} disabled={visitorPreview}>{following ? (ar ? 'تتابع' : 'Following') : (ar ? 'متابعة' : 'Follow')}</button><button className="approved-button primary" onClick={onSubscribe} disabled={visitorPreview}>{subscribed ? (ar ? 'مشترك' : 'Subscribed') : <Price ar={ar} />}</button></>}</div>{visitorPreview && <button className="approved-button wide visitor-exit" onClick={onExitVisitor}>{ar ? 'إنهاء معاينة الزائر' : 'Exit visitor preview'}</button>}<div className="approved-tabs"><button className="active" onClick={() => setEditCategory('All')}>{ar ? 'التعديلات' : 'Edits'}</button><button onClick={onCollections}>{ar ? 'المجموعات' : 'Collections'}</button><button onClick={onAbout}>{ar ? 'حول' : 'About'}</button></div>{profileCategoryItems.length > 2 && <CategoryChips ar={ar} active={editCategory} onSelect={setEditCategory} items={profileCategoryItems} testIdPrefix="profile-category" ariaLabel={ar ? 'فلاتر تعديلات المبدع' : 'Creator edit categories'} className="profile-edit-filters" />}<div className="approved-grid">{profileFilteredEdits.slice(0, 6).map((edit) => { const caption = publicCaptionLine(edit, ar); const location = placeLocation(edit, ar); return <button className={`approved-grid-card ${edit.image ? '' : 'place-grid-card'}`} key={edit.id} onClick={() => onEdit(edit)}>{edit.image ? <img style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop) }} src={imageSrc(edit.image)} alt={edit.altText} /> : <div className="place-grid-preview"><span className="place-grid-eyebrow">{displayCategory(edit.category, ar ? 'ar' : 'en')}</span><strong>{edit.placeName || caption}</strong>{location && <span className="place-grid-location"><MapPin size={14} />{location}</span>}<TasteRating rating={edit.tasteRating} ar={ar} />{edit.creatorReview && <p>{edit.creatorReview.split(/\r?\n/, 1)[0]}</p>}</div>}{caption && edit.image && <strong>{caption}</strong>}</button>; })}</div></section>;
}
function CreatorDashboard({ ar, edits, collections, busy, onNew, onEdit, onArchive, onUnarchive, onCollections }: { ar: boolean; edits: CreatorEdit[]; collections: CreatorCollection[]; busy: boolean; onNew: () => void; onEdit: (edit: CreatorEdit) => void; onArchive: (id: string) => void; onUnarchive: (id: string) => void; onCollections: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const groups: [EditStatus, string, string][] = [['draft', 'Drafts', 'مسودات'], ['published', 'Published', 'منشور'], ['archived', 'Archived', 'مؤرشف']]; return <section className="creator-workspace"><span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span><div className="workspace-head"><div><h1 className="approved-title">{t('Good afternoon, Fheed.', 'مساء الخير، فهيد.')}</h1><p>{t('Shape the next thing people save.', 'اصنع ما سيحفظه الناس لاحقاً.')}</p></div><button className="approved-button primary" onClick={onNew} disabled={busy}><Plus size={16} /> {t('New Edit', 'تعديل جديد')}</button></div><div className="creator-stats"><Stat value={edits.filter((item) => item.status === 'published').length} label={t('Published', 'منشور')} /><Stat value={edits.filter((item) => item.status === 'draft').length} label={t('Drafts', 'مسودات')} /><Stat value={collections.length} label={t('Collections', 'مجموعات')} /></div><button className="workspace-collection-link" onClick={onCollections} disabled={busy}><span><FileText size={17} /><strong>{t('Manage collections', 'إدارة المجموعات')}</strong></span><ChevronRight size={17} /></button>{groups.map(([status, en, arabic]) => <div className="workspace-section" key={status}><div className="workspace-section-head"><h2>{ar ? arabic : en}</h2><span>{edits.filter((item) => item.status === status).length}</span></div>{edits.filter((item) => item.status === status).map((item) => <div className="workspace-edit" key={item.id}>{item.image ? <img src={imageSrc(item.image)} alt={item.altText} /> : <div className="workspace-place-thumb"><MapPin size={17} /></div>}<div><strong>{ar ? item.titleAr : item.title}</strong><span>{item.access === 'locked' ? t('Subscribers only', 'للمشتركين فقط') : t('Public', 'عام')} · {placeLocation(item, ar)}</span></div><div className="workspace-edit-actions">{status === 'archived' ? <button onClick={() => onUnarchive(item.id)} disabled={busy}>{t('Restore', 'استعادة')}</button> : <><button onClick={() => onEdit(item)} aria-label={t('Edit', 'تعديل')} disabled={busy}><Pencil size={15} /></button><button onClick={() => onArchive(item.id)} aria-label={t('Archive', 'أرشفة')} disabled={busy}><Archive size={15} /></button></>}</div></div>)}{!edits.some((item) => item.status === status) && <Empty text={t('Nothing here yet.', 'لا يوجد شيء هنا after.')} />}</div>)}</section>; }
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
  return <section className="profile-editor"><span className="approved-kicker">{t('Creator profile', 'ملف المبدع')}</span><h1 className="approved-title">{t('Edit profile', 'تعديل الملف')}</h1><p className="profile-editor-intro">{t('Shape the identity visitors see. Verification and audience numbers remain managed by TASTEKIN.', 'حدّد الهوية التي يراها الزوار. تبقى حالة التوثيق وأرقام الجمهور تحت إدارة تيستكن.')}</p><label className="profile-photo-picker"><Avatar profile={form} src={photo?.url || form.avatar} /><span><ImagePlus size={16} /> {processing ? t('Preparing…', 'جارٍ التجهيز…') : t('Change photo', 'تغيير الصورة')}</span><input aria-label={t('Change profile photo', 'تغيير صورة الملف')} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif" onChange={selectPhoto} disabled={processing || busy} /></label>{imageError && <p className="workspace-notice" role="alert">{imageError}</p>}<Field label={t('Display name', 'الاسم الظاهر')} value={form.displayName} onChange={(value) => update('displayName', value)} placeholder={t('Your name', 'اسمك')} /><Field label={t('Username', 'اسم المستخدم')} value={form.username} onChange={(value) => update('username', value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="fheed" /><Field label={t('Bio', 'النبذة')} value={form.bio} onChange={(value) => update('bio', value)} placeholder={t('A few words about your taste…', 'بضع كلمات عن ذوقك…')} multiline /><div className="form-two"><Field label={t('City', 'المدينة')} value={form.city} onChange={(value) => update('city', value)} placeholder={t('Kuwait City', 'مدينة الكويت')} /><Field label={t('Country', 'الدولة')} value={form.country} onChange={(value) => update('country', value)} placeholder={t('Kuwait', 'الكويت')} /></div><span className="form-label">{t('Taste categories', 'فئات الذوق')}</span><div className="profile-interests">{categories.filter((category) => category.id !== 'All').map((category) => <button key={category.id} type="button" className={form.interests.includes(category.id) ? 'selected' : ''} onClick={() => update('interests', form.interests.includes(category.id) ? form.interests.filter((id) => id !== category.id) : [...form.interests, category.id])} disabled={busy}>{form.interests.includes(category.id) && <Check size={13} />}{ar ? category.ar : category.en}</button>)}</div><div className="profile-privacy"><Field label={t('Date of birth', 'تاريخ الميلاد')} value={form.dateOfBirth || ''} onChange={(value) => update('dateOfBirth', value || null)} placeholder="YYYY-MM-DD" type="date" /><label className="age-toggle"><input type="checkbox" checked={form.showAge} onChange={(event) => update('showAge', event.target.checked)} disabled={busy} /><span><strong>{t('Show my age on my profile', 'أظهر عمري في ملفي')}</strong><small>{t('Your date of birth stays private.', 'يبقى تاريخ ميلادك خاصاً.')}</small></span></label></div>{error && <p className="workspace-notice" role="alert">{error}</p>}{saved && <p className="profile-save-success" role="status">{t('Profile saved. Your public profile is up to date.', 'تم حفظ الملف. ملفك العام محدّث الآن.')}</p>}<button className="approved-button primary wide" onClick={onSave} disabled={busy || processing}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save profile', 'حفظ الملف')}</button>{photo && <button className="profile-remove-photo" type="button" onClick={onCancelPhoto}>{t('Discard new photo', 'تجاهل الصورة الجديدة')}</button>}</section>;
}

function EditComposer({ ar, form, collections, busy, onChange, onCropPrepared, onBack, onDraft, onPreview, onPublish }: { ar: boolean; form: EditForm; collections: CreatorCollection[]; busy: boolean; onChange: (form: EditForm) => void; onCropPrepared: (crop: PendingCrop) => void; onBack: () => void; onDraft: () => void; onPreview: () => void; onPublish: () => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [imageError, setImageError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [pendingImage, setPendingImage] = useState<PreparedImage | null>(null);
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
    <div className="composer-actions"><button className="approved-button" onClick={onDraft} disabled={processing || busy}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save draft', 'حفظ كمسودة')}</button><button className="approved-button" onClick={onPreview} disabled={processing || busy}>{t('Preview', 'معاينة')}</button><button className="approved-button primary" onClick={tryPublish} disabled={processing || busy}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Publish', 'نشر')}</button></div>
  </section>;
}
function Field({ label, value, onChange, placeholder, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean; type?: string }) { return <label className="form-field"><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function CreatorPreview({ ar, busy, edit, onBack, onPublish }: { ar: boolean; busy: boolean; edit: CreatorEdit; onBack: () => void; onPublish: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const [publishError, setPublishError] = useState(''); const tryPublish = () => { const error = publishValidationMessage(edit, ar); if (error) { setPublishError(error); return; } setPublishError(''); onPublish(); }; return <SimpleScreen kicker={t('Consumer preview', 'معاينة للمستهلك')} title={t('This is how it will appear.', 'هكذا سيظهر.') }><p>{edit.image ? t('Your wording, access label, and image appear exactly as they will in the consumer feed.', 'ستظهر كتابتك وعلامة الوصول والصورة كما ستظهر في تغذية المستهلك.') : t('Your place recommendation appears as an intentional no-photo card.', 'ستظهر توصية المكان كبطاقة مقصودة بلا صورة.')}</p><EditCard edit={edit} ar={ar} saved={false} onSave={() => undefined} onOpen={() => undefined} />{publishError && <p className="workspace-notice" role="alert">{publishError}</p>}<div className="composer-actions"><button className="approved-button" onClick={onBack} disabled={busy}>{t('Keep editing', 'متابعة التعديل')}</button><button className="approved-button primary" onClick={tryPublish} disabled={busy}>{t('Publish Edit', 'نشر التعديل')}</button></div></SimpleScreen>; }
function CollectionManager({ ar, collections, published, form, editing, onChange, onEdit, onNew, onSave }: { ar: boolean; collections: CreatorCollection[]; published: CreatorEdit[]; form: CollectionForm; editing: string | null; onChange: (form: CollectionForm) => void; onEdit: (item?: CreatorCollection) => void; onNew: () => void; onSave: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const update = <K extends keyof CollectionForm>(key: K, value: CollectionForm[K]) => onChange({ ...form, [key]: value }); return <section className="creator-composer"><span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span><div className="workspace-head"><div><h1 className="approved-title">{t('Collections', 'المجموعات')}</h1><p>{t('Group recommendations into a complete taste world.', 'اجمع التوصيات في عالم ذوق متكامل.')}</p></div><button className="approved-button" onClick={onNew}><Plus size={15} /> {t('New', 'جديد')}</button></div><div className="manager-list">{collections.map((item) => <button className="workspace-collection-link" key={item.id} onClick={() => onEdit(item)}><span><img src={imageSrc(published.find((edit) => edit.id === item.coverEditId)?.image || media('quiet-tailoring.webp'))} alt="" /><strong>{ar ? item.titleAr : item.title}</strong></span><Pencil size={16} /></button>)}</div><div className="manager-form"><h2>{editing ? t('Edit collection', 'تعديل المجموعة') : t('New collection', 'مجموعة جديدة')}</h2><Field label={t('Title', 'العنوان')} value={form.title} onChange={(value) => update('title', value)} placeholder="Collection title" /><Field label={t('Arabic title', 'العنوان بالعربية')} value={form.titleAr} onChange={(value) => update('titleAr', value)} placeholder="عنوان المجموعة" /><Field label={t('Description', 'الوصف')} value={form.description} onChange={(value) => update('description', value)} multiline placeholder="What holds it together?" /><Field label={t('Arabic description', 'الوصف بالعربية')} value={form.descriptionAr} onChange={(value) => update('descriptionAr', value)} multiline placeholder="ما الذي يجمعها؟" /><SelectField label={t('Cover Edit', 'تعديل الغلاف')} value={form.coverEditId} onChange={(value) => update('coverEditId', value)} options={published.map((item) => ({ value: item.id, label: ar ? item.titleAr : item.title }))} /><span className="form-label">{t('Visibility', 'الوصول')}</span><div className="access-toggle"><button className={form.access === 'public' ? 'selected' : ''} onClick={() => update('access', 'public')}>{t('Public', 'عام')}</button><button className={form.access === 'locked' ? 'selected' : ''} onClick={() => update('access', 'locked')}>{t('Subscribers Only', 'للمشتركين فقط')}</button></div><span className="form-label">{t('Included published Edits', 'التعديلات المنشورة المضمنة')}</span><div className="collection-checks">{published.map((item) => <button key={item.id} className={form.editIds.includes(item.id) ? 'selected' : ''} onClick={() => update('editIds', form.editIds.includes(item.id) ? form.editIds.filter((id) => id !== item.id) : [...form.editIds, item.id])}>{form.editIds.includes(item.id) && <Check size={14} />}{ar ? item.titleAr : item.title}</button>)}</div><button className="approved-button primary wide" onClick={onSave}>{editing ? t('Save changes', 'حفظ التغييرات') : t('Create collection', 'إنشاء المجموعة')}</button></div></section>; }
function CollectionDetail({ ar, collection, edits, canView, onOpen, onSubscribe }: { ar: boolean; collection: CreatorCollection; edits: CreatorEdit[]; canView: boolean; onOpen: (edit: CreatorEdit) => void; onSubscribe: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; if (!canView && collection.access === 'locked') return <SimpleScreen kicker={t('Subscribers only', 'للمشتركين فقط')} title={ar ? collection.titleAr : collection.title}><div className="approved-panel collection-gate"><LockKeyhole size={25} /><h3>{t('A private collection from Fheed.', 'مجموعة خاصة من فهيد.')}</h3><p>{t('Subscribe to unlock the complete collection and its field notes.', 'اشترك لفتح المجموعة الكاملة وملاحظاتها.')}</p><button className="approved-button primary wide" onClick={onSubscribe}><Price ar={ar} /></button></div></SimpleScreen>; return <SimpleScreen kicker={ar ? 'مجموعة' : 'Collection'} title={ar ? collection.titleAr : collection.title}><img className="approved-collection-hero" src={imageSrc(edits[0]?.image || media('quiet-tailoring.webp'))} alt="" /><p>{ar ? collection.descriptionAr : collection.description}</p><h3 className="approved-kicker">{ar ? 'التعديلات المضمنة' : 'Included edits'}</h3><div className="approved-list">{edits.map((item) => { const caption = publicCaptionLine(item, ar); return <button key={item.id} onClick={() => onOpen(item)}><span>{caption}</span><ChevronRight size={17} /></button>; })}</div></SimpleScreen>; }