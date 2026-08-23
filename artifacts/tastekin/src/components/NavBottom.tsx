/* NavBottom: improved bottom navigation for mobile */
import React from 'react';
import { Home, Search, Plus, Bookmark, UserRound } from 'lucide-react';

export default function NavBottom({ active, onNavigate }: { active: string; onNavigate: (id: string) => void }) {
  const nav = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'explore', icon: Search, label: 'Explore' },
    { id: 'add', icon: Plus, label: 'Add' },
    { id: 'saved', icon: Bookmark, label: 'Saved' },
    { id: 'you', icon: UserRound, label: 'You' },
  ];

  return (
    <nav className="approved-bottom" aria-label="Primary navigation" style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}>
      {nav.map((item) => (
        <button key={item.id} className={`approved-bottom-item ${active === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)} aria-label={item.label}>
          <item.icon />
          <span className="approved-bottom-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
