/**
 * Window - Draggable, resizable terminal window component
 *
 * Bear Hedge style with drag-from-anywhere, close button, resize handle.
 */

import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

interface WindowProps {
  id: string;
  title: string;
  isOpen: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onClose: () => void;
  onBringToFront: () => void;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  children: ReactNode;
}

export function Window({
  id,
  title,
  isOpen,
  zIndex,
  position,
  size,
  onClose,
  onBringToFront,
  onPositionChange,
  onSizeChange,
  children,
}: WindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't drag if clicking buttons, links, inputs, or close button
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, .window-close')) return;

    onBringToFront();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setStartPos(position);
  }, [position, onBringToFront]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      onPositionChange({
        x: startPos.x + deltaX,
        y: startPos.y + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart, startPos, onPositionChange]);

  // Track resize via ResizeObserver with debounce to prevent infinite loop
  useEffect(() => {
    const el = windowRef.current;
    if (!el) return;

    let timeoutId: NodeJS.Timeout | null = null;
    let lastWidth = size.width;
    let lastHeight = size.height;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const newWidth = Math.round(entry.contentRect.width + 2);
        const newHeight = Math.round(entry.contentRect.height + 2);

        // Only update if changed by more than 5px to prevent loop
        if (Math.abs(newWidth - lastWidth) > 5 || Math.abs(newHeight - lastHeight) > 5) {
          lastWidth = newWidth;
          lastHeight = newHeight;

          // Debounce the update
          if (timeoutId) clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            onSizeChange({ width: newWidth, height: newHeight });
          }, 100);
        }
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [onSizeChange, size.width, size.height]);

  if (!isOpen) return null;

  return (
    <div
      ref={windowRef}
      id={`window-${id}`}
      className="terminal-window"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex,
        background: '#000',
        border: '1px solid #333',
        resize: 'both',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div
        className="terminal-window__header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid #333',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, color: '#fff' }}>{title}</span>
        <button
          className="window-close"
          onClick={onClose}
          style={{
            fontSize: 12,
            color: '#888',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: '2px 6px',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={e => (e.currentTarget.style.color = '#888')}
        >
          close
        </button>
      </div>

      {/* Content */}
      <div
        className="terminal-window__content"
        style={{
          padding: 16,
          flex: 1,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.8,
          color: '#888',
        }}
      >
        {children}
      </div>

      {/* Resize handle indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 12,
          height: 12,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, #444 50%)',
        }}
      />
    </div>
  );
}
