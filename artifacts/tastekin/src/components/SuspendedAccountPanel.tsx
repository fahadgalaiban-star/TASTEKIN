export function SuspendedAccountPanel({ ar, supportEmail, onLogout, onDelete, onPrivacy, onTerms }: {
  ar: boolean; supportEmail?: string | null;
  onLogout: () => void; onDelete: () => void; onPrivacy: () => void; onTerms: () => void;
}) {
  return <section className="approved-panel" dir={ar ? "rtl" : "ltr"} style={{ direction: ar ? "rtl" : "ltr", textAlign: ar ? "right" : "left" }} aria-label={ar ? "الوصول للحساب الموقوف" : "Suspended account access"}>
    <h1>{ar ? "حسابك موقوف" : "Your account is suspended"}</h1>
    <p role="status">{ar ? "النشر والميزات الاجتماعية غير متاحة. يمكنك تسجيل الخروج أو حذف حسابك أو الاطلاع على المعلومات القانونية." :
      "Publishing and social features are unavailable. You can still sign out, delete your account, or view legal information."}</p>
    <button className="approved-button wide" onClick={onLogout}>{ar ? "تسجيل الخروج" : "Sign out"}</button>
    <button className="approved-button wide" onClick={onDelete}>{ar ? "حذف الحساب" : "Delete account"}</button>
    <button className="approved-button wide" onClick={onPrivacy}>{ar ? "سياسة الخصوصية" : "Privacy policy"}</button>
    <button className="approved-button wide" onClick={onTerms}>{ar ? "الشروط والأحكام" : "Terms"}</button>
    {supportEmail && <a href={`mailto:${supportEmail}`}>{ar ? "التواصل مع الدعم" : "Contact support"}</a>}
  </section>;
}