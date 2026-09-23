// Store-facing legal copy for TASTEKIN (Privacy Policy and Terms of Use), in
// English and Arabic. Both documents describe only what the product actually
// does today: a free app with no payments, no advertising, and no sale of
// personal data. When the product changes, update the text here AND bump the
// effective date below — the date is shown on every copy of both documents
// (Settings and the public /privacy and /terms pages).
//
// Facts that are intentionally NOT stated because they are not decided or not
// verifiable from the product: a legal entity name or registration number, a
// postal address, a governing jurisdiction. Contact is the support mailbox.

export const LEGAL_EFFECTIVE_DATE = '2026-09-23';
export const LEGAL_VERSION = 1;
export const SUPPORT_EMAIL = 'support@tastekin.app';

export type LegalDocumentKind = 'privacy' | 'terms';
export type LegalSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type LegalDocument = { title: string; intro: string; sections: LegalSection[] };

const privacyEn: LegalDocument = {
  title: 'Privacy Policy',
  intro: `This Privacy Policy explains what information TASTEKIN collects when you use the TASTEKIN app and website, how it is used, and the choices you have. TASTEKIN is free: there are no subscriptions, purchases or advertising, and we never sell your personal data. Questions: ${SUPPORT_EMAIL}.`,
  sections: [
    {
      heading: 'Information you give us',
      bullets: [
        'Account: your email address and, for email sign-up, a password (stored only as a hash). If you sign in with Google or Replit, we receive your name, email and profile picture link from that provider.',
        'Creator profile: display name, username, bio, city and country, interests, optional date of birth (your age is shown only if you turn that on), profile photo and cover photo.',
        'Content you create: Edits (photos, videos, captions, place details, ratings, reviews, outfit details and links), collections, drafts and archived items.',
        'Interactions: likes, saves and saved lists, comments, follows, My Circle members, and private messages you exchange with verified creators.',
        'My Things (KIN): photos of your clothing and the details you enter about each item. Photos are re-encoded on our servers, which removes camera metadata such as location.',
        'KIN searches: the questions you ask, any clothing photos you attach, and the trip details you enter (destination, dates, budget); saved recommendations and trips you choose to keep.',
        'Safety and trust: reports you file, accounts you block or mute, and verification applications (your statement and evidence links).',
        'Settings: interface language and notification preferences.',
      ],
    },
    {
      heading: 'Information collected automatically',
      bullets: [
        'Session data: a session cookie on the web, or a sign-in token stored in your phone\'s secure storage in the app, so you stay signed in.',
        'Usage events: privacy-safe product analytics such as "home viewed" or "edit viewed", stored with your account id or anonymously. We never record message text, search text, passwords or email addresses in analytics.',
        'Technical logs: your IP address and request details are processed to run the service, protect against abuse (for example login rate limiting) and diagnose errors. Logs are kept for a limited period.',
        'Creator insights: when you view a creator\'s profile or Edit while signed in, that view is counted so the creator can see aggregate numbers. Creators never see who viewed.',
      ],
    },
    {
      heading: 'How we use information',
      bullets: [
        'To provide the service: show your content, feeds, profiles, saves, messages and settings, and keep you signed in.',
        'To power KIN and My Things suggestions using an AI provider (see below).',
        'To keep TASTEKIN safe: reports, blocks, mutes, moderation and verification, and protecting accounts.',
        'To understand how the product is used, in aggregate.',
        'We do not use your information for advertising, and we do not sell it.',
      ],
    },
    {
      heading: 'Service providers',
      paragraphs: ['We use a small number of providers that process data on our behalf, only to operate the features described here:'],
      bullets: [
        'Replit: application hosting, file storage for photos, and "Continue with Replit" sign-in.',
        'A managed PostgreSQL database that stores account and content data.',
        'Google: "Continue with Google" sign-in, and the Google Places API that KIN Travel uses to find places for the destination you type.',
        'Bunny.net: hosting, processing and streaming of videos you upload.',
        'Anthropic: the AI model that produces KIN Looks and KIN Travel answers and optional clothing-photo suggestions. Only the query, photos and trip details you submit for that request are sent.',
        'When KIN cites a website, we may fetch that page to show a link preview.',
      ],
    },
    {
      heading: 'Who can see your content',
      bullets: [
        'Published Edits, collections, your creator profile (name, username, bio, city, interests, photos and, if enabled, age) and your comments are public.',
        'Drafts, archived Edits, My Things, KIN searches, saved items, blocks, mutes, settings and private messages are visible only to you (messages are visible to both participants).',
        'Follower and following counts are never shown publicly.',
      ],
    },
    {
      heading: 'Retention and deletion',
      bullets: [
        'We keep your information while your account exists.',
        'You can delete your account at any time from Settings → Delete account, or on the web at /delete-account. Deletion removes your account, profile, Edits, collections, photos and videos, saved items, comments, follows, messages, My Things items and KIN history, and ends all your sessions.',
        'Reports, moderation records and administrative audit records may be retained after deletion with an internal identifier that no longer links to you, so that safety decisions remain accountable.',
        'Copies in server logs and backups expire on their own schedule.',
      ],
    },
    {
      heading: 'Your choices',
      bullets: [
        'Edit your profile and content from the app; change language and notification preferences in Settings.',
        'Choose whether your age is shown; choose what to publish, save or keep private.',
        'Block, mute or report accounts.',
        'Delete your account as described above, or write to us at the address below with any request about your data.',
      ],
    },
    {
      heading: 'Security',
      paragraphs: ['Passwords are stored only as bcrypt hashes; app sign-in tokens are stored hashed on our servers and in your device\'s secure storage; private photos are served through short-lived signed links. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.'],
    },
    {
      heading: 'Children',
      paragraphs: ['TASTEKIN is not directed at children under 13, and we do not knowingly collect personal data from them. If you believe a child has created an account, contact us and we will delete it.'],
    },
    {
      heading: 'Changes to this policy',
      paragraphs: [`We may update this policy as TASTEKIN changes. The effective date at the top of this page is updated with every change, and material changes are announced in the app. This version is effective ${LEGAL_EFFECTIVE_DATE}.`],
    },
    {
      heading: 'Contact',
      paragraphs: [`TASTEKIN — ${SUPPORT_EMAIL}`],
    },
  ],
};

