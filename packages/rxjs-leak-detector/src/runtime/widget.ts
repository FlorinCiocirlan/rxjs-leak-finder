export type WidgetController = {
  setRecording(recording: boolean): void;
  unmount(): void;
};

type WidgetCallbacks = {
  onStart(): void;
  onStop(): void;
  onMark(): void;
};

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
  });

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
      btn.addEventListener('click', () => cb.onStop());
      root.appendChild(btn);

      const mark = document.createElement('button');
      Object.assign(mark.style, {
        background: '#3c4043', color: '#e8eaed', border: '1px solid #5f6368',
        padding: '4px 10px', cursor: 'pointer', font: 'inherit',
        borderRadius: '4px', marginLeft: '6px',
      });
      mark.textContent = 'Mark Nav';
      mark.dataset.action = 'mark';
      mark.addEventListener('click', () => cb.onMark());
      root.appendChild(mark);
    } else {
      btn.textContent = '● Rec';
      btn.dataset.action = 'start';
      btn.addEventListener('click', () => cb.onStart());
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
