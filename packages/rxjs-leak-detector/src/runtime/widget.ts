export type WidgetController = {
  setRecording(recording: boolean): void;
  unmount(): void;
};

type WidgetCallbacks = {
  onStart(): void;
  onStop(): void;
};

const DRAG_THRESHOLD = 4;

export function mountWidget(cb: WidgetCallbacks): WidgetController {
  const root = document.createElement('div');
  root.id = '__rld_widget';
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    zIndex: '2147483647',
    fontFamily: 'monospace',
    fontSize: '12px',
    background: '#2b2b2b',
    color: '#e8eaed',
    border: '1px solid #5f6368',
    borderRadius: '6px',
    padding: '6px 8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    cursor: 'move',
    touchAction: 'none',
    userSelect: 'none',
  });

  // --- draggable behavior ---
  let pointerStart: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;

  root.addEventListener('pointerdown', (e) => {
    const rect = root.getBoundingClientRect();
    pointerStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    moved = false;
    if (e.pointerId != null && typeof root.setPointerCapture === 'function') {
      root.setPointerCapture(e.pointerId);
    }
  });

  root.addEventListener('pointermove', (e) => {
    if (!pointerStart) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    moved = true;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.left = `${pointerStart.left + dx}px`;
    root.style.top = `${pointerStart.top + dy}px`;
  });

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId != null && typeof root.releasePointerCapture === 'function') {
      root.releasePointerCapture(e.pointerId);
    }
    pointerStart = null;
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  // Swallow the click that trails a drag so it never toggles recording.
  root.addEventListener(
    'click',
    (e) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    },
    true,
  );

  let recording = false;

  const render = () => {
    root.innerHTML = '';
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      background: recording ? '#f28b82' : '#3c4043',
      color: '#e8eaed',
      border: '1px solid #5f6368',
      padding: '4px 10px',
      cursor: 'pointer',
      font: 'inherit',
      borderRadius: '4px',
    });
    if (recording) {
      btn.textContent = '■ Stop';
      btn.dataset.action = 'stop';
      btn.addEventListener('click', (e) => { if (!e.defaultPrevented) cb.onStop(); });
      root.appendChild(btn);
    } else {
      btn.textContent = '● Rec';
      btn.dataset.action = 'start';
      btn.addEventListener('click', (e) => { if (!e.defaultPrevented) cb.onStart(); });
      root.appendChild(btn);
    }
  };

  render();
  document.body.appendChild(root);

  return {
    setRecording(r: boolean) { recording = r; render(); },
    unmount() { root.remove(); },
  };
}