const privacyAr: LegalDocument = {
  title: 'سياسة الخصوصية',
  intro: `توضح سياسة الخصوصية هذه المعلومات التي يجمعها TASTEKIN عند استخدامك لتطبيق TASTEKIN وموقعه، وكيف نستخدمها، والخيارات المتاحة لك. TASTEKIN مجاني: لا توجد اشتراكات أو مشتريات أو إعلانات، ولا نبيع بياناتك الشخصية أبداً. للاستفسار: ${SUPPORT_EMAIL}.`,
  sections: [
    {
      heading: 'المعلومات التي تقدمها لنا',
      bullets: [
        'الحساب: بريدك الإلكتروني، وكلمة مرور عند التسجيل بالبريد الإلكتروني (تُحفظ على شكل تجزئة فقط). عند تسجيل الدخول عبر Google أو Replit نتلقى اسمك وبريدك الإلكتروني ورابط صورة ملفك من ذلك المزوّد.',
        'ملف المبدع: الاسم المعروض، اسم المستخدم، النبذة، المدينة والدولة، الاهتمامات، تاريخ الميلاد اختيارياً (يُعرض عمرك فقط إذا فعّلت ذلك)، صورة الملف وصورة الغلاف.',
        'المحتوى الذي تنشئه: التعديلات (الصور والفيديوهات والتعليقات وتفاصيل الأماكن والتقييمات والمراجعات وتفاصيل الإطلالات والروابط)، المجموعات، المسودات والعناصر المؤرشفة.',
        'التفاعلات: الإعجابات، المحفوظات وقوائم الحفظ، التعليقات، المتابعات، أعضاء دائرتك، والرسائل الخاصة التي تتبادلها مع المبدعين الموثّقين.',
        'أشيائي (KIN): صور ملابسك والتفاصيل التي تُدخلها عن كل قطعة. تُعاد معالجة الصور على خوادمنا، ما يزيل بيانات الكاميرا الوصفية مثل الموقع.',
        'عمليات بحث KIN: الأسئلة التي تطرحها، وأي صور ملابس ترفقها، وتفاصيل الرحلة التي تُدخلها (الوجهة والتواريخ والميزانية)؛ والتوصيات والرحلات التي تختار حفظها.',
        'الأمان والثقة: البلاغات التي تقدمها، الحسابات التي تحظرها أو تكتمها، وطلبات التوثيق (بيانك وروابط الإثبات).',
        'الإعدادات: لغة الواجهة وتفضيلات الإشعارات.',
      ],
    },
    {
      heading: 'المعلومات التي تُجمع تلقائياً',
      bullets: [
        'بيانات الجلسة: ملف تعريف ارتباط للجلسة على الويب، أو رمز تسجيل دخول محفوظ في التخزين الآمن لهاتفك داخل التطبيق، لتبقى مسجلاً للدخول.',
        'أحداث الاستخدام: تحليلات منتج تراعي الخصوصية مثل "مشاهدة الرئيسية" أو "مشاهدة تعديل"، تُحفظ مع معرّف حسابك أو بشكل مجهول. لا نسجل أبداً نصوص الرسائل أو نصوص البحث أو كلمات المرور أو عناوين البريد في التحليلات.',
        'السجلات التقنية: يُعالج عنوان IP الخاص بك وتفاصيل الطلبات لتشغيل الخدمة، والحماية من إساءة الاستخدام (مثل تقييد محاولات تسجيل الدخول)، وتشخيص الأخطاء. تُحفظ السجلات لفترة محدودة.',
        'إحصاءات المبدع: عند عرض ملف مبدع أو تعديل وأنت مسجل الدخول، تُحتسب المشاهدة ليرى المبدع أرقاماً إجمالية. لا يرى المبدعون أبداً من شاهد.',
      ],
    },
    {
      heading: 'كيف نستخدم المعلومات',
      bullets: [
        'لتقديم الخدمة: عرض محتواك والخلاصات والملفات والمحفوظات والرسائل والإعدادات، وإبقاؤك مسجلاً للدخول.',
        'لتشغيل اقتراحات KIN وأشيائي عبر مزوّد ذكاء اصطناعي (انظر أدناه).',
        'للحفاظ على أمان TASTEKIN: البلاغات والحظر والكتم والإشراف والتوثيق وحماية الحسابات.',
        'لفهم كيفية استخدام المنتج بشكل إجمالي.',
        'لا نستخدم معلوماتك للإعلانات، ولا نبيعها.',
      ],
    },
    {
      heading: 'مزوّدو الخدمة',
      paragraphs: ['نستعين بعدد محدود من المزوّدين الذين يعالجون البيانات نيابةً عنا، فقط لتشغيل الميزات الموضحة هنا:'],
      bullets: [
        'Replit: استضافة التطبيق، وتخزين ملفات الصور، وتسجيل الدخول عبر "المتابعة عبر Replit".',
        'قاعدة بيانات PostgreSQL مُدارة تخزّن بيانات الحساب والمحتوى.',
        'Google: تسجيل الدخول عبر "المتابعة عبر Google"، وواجهة Google Places التي يستخدمها KIN Travel للعثور على الأماكن في الوجهة التي تكتبها.',
        'Bunny.net: استضافة ومعالجة وبث الفيديوهات التي ترفعها.',
        'Anthropic: نموذج الذكاء الاصطناعي الذي ينتج إجابات KIN Looks وKIN Travel والاقتراحات الاختيارية لصور الملابس. يُرسل فقط الاستعلام والصور وتفاصيل الرحلة التي تقدمها لذلك الطلب.',
        'عندما يستشهد KIN بموقع إلكتروني، قد نجلب تلك الصفحة لعرض معاينة للرابط.',
      ],
    },
    {
      heading: 'من يمكنه رؤية محتواك',
      bullets: [
        'التعديلات المنشورة، والمجموعات، وملف المبدع الخاص بك (الاسم واسم المستخدم والنبذة والمدينة والاهتمامات والصور، والعمر إذا فعّلته)، وتعليقاتك، كلها عامة.',
        'المسودات، والتعديلات المؤرشفة، وأشيائي، وعمليات بحث KIN، والعناصر المحفوظة، والحظر، والكتم، والإعدادات، والرسائل الخاصة تظهر لك وحدك (تظهر الرسائل لطرفي المحادثة).',
        'لا تُعرض أعداد المتابعين والمتابَعين علناً أبداً.',
      ],
    },
    {
      heading: 'الاحتفاظ والحذف',
      bullets: [
        'نحتفظ بمعلوماتك ما دام حسابك موجوداً.',
        'يمكنك حذف حسابك في أي وقت من الإعدادات ← حذف الحساب، أو على الويب عبر /delete-account. يزيل الحذف حسابك وملفك وتعديلاتك ومجموعاتك وصورك وفيديوهاتك وعناصرك المحفوظة وتعليقاتك ومتابعاتك ورسائلك وعناصر أشيائي وسجل KIN، ويُنهي جميع جلساتك.',
        'قد نحتفظ بالبلاغات وسجلات الإشراف والسجلات الإدارية بعد الحذف بمعرّف داخلي لم يعد مرتبطاً بك، حفاظاً على مساءلة قرارات السلامة.',
        'تنتهي النسخ الموجودة في سجلات الخوادم والنسخ الاحتياطية وفق جدولها الخاص.',
      ],
    },
    {
      heading: 'خياراتك',
      bullets: [
        'عدّل ملفك ومحتواك من التطبيق؛ وغيّر اللغة وتفضيلات الإشعارات من الإعدادات.',
        'اختر ما إذا كان عمرك يُعرض؛ واختر ما تنشره أو تحفظه أو تُبقيه خاصاً.',
        'احظر الحسابات أو اكتمها أو أبلغ عنها.',
        'احذف حسابك كما هو موضح أعلاه، أو راسلنا على العنوان أدناه بأي طلب يتعلق ببياناتك.',
      ],
    },
    {
      heading: 'الأمان',
      paragraphs: ['تُحفظ كلمات المرور على شكل تجزئة bcrypt فقط؛ وتُحفظ رموز تسجيل الدخول في التطبيق مجزّأة على خوادمنا وفي التخزين الآمن لجهازك؛ وتُقدَّم الصور الخاصة عبر روابط موقّعة قصيرة الأجل. لا توجد طريقة نقل أو تخزين آمنة تماماً، ولا يمكننا ضمان الأمان المطلق.'],
    },
    {
      heading: 'الأطفال',
      paragraphs: ['TASTEKIN غير موجّه للأطفال دون 13 عاماً، ولا نجمع عن علم بيانات شخصية منهم. إذا كنت تعتقد أن طفلاً أنشأ حساباً، تواصل معنا وسنحذفه.'],
    },
    {
      heading: 'التغييرات على هذه السياسة',
      paragraphs: [`قد نحدّث هذه السياسة مع تطور TASTEKIN. يُحدَّث تاريخ السريان في أعلى هذه الصفحة مع كل تغيير، ويُعلن عن التغييرات الجوهرية داخل التطبيق. هذه النسخة سارية اعتباراً من ${LEGAL_EFFECTIVE_DATE}.`],
    },
    {
      heading: 'التواصل',
      paragraphs: [`TASTEKIN — ${SUPPORT_EMAIL}`],
    },
  ],
};

