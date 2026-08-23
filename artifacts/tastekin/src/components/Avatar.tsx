import React from 'react';

export default function Avatar({ profile, src }: { profile?: any; src?: string }) {
  const image = src || profile?.avatar;
  return (
    <div className="approved-avatar">
      {image ? <img src={image} alt={profile?.displayName || ''} /> : <span aria-hidden>?</span>}
    </div>
  );
}
