import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Archive, ArrowLeft, Bookmark, Check, ChevronRight, CircleUserRound, Eye, FileText,
  Home, ImagePlus, LockKeyhole, MapPin, Pencil, Plus, PlusCircle, Search, Settings2,
  ShieldCheck, Upload, UserRound, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import './approved.css';

type Language = 'en' | 'ar';
type Role = 'owner' | 'consumer';
type Screen = 'home' | 'explore' | 'add' | 'saved' | 'you' | 'profile' | 'collections' | 'collection' | 'about' | 'match' | 'edit' | 'subscribe' | 'composer' | 'creatorPreview' | 'collectionManager';
type Category = 'All' | 'Fashion' | 'Travel' | 'Places' | 'Restaurants' | 'DailyRoutine' | 'PersonalCare' | 'HealthFitness' | 'Decor' | 'Books' | 'Vlogs';
type EditStatus = 'draft' | 'published' | 'archived';
type Access = 'public' | 'locked';
type ImageMetadata = { name: string; size: number; contentType: string };
type CropAspect = 'square' | 'portrait' | 'story';
type CropMetadata = { aspect: CropAspect; zoom: number; x: number; y: number; rotation: number; sourceWidth: number; sourceHeight: number; outputWidth: number; outputHeight: number };
type PendingCrop = { source: File; crop: File; preview: File; cropMetadata: CropMetadata; cropUrl: string; previewUrl: string };
type OutfitItem = { type: string; brand: string; name: string; link: string };

