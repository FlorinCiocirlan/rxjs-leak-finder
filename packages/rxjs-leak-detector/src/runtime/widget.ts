export type WidgetController = {
  setRecording(recording: boolean): void;
  setLeakCount(n: number): void;
  unmount(): void;
};

type WidgetCallbacks = {
  onStart(): void;
  onStop(): void;
};

const DRAG_THRESHOLD = 4;

function ensurePulseStyle(): void {
  if (document.getElementById('__rld_pulse_style')) return;
  const style = document.createElement('style');
  style.id = '__rld_pulse_style';
  style.textContent = '@keyframes __rld_pulse{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}';
  document.head.appendChild(style);
}

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
  // The move/up listeners live on `document`, added on pointerdown and removed
  // on pointerup. That way the drag receives every move no matter where the
  // pointer travels — including off the widget in any direction. (The earlier
  // approach listened on the widget itself and lazily called setPointerCapture
  // inside pointermove; if the pointer left the widget before that first move
  // registered — e.g. grabbing the left edge and dragging left — capture never
  // engaged and the drag died. That was the "can't drag left" bug.)
  //
  // We deliberately do NOT use setPointerCapture: capturing retargets the
  // trailing `click` to root, which kills the Rec/Stop button.
  let pointerStart: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;

  const onMove = (e: PointerEvent) => {
    if (!pointerStart) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    moved = true;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.left = `${pointerStart.left + dx}px`;
    root.style.top = `${pointerStart.top + dy}px`;
  };

  const onUp = () => {
    pointerStart = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    // `moved` stays set until the click handler below consumes it.
  };

  root.addEventListener('pointerdown', (e) => {
    const rect = root.getBoundingClientRect();
    pointerStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    moved = false;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

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
  let leakCount = 0;

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
      const status = document.createElement('span');
      status.dataset.role = 'live';
      status.style.marginRight = '8px';
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
        background: '#f28b82', marginRight: '5px', animation: '__rld_pulse 1.4s infinite',
      });
      status.appendChild(dot);
      status.appendChild(document.createTextNode(`Rec · ${leakCount}`));
      root.appendChild(status);

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

  ensurePulseStyle();
  render();
  document.body.appendChild(root);

  return {
    setRecording(r: boolean) { recording = r; render(); },
    setLeakCount(n: number) { leakCount = n; if (recording) render(); },
    unmount() { root.remove(); },
  };
}
