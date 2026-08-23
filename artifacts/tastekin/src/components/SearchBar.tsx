/* Simple SearchBar component with debounce */
import React, { useState, useEffect } from 'react';

export default function SearchBar({ value: initial = '', onChange }: { value?: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  useEffect(() => { setValue(initial); }, [initial]);
  useEffect(() => {
    const t = setTimeout(() => onChange(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value, onChange]);
  return (
    <div className="approved-search">
      <input aria-label="Search" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Search creators, places, and edits" />
    </div>
  );
}