type CreatorEdit = {
  id: string; category: Exclude<Category, 'All'>; title: string; titleAr: string; caption: string; captionAr: string;
  image: string; sourceImage?: string; previewImage?: string; imageMetadata?: ImageMetadata; crop?: CropMetadata; location: string; locationAr: string; altText: string; access: Access; status: EditStatus; collectionIds: string[]; outfitItems?: OutfitItem[]; showOutfitDetails?: boolean;
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
const imageSrc = (image: string) => image.startsWith('/objects/') ? `/api/storage${image}` : image;
const cropAspectRatio = (_aspect?: CropAspect, crop?: CropMetadata) => crop?.outputWidth && crop?.outputHeight ? `${crop.outputWidth} / ${crop.outputHeight}` : _aspect === 'square' ? '1 / 1' : _aspect === 'story' ? '9 / 16' : '4 / 5';
const blankEdit = (): EditForm => ({ category: 'Fashion', title: '', titleAr: '', caption: '', captionAr: '', image: media('quiet-tailoring.webp'), location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: '', access: 'public', collectionIds: [] });
const blankCollection = (): CollectionForm => ({ title: '', titleAr: '', description: '', descriptionAr: '', access: 'public', coverEditId: 'quiet-tailoring', editIds: [] });

function Price({ ar, withVerb = true }: { ar: boolean; withVerb?: boolean }) { return ar ? <>{withVerb && 'اشترك · '}<bdi dir="ltr">19.99</bdi> دولار شهريًا</> : <>{withVerb && 'Subscribe · '}$19.99 / month</>; }

export default function App() {
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : read('interface-language', 'en'));
  const [role, setRole] = useState<Role>(() => read('demo-role', 'owner'));
  const [screen, setScreen] = useState<Screen>('home');
  const [category, setCategory] = useState<Category>('All');
  const [saved, setSaved] = useState<string[]>(() => read('saved-edits', []));
  const [following, setFollowing] = useState(() => read('following-fheed', false));
  const [subscribed, setSubscribed] = useState(() => read('subscribed-fheed', false));
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatorEdits, setCreatorEdits] = useState<CreatorEdit[]>(seedEdits);
  const [creatorCollections, setCreatorCollections] = useState<CreatorCollection[]>(seedCollections);
  const [workspaceRevision, setWorkspaceRevision] = useState(1);
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'ready' | 'syncing' | 'error'>('loading');
  const [workspaceError, setWorkspaceError] = useState('');
  const [selectedEditId, setSelectedEditId] = useState('quiet-tailoring');
  const [selectedCollectionId, setSelectedCollectionId] = useState('quiet-luxury');
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
  const ar = language === 'ar'; const owner = role === 'owner'; const t = (en: string, arabic: string) => ar ? arabic : en;
  const published = creatorEdits.filter((item) => item.status === 'published');
  const filtered = useMemo(() => (category === 'All' ? published : published.filter((item) => item.category === category)), [category, published]);
  const selectedEdit = creatorEdits.find((item) => item.id === selectedEditId) || published[0] || seedEdits[0];
  const selectedCollection = creatorCollections.find((item) => item.id === selectedCollectionId) || creatorCollections[0] || seedCollections[0];
  const go = (next: Screen) => {
    if (workspaceState === 'syncing') return;
    const leavingCreatorFlow = (screen === 'composer' || screen === 'creatorPreview') && next !== 'composer' && next !== 'creatorPreview';
    if (leavingCreatorFlow && pendingMediaPaths.length) { pendingMediaIsDiscardable.current = false; void cleanupCreatorMedia(pendingMediaPaths); setPendingMediaPaths([]); }
    if (leavingCreatorFlow) discardPendingCrop();
    setScreen(next); setMenuOpen(false);
  };
  const toggleSaved = (id: string) => { const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id]; setSaved(next); write('saved-edits', next); };
  const openEdit = (item: CreatorEdit) => { setSelectedEditId(item.id); go('edit'); };
  const openComposer = (item?: CreatorEdit) => { discardPendingCrop(); setEditingId(item?.id || null); setEditForm(item ? { category: item.category, title: item.title, titleAr: item.titleAr, caption: item.caption, captionAr: item.captionAr, image: item.image, sourceImage: item.sourceImage, previewImage: item.previewImage, imageMetadata: item.imageMetadata, crop: item.crop, location: item.location, locationAr: item.locationAr, altText: item.altText, access: item.access, collectionIds: item.collectionIds, outfitItems: item.outfitItems || [], showOutfitDetails: item.showOutfitDetails || false } : blankEdit()); go('composer'); };
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
    const next = { id, ...formToSave, title: formToSave.title.trim() || formToSave.caption.trim().slice(0, 80) || 'Untitled Edit', titleAr: formToSave.titleAr.trim() || formToSave.caption.trim().slice(0, 80) || 'Untitled Edit', captionAr: formToSave.captionAr || formToSave.caption, status } as CreatorEdit;
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
  const goBack = () => { if (screen === 'composer' || screen === 'creatorPreview') { abandonComposer(); return; } go(screen === 'edit' ? 'profile' : screen === 'collection' ? 'collections' : screen === 'collectionManager' ? 'add' : 'home'); };
  const nav = [{ id: 'home' as const, icon: Home, en: 'Home', ar: 'الرئيسية' }, { id: 'explore' as const, icon: Search, en: 'Explore', ar: 'اكتشف' }, { id: 'add' as const, icon: PlusCircle, en: 'Add', ar: 'إضافة' }, { id: 'saved' as const, icon: Bookmark, en: 'Saved', ar: 'المحفوظات' }, { id: 'you' as const, icon: UserRound, en: 'You', ar: 'أنت' }];
  return <div className="approved-app" dir={ar ? 'rtl' : 'ltr'}><main className="approved-shell">
    <header className="approved-topbar">{!['home', 'you', 'add'].includes(screen) ? <button className="approved-icon" onClick={goBack} aria-label={t('Back', 'رجوع')}><ArrowLeft size={21} /></button> : <span className="approved-spacer" />}<img src="/tastekin-logo.svg" className="approved-logo" alt="TASTEKIN" /><button className="approved-icon" onClick={() => setMenuOpen(true)} aria-label={t('Open menu', 'فتح القائمة')}><Settings2 size={19} /></button></header>
    {workspaceState === 'loading' && <div className="workspace-sync">{t('Loading your shared creator workspace…', 'جارٍ تحميل مساحة المبدع المشتركة…')}</div>}
    {workspaceState === 'syncing' && <div className="workspace-sync">{t('Saving your creator changes across devices…', 'جارٍ حفظ تغييرات المبدع على جميع الأجهزة…')}</div>}
    {workspaceState === 'error' && <div className="workspace-notice" role="alert">{workspaceError}<button onClick={() => workspaceError.startsWith('Sign in') ? window.location.assign('/api/login?returnTo=/') : void loadWorkspace()}>{workspaceError.startsWith('Sign in') ? t('Sign in', 'تسجيل الدخول') : t('Try again', 'حاول مجددًا')}</button></div>}
    {screen === 'home' && <><section className="approved-hero"><span className="approved-kicker">{t('Taste-led discovery', 'اكتشاف مبني على الذوق')}</span><h1>{t('Follow the taste, not the numbers.', 'اتبع الذوق، لا الأرقام.')}</h1><p>{t('A considered feed of people, places, and daily routines shaped by what you actually like.', 'تغذية منتقاة من الأشخاص وأماكنهم وروتينهم اليومي، تتشكل بحسب ما تحبه فعلاً.')}</p></section><CategoryChips ar={ar} active={category} onSelect={setCategory} /><div className="approved-feed">{filtered.map((item) => <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}</div></>}
    {screen === 'explore' && <section><span className="approved-kicker">{t('Explore', 'اكتشف')}</span><h1 className="approved-title">{t('Find your next taste.', 'اكتشف ذوقك القادم.')}</h1><div className="approved-search"><Search size={18} /><span>{t('Search creators, places, and edits', 'ابحث عن المبدعين والأماكن والتعديلات')}</span></div><CategoryChips ar={ar} active={category} onSelect={setCategory} /><div className="approved-panel approved-profile-mini" data-testid="fheed-profile-mini" onClick={() => go('profile')}><Avatar /><div><strong>{t('Fheed Alaiban', 'فهيد العيبان')}</strong><span>{t('Fashion & Outfits · Travel · Places', 'أزياء وإطلالات · سفر · أماكن')}</span></div><ChevronRight /></div><div className="approved-feed">{filtered.slice(0, 4).map((item) => <EditCard key={item.id} edit={item} ar={ar} saved={saved.includes(item.id)} onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}</div></section>}
    {screen === 'add' && (owner ? <CreatorDashboard ar={ar} edits={creatorEdits} collections={creatorCollections} busy={workspaceState !== 'ready'} onNew={() => openComposer()} onEdit={openComposer} onArchive={archiveEdit} onUnarchive={unarchiveEdit} onCollections={() => openCollectionManager()} /> : <SimpleScreen kicker={t('Creator tools', 'أدوات المبدع')} title={t('Creator workspace', 'مساحة المبدع')}><p>{t('Publishing belongs to a verified creator profile. Switch to Fheed owner preview to create and manage edits.', 'النشر متاح لملف المبدع الموثق. انتقل إلى وضع مالك فهيد لإنشاء وإدارة التعديلات.')}</p><div className="approved-panel"><h3>{t('Visitor preview', 'معاينة الزائر')}</h3><p>{t('You can still follow, save, and subscribe to the demo creator experience.', 'ما زال بإمكانك المتابعة والحفظ والاشتراك في تجربة المبدع.')}</p></div></SimpleScreen>)}
    {screen === 'composer' && <EditComposer ar={ar} form={editForm} collections={creatorCollections} busy={workspaceState === 'syncing'} onChange={setEditForm} onCropPrepared={(crop) => { discardPendingCrop(); setPendingCrop(crop); }} onBack={abandonComposer} onDraft={() => { void commitEdit('draft').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} onPreview={() => { const preview = { id: editingId || 'preview', ...editForm, status: 'draft' } as CreatorEdit; setSelectedEditId(preview.id); go('creatorPreview'); }} onPublish={() => { void commitEdit('published').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} />}
    {screen === 'creatorPreview' && <CreatorPreview ar={ar} busy={workspaceState === 'syncing'} edit={{ id: editingId || 'preview', ...editForm, status: 'draft' } as CreatorEdit} onBack={() => go('composer')} onPublish={() => { void commitEdit('published').then((saved) => { if (saved) finishSavedCreatorFlow(); }); }} />}
    {screen === 'collectionManager' && <CollectionManager ar={ar} collections={creatorCollections} published={published} form={collectionForm} editing={editingCollectionId} onChange={setCollectionForm} onEdit={openCollectionManager} onNew={() => openCollectionManager()} onSave={() => { saveCollection(); openCollectionManager(); }} />}
    {screen === 'saved' && <SimpleScreen kicker={t('Your library', 'مكتبتك')} title={t('Saved', 'المحفوظات')}><p>{t('Return to ideas when the moment is right.', 'عد إلى الأفكار عندما يحين وقتها.')}</p><div className="approved-feed">{published.filter((item) => saved.includes(item.id)).map((item) => <EditCard key={item.id} edit={item} ar={ar} saved onSave={() => toggleSaved(item.id)} onOpen={() => openEdit(item)} />)}{!saved.length && <Empty text={t('Nothing saved yet. Explore Fheed’s edits and keep what speaks to you.', 'لا توجد محفوظات بعد. اكتشف تعديلات فهيد واحفظ ما يناسب ذوقك.')} />}</div></SimpleScreen>}
    {screen === 'you' && <SimpleScreen kicker={owner ? t('Creator owner mode', 'وضع مالك الحساب') : t('Your account', 'حسابك')} title={owner ? t('Your profile', 'ملفك الشخصي') : t('Alex Morgan', 'أليكس مورغان')}><div className="approved-panel identity"><Avatar /><div><strong>{owner ? t('Fheed Alaiban', 'فهيد العيبان') : t('Alex Morgan', 'أليكس مورغان')}</strong><span>{owner ? 'Kuwait City, Kuwait' : '@alexmorgan'}</span></div></div><div className="approved-panel"><h3>{t('Taste profile', 'ملف الذوق')}</h3><p>{t('Fashion & outfits, travel, places, restaurants, and daily routines.', 'أزياء وإطلالات، سفر، أماكن، مطاعم، وروتين يومي.')}</p></div>{owner && <button className="approved-button wide" onClick={() => go('profile')}>{t('View profile', 'عرض الملف')}</button>}</SimpleScreen>}
    {screen === 'profile' && <Profile ar={ar} owner={owner} following={following} subscribed={subscribed} edits={published} onFollow={() => { setFollowing(!following); write('following-fheed', !following); }} onSubscribe={() => go('subscribe')} onEdit={openEdit} onCollections={() => go('collections')} onAbout={() => go('about')} onMatch={() => go('match')} />}
    {screen === 'collections' && <SimpleScreen kicker={t('Fheed Alaiban', 'فهيد العيبان')} title={t('Collections', 'المجموعات')}><p>{t('Complete taste worlds, not a pile of posts.', 'عوالم ذوق مكتملة، وليست مجرد مجموعة منشورات.')}</p><div className="approved-grid">{creatorCollections.map((item) => <button className="approved-collection" key={item.id} onClick={() => { setSelectedCollectionId(item.id); go('collection'); }}><img src={imageSrc(published.find((edit) => edit.id === item.coverEditId)?.image || media('quiet-tailoring.webp'))} alt="" /><strong>{ar ? item.titleAr : item.title}</strong><span>{item.access === 'locked' ? t('Subscribers only', 'للمشتركين فقط') : t('Public collection', 'مجموعة عامة')}</span></button>)}</div></SimpleScreen>}
    {screen === 'collection' && <CollectionDetail ar={ar} collection={selectedCollection} edits={published.filter((item) => selectedCollection.editIds.includes(item.id))} canView={owner || subscribed} onOpen={openEdit} onSubscribe={() => go('subscribe')} />}
    {screen === 'about' && <SimpleScreen kicker={t('About Fheed', 'عن فهيد')} title={t('Fheed Alaiban', 'فهيد العيبان')}><p>{t('Kuwait City, Kuwait. I share Fashion & Outfits, places worth returning to, quiet travel notes, and daily routines that make everyday life feel better.', 'مدينة الكويت، الكويت. أشارك أزياء وإطلالات مدروسة، وأماكن تستحق العودة إليها، وملاحظات سفر هادئة، وروتيناً يومياً يجعل الحياة أفضل.')}</p><div className="approved-panel"><h3>{t('Taste pillars', 'ركائز الذوق')}</h3><p>{t('Fashion & Outfits · Travel · Health & Fitness · Places · Restaurants', 'أزياء وإطلالات · سفر · صحة ولياقة · أماكن · مطاعم')}</p></div><button className="approved-button primary wide" onClick={() => go('subscribe')}><Price ar={ar} /></button></SimpleScreen>}
    {screen === 'match' && <SimpleScreen kicker={t('Taste Match', 'تطابق الذوق')} title={t('Why you match', 'لماذا يتطابق ذوقكما')}><p>{t('A transparent score based on your selected taste preferences and saves.', 'درجة شفافة مبنية على تفضيلات ذوقك والمحتوى الذي حفظته.')}</p>{[['Fashion & Outfits', 'أزياء وإطلالات', '96%'], ['Travel', 'سفر', '91%'], ['Places', 'أماكن', '94%']].map(([en, arabic, score]) => <div className="approved-panel match" key={en}><strong>{ar ? arabic : en}</strong><b>{score}</b><p>{t('Your taste overlaps in thoughtful choices.', 'يتقاطع ذوقكما في اختيارات مدروسة.')}</p></div>)}</SimpleScreen>}
    {screen === 'edit' && <EditDetail edit={selectedEdit} ar={ar} subscribed={subscribed} saved={saved.includes(selectedEdit.id)} onSave={() => toggleSaved(selectedEdit.id)} onSubscribe={() => go('subscribe')} />}
    {screen === 'subscribe' && <SimpleScreen kicker={t('Fheed Alaiban', 'فهيد العيبان')} title={subscribed ? t('You’re subscribed', 'اشتراكك نشط') : t('Subscribe to Fheed', 'اشترك في فهيد')}><div className="approved-panel"><h3><Price ar={ar} withVerb={false} /></h3><p>{t('Private travel diaries, training routines, outfit details, and early collections.', 'مذكرات سفر خاصة، برامج تدريب، تفاصيل إطلالات، ومجموعات مبكرة.')}</p></div>{!owner && <button className="approved-button primary wide" onClick={() => { setSubscribed(!subscribed); write('subscribed-fheed', !subscribed); }}><Price ar={ar} /></button>}</SimpleScreen>}
  </main>{screen !== 'composer' && screen !== 'creatorPreview' && <nav className="approved-bottom" aria-label={t('Primary navigation', 'التنقل الرئيسي')} data-testid="primary-navigation">{nav.map(({ id, icon: Icon, en, ar: labelAr }) => <button key={id} data-testid={`nav-${id}`} className={screen === id ? 'active' : ''} onClick={() => go(id)}><Icon size={21} /><span>{ar ? labelAr : en}</span></button>)}</nav>}
  {menuOpen && <div className="approved-menu" data-testid="identity-language-menu"><div className="approved-menu-head"><h2>{t('Preview identity & language', 'هوية ولغة المعاينة')}</h2><button className="approved-icon" onClick={() => setMenuOpen(false)}><X size={19} /></button></div><span className="approved-kicker">{t('Demo identity', 'هوية العرض')}</span><div className="approved-segment"><button data-testid="identity-owner" className={owner ? 'selected' : ''} onClick={() => { setRole('owner'); write('demo-role', 'owner'); go('you'); }}><ShieldCheck size={14} /> {t('Fheed · Owner', 'فهيد · المالك')}</button><button data-testid="identity-consumer" className={!owner ? 'selected' : ''} onClick={() => { setRole('consumer'); write('demo-role', 'consumer'); go('you'); }}><CircleUserRound size={14} /> {t('Alex · Visitor', 'أليكس · زائر')}</button></div><span className="approved-kicker">{t('Interface language', 'لغة الواجهة')}</span><div className="approved-segment"><button data-testid="language-en" className={!ar ? 'selected' : ''} onClick={() => { setLanguage('en'); write('interface-language', 'en'); }}>English</button><button data-testid="language-ar" className={ar ? 'selected' : ''} onClick={() => { setLanguage('ar'); write('interface-language', 'ar'); }}>العربية</button></div></div>}
  </div>;
}

function CategoryChips({ ar, active, onSelect }: { ar: boolean; active: Category; onSelect: (category: Category) => void }) { return <div className="approved-chips" aria-label={ar ? 'فلاتر الاكتشاف' : 'Discovery categories'}>{categories.map((item) => <button key={item.id} data-testid={`category-${item.id}`} className={item.id === active ? 'active' : ''} onClick={() => onSelect(item.id)}>{ar ? item.ar : item.en}</button>)}</div>; }
function Avatar() { return <div className="approved-avatar"><img src={media('fheed-profile.webp')} alt="Fheed Alaiban" /></div>; }
function SimpleScreen({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) { return <section><span className="approved-kicker">{kicker}</span><h1 className="approved-title">{title}</h1>{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="approved-empty">{text}</div>; }
function EditCard({ edit, ar, saved, onSave, onOpen }: { edit: CreatorEdit; ar: boolean; saved: boolean; onSave: () => void; onOpen: () => void }) { return <article className="approved-card" data-testid={`edit-card-${edit.id}`}><button className="approved-art" style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop) }} onClick={onOpen}><img src={imageSrc(edit.image)} alt={edit.altText} />{edit.access === 'locked' && <span className="approved-access"><LockKeyhole size={11} /> {ar ? 'للمشتركين فقط' : 'Subscribers only'}</span>}</button><div className="approved-caption"><div className="approved-caption-row"><button className="approved-card-title" data-testid={`edit-title-${edit.id}`} onClick={onOpen}>{ar ? edit.titleAr : edit.title}</button><button className={`approved-save ${saved ? 'saved' : ''}`} data-testid={`save-${edit.id}`} onClick={onSave} aria-label={saved ? (ar ? 'إزالة من المحفوظات' : 'Remove from saved') : (ar ? 'حفظ التعديل' : 'Save Edit')} aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button></div><span>{ar ? edit.captionAr : edit.caption}</span></div></article>; }
function EditDetail({ edit, ar, subscribed, saved, onSave, onSubscribe }: { edit: CreatorEdit; ar: boolean; subscribed: boolean; saved: boolean; onSave: () => void; onSubscribe: () => void }) { const locked = edit.access === 'locked'; const outfitItems = (edit.outfitItems || []).filter((item) => item.type || item.brand || item.name); return <SimpleScreen kicker={locked ? (ar ? 'للمشتركين فقط' : 'Subscribers only') : (ar ? 'تعديل عام' : 'Public Edit')} title={ar ? edit.titleAr || edit.title : edit.title}><div className={`approved-detail-art ${locked ? 'locked' : ''}`} style={{ aspectRatio: cropAspectRatio(edit.crop?.aspect, edit.crop), height: 'auto' }}><img src={imageSrc(edit.image)} alt={edit.altText} />{locked && <div><LockKeyhole size={26} /><strong>{ar ? edit.titleAr || edit.title : edit.title}</strong></div>}</div>{(edit.location || edit.locationAr) && <div className="approved-location"><MapPin size={14} />{ar ? edit.locationAr || edit.location : edit.location}</div>}{locked ? <div className="approved-panel"><h3>{ar ? 'هذا التعديل للمشتركين' : 'This edit is for subscribers'}</h3><p>{ar ? 'تظل الوسائط الخاصة محمية إلى أن يتم تأكيد اشتراكك في حسابك.' : 'Private media stays protected until your subscription is confirmed on your account.'}</p><button className="approved-button primary wide" onClick={onSubscribe}>{subscribed ? (ar ? 'بانتظار تأكيد الاشتراك' : 'Subscription pending confirmation') : <Price ar={ar} />}</button></div> : <><p>{ar ? edit.captionAr || edit.caption : edit.caption}</p>{edit.showOutfitDetails && outfitItems.length > 0 && <div className="outfit-published"><h3>{ar ? 'تفاصيل الإطلالة' : 'Outfit details'}</h3>{outfitItems.map((item, index) => <div key={index}><strong>{item.type || item.name}</strong><span>{[item.brand, item.name].filter(Boolean).join(' · ')}</span>{item.link && <a href={item.link} target="_blank" rel="noreferrer">{ar ? 'عرض المنتج' : 'View item'}</a>}</div>)}</div>}<button className={`approved-button wide ${saved ? 'primary' : ''}`} onClick={onSave}>{saved ? (ar ? 'تم الحفظ' : 'Saved') : (ar ? 'احفظ هذا التعديل' : 'Save this edit')}</button></>}</SimpleScreen>; }
function Profile({ ar, owner, following, subscribed, edits, onFollow, onSubscribe, onEdit, onCollections, onAbout, onMatch }: { ar: boolean; owner: boolean; following: boolean; subscribed: boolean; edits: CreatorEdit[]; onFollow: () => void; onSubscribe: () => void; onEdit: (edit: CreatorEdit) => void; onCollections: () => void; onAbout: () => void; onMatch: () => void }) { return <section><div className="approved-profile-head"><Avatar /><div><div className="approved-name"><h1>{ar ? 'فهيد العيبان' : 'Fheed Alaiban'}</h1><Check size={15} /></div><span><bdi dir="ltr">@fheed</bdi></span><p>{ar ? 'مدينة الكويت، الكويت · أزياء وإطلالات · سفر · أماكن' : 'Kuwait City, Kuwait · Fashion & Outfits · Travel · Places'}</p></div></div><button className="approved-match" onClick={onMatch}>{ar ? 'تطابق ذوق ٩٢٪' : '92% Taste Match'}</button><div className="approved-actions">{owner ? <button className="approved-button primary" onClick={() => onEdit(edits[0])}>{ar ? 'تعديل الملف' : 'Edit profile'}</button> : <><button className="approved-button" onClick={onFollow}>{following ? (ar ? 'تتابع' : 'Following') : (ar ? 'متابعة' : 'Follow')}</button><button className="approved-button primary" onClick={onSubscribe}>{subscribed ? (ar ? 'مشترك' : 'Subscribed') : <Price ar={ar} />}</button></>}</div><div className="approved-tabs"><button className="active" onClick={() => onEdit(edits[0])}>{ar ? 'التعديلات' : 'Edits'}</button><button onClick={onCollections}>{ar ? 'المجموعات' : 'Collections'}</button><button onClick={onAbout}>{ar ? 'حول' : 'About'}</button></div><div className="approved-grid">{edits.slice(0, 6).map((edit) => <button className="approved-grid-card" key={edit.id} onClick={() => onEdit(edit)}><img src={imageSrc(edit.image)} alt={edit.altText} /><strong>{ar ? edit.titleAr : edit.title}</strong></button>)}</div></section>; }
function CreatorDashboard({ ar, edits, collections, busy, onNew, onEdit, onArchive, onUnarchive, onCollections }: { ar: boolean; edits: CreatorEdit[]; collections: CreatorCollection[]; busy: boolean; onNew: () => void; onEdit: (edit: CreatorEdit) => void; onArchive: (id: string) => void; onUnarchive: (id: string) => void; onCollections: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const groups: [EditStatus, string, string][] = [['draft', 'Drafts', 'مسودات'], ['published', 'Published', 'منشور'], ['archived', 'Archived', 'مؤرشف']]; return <section className="creator-workspace"><span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span><div className="workspace-head"><div><h1 className="approved-title">{t('Good afternoon, Fheed.', 'مساء الخير، فهيد.')}</h1><p>{t('Shape the next thing people save.', 'اصنع ما سيحفظه الناس لاحقاً.')}</p></div><button className="approved-button primary" onClick={onNew} disabled={busy}><Plus size={16} /> {t('New Edit', 'تعديل جديد')}</button></div><div className="creator-stats"><Stat value={edits.filter((item) => item.status === 'published').length} label={t('Published', 'منشور')} /><Stat value={edits.filter((item) => item.status === 'draft').length} label={t('Drafts', 'مسودات')} /><Stat value={collections.length} label={t('Collections', 'مجموعات')} /></div><button className="workspace-collection-link" onClick={onCollections} disabled={busy}><span><FileText size={17} /><strong>{t('Manage collections', 'إدارة المجموعات')}</strong></span><ChevronRight size={17} /></button>{groups.map(([status, en, arabic]) => <div className="workspace-section" key={status}><div className="workspace-section-head"><h2>{ar ? arabic : en}</h2><span>{edits.filter((item) => item.status === status).length}</span></div>{edits.filter((item) => item.status === status).map((item) => <div className="workspace-edit" key={item.id}><img src={imageSrc(item.image)} alt={item.altText} /><div><strong>{ar ? item.titleAr : item.title}</strong><span>{item.access === 'locked' ? t('Subscribers only', 'للمشتركين فقط') : t('Public', 'عام')} · {ar ? item.locationAr : item.location}</span></div><div className="workspace-edit-actions">{status === 'archived' ? <button onClick={() => onUnarchive(item.id)} disabled={busy}>{t('Restore', 'استعادة')}</button> : <><button onClick={() => onEdit(item)} aria-label={t('Edit', 'تعديل')} disabled={busy}><Pencil size={15} /></button><button onClick={() => onArchive(item.id)} aria-label={t('Archive', 'أرشفة')} disabled={busy}><Archive size={15} /></button></>}</div></div>)}{!edits.some((item) => item.status === status) && <Empty text={t('Nothing here yet.', 'لا يوجد شيء هنا بعد.')} />}</div>)}</section>; }
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

async function renderCrop(source: PreparedImage, crop: CropMetadata, longEdge = 1920) {
  const image = await loadImage(source.url);
  const target = cropDimensions(crop.aspect);
  const outputScale = Math.min(1, longEdge / Math.max(target.width, target.height));
  const width = Math.round(target.width * outputScale); const height = Math.round(target.height * outputScale);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!; context.fillStyle = '#eee8de'; context.fillRect(0, 0, width, height);
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * crop.zoom;
  context.save(); context.translate(width / 2 + (crop.x / 100) * width, height / 2 + (crop.y / 100) * height); context.rotate((crop.rotation * Math.PI) / 180); context.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale); context.restore();
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
  const withDimensions = (value: Omit<CropMetadata, 'outputWidth' | 'outputHeight'>) => ({ ...value, outputWidth: cropDimensions(value.aspect).width, outputHeight: cropDimensions(value.aspect).height });
  const defaultCrop = (): CropMetadata => withDimensions({ aspect: 'portrait', zoom: 1, x: 0, y: 0, rotation: 0, sourceWidth: source.width, sourceHeight: source.height });
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
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { const drag = dragRef.current; if (!drag) return; setCrop((value) => ({ ...value, x: Math.max(-46, Math.min(46, drag.cropX + (event.clientX - drag.x) / 2.8)), y: Math.max(-46, Math.min(46, drag.cropY + (event.clientY - drag.y) / 2.8)) })); };
  const reset = () => setCrop(defaultCrop());
  const formats = [{ id: 'portrait' as const, en: 'Post Portrait', ar: 'منشور عمودي', ratio: '4:5', pixels: '1080 × 1350' }, { id: 'square' as const, en: 'Post Square', ar: 'منشور مربع', ratio: '1:1', pixels: '1080 × 1080' }, { id: 'story' as const, en: 'Story / Reel', ar: 'قصة / ريلز', ratio: '9:16', pixels: '1080 × 1920' }];
  return <section className="crop-editor" aria-label={t('Crop image', 'اقتصاص الصورة')}><div className="composer-title"><div><span className="approved-kicker">{t('Image editor', 'محرر الصورة')}</span><h1 className="approved-title">{t('Frame your Edit', 'ضع تعديلك في الإطار')}</h1></div><button className="approved-icon" onClick={onCancel} aria-label={t('Cancel crop', 'إلغاء الاقتصاص')} disabled={busy}><X size={20} /></button></div><p className="crop-help">{t('Choose a format, drag to position, then zoom if needed.', 'اختر التنسيق واسحب للتموضع ثم كبّر عند الحاجة.')}</p><div className="crop-stage" style={{ aspectRatio: aspect }} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }}>{previewUrl && <img src={previewUrl} alt="" draggable={false} />}</div><div className="crop-aspects crop-aspects-three" aria-label={t('Crop format', 'تنسيق الاقتصاص')}>{formats.map((item) => <button key={item.id} className={crop.aspect === item.id ? 'selected' : ''} onClick={() => setCrop((value) => withDimensions({ ...value, aspect: item.id }))} disabled={busy}><strong>{ar ? item.ar : item.en}</strong><span dir="ltr">{item.ratio} · {item.pixels}</span></button>)}</div><div className="crop-slider"><span><ZoomOut size={16} /> {t('Zoom', 'تكبير')}</span><input aria-label={t('Zoom image', 'تكبير الصورة')} type="range" min="1" max="3" step=".02" value={crop.zoom} onChange={(event) => setCrop((value) => ({ ...value, zoom: Number(event.target.value) }))} disabled={busy} /><ZoomIn size={16} /></div><div className="crop-tool-row"><button onClick={reset} disabled={busy}>{t('Reset', 'إعادة ضبط')}</button></div>{error && <p className="workspace-notice" role="alert">{error}</p>}<div className="crop-actions"><button className="approved-button" onClick={onCancel} disabled={busy}>{t('Cancel', 'إلغاء')}</button><button className="approved-button primary" onClick={() => onConfirm(crop)} disabled={busy}>{busy ? t('Rendering…', 'جارٍ التجهيز…') : t('Done', 'تم')}</button></div></section>;
}

