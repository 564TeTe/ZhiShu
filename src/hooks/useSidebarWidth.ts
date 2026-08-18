import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'sidebarWidth';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

function readStoredWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

export function useSidebarWidth() {
  const [width, setWidth] = useState(() => readStoredWidth());
  const widthRef = useRef(width);
  widthRef.current = width;

  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // Find the sidebar container to compute its left edge
    const sidebar = (event.target as HTMLElement).closest('[data-sidebar]');
    if (sidebar) sidebarRef.current = sidebar as HTMLDivElement;
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing.current) return;
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      const sidebarLeft = sidebar.getBoundingClientRect().left;
      // Clamp: width = mouseX - sidebarLeft, bounded
      const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - sidebarLeft));
      setWidth(nextWidth);
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(STORAGE_KEY, String(widthRef.current)); } catch { /* ignore */ }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return { sidebarWidth: width, onResizeStart: handleMouseDown };
}
