/* Shared simple components for loading / empty states */
import React from 'react';

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="approved-empty" aria-busy>{text}</div>;
}

export function Empty({ text }: { text: string }) {
  return <div className="approved-empty">{text}</div>;
}

export function ErrorMessage({ text }: { text: string }) {
  return <div role="alert" className="workspace-notice">{text}</div>;
}
