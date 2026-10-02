import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { API_BASE_URL, isNativeApp } from '../native';
import { loadPrivateImage, privateImagePath, type PrivateImageState } from '../lib/private-image';

type Props = ImgHTMLAttributes<HTMLImageElement>;

/** Public images and all ordinary-browser images keep their original element/URL. */
export function MediaImage(props: Props) {
  const path = isNativeApp ? privateImagePath(props.src, API_BASE_URL) : null;
  // Remount immediately on a source change: the previous URL can never be
  // rendered with the new source's props, even before effect cleanup runs.
  return path
    ? <NativePrivateImage key={props.src} {...props} path={path} />
    : <img {...props} />;
}

function NativePrivateImage({ path, src: _src, srcSet: _srcSet, onError, ...props }: Props & { path: string }) {
  const [state, setState] = useState<PrivateImageState>({ status: 'loading' });
  useEffect(() => loadPrivateImage(path, setState, {
    fetch: (...args) => window.fetch(...args),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  }), [path]);

  // Keep the existing <img> and its layout, but never fall back to an
  // unauthenticated request, signed URL, srcSet or token-bearing attribute.
  return <img {...props}
    src={state.status === 'ready' ? state.src : undefined}
    aria-busy={state.status === 'loading' || undefined}
    data-private-image-state={state.status}
    onError={(event) => { setState({ status: 'error' }); onError?.(event); }}
  />;
}