const termsEn: LegalDocument = {
  title: 'Terms of Use',
  intro: `These Terms of Use govern your use of the TASTEKIN app and website. By creating an account or using TASTEKIN you agree to them. TASTEKIN is free to use. Questions: ${SUPPORT_EMAIL}.`,
  sections: [
    {
      heading: 'Eligibility and your account',
      bullets: [
        'You must be at least 13 years old to use TASTEKIN.',
        'Keep your sign-in details confidential. You are responsible for activity on your account. Tell us immediately if you believe it has been compromised; you can reset your password from the sign-in screen, which signs out every device.',
        'One person, one account. Do not impersonate anyone or misrepresent who you are.',
      ],
    },
    {
      heading: 'A free service',
      paragraphs: ['TASTEKIN does not charge for any feature. There are no subscriptions, in-app purchases, paid or locked content, or payment processing in the app. We may change or discontinue features at any time.'],
    },
    {
      heading: 'Your content',
      bullets: [
        'You own the content you post. You give TASTEKIN a non-exclusive, worldwide, royalty-free licence to host, store, process, reproduce and display it solely to operate and improve the service (for example, showing your Edits in feeds, resizing photos, and streaming video). The licence ends when you delete the content or your account, except for copies kept for safety records as described in the Privacy Policy.',
        'You must have the rights to everything you post, including photos of other people and third-party brands, places and links.',
        'Published Edits, collections, comments and your creator profile are public and may be seen by anyone, including people without an account.',
      ],
    },
    {
      heading: 'Acceptable use',
      paragraphs: ['Do not use TASTEKIN to:'],
      bullets: [
        'post content that is unlawful, hateful, harassing, threatening, sexually explicit, violent, or that violates someone\'s privacy or intellectual property;',
        'spam, scam or mislead people, or post deceptive links;',
        'harass other members through comments, messages or repeated contact;',
        'circumvent blocks, mutes, rate limits or other safety measures, or access the service by automated means except as we allow;',
        'interfere with the service or attempt to access accounts or data that are not yours.',
      ],
    },
    {
      heading: 'Safety, moderation and verification',
      bullets: [
        'You can report content or accounts, and block or mute accounts, at any time. Reports are reviewed by TASTEKIN administrators.',
        'We may remove content, restrict features, or suspend or terminate accounts that violate these Terms, without notice where necessary.',
        'The Taste Seal (verification) is granted at our discretion after reviewing an application. It confirms identity and authenticity as assessed by TASTEKIN and can be withdrawn.',
        'Private messages are available with verified creators only.',
      ],
    },
    {
      heading: 'KIN and AI features',
      bullets: [
        'KIN Looks, KIN Travel and My Things suggestions are generated by an AI model from the information you provide and may be inaccurate, incomplete or out of date. They are ideas, not professional, medical, safety or financial advice. Check details (opening hours, addresses, prices, availability) before relying on them.',
        'Places come from Google Places; links, products and websites shown or cited belong to third parties we do not control.',
        'Usage limits apply to KIN and photo uploads to keep the service available to everyone.',
      ],
    },
    {
      heading: 'Ending your account',
      bullets: [
        'You may delete your account at any time from Settings → Delete account or at /delete-account. Deletion is permanent and cannot be undone.',
        'We may suspend or terminate accounts that violate these Terms or where required to protect members or the service.',
      ],
    },
    {
      heading: 'Disclaimers and liability',
      bullets: [
        'TASTEKIN is provided "as is" and "as available" without warranties of any kind, to the fullest extent permitted by law. We do not guarantee that the service will be uninterrupted, error-free or free of harmful components, or that content from other members is accurate.',
        'To the fullest extent permitted by law, TASTEKIN is not liable for indirect, incidental or consequential damages, or for any loss arising from content posted by members, third-party services, or your reliance on AI-generated suggestions.',
        'Nothing in these Terms limits rights that applicable law does not allow to be limited.',
      ],
    },
    {
      heading: 'Changes',
      paragraphs: [`We may update these Terms as the service evolves. The effective date at the top of this page changes with every update; continued use after a change means you accept the updated Terms. This version is effective ${LEGAL_EFFECTIVE_DATE}.`],
    },
    {
      heading: 'Contact',
      paragraphs: [`TASTEKIN — ${SUPPORT_EMAIL}`],
    },
  ],
};