function EditComposer({ ar, form, collections, busy, onChange, onCropPrepared, onBack, onDraft, onPreview, onPublish }: { ar: boolean; form: EditForm; collections: CreatorCollection[]; busy: boolean; onChange: (form: EditForm) => void; onCropPrepared: (crop: PendingCrop) => void; onBack: () => void; onDraft: () => void; onPreview: () => void; onPublish: () => void }) {
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const [imageError, setImageError] = useState('');
  const [publishError, setPublishError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [pendingImage, setPendingImage] = useState<PreparedImage | null>(null);
  const update = <K extends keyof EditForm>(key: K, value: EditForm[K]) => onChange({ ...form, [key]: value });
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
  const tryPublish = () => { if (!form.image) { setPublishError(t('Choose an image before publishing.', 'اختر صورة قبل النشر.')); return; } setPublishError(''); onPublish(); };
  const outfitItems = form.outfitItems || [];
  const updateOutfit = (index: number, key: keyof OutfitItem, value: string) => update('outfitItems', outfitItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  if (pendingImage) return <CropEditor ar={ar} source={pendingImage} initialCrop={form.crop} error={imageError} busy={processing} onCancel={() => { URL.revokeObjectURL(pendingImage.url); setPendingImage(null); }} onConfirm={confirmCrop} />;
  return <section className="creator-composer"><span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span><div className="composer-title"><h1 className="approved-title">{t('Create an Edit', 'أنشئ تعديلاً')}</h1><button className="approved-icon" onClick={onBack} aria-label={t('Close editor', 'إغلاق المحرر')} disabled={busy}><X size={20} /></button></div><label className="image-uploader" style={{ aspectRatio: cropAspectRatio(form.crop?.aspect, form.crop) }}><img src={imageSrc(form.image)} alt={form.altText || ''} /><span><ImagePlus size={18} /> {processing ? t('Preparing…', 'جارٍ التجهيز…') : t('Edit crop', 'تعديل الاقتصاص')}</span><input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.heic,.heif" onChange={selectImage} disabled={processing || busy} /></label>{imageError && <p className="workspace-notice" role="alert">{imageError}</p>}<Field label={t('Caption (optional)', 'الوصف (اختياري)')} value={form.caption} onChange={(value) => onChange({ ...form, caption: value, captionAr: value })} multiline placeholder={t('Share a thought, in any language…', 'شارك فكرة بأي لغة…')} /><span className="form-label">{t('Visibility', 'الوصول')}</span><div className="access-toggle"><button className={form.access === 'public' ? 'selected' : ''} onClick={() => update('access', 'public')} disabled={busy}><Eye size={16} />{t('Public', 'عام')}</button><button className={form.access === 'locked' ? 'selected' : ''} onClick={() => update('access', 'locked')} disabled={busy}><LockKeyhole size={16} />{t('Subscribers Only', 'للمشتركين فقط')}</button></div><details className="composer-details"><summary>{t('Add details', 'أضف تفاصيل')}</summary><div className="details-body"><div className="form-two"><SelectField label={t('Category', 'الفئة')} value={form.category} onChange={(value) => update('category', value as Exclude<Category, 'All'>)} options={categories.filter((item) => item.id !== 'All').map((item) => ({ value: item.id, label: ar ? item.ar : item.en }))} /><Field label={t('Location', 'الموقع')} value={ar ? form.locationAr : form.location} onChange={(value) => update(ar ? 'locationAr' : 'location', value)} placeholder="Kuwait City" /></div><span className="form-label">{t('Collection', 'المجموعة')}</span><div className="collection-checks">{collections.map((collection) => <button key={collection.id} className={form.collectionIds.includes(collection.id) ? 'selected' : ''} onClick={() => update('collectionIds', form.collectionIds.includes(collection.id) ? form.collectionIds.filter((id) => id !== collection.id) : [...form.collectionIds, collection.id])} disabled={busy}>{form.collectionIds.includes(collection.id) && <Check size={14} />}{ar ? collection.titleAr : collection.title}</button>)}</div><details className="nested-details"><summary>{t('Add outfit or product details', 'أضف تفاصيل الإطلالة أو المنتج')}</summary><div className="details-body"><label className="outfit-switch"><input type="checkbox" checked={Boolean(form.showOutfitDetails)} onChange={(event) => update('showOutfitDetails', event.target.checked)} /> {t('Show outfit details under this Edit', 'اعرض تفاصيل الإطلالة أسفل هذا التعديل')}</label>{outfitItems.map((item, index) => <div className="outfit-row" key={index}><input value={item.type} onChange={(event) => updateOutfit(index, 'type', event.target.value)} placeholder={t('Item type', 'نوع القطعة')} /><input value={item.brand} onChange={(event) => updateOutfit(index, 'brand', event.target.value)} placeholder={t('Brand or store', 'العلامة أو المتجر')} /><input value={item.name} onChange={(event) => updateOutfit(index, 'name', event.target.value)} placeholder={t('Product name', 'اسم المنتج')} /><input value={item.link} onChange={(event) => updateOutfit(index, 'link', event.target.value)} placeholder={t('Product link', 'رابط المنتج')} /></div>)}<button className="approved-button" type="button" onClick={() => update('outfitItems', [...outfitItems, { type: '', brand: '', name: '', link: '' }])}>{t('Add another item', 'أضف قطعة أخرى')}</button></div></details></div></details><details className="composer-details"><summary>{t('Accessibility & advanced', 'إمكانية الوصول والمتقدم')}</summary><div className="details-body"><Field label={t('Alt text', 'النص البديل')} value={form.altText} onChange={(value) => update('altText', value)} placeholder={t('Describe the image for everyone.', 'صف الصورة للجميع.')} /></div></details>{publishError && <p className="workspace-notice" role="alert">{publishError}</p>}<div className="composer-actions"><button className="approved-button" onClick={onDraft} disabled={processing || busy}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save draft', 'حفظ كمسودة')}</button><button className="approved-button" onClick={onPreview} disabled={processing || busy}>{t('Preview', 'معاينة')}</button><button className="approved-button primary" onClick={tryPublish} disabled={processing || busy}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Publish', 'نشر')}</button></div></section>;
}
function Field({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean }) { return <label className="form-field"><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3} /> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>; }
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function CreatorPreview({ ar, busy, edit, onBack, onPublish }: { ar: boolean; busy: boolean; edit: CreatorEdit; onBack: () => void; onPublish: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const [publishError, setPublishError] = useState(''); const tryPublish = () => { if (!edit.image) { setPublishError(t('Choose an image before publishing.', 'اختر صورة قبل النشر.')); return; } onPublish(); }; return <SimpleScreen kicker={t('Consumer preview', 'معاينة للمستهلك')} title={t('This is how it will appear.', 'هكذا سيظهر.') }><p>{t('Your wording, access label, and image appear exactly as they will in the consumer feed.', 'ستظهر كتابتك وعلامة الوصول والصورة كما ستظهر في تغذية المستهلك.')}</p><EditCard edit={edit} ar={ar} saved={false} onSave={() => undefined} onOpen={() => undefined} />{publishError && <p className="workspace-notice" role="alert">{publishError}</p>}<div className="composer-actions"><button className="approved-button" onClick={onBack} disabled={busy}>{t('Keep editing', 'متابعة التعديل')}</button><button className="approved-button primary" onClick={tryPublish} disabled={busy}>{t('Publish Edit', 'نشر التعديل')}</button></div></SimpleScreen>; }
function CollectionManager({ ar, collections, published, form, editing, onChange, onEdit, onNew, onSave }: { ar: boolean; collections: CreatorCollection[]; published: CreatorEdit[]; form: CollectionForm; editing: string | null; onChange: (form: CollectionForm) => void; onEdit: (item?: CreatorCollection) => void; onNew: () => void; onSave: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; const update = <K extends keyof CollectionForm>(key: K, value: CollectionForm[K]) => onChange({ ...form, [key]: value }); return <section className="creator-composer"><span className="approved-kicker">{t('Creator Workspace', 'مساحة المبدع')}</span><div className="workspace-head"><div><h1 className="approved-title">{t('Collections', 'المجموعات')}</h1><p>{t('Group recommendations into a complete taste world.', 'اجمع التوصيات في عالم ذوق متكامل.')}</p></div><button className="approved-button" onClick={onNew}><Plus size={15} /> {t('New', 'جديد')}</button></div><div className="manager-list">{collections.map((item) => <button className="workspace-collection-link" key={item.id} onClick={() => onEdit(item)}><span><img src={imageSrc(published.find((edit) => edit.id === item.coverEditId)?.image || media('quiet-tailoring.webp'))} alt="" /><strong>{ar ? item.titleAr : item.title}</strong></span><Pencil size={16} /></button>)}</div><div className="manager-form"><h2>{editing ? t('Edit collection', 'تعديل المجموعة') : t('New collection', 'مجموعة جديدة')}</h2><Field label={t('Title', 'العنوان')} value={form.title} onChange={(value) => update('title', value)} placeholder="Collection title" /><Field label={t('Arabic title', 'العنوان بالعربية')} value={form.titleAr} onChange={(value) => update('titleAr', value)} placeholder="عنوان المجموعة" /><Field label={t('Description', 'الوصف')} value={form.description} onChange={(value) => update('description', value)} multiline placeholder="What holds it together?" /><Field label={t('Arabic description', 'الوصف بالعربية')} value={form.descriptionAr} onChange={(value) => update('descriptionAr', value)} multiline placeholder="ما الذي يجمعها؟" /><SelectField label={t('Cover Edit', 'تعديل الغلاف')} value={form.coverEditId} onChange={(value) => update('coverEditId', value)} options={published.map((item) => ({ value: item.id, label: ar ? item.titleAr : item.title }))} /><span className="form-label">{t('Visibility', 'الوصول')}</span><div className="access-toggle"><button className={form.access === 'public' ? 'selected' : ''} onClick={() => update('access', 'public')}>{t('Public', 'عام')}</button><button className={form.access === 'locked' ? 'selected' : ''} onClick={() => update('access', 'locked')}>{t('Subscribers Only', 'للمشتركين فقط')}</button></div><span className="form-label">{t('Included published Edits', 'التعديلات المنشورة المضمنة')}</span><div className="collection-checks">{published.map((item) => <button key={item.id} className={form.editIds.includes(item.id) ? 'selected' : ''} onClick={() => update('editIds', form.editIds.includes(item.id) ? form.editIds.filter((id) => id !== item.id) : [...form.editIds, item.id])}>{form.editIds.includes(item.id) && <Check size={14} />}{ar ? item.titleAr : item.title}</button>)}</div><button className="approved-button primary wide" onClick={onSave}>{editing ? t('Save changes', 'حفظ التغييرات') : t('Create collection', 'إنشاء المجموعة')}</button></div></section>; }
function CollectionDetail({ ar, collection, edits, canView, onOpen, onSubscribe }: { ar: boolean; collection: CreatorCollection; edits: CreatorEdit[]; canView: boolean; onOpen: (edit: CreatorEdit) => void; onSubscribe: () => void }) { const t = (en: string, arabic: string) => ar ? arabic : en; if (!canView && collection.access === 'locked') return <SimpleScreen kicker={t('Subscribers only', 'للمشتركين فقط')} title={ar ? collection.titleAr : collection.title}><div className="approved-panel collection-gate"><LockKeyhole size={25} /><h3>{t('A private collection from Fheed.', 'مجموعة خاصة من فهيد.')}</h3><p>{t('Subscribe to unlock the complete collection and its field notes.', 'اشترك لفتح المجموعة الكاملة وملاحظاتها.')}</p><button className="approved-button primary wide" onClick={onSubscribe}><Price ar={ar} /></button></div></SimpleScreen>; return <SimpleScreen kicker={ar ? 'مجموعة' : 'Collection'} title={ar ? collection.titleAr : collection.title}><img className="approved-collection-hero" src={imageSrc(edits[0]?.image || media('quiet-tailoring.webp'))} alt="" /><p>{ar ? collection.descriptionAr : collection.description}</p><h3 className="approved-kicker">{ar ? 'التعديلات المضمنة' : 'Included edits'}</h3><div className="approved-list">{edits.map((item) => <button key={item.id} onClick={() => onOpen(item)}><span>{ar ? item.titleAr : item.title}</span><ChevronRight size={17} /></button>)}</div></SimpleScreen>; }