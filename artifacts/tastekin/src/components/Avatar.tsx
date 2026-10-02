import React from 'react';
import { MediaImage } from './MediaImage';

export default function Avatar({ profile, src }: { profile?: any; src?: string }) {
  const image = src || profile?.avatar;
  return (
    <div className="approved-avatar">
      {image ? <MediaImage src={image} alt={profile?.displayName || ''} /> : <span aria-hidden>?</span>}
    </div>
  );
}