const termsAr: LegalDocument = {
  title: 'شروط الاستخدام',
  intro: `تحكم شروط الاستخدام هذه استخدامك لتطبيق TASTEKIN وموقعه. بإنشاء حساب أو استخدام TASTEKIN فإنك توافق عليها. استخدام TASTEKIN مجاني. للاستفسار: ${SUPPORT_EMAIL}.`,
  sections: [
    {
      heading: 'الأهلية وحسابك',
      bullets: [
        'يجب ألا يقل عمرك عن 13 عاماً لاستخدام TASTEKIN.',
        'حافظ على سرية بيانات تسجيل الدخول. أنت مسؤول عن النشاط في حسابك. أخبرنا فوراً إذا كنت تعتقد أنه تعرّض للاختراق؛ يمكنك إعادة تعيين كلمة المرور من شاشة تسجيل الدخول، وهو ما يُسجّل الخروج من جميع الأجهزة.',
        'شخص واحد، حساب واحد. لا تنتحل شخصية أحد ولا تُضلّل بشأن هويتك.',
      ],
    },
    {
      heading: 'خدمة مجانية',
      paragraphs: ['لا يفرض TASTEKIN رسوماً على أي ميزة. لا توجد اشتراكات أو مشتريات داخل التطبيق أو محتوى مدفوع أو مقفل أو معالجة مدفوعات في التطبيق. يجوز لنا تغيير الميزات أو إيقافها في أي وقت.'],
    },
    {
      heading: 'محتواك',
      bullets: [
        'أنت تملك المحتوى الذي تنشره. تمنح TASTEKIN ترخيصاً غير حصري وعالمياً وخالياً من الرسوم لاستضافته وتخزينه ومعالجته ونسخه وعرضه فقط لتشغيل الخدمة وتحسينها (مثل عرض تعديلاتك في الخلاصات، وتغيير حجم الصور، وبث الفيديو). ينتهي الترخيص عند حذف المحتوى أو حسابك، باستثناء النسخ المحفوظة لسجلات السلامة كما هو موضح في سياسة الخصوصية.',
        'يجب أن تملك الحقوق لكل ما تنشره، بما في ذلك صور الأشخاص الآخرين والعلامات التجارية والأماكن والروابط التابعة لأطراف ثالثة.',
        'التعديلات المنشورة والمجموعات والتعليقات وملف المبدع الخاص بك عامة ويمكن لأي شخص رؤيتها، بمن فيهم من لا يملكون حساباً.',
      ],
    },
    {
      heading: 'الاستخدام المقبول',
      paragraphs: ['لا تستخدم TASTEKIN من أجل:'],
      bullets: [
        'نشر محتوى غير قانوني أو يحض على الكراهية أو مضايق أو مهدد أو جنسي صريح أو عنيف، أو ينتهك خصوصية أحد أو ملكيته الفكرية؛',
        'إرسال رسائل مزعجة أو الاحتيال أو تضليل الناس، أو نشر روابط خادعة؛',
        'مضايقة الأعضاء الآخرين عبر التعليقات أو الرسائل أو التواصل المتكرر؛',
        'التحايل على الحظر أو الكتم أو حدود الاستخدام أو غيرها من إجراءات السلامة، أو الوصول إلى الخدمة بوسائل آلية إلا بما نسمح به؛',
        'التدخل في الخدمة أو محاولة الوصول إلى حسابات أو بيانات ليست لك.',
      ],
    },
    {
      heading: 'السلامة والإشراف والتوثيق',
      bullets: [
        'يمكنك الإبلاغ عن محتوى أو حسابات، وحظر الحسابات أو كتمها، في أي وقت. يراجع مسؤولو TASTEKIN البلاغات.',
        'يجوز لنا إزالة المحتوى أو تقييد الميزات أو تعليق الحسابات أو إنهاؤها عند مخالفة هذه الشروط، دون إشعار عند الضرورة.',
        'يُمنح ختم الذوق (التوثيق) وفق تقديرنا بعد مراجعة الطلب. وهو يؤكد الهوية والأصالة كما يقيّمها TASTEKIN ويمكن سحبه.',
        'الرسائل الخاصة متاحة مع المبدعين الموثّقين فقط.',
      ],
    },
    {
      heading: 'KIN وميزات الذكاء الاصطناعي',
      bullets: [
        'اقتراحات KIN Looks وKIN Travel وأشيائي يولّدها نموذج ذكاء اصطناعي من المعلومات التي تقدمها، وقد تكون غير دقيقة أو ناقصة أو قديمة. إنها أفكار وليست نصيحة مهنية أو طبية أو أمنية أو مالية. تحقق من التفاصيل (ساعات العمل والعناوين والأسعار والتوفر) قبل الاعتماد عليها.',
        'الأماكن مصدرها Google Places؛ والروابط والمنتجات والمواقع المعروضة أو المستشهد بها تعود لأطراف ثالثة لا نتحكم بها.',
        'تُطبّق حدود استخدام على KIN ورفع الصور لإبقاء الخدمة متاحة للجميع.',
      ],
    },
    {
      heading: 'إنهاء حسابك',
      bullets: [
        'يمكنك حذف حسابك في أي وقت من الإعدادات ← حذف الحساب أو عبر /delete-account. الحذف نهائي ولا يمكن التراجع عنه.',
        'يجوز لنا تعليق أو إنهاء الحسابات التي تخالف هذه الشروط أو عندما يلزم ذلك لحماية الأعضاء أو الخدمة.',
      ],
    },
    {
      heading: 'إخلاء المسؤولية والمسؤولية القانونية',
      bullets: [
        'يُقدَّم TASTEKIN "كما هو" و"حسب التوفر" دون أي ضمانات من أي نوع، إلى أقصى حد يسمح به القانون. لا نضمن أن الخدمة ستكون دون انقطاع أو خالية من الأخطاء أو من المكونات الضارة، أو أن محتوى الأعضاء الآخرين دقيق.',
        'إلى أقصى حد يسمح به القانون، لا يتحمل TASTEKIN المسؤولية عن الأضرار غير المباشرة أو العرضية أو التبعية، أو عن أي خسارة ناتجة عن محتوى ينشره الأعضاء أو خدمات الأطراف الثالثة أو اعتمادك على اقتراحات مولّدة بالذكاء الاصطناعي.',
        'لا شيء في هذه الشروط يحد من الحقوق التي لا يسمح القانون المعمول به بتقييدها.',
      ],
    },
    {
      heading: 'التغييرات',
      paragraphs: [`قد نحدّث هذه الشروط مع تطور الخدمة. يتغير تاريخ السريان في أعلى هذه الصفحة مع كل تحديث؛ ويعني الاستمرار في الاستخدام بعد التغيير قبولك للشروط المحدّثة. هذه النسخة سارية اعتباراً من ${LEGAL_EFFECTIVE_DATE}.`],
    },
    {
      heading: 'التواصل',
      paragraphs: [`TASTEKIN — ${SUPPORT_EMAIL}`],
    },
  ],
};

export function legalDocument(kind: LegalDocumentKind, language: 'en' | 'ar'): LegalDocument {
  if (kind === 'privacy') return language === 'ar' ? privacyAr : privacyEn;
  return language === 'ar' ? termsAr : termsEn;
}
